import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { prisma as prismaGlobal } from '../database/prisma';
import { comoLoja } from './loja';
import { venceTestes } from './assinaturas';
import { emFila } from './writeQueue';
import { logDoModulo, podarLogsDoDia } from './logger';
import { podarBackupsDoDia } from './backup';

const log = logDoModulo('retencao');

/**
 * Regra: vale para o dia de hoje. Corte na meia-noite, e nao "24 horas atras", porque
 * e' idempotente. O DELETE vai pela fila das gravacoes. Nao ha mais VACUUM: quem
 * devolve espaco ao disco e' a plataforma do Postgres gerenciado.
 */

/** De quanto em quanto tempo procurar por mensagens para apagar. */
const TICK_MS = 15 * 60_000;

export type PodaResultado = {
    /** A meia-noite que separou ontem de hoje. */
    corte: Date;
    mensagens: number;
    /** Conversas de ontem que o bot atendia: saem da lista. */
    conversasRemovidas: number;
    /** Pedidos que ficaram em aberto ate ontem e perderam o passo. */
    pedidosAbertos: number;
    /** Conversas de ontem que um humano assumiu: ficam, com a previa limpa. */
    conversasAssumidas: number;
    /** Pedido de marketplace que venceu o prazo da fila sem o PC buscar. */
    fila: number;
    backupsRemovidos: number;
    logsRemovidos: number;
    /** Sempre falso: quem compacta o Postgres gerenciado e' a plataforma. */
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
 * Executa a poda idempotente de mensagens e historico anterior a meia-noite.
 * Itera por todas as lojas ativas individualmente para isolar a limpeza.
 */
export async function podarDiaAnterior(agora: Date = new Date()): Promise<PodaResultado> {
    const corte = inicioDoDia(agora);
    const hoje = carimboDoDia(agora);

    const lojas = await prismaGlobal.tenant.findMany({ where: { ativo: true }, select: { id: true } });
    const total = { mensagens: 0, conversas: 0, pedidos: 0, preservadas: 0, fila: 0 };
    for (const { id } of lojas) {
        const r = await comoLoja(id, () => podaDaLoja(corte));
        total.mensagens += r.mensagens;
        total.conversas += r.conversas;
        total.pedidos += r.pedidosAbertos;
        total.preservadas += r.preservadas;
        total.fila += r.fila;
    }

    /*
     * Poda de disco, fora da fila: sao arquivos, e o Postgres nao participa. O
     * backup e' o que mais importa -- e' copia do banco, entao continua sendo onde
     * a mensagem de ontem sobrevive depois da poda ter apagado o resto.
     */
    const backupsRemovidos = podarBackupsDoDia(hoje);
    const logsRemovidos = podarLogsDoDia(hoje).length;

    const mexeuEmAlgo =
        total.mensagens + total.conversas + total.pedidos + total.preservadas + backupsRemovidos + logsRemovidos > 0;

    return {
        corte,
        mensagens: total.mensagens,
        conversasRemovidas: total.conversas,
        pedidosAbertos: total.pedidos,
        conversasAssumidas: total.preservadas,
        fila: total.fila,
        backupsRemovidos,
        logsRemovidos,
        // Quem devolve espaco ao disco e' a plataforma do Postgres gerenciado.
        compactou: false,
    };
}

/** A poda de UMA loja. Corre dentro de `comoLoja`, e e' por isso que nao recebe a loja. */
async function podaDaLoja(corte: Date): Promise<{ mensagens: number; conversas: number; pedidosAbertos: number; preservadas: number; fila: number }> {
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

        /*
         * O passo e o carrinho andam junto com a conversa: um pedido em aberto de
         * ontem apontaria para produtos que o dono pode ter pausado desde entao,
         * e a pessoa receberia a pergunta de um pedido que ja expirou.
         */
        const pedidos = await prisma.pedidoAberto.deleteMany({
            where: { atualizadoEm: { lt: corte } },
        });

        /*
         * A fila do marketplace tem prazo proprio, e nao o dia da loja: um pedido que
         * chegou ha dois dias nao e' mais do dia anterior. No PC da loja a tabela esta
         * vazia e este deleteMany nao faz nada, que e' o certo.
         */
        const fila = await prisma.pedidoEntrante.deleteMany({
            where: { expiraEm: { lt: new Date() } },
        });

        return {
            mensagens: mensagens.count,
            conversas: conversas.count,
            pedidos: pedidos.count,
            fila: fila.count,
        };
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

    return {
        mensagens: apagado.mensagens,
        conversas: apagado.conversas,
        pedidosAbertos: apagado.pedidos,
        preservadas: preservadas.count,
        fila: apagado.fila,
    };
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
            /*
             * O teste e' o tique mais importante da hora: fecha a porta de quem usou
             * os dias de teste e nunca pagou. Sem isto, "14 dias" seria teste eterno.
             */
            const testesVencidos = await venceTestes();
            if (testesVencidos > 0) {
                log.warn(`${testesVencidos} loja(s) perderam o acesso: o teste acabou sem pagamento.`);
            }

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
                r.pedidosAbertos > 0 ? `${r.pedidosAbertos} pedidos em aberto` : '',
                r.conversasAssumidas > 0 ? `${r.conversasAssumidas} conversas assumidas, so com a previa limpa` : '',
                r.backupsRemovidos > 0 ? `${r.backupsRemovidos} backups de antes de hoje` : '',
                r.logsRemovidos > 0 ? `${r.logsRemovidos} logs de antes de hoje` : '',
            ].filter(Boolean);

            log.info(`Virada do dia (antes de ${carimboDoDia(r.corte)}): ${partes.join(', ')}.`);
            if (r.conversasAssumidas > 0) {
                log.warn(
                    'Essas conversas continuam com o bot calado. Não há tela de conversas no painel: ' +
                        'quem assumir precisa olhar o WhatsApp pelo celular, e o cliente volta ao automático ' +
                        'escrevendo *menu* no próprio bot.'
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
