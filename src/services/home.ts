import { computeStats, type DashboardStats, type OrderWithProductless } from './stats';
import { reorderList, type StockRow } from './stock';
import { openShift, shiftHistory, type OpenShift, type ParkedSaleView } from './cash';
import { parkedSales } from './cash';
import { parseHhMm } from './cashSchedule';
import { parseItems } from './items';
import { getDailyMenu, previousDailyMenu, type DailyMenuView } from './dailyMenu';

/**
 * Todas as queries da home ficam aqui, num modulo so.
 *
 * A view (src/views/home.ts) nao toca o banco: recebe dados prontos. Isso
 * mantem a home isolada do resto, que e o que permite multi-loja no futuro
 * sem reescrever a interface.
 */

export type SetupCheck = {
    id: string;
    label: string;
    detail: string;
    href: string;
    done: boolean;
};

export type CashState = {
    scheduleOn: boolean;
    autoOpen: string;
    autoClose: string;
    hasFloat: boolean;
    /** Turno aberto agora, se houver. */
    shift: OpenShift | null;
    /** Turnos fechados pela agenda que ainda precisam de contagem. */
    pendingCount: number;
};

export type HomeAlert = {
    id: string;
    tone: 'red' | 'amber' | 'slate';
    title: string;
    detail: string;
    href: string;
    cta: string;
};

export type HomeData = {
    businessName: string;
    today: { revenue: number; orders: number };
    /** Variacao percentual vs o dia anterior; null quando nao ha base. */
    delta: { revenue: number | null; orders: number | null };
    averageTicket: number;
    yesterday: { revenue: number; orders: number } | null;
    queue: { pendente: number; preparando: number; entrega: number; concluidoHoje: number };
    topProducts: Array<{ name: string; qty: number }>;
    last7Days: Array<{ label: string; revenue: number; orders: number }>;
    /** Lucro estimado de hoje, quando ha preco de custo cadastrado. */
    margin: { value: number; percent: number | null } | null;
    setup: SetupCheck[];
    alerts: HomeAlert[];
    cash: CashState;
    parkedCount: number;
    botOnline: boolean;
    stats: DashboardStats;
    /** Menu do dia de hoje, ou null se ainda nao foi definido. */
    dailyMenu: DailyMenuView | null;
    /** Menu mais recente de um dia anterior, para oferecer "copiar". */
    previousMenu: DailyMenuView | null;
    /** Produtos disponiveis para montar o menu do dia, em ordem alfabetica. */
    menuProducts: Array<{ id: string; name: string; price: number; category: string }>;
};

function startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function pct(today: number, yesterday: number): number | null {
    if (yesterday <= 0) return null;
    return Math.round(((today - yesterday) / yesterday) * 1000) / 10;
}

/**
 * Lucro estimado de um conjunto de pedidos. O total do pedido e distribuido
 * igualmente entre as unidades (mesma regra de computeStats) e o custo vem do
 * preco de custo do produto. Sem nenhum item com custo cadastrado, devolve
 * null em vez de um numero inventado.
 */
function estimateMargin(
    orders: OrderWithProductless[],
    products: Array<{ name: string; price: number; costPrice: number }>
): HomeData['margin'] {
    const byName = new Map(products.map((p) => [p.name, p]));
    let revenue = 0;
    let cost = 0;
    let hasCost = false;

    for (const o of orders) {
        const items = parseItems(o.items);
        const totalQty = items.reduce((a, i) => a + i.qty, 0) || 1;
        for (const item of items) {
            const share = (o.total / totalQty) * item.qty;
            revenue += share;

            const p = byName.get(item.name);
            if (p && p.costPrice > 0 && p.price > 0) {
                // Proporcao custo/venda do item aplicada a parcela dele.
                cost += share * (p.costPrice / p.price);
                hasCost = true;
            }
        }
    }

    if (!hasCost || revenue <= 0) return null;

    const value = Math.round((revenue - cost) * 100) / 100;
    return { value, percent: Math.round(((revenue - cost) / revenue) * 1000) / 10 };
}

