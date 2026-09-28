// Este modulo nao fala com o banco: os dois estatisticos sao calculados em
// memoria, a partir da lista de pedidos que o servidor ja carregou. Isso
// mantem a regra unica de preco e status em um lugar so, sem consulta extra.
import { parseItems } from './items';

export type OrderWithProductless = {
    id: string;
    clientPhone: string;
    clientName: string | null;
    items: string;
    total: number;
    subtotal: number;
    discount: number;
    tip: number;
    notes: string | null;
    status: string;
    channel: string;
  paymentMethod: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const ORDER_STATUSES = ['pendente', 'preparando', 'entrega', 'concluido'] as const;

const STATUS_LABELS: Record<string, string> = {
    pendente: 'Pendente',
    preparando: 'Preparando',
    entrega: 'Em entrega',
    concluido: 'Concluído',
};

export function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

function startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function addDays(d: Date, days: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
}

/** Reexporta o parser canonico de itens (com modificadores e retrocompativel). */
export { parseItems } from './items';

export type DashboardStats = {
    today: { revenue: number; orders: number };
    week: { revenue: number; orders: number };
    month: { revenue: number; orders: number };
    allTime: { revenue: number; orders: number };
    byStatus: Record<string, number>;
    averageTicket: number;
    topProducts: Array<{ name: string; qty: number; revenue: number }>;
    byHour: Array<{ hour: number; orders: number }>;
    byDayOfWeek: Array<{ label: string; orders: number; revenue: number }>;
    revenueByDay: Array<{ date: string; label: string; revenue: number; orders: number }>;
    busiestHour: { hour: number; orders: number } | null;
    todayAdjustments: { discounts: number; tips: number };
    byChannel: Array<{ channel: string; label: string; orders: number; revenue: number }>;
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function currency(n: number): string {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function shortDate(d: Date): string {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * Todas as metricas do painel/statisticas calculadas a partir dos pedidos reais.
 * Nenhum numero aqui e fixo no codigo.
 */
export async function computeStats(orders: OrderWithProductless[]): Promise<DashboardStats> {
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = addDays(todayStart, -6);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const sum = (list: OrderWithProductless[]) => ({
        revenue: list.reduce((acc, o) => acc + o.total, 0),
        orders: list.length,
    });

    const today = orders.filter((o) => o.createdAt >= todayStart);
    const week = orders.filter((o) => o.createdAt >= weekStart);
    const month = orders.filter((o) => o.createdAt >= monthStart);

    const byStatus: Record<string, number> = {};
    for (const s of ORDER_STATUSES) byStatus[s] = 0;
    for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

    const productMap = new Map<string, { qty: number; revenue: number }>();
    for (const o of orders) {
        // item count: divide o total igualmente entre os itens do pedido
        const parsed = parseItems(o.items);
        const totalQty = parsed.reduce((a, p) => a + p.qty, 0) || 1;
        const unitShare = o.total / totalQty;
        for (const p of parsed) {
            const cur = productMap.get(p.name) ?? { qty: 0, revenue: 0 };
            cur.qty += p.qty;
            cur.revenue += unitShare * p.qty;
            productMap.set(p.name, cur);
        }
    }

    const topProducts = [...productMap.entries()]
        .map(([name, v]) => ({ name, ...v, revenue: Math.round(v.revenue * 100) / 100 }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 8);

    const hourBuckets = new Array(24).fill(0).map((_, hour) => ({ hour, orders: 0 }));
    for (const o of orders) hourBuckets[o.createdAt.getHours()].orders += 1;

    const dowBuckets = WEEKDAYS.map((label) => ({ label, orders: 0, revenue: 0 }));
    for (const o of orders) {
        const b = dowBuckets[o.createdAt.getDay()];
        b.orders += 1;
        b.revenue += o.total;
    }

    const dayMap = new Map<string, { date: string; label: string; revenue: number; orders: number }>();
    for (const o of orders) {
        const key = o.createdAt.toISOString().slice(0, 10);
        const cur = dayMap.get(key) ?? { date: key, label: shortDate(o.createdAt), revenue: 0, orders: 0 };
        cur.revenue += o.total;
        cur.orders += 1;
        dayMap.set(key, cur);
    }
    const revenueByDay = [...dayMap.values()]
        .map((d) => ({ ...d, revenue: Math.round(d.revenue * 100) / 100 }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-14);

    const busiest = [...hourBuckets].sort((a, b) => b.orders - a.orders)[0];

    const channelMap = new Map<string, { orders: number; revenue: number }>();
    for (const o of orders) {
        const cur = channelMap.get(o.channel) ?? { orders: 0, revenue: 0 };
        cur.orders += 1;
        cur.revenue += o.total;
        channelMap.set(o.channel, cur);
    }

    return {
        today: sum(today),
        week: sum(week),
        month: sum(month),
        allTime: sum(orders),
        byStatus,
        averageTicket: orders.length ? orders.reduce((a, o) => a + o.total, 0) / orders.length : 0,
        topProducts,
        byHour: hourBuckets,
        byDayOfWeek: dowBuckets,
        revenueByDay,
        busiestHour: busiest && busiest.orders > 0 ? busiest : null,
        todayAdjustments: {
            discounts: Math.round(today.reduce((a, o) => a + (o.discount || 0), 0) * 100) / 100,
            tips: Math.round(today.reduce((a, o) => a + (o.tip || 0), 0) * 100) / 100,
        },
        byChannel: [...channelMap.entries()]
            .map(([channel, v]) => ({
                channel,
                label: channel === 'pdv' ? 'PDV / Balcao' : 'WhatsApp',
                orders: v.orders,
                revenue: Math.round(v.revenue * 100) / 100,
            }))
            .sort((a, b) => b.orders - a.orders),
    };
}

export type ReportRow = {
    id: string;
    quando: string;
    cliente: string;
    telefone: string;
    itens: string;
    total: number;
    status: string;
    statusLabel: string;
    channel: string;
    paymentMethod: string | null;
};

export function toReportRows(orders: OrderWithProductless[]): ReportRow[] {
    return orders.map((o) => ({
        id: o.id,
        quando: o.createdAt.toLocaleString('pt-BR'),
        cliente: o.clientName || 'Cliente',
        telefone: o.channel === 'pdv' ? (o.paymentMethod ?? 'Balcao') : o.clientPhone.replace('@s.whatsapp.net', ''),
        itens: o.items,
        total: o.total,
        status: o.status,
        statusLabel: statusLabel(o.status),
        channel: o.channel,
        paymentMethod: o.paymentMethod,
    }));
}

/** CSV com separador ; (abre direto no Excel pt-BR) e escape correto. */
export function toCsv(rows: ReportRow[]): string {
    const header = ['Data', 'Cliente', 'Contato', 'Itens', 'Total', 'Status', 'Canal', 'Pagamento'];
    const cell = (v: string | number) => {
        const s = String(v);
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header.join(';')];
    for (const r of rows) {
        lines.push(
            [
                r.quando,
                cell(r.cliente),
                cell(r.telefone),
                cell(r.itens),
                r.total.toFixed(2),
                cell(r.statusLabel),
                cell(r.channel === 'pdv' ? 'PDV' : 'WhatsApp'),
                cell(r.paymentMethod ?? ''),
            ].join(';')
        );
    }
    return lines.join('\r\n');
}

export { currency };
