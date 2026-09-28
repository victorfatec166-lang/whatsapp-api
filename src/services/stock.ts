import { prisma } from '../database/prisma';
import { emFila } from './writeQueue';

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
 * Cliente de transacao aceito pelas funcoes de estoque.
 *
 * E' o que permite a mesma operacao rodar dentro da transacao que cria o
 * pedido (orders.ts) ou abrir a dela sozinha. Sem isso, pedido e baixa de
 * estoque seriam dois commits independentes.
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
 *
 * Nao bloqueia a venda: avisar e' melhor do que recusar. O saldo do sistema
 * envelhece -- alguem vendeu no balcao sem atualizar, ou o pedido anterior ja
 * tinha zerado -- e recusar um pedido valido no meio do almoço custa mais caro
 * do que vender e sinalizar. O dono ve o aviso e reponde.
 */
export type Shortfall = {
    productId: string;
    nome: string;
    pediu: number;
    tinha: number;
};

/**
 * Baixa o estoque dos itens vendidos, de forma atomica de verdade.
 *
 * A versao anterior lia o saldo com um SELECT e depois gravava um valor
 * absoluto (stock - qty). Duas vendas do mesmo produto ao mesmo tempo liam as
 * duas o mesmo saldo e gravavam as duas o mesmo resultado: a segunda baixa se
 * perdia e o estoque ficava um item acima do real. No almoço, com o balcao e
 * o bot batendo juntos, isso nao e hipotese.
 *
 * Aqui o decremento acontece dentro do proprio UPDATE, calculado pelo banco a
 * partir do valor atual da linha. Nao existe leitura em JS para ficar
 * desatualizada, porque o numero que entra na conta e' o do banco no momento
 * do UPDATE. O MAX(0, ...) mantem a garantia antiga de saldo nunca negativo, e
 * agora sem a janela entre ler e gravar.
 *
 * Em combos o abate e' sempre nos componentes: quem chega aqui ja recebeu a
 * lista de productId resolvida, nunca o id do combo.
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

        await tx.$executeRawUnsafe(
            'UPDATE "Product" SET "stock" = MAX(0, "stock" - ?) WHERE "id" = ?',
            qty,
            productId
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
 * Baixa o estoque de uma venda abrindo a propria transacao.
 *
 * Use quando a venda NAO cria pedido junto. Para venda com pedido, use
 * createOrderWithStock, que faz as duas coisas no mesmo commit.
 *
 * Falha aqui nunca derruba a venda: o erro e' registrado e devolvido, porque o
 * pedido ja foi aceito e recusar depois seria pior.
 */
export async function registerSale(
    items: Array<{ productId: string; qty: number }>,
    source: MovementSource,
    note?: string
): Promise<{ ok: boolean; shortfalls: Shortfall[]; error?: string }> {
    try {
        // Mesma fila de createOrderWithStock: uma gravacao por vez evita
        // disputa de lock no SQLite. Quem chama isso sem criar pedido e' o
        // acerto de caixa e o ajuste manual.
        const shortfalls = await emFila(() =>
            prisma.$transaction(
                (tx) => decrementStock(tx as unknown as StockTx, items, source, note),
                { timeout: 10_000, maxWait: 5_000 }
            )
        );
        return { ok: true, shortfalls };
    } catch (error) {
        console.error('Erro ao baixar estoque da venda:', error);
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
