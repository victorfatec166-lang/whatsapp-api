import { prisma } from '../database/prisma';
import { parseItems } from './items';

/**
 * Clientes derivados dos pedidos.
 *
 * Nao existe um model Customer: a identidade do cliente ja vem no
 * Order.clientPhone (e e o que o bot usa para conversar). Aqui apenas
 * agregamos -- nenhuma migration necessaria. Se um dia vier a existir um
 * cadastro proprio, e este arquivo que passa a ler de la.
 */

export type CustomerRow = {
    phone: string;
    name: string | null;
    orders: number;
    spent: number;
    averageTicket: number;
    lastOrderAt: string;
    /** Produto mais pedido, para sugerir ao cliente. */
    favorite: string | null;
    favoriteQty: number;
    channel: string;
};

export type CustomersSummary = {
    total: number;
    repeat: number;
    revenue: number;
    averageTicket: number;
};

export async function customerList(limit = 200): Promise<CustomerRow[]> {
    // So pedidos com telefone real: o PDV grava "Cliente Balcao" e nao tem
    // telefone, entao esses nao viram cliente.
    const orders = await prisma.order.findMany({
        where: { channel: 'whatsapp', NOT: { clientPhone: '' } },
        orderBy: { createdAt: 'desc' },
    });

    const byPhone = new Map<string, CustomerRow>();
    const itemsByPhone = new Map<string, Map<string, number>>();

    for (const o of orders) {
        const phone = o.clientPhone.trim();
        if (!phone) continue;

        let row = byPhone.get(phone);
        if (!row) {
            row = {
                phone,
                name: null,
                orders: 0,
                spent: 0,
                averageTicket: 0,
                lastOrderAt: o.createdAt.toLocaleString('pt-BR'),
                favorite: null,
                favoriteQty: 0,
                channel: o.channel,
            };
            byPhone.set(phone, row);
            itemsByPhone.set(phone, new Map());
        }

        row.orders += 1;
        row.spent += o.total;
        // Nome mais recente disponivel: o bot nunca pergunta o nome, mas o
        // balcao pode ter preenchido.
        if (!row.name && o.clientName && o.clientName.trim() && o.clientName !== 'Cliente WhatsApp') {
            row.name = o.clientName.trim();
        }

        const counts = itemsByPhone.get(phone)!;
        for (const item of parseItems(o.items)) {
            counts.set(item.name, (counts.get(item.name) ?? 0) + item.qty);
        }
    }

    const rows: CustomerRow[] = [];
    for (const [phone, row] of byPhone) {
        row.spent = Math.round(row.spent * 100) / 100;
        row.averageTicket = row.orders > 0 ? Math.round((row.spent / row.orders) * 100) / 100 : 0;

        const counts = itemsByPhone.get(phone)!;
        let best: string | null = null;
        let bestQty = 0;
        for (const [name, qty] of counts) {
            if (qty > bestQty) {
                best = name;
                bestQty = qty;
            }
        }
        row.favorite = best;
        row.favoriteQty = bestQty;
        rows.push(row);
    }

    rows.sort((a, b) => b.spent - a.spent);
    return rows.slice(0, limit);
}

export function summarizeCustomers(rows: CustomerRow[]): CustomersSummary {
    let repeat = 0;
    let revenue = 0;
    for (const r of rows) {
        if (r.orders > 1) repeat++;
        revenue += r.spent;
    }
    revenue = Math.round(revenue * 100) / 100;
    return {
        total: rows.length,
        repeat,
        revenue,
        averageTicket: rows.length > 0 ? Math.round((revenue / rows.length) * 100) / 100 : 0,
    };
}
