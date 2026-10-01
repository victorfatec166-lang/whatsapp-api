import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { getBotMessage } from './botMessages';
import { exigeLoja } from './loja';

/**
 * Menu do dia. Regra central: `buildBotMenu` e a UNICA fonte da lista numerada
 * que o bot envia e que ele usa para interpretar a resposta -- se as duas
 * divergirem, o cliente pede o prato errado.
 */

/** Meia-noite local do dia de `d`. */
export function startOfDay(d: Date = new Date()): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

/** Aceita "YYYY-MM-DD" ou Date e devolve a meia-noite local desse dia. */
export function normalizeDate(input: Date | string | null | undefined): Date {
    if (input instanceof Date) return startOfDay(input);
    if (typeof input === 'string') {
        const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    return startOfDay();
}

export type DailyMenuItemView = {
    id: string;
    name: string;
    price: number;
    description: string | null;
    category: string;
};

export type DailyMenuView = {
    date: string;
    note: string | null;
    items: DailyMenuItemView[];
};

function toDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export async function getDailyMenu(input?: Date | string | null): Promise<DailyMenuView | null> {
    const date = normalizeDate(input);
    const menu = await prisma.dailyMenu.findFirst({
        where: { date },
        include: {
            items: {
                orderBy: { sortOrder: 'asc' },
                include: { product: { select: { id: true, name: true, price: true, description: true, category: true } } },
            },
        },
    });
    if (!menu) return null;

    return {
        date: toDateKey(menu.date),
        note: menu.note,
        items: menu.items.map((i) => ({
            id: i.product.id,
            name: i.product.name,
            price: i.product.price,
            description: i.product.description,
            category: i.product.category,
        })),
    };
}

/**
 * Grava o menu do dia. `productIds` substitui a lista inteira, na ordem
 * informada. Pratos pausados ou inexistentes sao ignorados em vez de falhar:
 * o dono pode ter marcado um prato como pausado depois de montar a lista.
 */
export async function setDailyMenu(params: {
    date?: Date | string | null;
    productIds: string[];
    note?: string | null;
}): Promise<{ ok: boolean; error?: string; menu?: DailyMenuView }> {
    const date = normalizeDate(params.date);

    const wanted: string[] = [...new Set(params.productIds.map((id) => String(id ?? '')).filter(Boolean))];
    if (wanted.length === 0) {
        // Menu sem pratos e o mesmo que nao ter menu: remove o registro para
        // o card da home voltar ao estado "nao definido".
        await prisma.dailyMenu.deleteMany({ where: { date } });
        return { ok: true, menu: null };
    }

    const available = await prisma.product.findMany({
        where: { id: { in: wanted }, isAvailable: true },
        select: { id: true },
    });
    const allowed = new Set(available.map((p) => p.id));
    const ids = wanted.filter((id) => allowed.has(id));
    if (ids.length === 0) {
        return { ok: false, error: 'Nenhum prato valido ou disponivel no menu.' };
    }

    const note = typeof params.note === 'string' ? params.note.trim().slice(0, 140) : null;

    const menu = await prisma.dailyMenu.upsert({
        where: { tenantId_date: { tenantId: exigeLoja(), date } },
        update: { note },
        create: { tenantId: exigeLoja(), date, note },
    });

    await prisma.$transaction(async (tx) => {
        await tx.dailyMenuItem.deleteMany({ where: { menuId: menu.id } });
        await tx.dailyMenuItem.createMany({
            data: ids.map((productId, i) => ({ tenantId: exigeLoja(), menuId: menu.id, productId, sortOrder: i })),
        });
    });

    return { ok: true, menu: await getDailyMenu(date) };
}

/** Copia os pratos de um dia para outro. Base para "ontem foi assim, hoje e igual". */
export async function copyDailyMenu(params: {
    from: Date | string | null;
    to?: Date | string | null;
}): Promise<{ ok: boolean; error?: string; copied: number }> {
    const from = normalizeDate(params.from);
    const to = normalizeDate(params.to ?? new Date());

    const source = await prisma.dailyMenu.findFirst({
        where: { date: from },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source || source.items.length === 0) {
        return { ok: false, error: 'Nao ha menu do dia de origem para copiar.', copied: 0 };
    }

    const result = await setDailyMenu({
        date: to,
        productIds: source.items.map((i) => i.productId),
        note: source.note,
    });
    if (!result.ok) return { ok: false, error: result.error, copied: 0 };
    return { ok: true, copied: source.items.length };
}

/** Menu do dia mais recente com pratos, usado no botao "copiar". */
export async function previousDailyMenu(before: Date | string | null): Promise<DailyMenuView | null> {
    const date = normalizeDate(before);
    const menu = await prisma.dailyMenu.findFirst({
        where: { date: { lt: date }, items: { some: {} } },
        orderBy: { date: 'desc' },
        include: {
            items: {
                orderBy: { sortOrder: 'asc' },
                include: { product: { select: { id: true, name: true, price: true, description: true, category: true } } },
            },
        },
    });
    if (!menu) return null;

    return {
        date: toDateKey(menu.date),
        note: menu.note,
        items: menu.items.map((i) => ({
            id: i.product.id,
            name: i.product.name,
            price: i.product.price,
            description: i.product.description,
            category: i.product.category,
        })),
    };
}

export type BotMenuEntry = {
    id: string;
    name: string;
    price: number;
    description: string | null;
    isDaily: boolean;
};

/**
 * Lista numerada: menu do dia primeiro, depois o restante do cardapio, sem repetir.
 * Serve para renderizar a mensagem e para resolver o numero digitado -- por isso o
 * bot guarda tambem um retrato desta lista na sessao.
 */
export async function buildBotMenu(now = new Date()): Promise<BotMenuEntry[]> {
    const available = await prisma.product.findMany({
        where: { isAvailable: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, price: true, description: true },
    });

    const menu = await prisma.dailyMenu.findFirst({
        where: { date: startOfDay(now) },
        include: { items: { orderBy: { sortOrder: 'asc' }, select: { productId: true } } },
    });
    const dailyIds = new Set(menu?.items.map((i) => i.productId) ?? []);

    const daily: BotMenuEntry[] = [];
    const rest: BotMenuEntry[] = [];

    // A ordem do menu do dia manda; por isso percorrendo os itens do menu e nao
    // os produtos.
    for (const item of menu?.items ?? []) {
        const p = available.find((x) => x.id === item.productId);
        if (!p) continue;
        daily.push({ id: p.id, name: p.name, price: p.price, description: p.description, isDaily: true });
    }
    for (const p of available) {
        if (dailyIds.has(p.id)) continue;
        rest.push({ id: p.id, name: p.name, price: p.price, description: p.description, isDaily: false });
    }

    return [...daily, ...rest];
}

/**
 * Texto do cardapio enviado ao cliente: secao do menu do dia no topo, depois o
 * restante, com a numeracao correndo do inicio ao fim.
 *
 * Fica aqui (e nao em bot.ts) para poder ser testado sem conexao de WhatsApp.
 */
export function renderBotMenuText(entries: BotMenuEntry[]): string {
    const line = (e: BotMenuEntry, index: number) =>
        `*[${index + 1}]* ${e.name}\n` +
        `      💰 R$ ${e.price.toFixed(2)}\n` +
        (e.description ? `      📝 ${e.description}\n` : '') +
        '\n';

    let text = getBotMessage('menuHeader', '🍽️ *CARDÁPIO DIGITAL* 🍽️') + '\n';
    text += '━━━━━━━━━━━━━━━━━━━━━\n\n';

    let n = 0;
    const daily = entries.filter((e) => e.isDaily);
    if (daily.length > 0) {
        text += getBotMessage('dailyMenuTitle', '⭐ *MENU DO DIA* ⭐\n');
        text += '━━━━━━━━━━━━━━━━━━━━━\n\n';
        for (const e of daily) text += line(e, n++);
    }

    const rest = entries.filter((e) => !e.isDaily);
    if (rest.length > 0) {
        if (daily.length > 0) {
            text += getBotMessage('regularMenuTitle', '📋 *CARDÁPIO* 📋\n');
            text += '━━━━━━━━━━━━━━━━━━━━━\n\n';
        }
        for (const e of rest) text += line(e, n++);
    }

    text += '━━━━━━━━━━━━━━━━━━━━━\n';
    text += getBotMessage('menuFooter', '👉 Digite o *número do produto* que deseja encomendar (ou digite *menu* para voltar):');
    return text;
}
