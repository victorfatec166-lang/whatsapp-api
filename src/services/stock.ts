import { prisma } from '../database/prisma';

export type MovementType = 'entrada' | 'saida' | 'perda' | 'ajuste';
export type MovementSource = 'pdv' | 'whatsapp' | 'manual';

export const MOVEMENT_LABELS: Record<MovementType, string> = {
    entrada: 'Entrada',
    saida: 'Saida',
    perda: 'Perda',
    ajuste: 'Ajuste',
};

export const MOVEMENT_BADGES: Record<MovementType, string> = {
    entrada: 'badge-emerald',
    saida: 'badge-red',
    perda: 'badge-orange',
    ajuste: 'badge-amber',
};

/** Tipos que aumentam o saldo. */
const INCREASING: MovementType[] = ['entrada'];

export type StockRow = {
    id: string;
    name: string;
    price: number;
    costPrice: number;
    category: string;
    stock: number;
    minStock: number;
    trackStock: boolean;
    isAvailable: boolean;
};

/**
 * Status de estoque de um produto.
 * - "sem-controle" quando trackStock = false (produto de servico/receita).
 * - "zerado" quando controlado e sem unidades.
 * - "baixo" quando controlado, acima de zero e no ou abaixo do minimo.
 * - "ok" no resto.
 *
 * `minStock` igual a zero significa "minimo nao definido": o produto nao gera
 * alerta de reposicao. Use `needsMinStock` para sinalizar isso na interface.
 */
export function stockStatus(row: { stock: number; minStock: number; trackStock: boolean }): 'ok' | 'baixo' | 'zerado' | 'sem-controle' {
    if (!row.trackStock) return 'sem-controle';
    if (row.stock <= 0) return 'zerado';
    if (row.minStock > 0 && row.stock <= row.minStock) return 'baixo';
    return 'ok';
}

/** Controlado porem sem minimo definido: nunca aparece na lista de reposicao. */
export function needsMinStock(row: { trackStock: boolean; minStock: number }): boolean {
    return row.trackStock && row.minStock <= 0;
}

export const STOCK_STATUS_LABEL: Record<string, string> = {
    ok: 'Em estoque',
    baixo: 'Estoque baixo',
    zerado: 'Zerado',
    'sem-controle': 'Sem controle',
};

export const STOCK_STATUS_BADGE: Record<string, string> = {
    ok: 'badge-emerald',
    baixo: 'badge-amber',
    zerado: 'badge-red',
    'sem-controle': 'badge-slate',
};

/**
 * Registra um movimento de estoque e atualiza o saldo do produto na mesma
 * transacao, gravando o sinal real em `delta` para que o historico sempre
 * mostre a direcao (uma contagem que reduz precisa ficar registrada como
 * reducao, e nao como entrada).
 *
 * Nunca lanca excecao: uma falha de estoque nao pode derrubar a venda.
 */
export async function applyMovement(params: {
    productId: string;
    type: MovementType;
    quantity: number;
    source: MovementSource;
    note?: string | null;
}): Promise<{ ok: boolean; stock: number; error?: string }> {
    const qty = Math.abs(Math.round(params.quantity));
    if (qty <= 0) return { ok: false, stock: 0, error: 'Quantidade invalida.' };

    // "ajuste" nao tem direcao definida aqui: contagem fisica usa setStockTo.
    if (params.type === 'ajuste') {
        return { ok: false, stock: 0, error: 'Use "definir saldo" para registrar contagem fisica.' };
    }

    const delta = INCREASING.includes(params.type) ? qty : -qty;

    try {
        return await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({ where: { id: params.productId } });
            if (!product) return { ok: false, stock: 0, error: 'Produto nao encontrado.' };
            if (!product.trackStock) return { ok: true, stock: product.stock };

            const next = Math.max(0, product.stock + delta);

            await tx.product.update({ where: { id: product.id }, data: { stock: next } });
            await tx.stockMovement.create({
                data: {
                    productId: product.id,
                    type: params.type,
                    quantity: qty,
                    delta,
                    source: params.source,
                    note: params.note ?? null,
                },
            });

            return { ok: true, stock: next };
        });
    } catch (error) {
        console.error('Erro ao registrar movimento de estoque:', error);
        return { ok: false, stock: 0, error: 'Erro ao registrar movimento' };
    }
}

/**
 * Define o saldo por contagem fisica, registrando a diferenca encontrada com o
 * sinal correto. Moveimentos antigos (delta = 0) sao interpretados pelo tipo.
 */
export async function setStockTo(params: {
    productId: string;
    stock: number;
    source: MovementSource;
    note?: string | null;
}): Promise<{ ok: boolean; stock: number; delta: number; error?: string }> {
    const target = Math.max(0, Math.round(params.stock));

    try {
        return await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({ where: { id: params.productId } });
            if (!product) return { ok: false, stock: 0, delta: 0, error: 'Produto nao encontrado.' };
            if (!product.trackStock) {
                return { ok: false, stock: product.stock, delta: 0, error: 'Produto sem controle de estoque.' };
            }

            const delta = target - product.stock;
            if (delta === 0) return { ok: true, stock: product.stock, delta: 0 };

            await tx.product.update({ where: { id: product.id }, data: { stock: target } });
            await tx.stockMovement.create({
                data: {
                    productId: product.id,
                    type: 'ajuste',
                    quantity: Math.abs(delta),
                    delta,
                    source: params.source,
                    note: params.note ?? 'Contagem fisica',
                },
            });

            return { ok: true, stock: target, delta };
        });
    } catch (error) {
        console.error('Erro ao definir saldo de estoque:', error);
        return { ok: false, stock: 0, delta: 0, error: 'Erro ao definir saldo' };
    }
}

