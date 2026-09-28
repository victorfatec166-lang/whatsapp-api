import { prisma } from '../database/prisma';
import { serializeItems } from './items';

const round = (n: number) => Math.round(n * 100) / 100;

export type ModifierOptionView = {
    id: string;
    name: string;
    price: number;
    prefix: string;
};

export type ModifierGroupView = {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    required: boolean;
    sortOrder: number;
    options: ModifierOptionView[];
};

export type ComboComponentView = {
    componentId: string;
    name: string;
    quantity: number;
};

/** Produto com os grupos de modificadores e os componentes de combo. */
export type ProductFull = {
    id: string;
    name: string;
    isCombo: boolean;
    modifierGroups: Array<ModifierGroupView & { sortOrder: number }>;
    comboComponents: ComboComponentView[];
};

export async function loadProductFull(productId: string): Promise<ProductFull | null> {
    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: {
            id: true,
            name: true,
            isCombo: true,
            modifierGroups: {
                orderBy: { sortOrder: 'asc' },
                include: {
                    group: {
                        include: { options: { orderBy: { sortOrder: 'asc' } } },
                    },
                },
            },
            comboComponents: {
                orderBy: { sortOrder: 'asc' },
                include: { component: { select: { id: true, name: true } } },
            },
        },
    });
    if (!product) return null;

    return {
        id: product.id,
        name: product.name,
        isCombo: product.isCombo,
        modifierGroups: product.modifierGroups
            .map((link) => ({
                id: link.group.id,
                name: link.group.name,
                minSelect: link.group.minSelect,
                maxSelect: link.group.maxSelect,
                required: link.group.required,
                sortOrder: link.group.sortOrder,
                options: link.group.options.map((o) => ({
                    id: o.id,
                    name: o.name,
                    price: o.price,
                    prefix: o.prefix,
                })),
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        comboComponents: product.comboComponents.map((c) => ({
            componentId: c.component.id,
            name: c.component.name,
            quantity: c.quantity,
        })),
    };
}

/* ------------------------------------------------------- Carrinho (PDV) */

export type CartModifier = {
    groupId: string;
    /** Opcoes escolhidas com o nome ja formatado ("P", "Bacon extra"). */
    labels: string[];
    /** Soma dos acrescimos das opcoes escolhidas. */
    extra: number;
};

export type CartLine = {
    id: string;
    qty: number;
    mods: CartModifier[];
};

export type PricedLine = {
    id: string;
    name: string;
    qty: number;
    unitPrice: number;
    total: number;
    mods: CartModifier[];
    /** Rotulo final: "X-Burguer (P, Bacon extra)". */
    label: string;
    modLabels: string[];
};

export type PriceResult = {
    lines: PricedLine[];
    subtotal: number;
    /** Ids de produtos que precisam de baixa de estoque (inclui componentes). */
    stockDeductions: Array<{ productId: string; qty: number }>;
};

/**
 * Precifica o carrinho usando SEMPRE os precos do banco. O cliente manda
 * apenas { id, qty, mods:{ groupId: { optionIds } } }.
 *
 * Regras aplicadas:
 * - modificador so vale se a opcao existir E o grupo estiver ligado ao produto;
 * - respeita minSelect/maxSelect e grupos obrigatorios;
 * - combo baixa estoque nos componentes, nao no combo.
 */
export async function priceCart(raw: unknown): Promise<{ ok: true; result: PriceResult } | { ok: false; error: string }> {
    if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Carrinho vazio.' };

    const requested = raw.slice(0, 100).map((x) => ({
        id: String(x?.id ?? ''),
        qty: Math.min(99, Math.max(1, Math.round(Number(x?.qty) || 1))),
        groups: (x?.groups && typeof x.groups === 'object' ? x.groups : {}) as Record<string, unknown>,
    }));
    const ids = requested.map((r) => r.id).filter(Boolean);
    if (ids.length !== requested.length) return { ok: false, error: 'Item invalido no carrinho.' };

    const products = await prisma.product.findMany({
        where: { id: { in: ids }, isAvailable: true },
        include: {
            modifierGroups: { include: { group: { include: { options: true } } } },
            comboComponents: { include: { component: { select: { id: true, name: true, price: true, trackStock: true, stock: true } } } },
        },
    });
    if (products.length !== ids.length) {
        return { ok: false, error: 'Um ou mais itens nao existem ou estao pausados.' };
    }
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines: PricedLine[] = [];
    const stockMap = new Map<string, number>();
    let subtotal = 0;

    for (const line of requested) {
        const product = byId.get(line.id)!;
        const groups = product.modifierGroups.map((l) => l.group).sort((a, b) => a.sortOrder - b.sortOrder);

        // ---- valida e soma modificadores ----
        const chosen: CartModifier[] = [];
        for (const group of groups) {
            const picked = line.groups[group.id];
            const optionIds = Array.isArray(picked) ? picked.map((v) => String(v)) : [];
            const valid = group.options.filter((o) => optionIds.includes(o.id));

            if (group.required && valid.length < Math.max(1, group.minSelect)) {
                return { ok: false, error: `"${product.name}": escolha obrigatoria em ${group.name}.` };
            }
            if (valid.length > group.maxSelect) {
                return { ok: false, error: `"${product.name}": maximo de ${group.maxSelect} em ${group.name}.` };
            }
            if (valid.length === 0) continue;

            chosen.push({
                groupId: group.id,
                labels: valid.map((o) => (o.prefix ? `${o.prefix} ${o.name}` : o.name)),
                extra: round(valid.reduce((a, o) => a + o.price, 0)),
            });
        }

        // Opcoes de grupos que o cliente nao enviou sao apenas ignoradas.
        const modsExtra = round(chosen.reduce((a, m) => a + m.extra, 0));
        const unitPrice = round(product.price + modsExtra);
        const lineTotal = round(unitPrice * line.qty);
        const modLabels = chosen.flatMap((m) => m.labels);

        lines.push({
            id: product.id,
            name: product.name,
            qty: line.qty,
            unitPrice,
            total: lineTotal,
            mods: chosen,
            label: product.name + (modLabels.length ? ` (${modLabels.join(', ')})` : product.name),
            modLabels,
        });
        subtotal += lineTotal;

        // ---- estoque ----
        if (product.isCombo && product.comboComponents.length > 0) {
            for (const c of product.comboComponents) {
                if (!c.component.trackStock) continue;
                stockMap.set(c.component.id, (stockMap.get(c.component.id) ?? 0) + c.quantity * line.qty);
            }
        } else if (product.trackStock) {
            stockMap.set(product.id, (stockMap.get(product.id) ?? 0) + line.qty);
        }
    }

    // ---- bloqueia venda sem estoque suficiente ----
    const trackedIds = [...stockMap.keys()];
    if (trackedIds.length) {
        const tracked = await prisma.product.findMany({
            where: { id: { in: trackedIds } },
            select: { id: true, name: true, stock: true, trackStock: true },
        });
        const problems = tracked
            .filter((p) => p.trackStock && p.stock < (stockMap.get(p.id) ?? 0))
            .map((p) => `${p.name} (disponivel: ${p.stock})`);
        if (problems.length) {
            return { ok: false, error: `Sem estoque suficiente: ${problems.join(', ')}.` };
        }
    }

    return {
        ok: true,
        result: {
            lines,
            subtotal: round(subtotal),
            stockDeductions: [...stockMap.entries()].map(([productId, qty]) => ({ productId, qty })),
        },
    };
}

/** Texto do campo `items` a partir das linhas precificadas. */
export function linesToItemsField(lines: PricedLine[]): string {
    return serializeItems(lines.map((l) => ({ qty: l.qty, name: l.name, mods: l.modLabels })));
}
