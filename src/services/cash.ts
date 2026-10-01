import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { logDoModulo } from './logger';
import { exigeLoja } from './loja';
const log = logDoModulo('cash');

const round = (n: number) => Math.round(n * 100) / 100;

export type CashMovementType = 'entrada' | 'saida';

// CASH_LABELS e CASH_BADGES saíram daqui. O texto e a cor do tipo de movimento
// passaram a ser decididos na view, que é onde o badge tem meaning visual; o
// serviço ficou só com a regra de negócio, e a view com a apresentação.
const METHOD_LABELS: Record<string, string> = {
    pix: 'PIX',
    dinheiro: 'Dinheiro',
    cartao: 'Cartao',
};

/* --------------------------------------------------------------- Turno */

export type ShiftTotals = {
    /** Vendas em dinheiro dentro da janela do turno. */
    cashSales: number;
    cashIn: number;
    cashOut: number;
    /** Float inicial + vendas em dinheiro + entradas - saidas. */
    expected: number;
    byMethod: Array<{ method: string; label: string; total: number; count: number }>;
    orders: number;
    discounts: number;
    tips: number;
    /** Faturamento bruto de todos os canais na janela. */
    revenue: number;
};

export type OpenShift = {
    id: string;
    openedAt: string;
    openingFloat: number;
    totals: ShiftTotals;
    movements: Array<{ id: string; type: string; amount: number; note: string | null; when: string }>;
};

