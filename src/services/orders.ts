import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { decrementStock, type Shortfall, type StockTx } from './stock';
import { emFila } from './writeQueue';
import { exigeLoja } from './loja';

/**
 * Criacao de pedido. Este servico existe por um motivo pontual: pedido e baixa de
 * estoque precisam ser o MESMO commit -- antes eram dois, e o sistema ficava
 * mentindo sobre o saldo. Quem calcula preco continua sendo priceCart.
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
    /**
     * Id do pedido no marketplace de origem, gravado no MESMO commit do insert.
     * O indice unico (channel, externalId) so protege enquanto o valor estiver na
     * linha: um update depois abre a janela de um reenvio criar o pedido duas vezes.
     */
    externalId?: string | null;
};

export type CreatedOrder = {
    order: { id: string; total: number; createdAt: Date };
    /** Itens que venderam sem saldo. A venda segue valendo. */
    shortfalls: Shortfall[];
};

/**
 * Concorrencia de escrita: no Postgres ela aparece como deadlock ou espera de
 * lock vencida. Nao e' falha de negocio, e' disputa, e repetir resolve. Erro de
 * dado ou disco nao entra nesta lista -- insistir nao conserta e segura a fila.
 */
function ehBancoTrancado(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return /deadlock|lock timeout|could not obtain lock|write conflict|database is locked|SQLITE_BUSY|timed out|timeout/i.test(
        msg
    );
}

/**
 * Cria o pedido e baixa o estoque no mesmo commit. `deductions` vem de priceCart ja
 * resolvido nos componentes. So retentamos travamento: deadlock e' sinal de "tente
 * de novo em um instante"; erro de dado ou disco sobe na hora.
 */
export async function createOrderWithStock(
    data: NewOrder,
    deductions: Array<{ productId: string; qty: number }>,
    source: 'pdv' | 'whatsapp'
): Promise<CreatedOrder> {
    // A gravacao entra na fila antes de abrir transacao. E' aqui que o
    //imestamp de concorrencia morre: enquanto uma venda escreve, as outras
    // esperam, em vez de disputar a gravacao e estourar o timeout.
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
                            tenantId: exigeLoja(),
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
                            // No insert, nunca num update depois: ver o
                            // comentario de externalId em NewOrder.
                            externalId: data.externalId ?? null,
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
     * A transacao inteira falhou, entao o pedido NAO foi criado -- e' o ganho
     * deste servico. Como nada foi criado, so tenta de novo; a excecao sobe para
     * quem chamou, que decide como avisar.
     */
    throw ultimoErro;
}
