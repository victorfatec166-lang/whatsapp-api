import * as fs from 'fs';
import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { prisma as prismaGlobal } from '../database/prisma';
import { comoLoja } from './loja';
import { emFila } from './writeQueue';
import { logDoModulo, podarLogsDoDia } from './logger';
import { podarBackupsDoDia } from './backup';

const log = logDoModulo('retencao');

/**
 * Regra: vale para o dia de hoje. Corte na meia-noite, e nao "24 horas atras", porque
 * e' idempotente. O DELETE vai pela fila das gravacoes (fora dela e' "database is
 * locked") e o VACUUM existe porque apagar linha no SQLite nao devolve espaco ao disco.
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
 * Dia local, nunca toISOString: o segundo devolve UTC e joga para o dia seguinte
 * todo pedido feito depois das 21h -- ja custou 8 pedidos no grafico com dia errado.
 */
export function inicioDoDia(agora: Date): Date {
    return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

/**
 * Serve para comparar com o prefixo do nome dos arquivos: string ordena por data
 * sem abrir o arquivo -- e o nome e' a unica data que ele tem.
 */
export function carimboDoDia(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Pergunta ao motor em vez de reimplementar a resolucao do DATABASE_URL: o
 * Prisma resolve relativo a pasta do schema, e um path.join aqui erraria justo
 * no caso que importa -- banco em outro disco.
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
 * Executa a poda idempotente de mensagens e historico anterior a meia-noite.
 * Itera por todas as lojas ativas individualmente para isolar a limpeza.
 */
export async function podarDiaAnterior(agora: Date = new Date()): Promise<PodaResultado> {
    const corte = inicioDoDia(agora);
    const hoje = carimboDoDia(agora);

    const lojas = await prismaGlobal.tenant.findMany({ where: { ativo: true }, select: { id: true } });
    const total = { mensagens: 0, conversas: 0, preservadas: 0 };
    for (const { id } of lojas) {
        const r = await comoLoja(id, () => podaDaLoja(corte));
        total.mensagens += r.mensagens;
        total.conversas += r.conversas;
        total.preservadas += r.preservadas;
    }

    /*
     * Fora da fila: sao disco, e o SQLite nao participa. O backup e' o que mais
     * importa -- e' copia integral do banco, entao continuaria sendo onde a
     * mensagem de ontem sobrevive depois da poda ter apagado todo o resto.
     */
    const caminhoAntes = await caminhoDoBanco();
    const tamanhoAntes = tamanhoDe(caminhoAntes);

    const backupsRemovidos = podarBackupsDoDia(hoje);
    const logsRemovidos = podarLogsDoDia(hoje).length;

    const mexeuEmAlgo =
        total.mensagens + total.conversas + total.preservadas + backupsRemovidos + logsRemovidos > 0;

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
        mensagens: total.mensagens,
        conversasRemovidas: total.conversas,
        conversasAssumidas: total.preservadas,
        backupsRemovidos,
        logsRemovidos,
        compactou,
    };
}

/** A poda de UMA loja. Corre dentro de `comoLoja`, e e' por isso que nao recebe a loja. */
async function podaDaLoja(corte: Date): Promise<{ mensagens: number; conversas: number; preservadas: number }> {
    /*
     * Uma unica fatia da fila: separadas, abriria uma janela em que o bot grava
     * a mensagem de um cliente novo entre o deleteMany das mensagens e o das
     * conversas, e a conversa recem-criada sobrevive sem mensagem.
     */
    const apagado = await emFila(async () => {
        const mensagens = await prisma.message.deleteMany({
            where: { sentAt: { lt: corte } },
        });

        /*
         * A linha e' removida, e nao esvaziada: esvaziar so o texto deixaria nome e telefone
         * do cliente de ontem no banco. O filtro e' em lastMessageAt e nao em naoLidas ou
         * updatedAt porque registrarMensagem grava os dois juntos.
         */
        const conversas = await prisma.chat.deleteMany({
            where: { lastMessageAt: { lt: corte }, atendente: 'bot' },
        });

        return { mensagens: mensagens.count, conversas: conversas.count };
    });

    /*
     * Conversa assumida continua na lista, sem o texto: sem a linha, botPodeResponder
     * voltaria a dizer que o bot pode atender a quem escreveu 23:50. O OR no filtro
     * impede o log de mentir -- sem ele o updateMany conta linhas ja vazias a cada tick.
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

    return { mensagens: apagado.mensagens, conversas: apagado.conversas, preservadas: preservadas.count };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Idempotente: chamar duas vezes nao cria dois timers. O primeiro tick roda no
 * boot, e e' ele que cobre o servidor que ficou desligado a noite e ligou as 09:
 * com o corte ancorado na meia-noite de hoje, faz o mesmo que a meia-noite faria.
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
