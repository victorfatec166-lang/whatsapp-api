import { prisma } from '../database/prisma';
import { parseItems } from './items';

/**
 * Clientes derivados dos pedidos.
 *
 * Nao existe um model Customer: a identidade do cliente vem do pedido. Aqui
 * apenas agregamos. Se um dia vier a existir um cadastro proprio, e este
 * arquivo que passa a ler de la.
 *
 * A identidade e' o ponto delicado, e mudou por causa do WhatsApp.
 *
 * O `Order.clientPhone` guarda o endereco que o bot usou para responder, e o
 * WhatsApp passou a entregar mensagens por um identificador de privacidade, o
 * LID ("192479311741143@lid"). Esse identificador nao contem telefone e nao e'
 * estavel: a mesma pessoa pode aparecer com LIDs diferentes, e agrupar por ele
 * divide o mesmo cliente em varias linhas. O dono veria a Maria aparecer tres
 * vezes, com o gasto dividido, e nenhuma das tres linhas contaria a verdade do
 * total dela.
 *
 * A correcao e' agrupar pelo telefone de verdade quando ele existe, e so cair
 * para o endereco quando nao existe. O telefone vem da tabela Chat, que e' onde
 * o sistema ja resolve LID -> numero. Sem ele, um cliente com dois LIDs
 * diferentes continua separado -- por isso o endereco fica na chave como
 * ultimo recurso, marcado.
 */

export type CustomerRow = {
    /** Como o cliente aparece: telefone de verdade, ou o endereco se nao houver. */
    phone: string;
    /** Endereco usado para conversar, o que o bot entende. */
    jid: string;
    /** true quando so existe o endereco, e o telefone continua nao identificado. */
    semTelefone: boolean;
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

/**
 * Telefone resolvido por endereco.
 *
 * Uma consulta so para os enderecos que aparecem nos pedidos deste periodo. Nao
 * e' consulta por pedido: a lista e' carregada uma vez e indexada, porque a
 * alternativa seria uma consulta por linha e a tela de clientes mostra ate 200.
 */
async function telefonesResolvidos(jids: string[]): Promise<Map<string, string>> {
    const mapa = new Map<string, string>();
    if (jids.length === 0) return mapa;

    const chats = await prisma.chat.findMany({
        where: { phone: { in: jids } },
        select: { phone: true, telefone: true, name: true },
    });
    for (const c of chats) {
        if (c.telefone) mapa.set(c.phone, c.telefone);
    }
    return mapa;
}

export async function customerList(limit = 200): Promise<CustomerRow[]> {
    // So pedidos com telefone real: o PDV grava "Cliente Balcao" e nao tem
    // telefone, entao esses nao viram cliente.
    const orders = await prisma.order.findMany({
        where: { channel: 'whatsapp', NOT: { clientPhone: '' } },
        orderBy: { createdAt: 'desc' },
    });

    const jids = [...new Set(orders.map((o) => o.clientPhone.trim()).filter(Boolean))];
    const telefones = await telefonesResolvidos(jids);

    /*
     * A chave e' o telefone quando existe, e o endereco quando nao. A
     * separacao importa: dois pedidos do mesmo cliente, um de antes de o
     * telefone ser resolvido e um de depois, caem na MESMA chave e viram um
     * cliente so. Sem o sufixo do endereco, o mesmo cliente apareceria duas
     * vezes -- uma com o telefone, outra so com o endereco -- que e'
     * exatamente a fragmentacao que esta funcao existe para evitar.
     */
    const chaveDe = (jid: string) => {
        const telefone = telefones.get(jid);
        return telefone ? `t:${telefone}` : `j:${jid}`;
    };

    const byChave = new Map<string, CustomerRow>();
    const itemsByChave = new Map<string, Map<string, number>>();

    for (const o of orders) {
        const jid = o.clientPhone.trim();
        if (!jid) continue;

        const chave = chaveDe(jid);
        const telefone = telefones.get(jid) ?? '';

        let row = byChave.get(chave);
        if (!row) {
            row = {
                phone: telefone || jid,
                jid,
                semTelefone: telefone.length === 0,
                name: null,
                orders: 0,
                spent: 0,
                averageTicket: 0,
                lastOrderAt: o.createdAt.toLocaleString('pt-BR'),
                favorite: null,
                favoriteQty: 0,
                channel: o.channel,
            };
            byChave.set(chave, row);
            itemsByChave.set(chave, new Map());
        }

        row.orders += 1;
        row.spent += o.total;
        // Nome mais recente disponivel: o bot nunca pergunta o nome, mas o
        // balcao pode ter preenchido.
        if (!row.name && o.clientName && o.clientName.trim() && o.clientName !== 'Cliente WhatsApp') {
            row.name = o.clientName.trim();
        }

        const counts = itemsByChave.get(chave)!;
        for (const item of parseItems(o.items)) {
            counts.set(item.name, (counts.get(item.name) ?? 0) + item.qty);
        }
    }

    const rows: CustomerRow[] = [];
    for (const [chave, row] of byChave) {
        row.spent = Math.round(row.spent * 100) / 100;
        row.averageTicket = row.orders > 0 ? Math.round((row.spent / row.orders) * 100) / 100 : 0;

        const counts = itemsByChave.get(chave)!;
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