export async function openShift(): Promise<OpenShift | null> {
    const shift = await prisma.cashShift.findFirst({ where: { closedAt: null }, orderBy: { openedAt: 'desc' } });
    if (!shift) return null;
    const totals = await shiftTotals(shift.id, shift.openingFloat, shift.openedAt, new Date());
    const movements = await prisma.cashMovement.findMany({
        where: { shiftId: shift.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
    });
    return {
        id: shift.id,
        openedAt: shift.openedAt.toLocaleString('pt-BR'),
        openingFloat: shift.openingFloat,
        totals,
        movements: movements.map((m) => ({
            id: m.id,
            type: m.type,
            amount: m.amount,
            note: m.note,
            when: m.createdAt.toLocaleString('pt-BR'),
        })),
    };
}

async function shiftTotals(shiftId: string, openingFloat: number, from: Date, to: Date): Promise<ShiftTotals> {
    const [orders, movements] = await Promise.all([
        prisma.order.findMany({
            where: { createdAt: { gte: from, lte: to } },
            select: { total: true, discount: true, tip: true, paymentMethod: true },
        }),
        prisma.cashMovement.findMany({ where: { shiftId }, select: { type: true, amount: true } }),
    ]);

    let cashSales = 0;
    let revenue = 0;
    let discounts = 0;
    let tips = 0;
    const methodMap = new Map<string, { total: number; count: number }>();

    for (const o of orders) {
        const method = o.paymentMethod ?? 'pix';
        const cur = methodMap.get(method) ?? { total: 0, count: 0 };
        cur.total += o.total;
        cur.count += 1;
        methodMap.set(method, cur);
        revenue += o.total;
        discounts += o.discount || 0;
        tips += o.tip || 0;
        if (method === 'dinheiro') cashSales += o.total;
    }

    let cashIn = 0;
    let cashOut = 0;
    for (const m of movements) {
        if (m.type === 'entrada') cashIn += m.amount;
        else cashOut += m.amount;
    }

    return {
        cashSales: round(cashSales),
        cashIn: round(cashIn),
        cashOut: round(cashOut),
        expected: round(openingFloat + cashSales + cashIn - cashOut),
        orders: orders.length,
        discounts: round(discounts),
        tips: round(tips),
        revenue: round(revenue),
        byMethod: [...methodMap.entries()]
            .map(([method, v]) => ({ method, label: METHOD_LABELS[method] ?? method, total: round(v.total), count: v.count }))
            .sort((a, b) => b.total - a.total),
    };
}

export async function startShift(openingFloat: number, now = new Date()): Promise<{ ok: boolean; error?: string; shiftId?: string }> {
    const existing = await prisma.cashShift.findFirst({ where: { closedAt: null } });
    if (existing) return { ok: false, error: 'Ja existe um turno aberto. Feche antes de abrir outro.' };
    if (!(openingFloat >= 0) || openingFloat > 1_000_000) return { ok: false, error: 'Valor inicial invalido.' };

    const shift = await prisma.cashShift.create({
        data: { tenantId: exigeLoja(), openingFloat: round(openingFloat), openedAt: now },
    });
    return { ok: true, shiftId: shift.id };
}

export type ClosedShiftReport = {
    id: string;
    openedAt: string;
    closedAt: string;
    openingFloat: number;
    countedCash: number;
    expectedCash: number;
    difference: number;
    note: string | null;
    totals: ShiftTotals;
};

export async function closeShift(params: {
    countedCash: number;
    note?: string | null;
}): Promise<{ ok: boolean; error?: string; report?: ClosedShiftReport }> {
    const shift = await prisma.cashShift.findFirst({ where: { closedAt: null }, orderBy: { openedAt: 'desc' } });
    if (!shift) return { ok: false, error: 'Nao ha turno aberto.' };
    if (!(params.countedCash >= 0) || params.countedCash > 100_000_000) {
        return { ok: false, error: 'Valor contado invalido.' };
    }

    const closedAt = new Date();
    const totals = await shiftTotals(shift.id, shift.openingFloat, shift.openedAt, closedAt);
    const counted = round(params.countedCash);
    const difference = round(counted - totals.expected);

    const saved = await prisma.cashShift.update({
        where: { id: shift.id },
        data: {
            closedAt,
            countedCash: counted,
            expectedCash: totals.expected,
            difference,
            note: params.note ? params.note.slice(0, 200) : null,
        },
    });

    return {
        ok: true,
        report: {
            id: saved.id,
            openedAt: saved.openedAt.toLocaleString('pt-BR'),
            closedAt: closedAt.toLocaleString('pt-BR'),
            openingFloat: saved.openingFloat,
            countedCash: counted,
            expectedCash: totals.expected,
            difference,
            note: saved.note,
            totals,
        },
    };
}

/**
 * Preenche a contagem fisica de um turno ja encerrado pela agenda e calcula a
 * diferenca. E o fim do fluxo "pendente de conferencia": o fecho automatico
 * grava o esperado, mas nao pode inventar a contagem da gaveta.
 */
export async function reconcileShift(params: {
    shiftId: string;
    countedCash: number;
    note?: string | null;
}): Promise<{ ok: boolean; error?: string; difference?: number }> {
    if (!(params.countedCash >= 0) || params.countedCash > 100_000_000) {
        return { ok: false, error: 'Valor contado invalido.' };
    }

    const shift = await prisma.cashShift.findUnique({ where: { id: params.shiftId } });
    if (!shift) return { ok: false, error: 'Turno nao encontrado.' };
    if (!shift.closedAt) return { ok: false, error: 'Conferencia so vale para turno ja fechado.' };
    if (shift.countedCash !== null) return { ok: false, error: 'Este turno ja foi conferido.' };

    const totals = await shiftTotals(shift.id, shift.openingFloat, shift.openedAt, shift.closedAt);
    const difference = round(params.countedCash - totals.expected);

    await prisma.cashShift.update({
        where: { id: shift.id },
        data: {
            countedCash: round(params.countedCash),
            expectedCash: totals.expected,
            difference,
            note: params.note ? params.note.slice(0, 200) : shift.note,
        },
    });

    return { ok: true, difference };
}

/**
 * Encerra o turno pela agenda, sem contagem fisica: grava o esperado e deixa
 * countedCash/difference nulos para conferência posterior. Evita o turno ficar
 * aberto para sempre quando ninguem fecha no balcao.
 */
export async function closeShiftAuto(now = new Date()): Promise<
    | { ok: true; shiftId: string; expected: number }
    | { ok: false; error: string; empty?: boolean }
> {
    const shift = await prisma.cashShift.findFirst({ where: { closedAt: null }, orderBy: { openedAt: 'desc' } });
    if (!shift) return { ok: false, error: 'Nao ha turno aberto.' };

    // Turno sem venda e sem movimento indica dia sem operacao: fechar aqui
    // poluiria o historico com turnos fantasma.
    const totals = await shiftTotals(shift.id, shift.openingFloat, shift.openedAt, now);
    if (totals.orders === 0 && totals.cashIn === 0 && totals.cashOut === 0) {
        return { ok: false, error: 'Turno sem movimento.', empty: true };
    }

    const closedAt = now;
    const finalTotals = await shiftTotals(shift.id, shift.openingFloat, shift.openedAt, closedAt);

    await prisma.cashShift.update({
        where: { id: shift.id },
        data: {
            closedAt,
            expectedCash: finalTotals.expected,
            countedCash: null,
            difference: null,
            note: 'Fechado automaticamente - conferencia pendente',
        },
    });

    return { ok: true, shiftId: shift.id, expected: finalTotals.expected };
}

export type ShiftHistoryRow = {
    id: string;
    openedAt: string;
    closedAt: string;
    openingFloat: number;
    expectedCash: number | null;
    countedCash: number | null;
    difference: number | null;
    revenue: number;
    orders: number;
};

export async function shiftHistory(limit = 30): Promise<ShiftHistoryRow[]> {
    const shifts = await prisma.cashShift.findMany({
        where: { closedAt: { not: null } },
        orderBy: { closedAt: 'desc' },
        take: limit,
        include: { movements: true },
    });

    return Promise.all(
        shifts.map(async (s) => {
            const orders = await prisma.order.findMany({
                where: { createdAt: { gte: s.openedAt, lte: s.closedAt! } },
                select: { total: true },
            });
            return {
                id: s.id,
                openedAt: s.openedAt.toLocaleString('pt-BR'),
                closedAt: s.closedAt!.toLocaleString('pt-BR'),
                openingFloat: s.openingFloat,
                expectedCash: s.expectedCash,
                countedCash: s.countedCash,
                difference: s.difference,
                revenue: round(orders.reduce((a, o) => a + o.total, 0)),
                orders: orders.length,
            };
        })
    );
}

/* --------------------------------------------- Movimentos de caixa (dia) */

function startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

export type CashSummary = {
    cashSales: number;
    cashIn: number;
    cashOut: number;
    expected: number;
    byMethod: Array<{ method: string; label: string; total: number; count: number }>;
    movements: Array<{ id: string; type: string; amount: number; note: string | null; when: string }>;
};

export async function cashSummary(now = new Date()): Promise<CashSummary> {
    const from = startOfDay(now);
    const [orders, movements] = await Promise.all([
        prisma.order.findMany({
            where: { createdAt: { gte: from }, channel: 'pdv' },
            select: { total: true, paymentMethod: true },
        }),
        prisma.cashMovement.findMany({
            where: { createdAt: { gte: from } },
            orderBy: { createdAt: 'desc' },
            take: 20,
        }),
    ]);

    let cashSales = 0;
    const methodMap = new Map<string, { total: number; count: number }>();
    for (const o of orders) {
        const method = o.paymentMethod ?? 'pix';
        const cur = methodMap.get(method) ?? { total: 0, count: 0 };
        cur.total += o.total;
        cur.count += 1;
        methodMap.set(method, cur);
        if (method === 'dinheiro') cashSales += o.total;
    }

    let cashIn = 0;
    let cashOut = 0;
    for (const m of movements) {
        if (m.type === 'entrada') cashIn += m.amount;
        else cashOut += m.amount;
    }

    return {
        cashSales: round(cashSales),
        cashIn: round(cashIn),
        cashOut: round(cashOut),
        expected: round(cashSales + cashIn - cashOut),
        byMethod: [...methodMap.entries()]
            .map(([method, v]) => ({ method, label: METHOD_LABELS[method] ?? method, total: round(v.total), count: v.count }))
            .sort((a, b) => b.total - a.total),
        movements: movements.map((m) => ({
            id: m.id,
            type: m.type,
            amount: m.amount,
            note: m.note,
            when: m.createdAt.toLocaleString('pt-BR'),
        })),
    };
}

/** Registra o movimento e o amarra ao turno aberto, se houver. */
export async function registerCashMovement(params: {
    type: CashMovementType;
    amount: number;
    note?: string | null;
}): Promise<{ ok: boolean; error?: string; warned?: string }> {
    const amount = round(params.amount);
    if (!(amount > 0)) return { ok: false, error: 'Valor deve ser maior que zero.' };
    if (amount > 1_000_000) return { ok: false, error: 'Valor muito alto.' };

    try {
        const shift = await prisma.cashShift.findFirst({ where: { closedAt: null } });
        await prisma.cashMovement.create({
            data: {
                tenantId: exigeLoja(),
                shiftId: shift?.id ?? null,
                type: params.type,
                amount,
                note: params.note ? params.note.slice(0, 140) : null,
            },
        });
        return { ok: true, warned: shift ? undefined : 'Movimento registrado sem turno aberto.' };
    } catch (error) {
        log.error('Erro ao registrar movimento de caixa:', error);
        return { ok: false, error: 'Erro ao registrar movimento' };
    }
}

/* ------------------------------------------------- Venda suspensa (hold) */

export type ParkedItem = { id: string; qty: number; groups?: Record<string, string[]> };

export type ParkedSaleView = {
    id: string;
    label: string;
    items: ParkedItem[];
    total: number;
    count: number;
    when: string;
};

export async function parkedSales(): Promise<ParkedSaleView[]> {
    const rows = await prisma.parkedSale.findMany({ orderBy: { createdAt: 'asc' } });

    const ids = [...new Set(rows.flatMap((r) => parseItems(r.items).map((i) => i.id)))];
    const products = ids.length
        ? await prisma.product.findMany({
              where: { id: { in: ids } },
              select: {
                  id: true,
                  name: true,
                  price: true,
                  modifierGroups: { include: { group: { include: { options: true } } } },
              },
          })
        : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    return rows.map((r) => {
        const parsed = parseItems(r.items);
        const items = parsed.filter((i) => byId.has(i.id));

        let total = 0;
        let count = 0;
        for (const i of items) {
            const p = byId.get(i.id)!;
            let extra = 0;
            if (i.groups) {
                for (const [gid, oids] of Object.entries(i.groups)) {
                    const group = p.modifierGroups.find((l) => l.group.id === gid)?.group;
                    if (!group) continue;
                    for (const oid of oids) {
                        const o = group.options.find((x) => x.id === oid);
                        if (o) extra += o.price;
                    }
                }
            }
            total += (p.price + extra) * i.qty;
            count += i.qty;
        }

        return {
            id: r.id,
            label: r.label || 'Sem nome',
            items,
            total: round(total),
            count,
            when: r.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        };
    });
}

function parseItems(raw: string): ParkedItem[] {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((x) => {
                const groups: Record<string, string[]> = {};
                if (x?.groups && typeof x.groups === 'object') {
                    for (const [g, v] of Object.entries(x.groups as Record<string, unknown>)) {
                        if (Array.isArray(v) && v.length) groups[g] = v.map((o) => String(o));
                    }
                }
                return { id: String(x?.id ?? ''), qty: Math.max(0, Math.round(Number(x?.qty) || 0)), groups };
            })
            .filter((x) => x.id && x.qty > 0);
    } catch {
        return [];
    }
}

export function serializeParkedItems(items: ParkedItem[]): string {
    return JSON.stringify(
        items.map((i) => {
            const groups = i.groups && Object.keys(i.groups).length ? i.groups : undefined;
            return groups ? { id: i.id, qty: i.qty, groups } : { id: i.id, qty: i.qty };
        })
    );
}

/* ------------------------------------------------------ Desconto e gorjeta */

export type Totals = {
    subtotal: number;
    discount: number;
    tip: number;
    total: number;
};

/** Desconto nunca passa do subtotal e a gorjeta nao pode ser negativa. */
export function computeTotals(subtotal: number, rawDiscount: unknown, rawTip: unknown): Totals {
    const sub = Math.max(0, round(subtotal));
    const discount = Math.min(sub, Math.max(0, round(Number(rawDiscount) || 0)));
    const tip = Math.max(0, round(Number(rawTip) || 0));
    return { subtotal: sub, discount, tip, total: round(sub - discount + tip) };
}
