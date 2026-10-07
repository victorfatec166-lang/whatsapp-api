// DashboardStats saiu do import: sobrou quando os numeros de faturamento foram
// para a aba Faturamento. Hoje a Home so devolve contagem de pedidos.
import { computeStats, type OrderWithProductless } from './stats';
import { reorderList, type StockRow } from './stock';
import { openShift, shiftHistory, type OpenShift, type ParkedSaleView } from './cash';
import { parkedSales } from './cash';
import { parseHhMm } from './cashSchedule';
import { parseItems } from './items';
import { getDailyMenu, previousDailyMenu, type DailyMenuView } from './dailyMenu';
import { listarContas, type Canal, type StatusConta } from './marketplace';
import { inicioDoDiaNoFuso } from './fuso';

/**
 * Todas as queries da home ficam aqui: a view (src/views/home.ts) nao toca o
 * banco, recebe dados prontos. E' o que mantem a home isolada do resto.
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
    today: { orders: number };
    /** Variacao percentual vs o dia anterior; null quando nao ha base. */
    delta: { orders: number | null };
    queue: { pendente: number; preparando: number; entrega: number; concluidoHoje: number };
    topProducts: Array<{ name: string; qty: number }>;
    setup: SetupCheck[];
    alerts: HomeAlert[];
    cash: CashState;
    parkedCount: number;
    botOnline: boolean;
    /** Menu do dia de hoje, ou null se ainda nao foi definido. */
    dailyMenu: DailyMenuView | null;
    /** Menu mais recente de um dia anterior, para oferecer "copiar". */
    previousMenu: DailyMenuView | null;
    /** Produtos disponiveis para montar o menu do dia, em ordem alfabetica. */
    menuProducts: Array<{ id: string; name: string; price: number; category: string }>;
    /**
     * A Home mostra so o estado do canal, nunca a credencial: serve para ver que o
     * iFood esta ativo sem abrir a tela do marketplace, e para saber que um canal
     * esta em homologacao enquanto ela acha que esta vendendo por ele.
     */
    conexoes: Array<{
        channel: Canal;
        status: StatusConta;
        temCredencial: boolean;
        pedidosRecebidos: number;
    }>;
};

/**
 * A Home e' so operacao: nada de receita, ticket, margem ou grafico. Tudo que
 * mexe em dinheiro foi para a aba Faturamento, e os campos sairam daqui de
 * proposito -- assim nao ha como o valor voltar a aparecer por engano.
 */


function pct(today: number, yesterday: number): number | null {
    if (yesterday <= 0) return null;
    return Math.round(((today - yesterday) / yesterday) * 1000) / 10;
}

/**
 * Lucro estimado. O total do pedido e distribuido igualmente entre as unidades
 * (mesma regra de computeStats); sem nenhum item com custo cadastrado, percent
 * e null em vez de um numero inventado.
 */
export type MarginEstimate = { value: number; percent: number | null };

export function estimateMargin(
    orders: OrderWithProductless[],
    products: Array<{ name: string; price: number; costPrice: number }>
): MarginEstimate | null {
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

/**
 * So entram etapas que o dono realmente precisa cumprir pela tela. Item que
 * promete algo que nao acontece e' pior que a falta dele: a pessoa para de
 * procurar o que esta realmente quebrado.
 */
async function buildSetupChecks(
    products: Array<{ id: string; trackStock: boolean }>,
    botOnline: boolean
): Promise<SetupCheck[]> {
    const tracked = products.filter((p) => p.trackStock).length;
    const cadastrados = products.length;

    return [
        {
            id: 'produtos',
            label: 'Cadastre seus produtos',
            detail:
                cadastrados === 0
                    ? 'Sem produtos o cardapio fica vazio para o cliente'
                    : cadastrados === 1
                      ? '1 produto no cardapio'
                      : cadastrados + ' produtos no cardapio',
            // O cadastro de produtos vive em Produtos e Estoque; o PDV so vende.
            href: '/admin?tab=estoque',
            done: cadastrados > 0,
        },
        {
            id: 'whatsapp',
            label: 'Conecte o WhatsApp',
            detail: botOnline
                ? 'Bot conectado e recebendo pedidos'
                : 'Sem ele nenhum pedido chega pelo WhatsApp',
            href: '/admin?tab=whatsapp',
            done: botOnline,
        },
        /* O item "Cadastre a chave PIX" saiu daqui: prometia algo que nao acontecia --
         * o pixKey so era lido por este checklist, nem o bot nem o PDV mandavam a
         * chave para o cliente. Volta junto quando o pixKey voltar a ser entregue.
         */
        {
            id: 'estoque',
            label: 'Ative o controle de estoque',
            detail: tracked === 0 ? 'Nenhum produto baixa o saldo na venda' : tracked + ' produto(s) com controle',
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
            href: '/admin?tab=faturamento&aba=caixa',
            cta: 'Conferir',
        });
    }

    return alerts;
}

export async function loadHomeData(opts: {
    orders: OrderWithProductless[];
    products: Array<{ id: string; name: string; price: number; costPrice: number; category: string | null; stock: number; minStock: number; trackStock: boolean; isAvailable: boolean }>;
    config: { businessName: string; cashAutoOpen: string; cashAutoClose: string; cashDefaultFloat: number };
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

    const todayStart = inicioDoDiaNoFuso(now);
    const yesterdayStart = inicioDoDiaNoFuso(new Date(now.getTime() - 86_400_000));

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

    const setup = await buildSetupChecks(products, botOnline);

    /*
     * Estado dos canais, e so o estado: credencial, webhook e erro da ultima
     * checagem moram na tela do canal. listarContas cria a conta na primeira
     * leitura, entao canal nunca configurado aparece como "sem credencial" em vez de sumir.
     */
    const conexoes = (await listarContas()).map((c) => ({
        channel: c.channel,
        status: c.status,
        temCredencial: c.temCredencial,
        pedidosRecebidos: c.pedidosRecebidos,
    }));

    return {
        businessName: config.businessName,
        today: { orders: todayOrders.length },
        delta: {
            orders: yesterdayOrders.length > 0 ? pct(todayOrders.length, yesterdayOrders.length) : null,
        },
        queue: {
            pendente: orders.filter((o) => o.status === 'pendente').length,
            preparando: orders.filter((o) => o.status === 'preparando').length,
            entrega: orders.filter((o) => o.status === 'entrega').length,
            concluidoHoje: orders.filter((o) => o.status === 'concluido' && o.updatedAt >= todayStart).length,
        },
        topProducts: stats.topProducts.slice(0, 3).map((p) => ({ name: p.name, qty: p.qty })),
        setup,
        alerts: buildAlerts(reorder, parked, cash, botOnline),
        cash,
        parkedCount: parked.length,
        botOnline,
        dailyMenu,
        previousMenu,
        // Pausados nao entram no cardapio, entao nao podem ser escolhidos.
        menuProducts: products
            .filter((p) => p.isAvailable)
            .map((p) => ({ id: p.id, name: p.name, price: p.price, category: p.category || 'Geral' }))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        conexoes,
    };
}


