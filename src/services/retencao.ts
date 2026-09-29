import * as fs from 'fs';
import { prisma } from '../database/prisma';
import { emFila } from './writeQueue';
import { logDoModulo, podarLogsDoDia } from './logger';
import { podarBackupsDoDia } from './backup';

const log = logDoModulo('retencao');

/**
 * A virada do dia: o que o sistema esquece a meia-noite.
 *
 * O QUE ISTO FAZ
 *
 * A loja fala com o cliente pelo WhatsApp, e o que o cliente escreve fica
 * guardado. A ideia e' simples: quando o dia vira, o dia anterior deixa de
 * existir. Mensagens, conversas da lista, backups e log do dia caem fora.
 *
 * O pedido e' esse, e a razao e' dupla: dado de cliente nao deveria ficar
 * guardado por tempo indeterminado numa maquina de loja, e banco que so cresce
 * enche o disco. A segunda razao e' a mais fraca das duas -- as mensagens
 * ocupam kilobyte -- mas oefeito de "guarda o que o dia fez" e' o mesmo nos dois
 * casos, e a regra fica mais simples de explicar: "vale para o dia de hoje".
 *
 * POR QUE MEIA-NOITE, E NAO "24 HORAS ATRAS"
 *
 * A janela movel (agora - 24h) tem uma propriedade ruim: cada mensagem vive um
 * tempo diferente, e o que "24h" significa muda a cada minuto. Ja o corte na
 * meia-noite tem uma propriedade que vale mais que a elegancia: e' idempotente.
 * Rodar 00:00, 00:15 ou as 09:00 de uma terca-feira, depois de o servidor ter
 * ficado dois dias desligado, produz exatamente o mesmo estado. Nao ha "ja fiz
 * a virada?" para guardar, nem marcador para perder, nem o caso do servidor que
 * ligou depois da meia-noite e deixou o dia inteiro nao guardado.
 *
 * O fuso e' o da maquina, o mesmo que o resto do sistema usa para "hoje" (o dia
 * do grafico, os pedidos concluidos de hoje). Nao ha fuso fixo no codigo porque
 * o PC da loja esta em Brasilia -- o que faria uma constante de pais diverge de
 * todo o resto, para resultado identico. O que a virada faz e um recorte, e o
 * recorte precisa casar com o dia que a tela ja mostra.
 *
 * POR QUE A FILA DE ESCRITA
 *
 * O DELETE vai para a mesma fila que as gravacoes. Um SQLite aceita uma
 * escrita por vez, e um `DELETE` de tabela cheia chegando fora de fila e' o
 * caminho curto para "database is locked" no meio de uma venda. A poda espera a
 * fila esvaziar e entra nela como mais uma tarefa.
 *
 * POR QUE O VACUUM ESTA AQUI
 *
 * Apagar linha no SQLite nao devolve espaco ao disco: o arquivo fica do mesmo
 * tamanho e o espaco vira lista livre, que a proxima gravacao reaproveita. Com
 * uma virada por dia, e' a unica forma de o arquivo realmente encolher --
 * e sem isso o `.db`, o `-wal` e o `-shm` so crescem, que e' exatamente o
 * sintoma que esta rotina existe para evitar.
 *
 * O VACUUM reescreve o arquivo inteiro e precisa do banco travado. Por isso ele
 * tem um teto: banco pequeno, reescrita instantanea. Passado o teto, apagar ja
 * devolve o espaco para a lista livre e a compactacao pode ser feita de
 * proposito, num momento escolhido, em vez de no meio de uma venda.
 *
 * Uma falha no VACUUM nunca interrompe a poda. O banco estar travado e' motivo
 * para pular a compactacao, nunca para devolver as mensagens que a poda apagou.
 */

/** De quanto em quanto tempo procurar por mensagens para apagar. */
const TICK_MS = 15 * 60_000;

/** Acima deste tamanho o VACUUM e' pulado. Ver a nota do arquivo. */
const LIMITE_VACUUM_BYTES = 50 * 1024 * 1024;

export type PodaResultado = {
    /** A meia-noite que separou ontem de hoje. */
    corte: Date;
    mensagens: number;
    /** Conversas de ontem que o bot atendia: saem da lista. */
    conversasRemovidas: number;
    /** Conversas de ontem que um humano assumiu: ficam, com a previa limpa. */
    conversasAssumidas: number;
    backupsRemovidos: number;
    logsRemovidos: number;
    /** O arquivo do banco encolheu? */
    compactou: boolean;
};

/**
 * Meia-noite do dia de `agora`, no fuso do processo.
 *
 * `new Date(d.getFullYear(), d.getMonth(), d.getDate())` e' a forma correta e
 * nao `toISOString().slice(0,10)`: o segundo devolve o dia em UTC, que joga
 * para o dia seguinte todo pedido feito depois das 21h -- exatamente o horario
 * em que a marmitaria funciona. Esse erro ja custou 8 pedidos aparecendo no
 * grafico com o dia errado.
 */
