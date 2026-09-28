import { escapeHtml } from './html';
import { currency } from '../services/stats';
import type { DashboardStats } from '../services/stats';
import { renderStats, type ReportData } from './tabs';
import { renderCash, type CashData } from './cash';
import { renderCustomers, type CustomersData } from './customers';

function money(n: number): string {
    return escapeHtml(currency(n));
}

function kpi(label: string, value: string, sub: string, tone: string): string {
    return `                <div class="kpi">
                    <p class="kpi-label">${label}</p>
                    <p class="kpi-value ${tone}">${value}</p>
                    <p class="kpi-sub">${sub}</p>
                </div>`;
}

export type FaturamentoData = {
    stats: DashboardStats;
    report: ReportData;
    cash: CashData;
    customers: CustomersData;
    todayRevenue: number;
    todayOrders: number;
    averageTicket: number;
    /** null enquanto nenhum produto tem custo cadastrado. */
    margin: { value: number; percent: number | null } | null;
};

/** Sub-abas. A ordem e' da pergunta mais comum para a menos comum. */
type SubTab = 'resumo' | 'caixa' | 'clientes' | 'pedidos';

const SUBTABS: Array<{ id: SubTab; label: string; icon: string }> = [
    { id: 'resumo', label: 'Resumo', icon: 'fa-solid fa-chart-line' },
    { id: 'caixa', label: 'Caixa', icon: 'fa-solid fa-cash-register' },
    { id: 'clientes', label: 'Clientes', icon: 'fa-solid fa-users' },
    { id: 'pedidos', label: 'Pedidos', icon: 'fa-solid fa-list' },
];

function subTabBar(atual: SubTab): string {
    return `        <div class="inline-flex rounded-card border border-line overflow-hidden mb-5 flex-wrap" role="tablist" aria-label="Faturamento">
${SUBTABS.map(
        (s) => `            <button type="button" id="sub_${s.id}" onclick="fatSetTab('${s.id}')" class="px-4 py-2 text-body font-medium transition ${
            s.id === atual ? 'bg-accent text-white' : ''
        }" role="tab" aria-selected="${s.id === atual ? 'true' : 'false'}">
                <i class="${s.icon}"></i> ${s.label}
            </button>`
    ).join('\n')}
        </div>`;
}

/** Painel do Resumo: os numeros de dinheiro que a Home deixou de mostrar. */
function resumo(d: FaturamentoData): string {
    const maxRevenue = Math.max(...d.stats.revenueByDay.slice(-7).map((x) => x.revenue), 1);
    const barras = d.stats.revenueByDay
        .slice(-7)
        .map(
            (x) => `                    <div class="flex-1 min-w-0 flex flex-col items-center gap-1">
                        <span class="text-micro text-ink-3">${x.revenue > 0 ? money(x.revenue) : ''}</span>
                        <div class="w-full max-w-[2.5rem] rounded-t bg-accent opacity-70" style="height: ${Math.max(3, Math.round((x.revenue / maxRevenue) * 100))}px"></div>
                        <span class="text-micro text-ink-3">${escapeHtml(x.label)}</span>
                    </div>`
        )
        .join('\n');

    const ticket = d.todayOrders > 0 ? money(d.averageTicket) : '--';

    return `        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            ${kpi('Faturamento hoje', money(d.todayRevenue), d.todayOrders + ' pedido(s)', 'text-accent-strong')}
            ${kpi('Ticket medio', ticket, d.todayOrders > 0 ? 'por pedido hoje' : 'sem pedidos hoje', 'text-accent-orange')}
            ${kpi(
                'Lucro estimado',
                d.margin ? money(d.margin.value) : '--',
                d.margin ? `margem de ${String(d.margin.percent).replace('.', ',')}%` : 'cadastre o custo dos produtos',
                d.margin ? 'text-accent-emerald' : 'text-ink-3'
            )}
            ${kpi('Pedidos no periodo', String(d.report.count), 'aba Pedidos', 'text-accent')}
        </div>

        ${
            barras
                ? `        <div class="card card-pad mb-6">
            <h3 class="text-title mb-1">Faturamento dos ultimos dias</h3>
            <p class="text-caption text-ink-3 mb-5">Receita por dia, em reais</p>
            <div class="flex items-end gap-2 h-[8.5rem]">
${barras}
            </div>
        </div>`
                : ''
        }

${renderStats(d.stats)}`;
}

