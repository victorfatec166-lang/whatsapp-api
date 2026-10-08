import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { emFila } from './writeQueue';
import { logDoModulo } from './logger';
import { exigeLoja } from './loja';
const log = logDoModulo('stock');

export type MovementType = 'entrada' | 'saida' | 'perda' | 'ajuste';
export type MovementSource = 'pdv' | 'whatsapp' | 'manual';

export const MOVEMENT_LABELS: Record<MovementType, string> = {
    entrada: 'Entrada',
    saida: 'Saida',
    perda: 'Perda',
    ajuste: 'Ajuste',
};

export const MOVEMENT_BADGES: Record<MovementType, string> = {
    entrada: 'badge-success',
    saida: 'badge-danger',
    perda: 'badge-warn',
    ajuste: 'badge-neutral',
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
    ok: 'badge-success',
    baixo: 'badge-warn',
    zerado: 'badge-danger',
    'sem-controle': 'badge-neutral',
};

/*
 * Chave composta do produto. `where: { id }` sozinho alcancaria a loja vizinha --
 * dentro de `$transaction` a extensao do Prisma nao alcança o `tx`, e ai nao ha nem
 * a trava que estouraria. Com a loja no proprio `where`, o filtro e' do banco.
 */
const chaveDoProduto = (id: string) => ({ tenantId_id: { tenantId: exigeLoja(), id } });

/**
 * Movimento e saldo na mesma transacao, com `delta` sempre com sinal: contagem
 * que reduz precisa ficar registrada como reducao, e nao como entrada.
 * Nunca lanca excecao: falha de estoque nao pode derrubar a venda.
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
            const product = await tx.product.findUnique({ where: chaveDoProduto(params.productId) });
            if (!product) return { ok: false, stock: 0, error: 'Produto nao encontrado.' };
            if (!product.trackStock) return { ok: true, stock: product.stock };

            const next = Math.max(0, product.stock + delta);

            await tx.product.update({ where: chaveDoProduto(product.id), data: { stock: next } });
            await tx.stockMovement.create({
                data: {
                    tenantId: exigeLoja(),
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
        log.error('Erro ao registrar movimento de estoque:', error);
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
            const product = await tx.product.findUnique({ where: chaveDoProduto(params.productId) });
            if (!product) return { ok: false, stock: 0, delta: 0, error: 'Produto nao encontrado.' };
            if (!product.trackStock) {
                return { ok: false, stock: product.stock, delta: 0, error: 'Produto sem controle de estoque.' };
            }

            const delta = target - product.stock;
            if (delta === 0) return { ok: true, stock: product.stock, delta: 0 };

            await tx.product.update({ where: chaveDoProduto(product.id), data: { stock: target } });
            await tx.stockMovement.create({
                data: {
                    tenantId: exigeLoja(),
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
        log.error('Erro ao definir saldo de estoque:', error);
        return { ok: false, stock: 0, delta: 0, error: 'Erro ao definir saldo' };
    }
}

/**
 * Cliente de transacao aceito pelas funcoes de estoque: e' o que permite rodar
 * dentro da transacao que cria o pedido (orders.ts) ou abrir a dela sozinha.
 */
export type StockTx = {
    product: {
        findMany: (args: unknown) => Promise<Array<{ id: string; name: string; stock: number; trackStock: boolean }>>;
    };
    stockMovement: { create: (args: unknown) => Promise<unknown> };
    $executeRawUnsafe: (sql: string, ...vals: unknown[]) => Promise<number>;
};

/**
 * Produto que ficou sem saldo no meio de uma venda.
 * Nao bloqueia a venda: o saldo envelhece, e recusar pedido valido no meio do
 * almoco custa mais caro do que vender e sinalizar.
 */
export type Shortfall = {
    productId: string;
    nome: string;
    pediu: number;
    tinha: number;
};

/**
 * Baixa atomica de verdade: o decremento roda dentro do UPDATE, calculado pelo banco
 * a partir do valor atual da linha -- ler em JS e gravar valor absoluto perdia uma
 * baixa quando duas vendas batiam juntas. Em combo entra o componente, nunca o combo.
 */
export async function decrementStock(
    tx: StockTx,
    items: Array<{ productId: string; qty: number }>,
    source: MovementSource,
    note?: string
): Promise<Shortfall[]> {
    const shortfalls: Shortfall[] = [];

    // Consolida por produto. O mesmo componente pode entrar duas vezes num
    // combo, e baixar em duas linhas separadas abriria de novo a janela.
    const totalPorProduto = new Map<string, number>();
    for (const i of items) {
        if (!i.productId) continue;
        const qty = Math.abs(Math.round(i.qty));
        if (qty === 0) continue;
        totalPorProduto.set(i.productId, (totalPorProduto.get(i.productId) ?? 0) + qty);
    }
    if (totalPorProduto.size === 0) return shortfalls;

    // Esta leitura e' so para o aviso de falta. A gravacao nao depende dela.
    const ids = [...totalPorProduto.keys()];
    const products = await tx.product.findMany({ where: { id: { in: ids } } });
    const before = new Map(products.filter((p) => p.trackStock).map((p) => [p.id, p.stock]));

    for (const [productId, qty] of totalPorProduto) {
        const saldoAntes = before.get(productId);
        if (saldoAntes === undefined) continue; // produto sem controle de estoque

        /*
         * `GREATEST` e nao `MAX` de dois argumentos: no Postgres o `MAX` e' agregacao.
         */
        await tx.$executeRawUnsafe(
            'UPDATE "Product" SET "stock" = GREATEST(0, "stock" - $1) WHERE "id" = $2 AND "tenantId" = $3',
            qty,
            productId,
            exigeLoja()
        );

        await tx.stockMovement.create({
            data: {
                productId,
                type: 'saida',
                quantity: qty,
                delta: -qty,
                source,
                note: note ?? null,
            },
        });

        if (saldoAntes < qty) {
            const nome = products.find((p) => p.id === productId)?.name ?? productId;
            shortfalls.push({ productId, nome, pediu: qty, tinha: saldoAntes });
        }
    }

    return shortfalls;
}

/**
 * Para venda que NAO cria pedido junto -- com pedido, use createOrderWithStock.
 * Falha nao derruba a venda: o erro volta registrado, porque recusar depois do
 * pedido ja aceito custa mais caro.
 */
export async function registerSale(
    items: Array<{ productId: string; qty: number }>,
    source: MovementSource,
    note?: string
): Promise<{ ok: boolean; shortfalls: Shortfall[]; error?: string }> {
    try {
        // Mesma fila de createOrderWithStock: uma gravacao por vez evita
        // disputa de lock. Quem chama isso sem criar pedido e' o acerto de caixa
        // e o ajuste manual.
        const shortfalls = await emFila(() =>
            prisma.$transaction(
                (tx) => decrementStock(tx as unknown as StockTx, items, source, note),
                { timeout: 10_000, maxWait: 5_000 }
            )
        );
        return { ok: true, shortfalls };
    } catch (error) {
        log.error('Erro ao baixar estoque da venda:', error);
        return { ok: false, shortfalls: [], error: 'Erro ao baixar estoque' };
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