/**
 * Baixa o estoque dos itens vendidos em uma unica transacao. Usado pelo PDV e
 * pelo bot do WhatsApp. Produtos sem controle de estoque sao ignorados.
 */
export async function registerSale(
    items: Array<{ productId: string; qty: number }>,
    source: MovementSource,
    note?: string
): Promise<void> {
    const list = items.filter((i) => i.productId && Math.abs(Math.round(i.qty)) > 0);
    if (list.length === 0) return;

    try {
        await prisma.$transaction(async (tx) => {
            const ids = [...new Set(list.map((i) => i.productId))];
            const products = await tx.product.findMany({ where: { id: { in: ids } } });
            const tracked = new Map(products.filter((p) => p.trackStock).map((p) => [p.id, p]));

            for (const item of list) {
                const product = tracked.get(item.productId);
                if (!product) continue;
                const qty = Math.abs(Math.round(item.qty));

                await tx.product.update({
                    where: { id: product.id },
                    data: { stock: Math.max(0, product.stock - qty) },
                });
                await tx.stockMovement.create({
                    data: {
                        productId: product.id,
                        type: 'saida',
                        quantity: qty,
                        delta: -qty,
                        source,
                        note: note ?? null,
                    },
                });
            }
        });
    } catch (error) {
        // A venda ja foi registrada: nao podemos derruba-la por causa do estoque.
        console.error('Erro ao baixar estoque da venda:', error);
    }
}

export type InventorySummary = {
    tracked: number;
    units: number;
    low: number;
    empty: number;
    /** Valor de venda do estoque: unidades x preco de venda. */
    value: number;
    /** Capital imobilizado: unidades x preco de custo. */
    costValue: number;
    untracked: number;
    /** Controlados porem sem minimo definido (nao entram na lista de compras). */
    missingMin: number;
    /** Margem media ponderada do estoque controlado, em %. */
    marginPct: number;
};

export function summarize(rows: StockRow[]): InventorySummary {
    let units = 0;
    let low = 0;
    let empty = 0;
    let value = 0;
    let costValue = 0;
    let tracked = 0;
    let untracked = 0;
    let missingMin = 0;

    for (const row of rows) {
        if (!row.trackStock) {
            untracked++;
            continue;
        }
        tracked++;
        units += row.stock;
        value += row.stock * row.price;
        costValue += row.stock * (row.costPrice || 0);
        if (needsMinStock(row)) missingMin++;
        const status = stockStatus(row);
        if (status === 'baixo') low++;
        if (status === 'zerado') empty++;
    }

    const marginPct = costValue > 0 ? ((value - costValue) / value) * 100 : 0;

    return {
        tracked,
        units,
        low,
        empty,
        value: Math.round(value * 100) / 100,
        costValue: Math.round(costValue * 100) / 100,
        untracked,
        missingMin,
        marginPct: Math.round(marginPct),
    };
}

/** Produtos controlados que precisam de reposicao, do mais critico ao menos. */
export function reorderList(rows: StockRow[]): Array<StockRow & { faltam: number }> {
    return rows
        .filter((r) => {
            const s = stockStatus(r);
            return s === 'zerado' || s === 'baixo';
        })
        .map((r) => ({ ...r, faltam: r.minStock > 0 ? Math.max(0, r.minStock * 2 - r.stock) : 0 }))
        .sort((a, b) => {
            if ((a.stock <= 0) !== (b.stock <= 0)) return a.stock <= 0 ? -1 : 1;
            const ra = a.minStock > 0 ? a.stock / a.minStock : Infinity;
            const rb = b.minStock > 0 ? b.stock / b.minStock : Infinity;
            return ra - rb;
        });
}

/** Resumo de perdas por descarte/validade em um periodo. */
export type WasteSummary = {
    units: number;
    cost: number;
    count: number;
};

export async function wasteSummary(since: Date): Promise<WasteSummary> {
    const rows = await prisma.stockMovement.findMany({
        where: { type: 'perda', createdAt: { gte: since } },
        include: { product: { select: { costPrice: true } } },
    });

    let units = 0;
    let cost = 0;
    for (const m of rows) {
        units += m.quantity;
        cost += m.quantity * (m.product.costPrice || 0);
    }

    return { units, cost: Math.round(cost * 100) / 100, count: rows.length };
}

export type MovementView = {
    id: string;
    productId: string;
    productName: string;
    type: string;
    quantity: number;
    delta: number;
    source: string;
    note: string | null;
    when: string;
};

export async function recentMovements(limit = 25): Promise<MovementView[]> {
    const rows = await prisma.stockMovement.findMany({
        include: { product: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });

    return rows.map((m) => ({
        id: m.id,
        productId: m.productId,
        productName: m.product.name,
        type: m.type,
        quantity: m.quantity,
        delta: m.delta,
        source: m.source,
        note: m.note,
        when: m.createdAt.toLocaleString('pt-BR'),
    }));
}