export function inicioDoDia(agora: Date): Date {
    return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

/**
 * "YYYY-MM-DD" no fuso do processo.
 *
 * Serve para comparar com o prefixo do nome dos arquivos, que ja e' esse
 * formato. Comparar string com string ordena por data sem abrir o arquivo e
 * sem interpretar nada -- e o nome do arquivo e' a unica data que ele tem.
 */
export function carimboDoDia(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * O caminho real do arquivo do banco, perguntado ao proprio SQLite.
 *
 * Reimplementar a resolucao do DATABASE_URL seria uma segunda fonte de
 * verdade: o Prisma resolve caminho relativo a pasta do schema, e um
 * `path.join(__dirname, ...)` aqui erraria justo nos casos que interessam
 * (banco em outro disco). `PRAGMA database_list` devolve o caminho que o motor
 * esta usando de fato.
 */
async function caminhoDoBanco(): Promise<string | null> {
    try {
        const linhas = await prisma.$queryRawUnsafe<{ file: string | null }[]>(`PRAGMA database_list`);
        const principal = linhas.find((l) => l.file);
        return principal?.file ?? null;
    } catch {
        return null;
    }
}

function tamanhoDe(caminho: string | null): number {
    if (!caminho) return 0;
    try {
        return fs.statSync(caminho).size;
    } catch {
        return 0;
    }
}

/**
 * Apaga o que e' do dia anterior. Pode rodar quantas vezes quiser: o corte e'
 * sempre a meia-noite de hoje, entao a segunda chamada no mesmo dia nao acha
 * nada e devolve zero em tudo.
 */
export async function podarDiaAnterior(agora: Date = new Date()): Promise<PodaResultado> {
    const corte = inicioDoDia(agora);
    const hoje = carimboDoDia(agora);

    /*
     * Tudo do banco numa unica fatia da fila, nao em varias.
     *
     * Separate as consultas em tarefas distintas pareceria mais granuloso, mas
     * abriria uma janela: o bot grava a mensagem de um cliente novo entre o
     * `deleteMany` das mensagens e o das conversas, e a conversa recem-criada
     * sobrevive sem a mensagem. Numa virada que acontece uma vez por dia o
     * resultado seria o mesmo, mas a razao pela qual a fila existe e' justamente
     * nao deixar a demonstracao para tras.
     */
    const apagado = await emFila(async () => {
        const mensagens = await prisma.message.deleteMany({
            where: { sentAt: { lt: corte } },
        });

        /*
         * Conversa que o bot atendia some da lista inteira.
         *
         * A linha e' removida, e nao esvaziada: enquanto ela existir, a lista
         * continua mostrando o nome e o telefone do cliente de ontem, que e'
         * dado tanto quanto o texto da mensagem. Esvaziar so o texto deixaria a
         * maior parte do dado pessoal do cliente parado no banco para sempre.
         *
         * O criterio e' o mesmo de `botPodeResponder`: quem tem `atendente`
         * diferente de 'bot' esta com o bot calado. Cliente que o bot atendia nao
         * fica com a conversa pela metade -- a proxima mensagem dele cria a
         * conversa de novo, como na primeira vez.
         *
         * A CONVERSA NAO PODE TER MENSAGEM DE HOJE PARA SER REMOVIDA -- e isso
         * nao e' uma checagem deste arquivo, e' uma propriedade do
         * `registrarMensagem`, que grava `lastMessageAt` com o mesmo instante
         * que grava o `sentAt` da mensagem. Entao "ultima mensagem de ontem" e
         * "conversa parada ontem" sao a mesma frase, por construcao.
         *
         * A propriedade importa porque `Message.chatId` tem `onDelete: Cascade`:
         * remover a linha leva junto as mensagens dela, sem discriminate. Se
         * essa equivalencia se quebrasse -- uma mensagem chegando com carimbo
         * antigo depois que a conversa foi atualizada, por exemplo -- acascade
         * levaria mensagem de hoje junto, e este `where` pareceria inocente. Por
         * isso o filtro e' em `lastMessageAt` e nao em `naoLidas` ou em
         * `updatedAt`: `lastMessageAt` e' o unico campo que significa "a
         * conversa parou em".
         */
        const conversas = await prisma.chat.deleteMany({
            where: { lastMessageAt: { lt: corte }, atendente: 'bot' },
        });

        return { mensagens: mensagens.count, conversas: conversas.count };
    });

    /*
     * Conversa assumida por humano continua na lista, sem o texto.
     *
     * Este e' o unico texto de cliente que a virada mantem, e a razao e'
     * comportamental, nao sentimental: sem a linha, `botPodeResponder` volta a
     * dizer que o bot pode atender, e um cliente que escreveu 23:50 receberia
     * resposta do bot as 00:10 enquanto o humano que o atendia ainda nao
     * voltou. A linha sobrevive com a previa e o contador zerados -- o que era
     * mensagem sai -- e o dono abre a conversa e clica em "Devolver ao bot".
     *
     * O `OR` no filtro e' o que impede o log de mentir: sem ele, o `updateMany`
     * conta como alteradas as linhas que ja estavam vazias, e a virada voltaria
     * a announcing um numero a cada 15 minutos. Assim a segunda rodada no mesmo
     * dia devolve zero, que e' o que faz o tick ser silencioso.
     */
    const preservadas = await emFila(() =>
        prisma.chat.updateMany({
            where: {
                lastMessageAt: { lt: corte },
                atendente: { not: 'bot' },
                OR: [{ ultimaMensagem: { not: '' } }, { naoLidas: { gt: 0 } }],
            },
            data: { ultimaMensagem: '', naoLidas: 0 },
        })
    );

    /*
     * Arquivos, fora da fila: sao disco, e o SQLite nao participa.
     *
     * O backup e' o ponto que mais importa aqui. Ele e' copia integral do banco,
     * entao continuaria sendo o lugar onde a mensagem de ontem sobrevive --
     * mesmo depois de a poda ter apagado tudo o mais. Depois da virada, so
     * ficam as copias de hoje, e o que a loja nao guardou e' o que nao esta
     * em lugar nenhum.
     */
    const caminhoAntes = await caminhoDoBanco();
    const tamanhoAntes = tamanhoDe(caminhoAntes);

    const backupsRemovidos = podarBackupsDoDia(hoje);
    const logsRemovidos = podarLogsDoDia(hoje).length;

    const mexeuEmAlgo =
        apagado.mensagens + apagado.conversas + preservadas.count + backupsRemovidos + logsRemovidos > 0;

    let compactou = false;
    if (caminhoAntes && tamanhoAntes > 0 && tamanhoAntes <= LIMITE_VACUUM_BYTES) {
        await emFila(async () => {
            try {
                await prisma.$executeRawUnsafe(`VACUUM`);
                compactou = true;
            } catch (error) {
                // Banco travado por outro processo: pular a compactacao e' o
                // resultado aceitavel. As mensagens continuam apagadas.
                log.debug('VACUUM pulado:', { erro: String(error) });
            }
        });
    }

    return {
        corte,
        mensagens: apagado.mensagens,
        conversasRemovidas: apagado.conversas,
        conversasAssumidas: preservadas.count,
        backupsRemovidos,
        logsRemovidos,
        compactou,
    };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Sobe a virada automatica. Idempotente: chamar duas vezes nao cria dois timers.
 *
 * O tick e' de quinze minutos, e o primeiro roda no boot. O boot importa: e' o
 * que cobre o servidor que ficou desligado a noite inteira e ligou as 09:00.
 * Com o corte ancorado na meia-noite de hoje, esse primeiro tick faz o mesmo
 * que teria feito a meia-noite.
 */
export function startPodador(): void {
    if (timer) return;

    const tick = async () => {
        try {
            const r = await podarDiaAnterior();
            if (!r.mensagens && !r.conversasRemovidas && !r.conversasAssumidas && !r.backupsRemovidos && !r.logsRemovidos) {
                // Silencio de proposito: sao 96 ticks por dia, e 96 linhas
                // dizendo "nada a fazer" esconde as que importam.
                log.debug('Nada a podar.');
                return;
            }

            const partes = [
                r.mensagens > 0 ? `${r.mensagens} mensagens` : '',
                r.conversasRemovidas > 0 ? `${r.conversasRemovidas} conversas` : '',
                r.conversasAssumidas > 0 ? `${r.conversasAssumidas} conversas assumidas, so com a previa limpa` : '',
                r.backupsRemovidos > 0 ? `${r.backupsRemovidos} backups de antes de hoje` : '',
                r.logsRemovidos > 0 ? `${r.logsRemovidos} logs de antes de hoje` : '',
            ].filter(Boolean);

            log.info(`Virada do dia (antes de ${carimboDoDia(r.corte)}): ${partes.join(', ')}.`);
            if (r.conversasAssumidas > 0) {
                log.warn(
                    'Essas conversas continuam com o bot calado. Abra cada uma e clique "Devolver ao bot" ' +
                        'quando voltar a atender.'
                );
            }
            if (!r.compactou && r.mensagens > 0) {
                log.info('O banco nao foi compactado; as mensagens sairam, mas o arquivo mantem o tamanho.');
            }
        } catch (error) {
            log.error('Falha na virada do dia:', error);
        }
    };

    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
    void tick();
}