async function buildSetupChecks(
    products: Array<{ id: string; trackStock: boolean }>,
    config: { pixKey: string; originAddress: string },
    botOnline: boolean
): Promise<SetupCheck[]> {
    const tracked = products.filter((p) => p.trackStock).length;
    const hasDefaultAddress = !config.originAddress || config.originAddress === 'Rua Principal, 100';

    return [
        {
            id: 'produtos',
            label: 'Cadastrar produtos no cardapio',
            detail: products.length === 0 ? 'Nenhum produto ainda' : `${products.length} produto(s) cadastrados`,
            href: '/admin?tab=pdv',
            done: products.length > 0,
        },
        {
            id: 'whatsapp',
            label: 'Conectar o WhatsApp',
            detail: botOnline ? 'Bot conectado e recebendo pedidos' : 'Bot desconectado: nenhum pedido chega pelo WhatsApp',
            href: '/admin?tab=whatsapp',
            done: botOnline,
        },
        {
            id: 'pix',
            label: 'Cadastrar a chave PIX',
            detail: config.pixKey ? 'Chave PIX configurada' : 'Sem chave, o cliente nao tem como pagar',
            href: '/admin?tab=config',
            done: config.pixKey.length > 0,
        },
        {
            id: 'origem',
            label: 'Definir o endereco de origem',
            detail: hasDefaultAddress ? 'Ainda no endereco padrao' : config.originAddress,
            href: '/admin?tab=config',
            done: !hasDefaultAddress,
        },
        {
            id: 'estoque',
            label: 'Controlar o estoque de algum produto',
            detail: tracked === 0 ? 'Nenhum produto baixa estoque na venda' : `${tracked} produto(s) com controle`,
            href: '/admin?tab=estoque',
            done: tracked > 0,
        },
    ];
}

function buildAlerts(
    reorder: Array<StockRow & { faltam: number }>,
    parked: ParkedSaleView[],
    cash: CashState,
    botOnline: boolean
): HomeAlert[] {
    const alerts: HomeAlert[] = [];

    const zerados = reorder.filter((r) => r.stock <= 0);
    if (zerados.length > 0) {
        alerts.push({
            id: 'zerado',
            tone: 'red',
            title: `${zerados.length} produto(s) zerado(s)`,
            detail: zerados
                .slice(0, 3)
                .map((r) => r.name)
                .join(', ') + (zerados.length > 3 ? '...' : ''),
            href: '/admin?tab=estoque',
            cta: 'Repor agora',
        });
    }

    const baixos = reorder.filter((r) => r.stock > 0);
    if (baixos.length > 0) {
        alerts.push({
            id: 'baixo',
            tone: 'amber',
            title: `${baixos.length} produto(s) abaixo do minimo`,
            detail: baixos
                .slice(0, 3)
                .map((r) => r.name)
                .join(', ') + (baixos.length > 3 ? '...' : ''),
            href: '/admin?tab=estoque',
            cta: 'Ver lista de compras',
        });
    }

    if (!botOnline) {
        alerts.push({
            id: 'bot',
            tone: 'red',
            title: 'Bot do WhatsApp desconectado',
            detail: 'Nenhum pedido novo esta entrando pelo WhatsApp.',
            href: '/admin?tab=whatsapp',
            cta: 'Reconectar',
        });
    }

    if (parked.length > 0) {
        alerts.push({
            id: 'pausadas',
            tone: 'amber',
            title: `${parked.length} venda(s) suspensa(s)`,
            detail: 'Pedidos do balcao que ficaram na fila de pagamento.',
            href: '/admin?tab=pdv',
            cta: 'Retomar',
        });
    }

    if (cash.pendingCount > 0) {
        alerts.push({
            id: 'conferencia',
            tone: 'amber',
            title: `${cash.pendingCount} turno(s) sem conferencia`,
            detail: 'Fechados pela agenda: falta contar o dinheiro da gaveta.',
            href: '/admin?tab=reports',
            cta: 'Conferir',
        });
    }

    return alerts;
}

