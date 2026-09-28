import { prisma } from '../database/prisma';
import { decrementStock, type Shortfall, type StockTx } from './stock';
import { emFila } from './writeQueue';

/**
 * Criacao de pedido.
 *
 * Existe este servico por um motivo pontual: pedido e baixa de estoque
 * precisam ser o MESMO commit.
 *
 * Antes, os dois sítios que criam pedido (o PDV em server.ts e o bot em
 * bot.ts) faziam prisma.order.create() e depois chamavam registerSale(),
 * que abria a transacao dela. Eram dois commits: se o processo morresse -- ou
 * a transacao do estoque falhasse -- ficava pedido gravado com o estoque
 * intacto. E o inverso tambem valia,overselling silencioso, porque o clamp em
 * JS transformava venda sem saldo em venda normal.
 *
 * Aqui os dois saem juntos ou nao saem. A regra de preco NAO mudou: quem
 * calcula continua sendo priceCart, no servidor, e o que chega aqui ja vem
 * pronto. Este modulo nao precifica nada, so grava.
 *
 * E' o ponto natural para o futuro multi-loja: quando existir um tenantId, ele
 * entra no filtro daqui e de todo o resto, sem tocar nos chamadores.
 */

/** Dados do pedido. Espelha model Order, sem o que o banco calcula. */
export type NewOrder = {
    clientPhone: string;
    clientName?: string | null;
    /** Texto ja formatado pelo items.ts, com modificadores. */
    items: string;
    subtotal: number;
    discount?: number;
    tip?: number;
    total: number;
    notes?: string | null;
    status?: string;
    channel?: string;
    paymentMethod?: string | null;
};

export type CreatedOrder = {
    order: { id: string; total: number; createdAt: Date };
    /** Itens que venderam sem saldo. A venda segue valendo. */
    shortfalls: Shortfall[];
};

/**
 * Trava de escrita do SQLite. Nao e' falha de negocio, e' concorrencia.
 *
 * O "timed out" entra aqui pelo mesmo motivo: com muitas escritas disputando,
 * o Prisma falha por tempo, e repetir resolve. Erro de dado ou disco nao entra
 * nesta lista, porque insistir nao conserta e ainda segura a fila.
 */
function ehBancoTrancado(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return /database is locked|SQLITE_BUSY|write conflict|timed out|timeout/i.test(msg);
}

/**
 * Cria o pedido e baixa o estoque no mesmo commit.
 *
 * deductions vem de priceCart e ja vem resolvido nos componentes dos combos,
 * entao nao ha nada a resolver aqui.
 *
 * Retentativa
 *
 * SQLite serializa as escritas e devolve "database is locked" quando duas
 * secoes tentam escrever no mesmo instante. Isso acontece de verdade no pico:
 * balcao, bot do WhatsApp e fechamento de turno batem juntos. Como a leitura
 * do SQLITE_BUSY e' "tente de novo em um instante", repetir resolve quase
 * sempre, e um instante e' invisivel para quem esta na fila.
 *
 * So retentamos trava. Erro de dado ou disco sobe na hora, porque insistir
 * nao conserta e ainda atrasa o cliente na frente do balcao.
 */
export async function createOrderWithStock(
    data: NewOrder,
    deductions: Array<{ productId: string; qty: number }>,
    source: 'pdv' | 'whatsapp'
): Promise<CreatedOrder> {
    // A gravacao entra na fila antes de abrir transacao. E' aqui que o
    //imestamp de concorrencia morre: enquanto uma venda escreve, as outras
    // esperam, em vez de disputar o lock do SQLite e voltar com timeout.
    return emFila(() => criarComRetry(data, deductions, source));
}

/** O commit propriamente dito, com retentativa para travamento residual. */
async function criarComRetry(
    data: NewOrder,
    deductions: Array<{ productId: string; qty: number }>,
    source: 'pdv' | 'whatsapp'
): Promise<CreatedOrder> {
    const tentativas = 4;
    let ultimoErro: unknown;

    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
        try {
            return await prisma.$transaction(
                async (tx) => {
                    const order = await tx.order.create({
                        data: {
                            clientPhone: data.clientPhone,
                            clientName: data.clientName ?? null,
                            items: data.items,
                            subtotal: data.subtotal,
                            discount: data.discount ?? 0,
                            tip: data.tip ?? 0,
                            total: data.total,
                            notes: data.notes ?? null,
                            status: data.status ?? 'pendente',
                            channel: data.channel ?? source,
                            paymentMethod: data.paymentMethod ?? null,
                        },
                    });

                    // Nota usa o id do pedido recem-criado, entao a movimentacao
                    // fica rastreavel ate ele.
                    const shortfalls = await decrementStock(
                        tx as unknown as StockTx,
                        deductions,
                        source,
                        `Pedido #${order.id.slice(0, 8)}`
                    );

                    return { order, shortfalls };
                },
                { timeout: 10_000, maxWait: 5_000 }
            );
        } catch (error) {
            ultimoErro = error;
            // Com a fila, travamento residual e' raro. Ainda assim, se vier,
            // uma segunda tentativa custa quase nada.
            if (!ehBancoTrancado(error) || tentativa === tentativas) break;
            await new Promise((r) => setTimeout(r, 40 * tentativa));
        }
    }

    /*
     * A transacao inteira falhou, entao o pedido NAO foi criado. E' o ganho
     * deste servico: antes, o pedido ja estava gravado quando a baixa de
     * estoque falhava, e o sistema ficava mentindo sobre o saldo.
     *
     * Como nada foi criado, o caixa ou o cliente so tenta de novo. A excecao
     * sobe para quem chamou, que decide como avisar.
     */
    throw ultimoErro;
}