function pedidos(d: FaturamentoData): string {
    const r = d.report;
    return `        <form method="GET" action="/admin" class="card card-pad mb-5 flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="faturamento">
            <div>
                <label class="label" for="relFrom">De</label>
                <input id="relFrom" type="date" name="from" value="${escapeHtml(r.from)}" class="input">
            </div>
            <div>
                <label class="label" for="relTo">Ate</label>
                <input id="relTo" type="date" name="to" value="${escapeHtml(r.to)}" class="input">
            </div>
            <div>
                <label class="label" for="relStatus">Status</label>
                <select id="relStatus" name="status" class="input">
                    <option value="">Todos</option>
                    <option value="pendente">Pendente</option>
                    <option value="preparando">Preparando</option>
                    <option value="entrega">Em entrega</option>
                    <option value="concluido">Concluido</option>
                </select>
            </div>
            <button type="submit" class="btn btn-primary">
                <i class="fa-solid fa-filter"></i> Filtrar
            </button>
            <a href="/admin/reports.csv?from=${escapeHtml(r.from)}&to=${escapeHtml(r.to)}" class="btn btn-ghost">
                <i class="fa-solid fa-file-csv"></i> Exportar CSV
            </a>
            <span class="text-body text-ink-3 ml-auto">${r.count} pedido(s) &middot; ${money(r.total)}</span>
        </form>

        <div class="card overflow-hidden">
            ${
                r.count === 0
                    ? '<p class="text-body text-ink-3 text-center py-10">Nenhum pedido encontrado no periodo.</p>'
                    : `<div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Data</th><th>Cliente</th><th>Contato</th><th>Itens</th>
                            <th>Desc/Gorj</th><th>Total</th><th>Status</th><th>Canal</th>
                        </tr>
                    </thead>
                    <tbody>${r.rowsHtml}</tbody>
                </table>
            </div>`
            }
        </div>`;
}

/**
 * Faturamento: tudo que mexe em dinheiro num lugar so.
 *
 * Resumo (numeros do dia, ticket, lucro, graficos), Caixa (turno, sangrias,
 * conferencia), Clientes (quanto cada um gastou) e Pedidos (a lista com filtro
 * e CSV). A Home ficou so com operacao.
 *
 * Esta aba e' o unico ponto onde o dinheiro aparece, e por isso foi deixada
 * pronta para ganhar uma senha: e' o lugar natural para o gate do servidor.
 * Vale registrar que senha sozinha nao esconde dado de quem ja tem a tela
 * aberta nem de quem le o banco -- o gate precisa ser no servidor.
 */
export function renderFaturamento(d: FaturamentoData, inicial: SubTab = 'resumo'): string {
    return `${subTabBar(inicial)}
        <div id="painelResumo"${inicial === 'resumo' ? '' : ' class="hidden"'}>
${resumo(d)}
        </div>

        <div id="painelCaixa"${inicial === 'caixa' ? '' : ' class="hidden"'}>
${renderCash(d.cash)}
        </div>

        <div id="painelClientes"${inicial === 'clientes' ? '' : ' class="hidden"'}>
${renderCustomers(d.customers)}
        </div>

        <div id="painelPedidos"${inicial === 'pedidos' ? '' : ' class="hidden"'}>
${pedidos(d)}
        </div>

        <script>
            function fatSetTab(qual) {
                var alvos = ['resumo', 'caixa', 'clientes', 'pedidos'];
                for (var i = 0; i < alvos.length; i++) {
                    var id = alvos[i];
                    var painel = document.getElementById('painel' + id.charAt(0).toUpperCase() + id.slice(1));
                    var botao = document.getElementById('sub_' + id);
                    if (!painel || !botao) continue;
                    painel.classList.toggle('hidden', id !== qual);
                    botao.className = 'px-4 py-2 text-body font-medium transition ' + (id === qual ? 'bg-accent text-white' : '');
                    botao.setAttribute('aria-selected', id === qual ? 'true' : 'false');
                }
                try { localStorage.setItem('faturamentoAba', qual); } catch (e) {}
            }

            (function abreCertaAba() {
                /*
                 * Prioridade para descobrir qual sub-aba abrir:
                 *
                 *   1. #hash        -- link antigo, ?tab=caixa vira #caixa
                 *   2. ?aba=        -- o que a Home e os redirecionamentos usam
                 *   3. filtro de data -- quem filtra por periodo quer Pedidos
                 *   4. localStorage  -- a ultima usada nesta visita
                 *   5. Resumo
                 *
                 * O ?aba= e' o que faltava, e sem ele o servidor desenhava a
                 * sub-aba certa e este script sobrescrevia com o localStorage.
                 * Efeito visivel: clicar em "Ver turnos" no card do Caixa da
                 * Home te trazia para a sub-aba que voce usou por ultimo.
                 */
                var hash = (window.location.hash || '').replace('#', '');
                var params = new URLSearchParams(window.location.search);
                var veioComFiltro = params.get('from') || params.get('to') || params.get('status');
                var qual = hash || params.get('aba') || '';
                if (!qual) qual = veioComFiltro ? 'pedidos' : '';
                if (!qual) { try { qual = localStorage.getItem('faturamentoAba') || ''; } catch (e) {} }
                fatSetTab(qual || 'resumo');
            })();
        </script>`;
}