export async function loadHomeData(opts: {
    orders: OrderWithProductless[];
    products: Array<{ id: string; name: string; price: number; costPrice: number; category: string | null; stock: number; minStock: number; trackStock: boolean; isAvailable: boolean }>;
    config: { businessName: string; pixKey: string; originAddress: string; cashAutoOpen: string; cashAutoClose: string; cashDefaultFloat: number };
    botOnline: boolean;
}): Promise<HomeData> {
    const { orders, products, config, botOnline } = opts;
    const now = new Date();

    const [stats, shift, parked, recentShifts, dailyMenu, previousMenu] = await Promise.all([
        computeStats(orders),
        openShift(),
        parkedSales(),
        shiftHistory(30),
        getDailyMenu(now),
        previousDailyMenu(now),
    ]);

    const todayStart = startOfDay(now);
    const yesterdayStart = startOfDay(new Date(now.getTime() - 86_400_000));

    const todayOrders = orders.filter((o) => o.createdAt >= todayStart);
    const yesterdayOrders = orders.filter((o) => o.createdAt >= yesterdayStart && o.createdAt < todayStart);

    const sum = (list: typeof orders) => Math.round(list.reduce((acc, o) => acc + o.total, 0) * 100) / 100;

    // ---- estoque ----
    const stockRows: StockRow[] = products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        costPrice: p.costPrice,
        category: p.category || 'Geral',
        stock: p.stock,
        minStock: p.minStock,
        trackStock: p.trackStock,
        isAvailable: p.isAvailable,
    }));
    const reorder = reorderList(stockRows);

    // ---- caixa ----
    const pendingCount = recentShifts.filter((s) => s.difference === null).length;
    const cash: CashState = {
        scheduleOn: parseHhMm(config.cashAutoOpen) !== null || parseHhMm(config.cashAutoClose) !== null,
        autoOpen: config.cashAutoOpen,
        autoClose: config.cashAutoClose,
        hasFloat: config.cashDefaultFloat > 0,
        shift,
        pendingCount,
    };

    // ---- lucro estimado de hoje ----
    // So e confiavel onde existe preco de custo. Sem ele, mostrar lucro seria
    // inventar numero, entao devolvemos null em vez de estimar.
    const margin = estimateMargin(todayOrders, products);

    const setup = await buildSetupChecks(products, config, botOnline);

    return {
        businessName: config.businessName,
        today: { revenue: sum(todayOrders), orders: todayOrders.length },
        yesterday: yesterdayOrders.length > 0 ? { revenue: sum(yesterdayOrders), orders: yesterdayOrders.length } : null,
        delta: {
            revenue: yesterdayOrders.length > 0 ? pct(sum(todayOrders), sum(yesterdayOrders)) : null,
            orders: yesterdayOrders.length > 0 ? pct(todayOrders.length, yesterdayOrders.length) : null,
        },
        averageTicket: todayOrders.length > 0 ? Math.round((sum(todayOrders) / todayOrders.length) * 100) / 100 : 0,
        queue: {
            pendente: orders.filter((o) => o.status === 'pendente').length,
            preparando: orders.filter((o) => o.status === 'preparando').length,
            entrega: orders.filter((o) => o.status === 'entrega').length,
            concluidoHoje: orders.filter((o) => o.status === 'concluido' && o.updatedAt >= todayStart).length,
        },
        topProducts: stats.topProducts.slice(0, 3).map((p) => ({ name: p.name, qty: p.qty })),
        last7Days: stats.revenueByDay.slice(-7).map((d) => ({ label: d.label, revenue: d.revenue, orders: d.orders })),
        margin,
        setup,
        alerts: buildAlerts(reorder, parked, cash, botOnline),
        cash,
        parkedCount: parked.length,
        botOnline,
        stats,
        dailyMenu,
        previousMenu,
        // Pausados nao entram no cardapio, entao nao podem ser escolhidos.
        menuProducts: products
            .filter((p) => p.isAvailable)
            .map((p) => ({ id: p.id, name: p.name, price: p.price, category: p.category || 'Geral' }))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    };
}


