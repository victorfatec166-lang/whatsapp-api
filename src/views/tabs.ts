import { escapeHtml } from './html';
import { currency, statusLabel, type OrderWithProductless } from '../services/stats';
import type { DashboardStats } from '../services/stats';
import { renderComandaModal, COMANDA_SCRIPT } from './comandaModal';

type Product = {
    id: string;
    name: string;
    price: number;
    description: string | null;
    category: string;
    isAvailable: boolean;
};

function money(n: number): string {
    return escapeHtml(currency(n));
}

function phone(p: string): string {
    return escapeHtml(p.replace('@s.whatsapp.net', ''));
}

function timeOf(d: Date): string {
    return escapeHtml(d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
}

/* ------------------------------------------------------------------ Kanban */

type KanbanData = {
    pendentes: OrderWithProductless[];
    preparando: OrderWithProductless[];
    entrega: OrderWithProductless[];
    concluido: OrderWithProductless[];
    /** Concluidos de dias anteriores, ocultos da coluna (mantidos no historico). */
    ocultosConcluidos: number;
    totalAguardando: number;
};

function orderCard(o: OrderWithProductless, next: string | null, tint: string, accent: string, icon: string): string {
    const action = next
        ? `<button onclick="updateStatus('${escapeHtml(o.id)}', '${next}')"
                     class="w-full ${tint} hover:brightness-95 text-white text-xs py-1.5 rounded-lg font-medium transition flex items-center justify-center gap-1">
                     ${statusLabel(next)} <i class="${icon}"></i>
           </button>`
        : '';

    // Venda de balcao nao tem WhatsApp: mostra o canal para nao confundir.
    const channel =
        o.channel === 'pdv'
            ? '<span class="badge-slate text-[10px] px-1.5 py-0.5 rounded font-bold" title="Venda de frente de caixa">PDV</span>'
            : '';

    // Comanda da cozinha. Fica ao lado do botao de status, e nao dentro dele:
    // imprimir e avancar o status sao acoes diferentes, e quem monta o pedido
    // as vezes precisa reimprimir sem ter chegado na cozinha ainda.
    const comanda = `<button type="button" onclick="comandaAbrir('${escapeHtml(o.id)}')"
                         class="w-full btn btn-ghost text-xs py-1.5 rounded-lg font-medium transition flex items-center justify-center gap-1 mt-1.5"
                         title="Ver a comanda da cozinha">
                     <i class="fa-solid fa-print"></i> Comanda
                 </button>`;

    return `                        <div class="surface p-3 rounded-xl border card-${tint.replace('bg-', '')} shadow-sm">
                            <div class="flex justify-between items-start gap-2 font-semibold ink text-sm mb-1">
                                <span class="truncate">${escapeHtml(o.clientName || 'Cliente')}</span>
                                <span class="${accent} shrink-0">${money(o.total)}</span>
                            </div>
                            <p class="text-xs ink-3 mb-2 break-words">${escapeHtml(o.items)}</p>
                            <p class="text-[11px] ink-3 mb-2 flex items-center gap-2 flex-wrap">
                                <span><i class="fa-solid fa-clock text-[10px]"></i> ${timeOf(o.createdAt)}</span>
                                ${
                                    o.channel === 'pdv'
                                        ? `<span title="Pago com ${escapeHtml(o.paymentMethod ?? 'nao informado')}"><i class="fa-solid fa-money-bill-wave text-[10px]"></i> ${escapeHtml(o.paymentMethod ?? 'balcao')}</span>`
                                        : `<span><i class="fa-solid fa-phone text-[10px]"></i> ${phone(o.clientPhone)}</span>`
                                }
                                ${channel}
                            </p>
                            ${action}
                            ${comanda}
                        </div>`;
}

export function renderKanban(d: KanbanData): string {
    const column = (
        title: string,
        icon: string,
        items: OrderWithProductless[],
        badge: string,
        empty: string,
        footnote = ''
    ): string => `                    <div class="surface-2 p-4 rounded-2xl shadow-sm border line flex flex-col min-h-[16rem]">
                        <div class="flex items-center justify-between pb-3 border-b line mb-3">
                            <h3 class="font-bold ink text-sm flex items-center gap-2">
                                <i class="${icon}"></i> ${title}
                            </h3>
                            <span class="${badge} text-xs px-2 py-0.5 rounded-full font-bold">${items.length}</span>
                        </div>
                        <div class="space-y-3 flex-1 overflow-y-auto">
                            ${items.length === 0 ? `<p class="text-xs ink-3 text-center py-6">${empty}</p>` : ''}
                            ${items.map((o) => orderCard(o, null, '', '', '')).join('')}
                        </div>
                        ${footnote}
                    </div>`;

    // colunas com acao proprio
    const withAction = (o: OrderWithProductless, next: string, tint: string, accent: string, icon: string) =>
        orderCard(o, next, tint, accent, icon);

    const col = (title: string, icon: string, items: OrderWithProductless[], badge: string, next: string | null, tint: string, accent: string, btnIcon: string) => `                    <div class="surface-2 p-4 rounded-2xl shadow-sm border line flex flex-col min-h-[16rem]">
                        <div class="flex items-center justify-between pb-3 border-b line mb-3">
                            <h3 class="font-bold ink text-sm flex items-center gap-2"><i class="${icon}"></i> ${title}</h3>
                            <span class="${badge} text-xs px-2 py-0.5 rounded-full font-bold">${items.length}</span>
                        </div>
                        <div class="space-y-3 flex-1 overflow-y-auto">
                            ${items.length === 0 ? '<p class="text-xs ink-3 text-center py-6">Nenhum pedido</p>' : ''}
                            ${items.map((o) => (next ? withAction(o, next, tint, accent, btnIcon) : orderCard(o, null, '', '', ''))).join('')}
                        </div>
                    </div>`;

    return `        <div class="flex flex-wrap items-center gap-3 mb-5">
            <div class="surface border line rounded-xl px-4 py-2 text-sm">
                <span class="ink-3">Aguardando:</span>
                <span class="font-bold ink ml-1">${d.totalAguardando}</span>
            </div>
            <div class="surface border line rounded-xl px-4 py-2 text-sm">
                <span class="ink-3">No quadro:</span>
                <span class="font-bold ink ml-1">${d.pendentes.length + d.preparando.length + d.entrega.length + d.concluido.length}</span>
            </div>
            <span class="text-xs ink-3">Clique no botao do card para avancar o status. O cliente recebe a mensagem automaticamente.</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            ${col('Pendentes', 'fa-solid fa-clock accent-amber', d.pendentes, 'badge-amber', 'preparando', 'bg-amber-500', 'accent-amber-strong', 'fa-arrow-right')}
            ${col('Na Cozinha', 'fa-solid fa-fire-burner accent-orange', d.preparando, 'badge-orange', 'entrega', 'bg-orange-500', 'accent-orange', 'fa-arrow-right')}
            ${col('Em Entrega', 'fa-solid fa-motorcycle accent-emerald', d.entrega, 'badge-emerald', 'concluido', 'bg-emerald-600', 'accent-emerald', 'fa-check')}
            ${column('Concluidos Hoje', 'fa-solid fa-circle-check ink-3', d.concluido, 'badge-slate', 'Nenhum pedido concluido hoje', d.ocultosConcluidos > 0
                ? `<p class="text-[11px] ink-3 text-center pt-3 mt-1 border-t line">
                       <i class="fa-solid fa-clock-rotate-left"></i>
                       ${d.ocultosConcluidos} concluído${d.ocultosConcluidos > 1 ? 's' : ''} de dias anteriores fora${d.ocultosConcluidos > 1 ? 'm' : ''} desta coluna.
                       Continuam no histórico e nos relatórios.
                   </p>`
                : '')}
        </div>

        <script>
            async function updateStatus(orderId, newStatus) {
                try {
                    const r = await postJSON('/admin/order/' + encodeURIComponent(orderId) + '/status', { status: newStatus });
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao atualizar pedido'); return; }
                    location.reload();
                } catch (e) { flash('err', 'Erro de conexao'); }
            }
        </script>

        ${renderComandaModal()}
${COMANDA_SCRIPT}`;
}

/* ----------------------------------------------------------- Configuracoes */

/*
 * Campos que a tela de Configuracoes mostra.
 *
 * A lista e' curta porque e' a lista do que funciona. "Pedido minimo", "Tempo
 * de preparo" e "Chave PIX" gravaram no banco durante muito tempo sem ninguem
 * ler -- ver o comentario em renderConfig. Nao voltaram aqui porque o tipo e'
 * o que impede a tela de-growing: um campo novo precisa de leitura, e nao so
 * de gravacao.
 */
type ConfigData = {
    businessName: string;
    /** Agenda automatica do caixa. Horarios em "HH:MM", vazio = desativado. */
    cashAutoOpen: string;
    cashAutoClose: string;
    cashDefaultFloat: number;
};

export function renderConfig(c: ConfigData): string {
    /*
     * Tudo que esta nesta tela funciona.
     *
     * Ela ja teve "Pedido minimo" e "Tempo de preparo", e os dois gravavam no
     * banco sem ninguem ler: o bot criava o pedido sem checar valor minimo, e o
     * tempo de preparo nao aparecia em lugar nenhum. Um controle que nao muda
     * nada e' pior do que a ausencia dele, porque o dono acredita que esta
     * protegido. Eles sairam daqui e continuam no schema, sem uso, ate que
     * exista a regra que os faca valer.
     *
     * A chave PIX tambem saiu, pelo mesmo motivo e por um caminho so dela: ela
     * so era lida pelo checklist da Home, que marcava "configurada" sem nunca
     * ter chegado ao cliente. O item de setup correspondente saiu junto.
     */
    return `        <form onsubmit="return saveConfig(event)" class="space-y-5 max-w-4xl">
            <div class="card">
                <div class="card-pad pb-3">
                    <h2 class="text-title flex items-center gap-2">
                        <i class="fa-solid fa-store text-accent"></i> Negocio
                    </h2>
                    <p class="text-caption text-ink-3">Aparece no nome da aba, no topo do painel e no rodape do cardapio do WhatsApp</p>
                </div>
                <div class="px-5 pb-5">
                    <div class="max-w-md">
                        <label class="label" for="cfg-businessName">Nome do negocio</label>
                        <input id="cfg-businessName" type="text" name="businessName" value="${escapeHtml(c.businessName)}"
                               maxlength="60" class="input" placeholder="Como o cliente ve o nome">
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-pad pb-3">
                    <h2 class="text-title flex items-center gap-2">
                        <i class="fa-solid fa-clock text-accent"></i> Agenda do caixa
                    </h2>
                    <p class="text-caption text-ink-3">
                        Abre e fecha o turno sozinho. O fechamento automatico nao conta o dinheiro da gaveta:
                        registra o valor esperado e deixa a conferencia para depois.
                    </p>
                </div>
                <div class="px-5 pb-5 space-y-4">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
                        <div>
                            <label class="label" for="cfg-cashAutoOpen">Abre as</label>
                            <input id="cfg-cashAutoOpen" type="time" name="cashAutoOpen" value="${escapeHtml(c.cashAutoOpen)}" class="input">
                            <p class="text-caption text-ink-3 mt-1">Vazio = desativado</p>
                        </div>
                        <div>
                            <label class="label" for="cfg-cashAutoClose">Fecha as</label>
                            <input id="cfg-cashAutoClose" type="time" name="cashAutoClose" value="${escapeHtml(c.cashAutoClose)}" class="input">
                            <p class="text-caption text-ink-3 mt-1">Vazio = desativado</p>
                        </div>
                    </div>

                    <div class="max-w-md">
                        <label class="label" for="cfg-cashDefaultFloat">Fundo de troco</label>
                        <div class="flex items-center gap-2">
                            <span class="text-body text-ink-3 shrink-0" aria-hidden="true">R$</span>
                            <input id="cfg-cashDefaultFloat" type="number" name="cashDefaultFloat" step="0.01" min="0"
                                   inputmode="decimal" value="${escapeHtml(c.cashDefaultFloat)}" class="input">
                        </div>
                        <p class="text-caption text-ink-3 mt-1">
                            A abertura so fica ativa com este valor preenchido: um fundo estimado contaminaria a
                            diferenca de caixa de todo fechamento.
                        </p>
                    </div>

                    <div class="flex items-start gap-2 text-caption text-ink-2 bg-surface-2 border line rounded-card p-3 max-w-2xl">
                        <i class="fa-solid fa-circle-info text-accent mt-0.5 shrink-0"></i>
                        <span>
                            Para fechar depois da meia-noite, use um horario menor que o de abertura
                            (ex.: abre 22:00, fecha 00:30).
                        </span>
                    </div>
                </div>
            </div>

            <div class="flex items-center gap-2">
                <button type="submit" class="btn btn-primary">
                    <i class="fa-solid fa-save"></i> Salvar
                </button>
                <span class="text-caption text-ink-3">As alteracoes valem para o proximo pedido e para a proxima virada de turno.</span>
            </div>
        </form>

        <script>
            async function saveConfig(event) {
                event.preventDefault();
                var btn = event.target.querySelector('button[type="submit"]');
                var original = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
                try {
                    var r = await postJSON('/admin/config/save', Object.fromEntries(new FormData(event.target).entries()));
                    if (!r.ok) {
                        flash('err', r.data.error || 'Erro ao salvar');
                        return;
                    }
                    // Recarrega para o nome do negocio aparecer no logo e no
                    // titulo: sao renderizados no servidor, entao valem para a
                    // proxima pagina, nao para esta.
                    flash('ok', 'Configuracoes salvas.');
                    setTimeout(function () { window.location.reload(); }, 700);
                } catch (e) {
                    flash('err', 'Erro de conexao');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = original;
                }
            }
        </script>`;
}

/* ------------------------------------------------------------ Calendario */

/**
 * Calendario: contagem de pedidos por dia.
 *
 * Nao mostra faturamento. O calendario responde "quantos pedidos houve", que
 * e pergunta de operacao; quanto entrou em dinheiro e' da aba Faturamento.
 */
type CalendarData = { totalOrders: number; totalRevenue: number; daysInPeriod: number };

export function renderCalendar(d: CalendarData): string {
    return `        <div class="flex flex-wrap items-center gap-3 mb-5">
            <div class="surface border line rounded-xl px-4 py-2 text-sm"><span class="ink-3">Pedidos no periodo:</span> <span class="font-bold ink ml-1">${d.totalOrders}</span></div>
            <div class="surface border line rounded-xl px-4 py-2 text-sm"><span class="ink-3">Media por dia:</span> <span class="font-bold ink ml-1">${(d.totalOrders / Math.max(1, d.daysInPeriod)).toFixed(1).replace('.', ',')}</span></div>
        </div>

        <div class="flex items-center gap-4 mb-5">
            <button onclick="changeMonth(-1)" class="bg-amber-600 hover:bg-amber-700 text-white w-9 h-9 rounded-lg transition"><i class="fa-solid fa-chevron-left"></i></button>
            <h3 class="text-xl font-bold ink" id="monthYear"></h3>
            <button onclick="changeMonth(1)" class="bg-amber-600 hover:bg-amber-700 text-white w-9 h-9 rounded-lg transition"><i class="fa-solid fa-chevron-right"></i></button>
        </div>

        <div class="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-bold ink-3 uppercase">
            <div>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div>
        </div>
        <div class="grid grid-cols-7 gap-1" id="calendarGrid"></div>

        <div class="mt-6 surface-2 p-4 rounded-xl border line">
            <h3 class="font-bold ink mb-3">Pedidos do dia selecionado</h3>
            <div id="dayOrders"><p class="ink-3 text-sm">Clique em um dia no calendario para ver os pedidos.</p></div>
        </div>

        <script src="/api/calendar.js"></script>`;
}

/* ----------------------------------------------------------- Estatisticas */

export function renderStats(s: DashboardStats): string {
    const maxHour = Math.max(...s.byHour.map((h) => h.orders), 1);
    const maxDow = Math.max(...s.byDayOfWeek.map((d) => d.orders), 1);
    const maxProd = Math.max(...s.topProducts.map((p) => p.qty), 1);
    const maxDay = Math.max(...s.revenueByDay.map((d) => d.revenue), 1);

    const card = (label: string, value: string, sub: string, tone: string) => `                <div class="surface border line rounded-2xl p-4 shadow-sm">
                    <p class="text-xs font-semibold ink-3 uppercase tracking-wide">${label}</p>
                    <p class="text-2xl font-extrabold ${tone} mt-1">${value}</p>
                    <p class="text-xs ink-3 mt-1">${sub}</p>
                </div>`;

    return `        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            ${card('Receita hoje', money(s.today.revenue), s.today.orders + ' pedido(s) hoje', 'accent-amber-strong')}
            ${card('Receita 7 dias', money(s.week.revenue), s.week.orders + ' pedido(s)', 'accent-amber')}
            ${card('Receita 30 dias', money(s.month.revenue), s.month.orders + ' pedido(s)', 'accent-emerald')}
            ${card('Ticket medio', money(s.averageTicket), s.allTime.orders + ' pedido(s) no total', 'accent-orange')}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            ${card('Pedidos pendentes', String(s.byStatus.pendente ?? 0), 'aguardando preparacao', 'accent-amber')}
            ${card('Em producao', String((s.byStatus.preparando ?? 0) + (s.byStatus.entrega ?? 0)), 'preparando + em entrega', 'accent-orange')}
            ${card('Concluidos', String(s.byStatus.concluido ?? 0), 'finalizados', 'accent-emerald')}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            ${card('Descontos hoje', money(s.todayAdjustments.discounts), 'concedidos no PDV', 'accent-red')}
            ${card('Gorjetas hoje', money(s.todayAdjustments.tips), 'repassadas a equipe', 'accent-emerald')}
            ${card(
                s.byChannel.length ? s.byChannel[0].label : 'PDV / Balcao',
                s.byChannel.length ? String(s.byChannel[0].orders) + ' pedidos' : '0',
                s.byChannel.length ? money(s.byChannel[0].revenue) : 'sem dados',
                'ink'
            )}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-1">Mais vendidos</h3>
                <p class="text-xs ink-3 mb-4">Quantidade de unidades por item</p>
                ${s.topProducts.length === 0 ? '<p class="text-sm ink-3 py-4">Sem dados ainda.</p>' : ''}
                ${s.topProducts.map((p) => `                <div class="mb-3">
                    <div class="flex justify-between text-sm mb-1">
                        <span class="ink truncate">${escapeHtml(p.name)}</span>
                        <span class="ink-3 shrink-0 ml-2">${p.qty} un.</span>
                    </div>
                    <div class="bar-track h-2"><div class="bar-fill" style="width:${Math.round((p.qty / maxProd) * 100)}%"></div></div>
                </div>`).join('')}
            </div>

            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-1">Faturamento por dia</h3>
                <p class="text-xs ink-3 mb-4">Ultimos ${s.revenueByDay.length} dia(s) com pedidos</p>
                ${s.revenueByDay.length === 0 ? '<p class="text-sm ink-3 py-4">Sem dados ainda.</p>' : ''}
                <div class="flex items-end gap-2 h-40">
                    ${s.revenueByDay.map((d) => `                    <div class="flex-1 flex flex-col items-center gap-1" title="${d.label}: ${money(d.revenue)} (${d.orders} pedidos)">
                        <div class="w-full bar-track flex items-end" style="height:100%">
                            <div class="bar-fill-emerald w-full" style="height:${Math.round((d.revenue / maxDay) * 100)}%"></div>
                        </div>
                        <span class="text-[10px] ink-3">${escapeHtml(d.label)}</span>
                    </div>`).join('')}
                </div>
            </div>

            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-1">Pedidos por hora</h3>
                <p class="text-xs ink-3 mb-4">${s.busiestHour ? 'Pico as ' + String(s.busiestHour.hour).padStart(2, '0') + 'h' : 'Sem dados'}</p>
                <div class="flex items-end gap-1 h-32">
                    ${s.byHour.map((h) => `                    <div class="flex-1 bar-track flex items-end" style="height:100%" title="${String(h.hour).padStart(2, '0')}h: ${h.orders} pedido(s)">
                        <div class="bar-fill-orange w-full" style="height:${Math.round((h.orders / maxHour) * 100)}%"></div>
                    </div>`).join('')}
                </div>
                <div class="flex justify-between text-[10px] ink-3 mt-1"><span>00h</span><span>12h</span><span>23h</span></div>
            </div>

            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-1">Pedidos por dia da semana</h3>
                <p class="text-xs ink-3 mb-4">Distribuicao da semana</p>
                ${s.byDayOfWeek.map((d) => `                <div class="mb-2">
                    <div class="flex justify-between text-sm mb-1">
                        <span class="ink">${d.label}</span>
                        <span class="ink-3">${d.orders} pedido(s)</span>
                    </div>
                    <div class="bar-track h-2"><div class="bar-fill-slate" style="width:${Math.round((d.orders / maxDow) * 100)}%"></div></div>
                </div>`).join('')}
            </div>
        </div>`;
}

/* ------------------------------------------------------------- Relatorios */

export type ReportData = {
    rowsHtml: string;
    count: number;
    total: number;
    from: string;
    to: string;
    /** Turnos fechados: mantidos no tipo, mas o Z report foi para o item Caixa. */
    shifts: Array<{
        id: string;
        openedAt: string;
        closedAt: string;
        openingFloat: number;
        expectedCash: number | null;
        countedCash: number | null;
        difference: number | null;
        revenue: number;
        orders: number;
    }>;
};

/* -------------------------------------------------------------------- Bot */

/*
 * Mensagens do bot.
 *
 * A tela precisa responder tres perguntas, e antes nao respondia nenhuma delas:
 *
 * 1. "O que o bot manda agora?" -- O texto efetivo va no campo, nao vazio. A
 *    versao anterior mostrava os 15 campos em branco para quem nunca editou
 *    nada, enquanto o bot mandava os padroes cheios de texto. A pessoa via uma
 *    tela em branco e nenhuma pista do que o cliente receberia.
 * 2. "O que e' o padrao?" -- Botao em cada campo editado, que devolve o texto
 *    padrao sem precisar sair da tela.
 * 3. "Quais eu ja mexi?" -- Selo de "padrao" ou "editada" em cada campo, e um
 *    contador no topo.
 */

export type EstadoMensagem = {
    /** Texto que o bot manda agora: o editado, ou o padrao se nao houver. */
    texto: string;
    /** Texto padrao, do codigo. */
    padrao: string;
    /** true quando o texto atual difere do padrao. */
    editado: boolean;
};

export type BotData = { mensagens: Record<string, EstadoMensagem> };

/**
 * Variaveis aceitas, e onde o clique insere.
 *
 * Viram botao em vez de texto solto na ajuda porque a pessoa nao deveria ter que
 * lembrar de um detalhe de sintaxe para escrever "Total {total}, e o PIX e' para
 * {total}". Um erro de digitacao aqui -- {item}, {total} -- mandava a variavel
 * literal para o cliente, e o unico sintoma era o cliente reclamando de um
 * texto com chaves.
 */
const VARIAVEIS: Array<{ token: string; exemplo: string }> = [
    { token: '{items}', exemplo: '2x Coxinha' },
    { token: '{total}', exemplo: '18,00' },
];

type CampoBot = {
    key: string;
    label: string;
    rows: number;
    hint?: string;
    /** Esta mensagem recebe itens e total. So nestas aparecem os botoes. */
    comValores?: boolean;
};

/**
 * Agrupadas por quando o cliente ve cada uma.
 *
 * A ordem anterior era a ordem do codigo, que e' a ordem em que foram escritas
 * as mensagens -- nao a ordem em que alguem precisa delas. Quem vai mudar o
 * "status: em entrega" procura essa, e ela estava no meio de quinze caixas
 * iguais. Agrupar por momento reduz a tela de "15 campos" para "4 respostas a
 * perguntas que eu tenho".
 */
const GRUPOS_BOT: Array<{ titulo: string; descricao: string; campos: CampoBot[] }> = [
    {
        titulo: 'Primeiro contato',
        descricao: 'O que o cliente recebe antes de qualquer coisa.',
        campos: [
            {
                key: 'mainMenu',
                label: 'Menu inicial',
                rows: 8,
                hint: 'Enviada quando o cliente manda "oi", "menu" ou "0".',
            },
            { key: 'menuEmpty', label: 'Cardapio vazio', rows: 2, hint: 'Nao ha produto cadastrado.' },
        ],
    },
    {
        titulo: 'Cardapio',
        descricao: 'Titulos e rodape que emolduram a lista de produtos.',
        campos: [
            { key: 'menuHeader', label: 'Cabecalho', rows: 1 },
            { key: 'dailyMenuTitle', label: 'Titulo do menu do dia', rows: 1, hint: 'Secao no topo do cardapio.' },
            { key: 'regularMenuTitle', label: 'Titulo do cardapio', rows: 1, hint: 'Abaixo do menu do dia, quando existe um.' },
            { key: 'menuFooter', label: 'Rodape', rows: 2, hint: 'Fecha a lista e diz como pedir.' },
        ],
    },
    {
        titulo: 'Pedido',
        descricao: 'O que o cliente recebe ao fechar o pedido, e o que recebe quando algo da errado.',
        campos: [
            {
                key: 'orderReceived',
                label: 'Pedido recebido',
                rows: 6,
                comValores: true,
                hint: 'Primeira confirmacao. Se o cliente pedir para cancelar, sair da loja.',
            },
            { key: 'noOrders', label: 'Cliente sem pedidos', rows: 2, hint: 'Quando ele consulta e nao ha nada.' },
            { key: 'invalidOption', label: 'Opcao invalida', rows: 2, hint: 'Ele digitou algo fora do menu.' },
            { key: 'invalidProduct', label: 'Produto invalido', rows: 2, hint: 'Numero que nao existe no cardapio.' },
        ],
    },
    {
        titulo: 'Andamento do pedido',
        descricao: 'Enviadas por voce, ao mudar o status na tela de Pedidos.',
        campos: [
            {
                key: 'statusPreparando',
                label: 'Preparando',
                rows: 6,
                comValores: true,
                hint: 'Assim que a cozinha comeca.',
            },
            {
                key: 'statusEntrega',
                label: 'Saiu para entrega',
                rows: 6,
                comValores: true,
                hint: 'Quando o pedido e' + ' marcado como em entrega.',
            },
            { key: 'statusConcluido', label: 'Entregue', rows: 4, hint: 'Quando voce marca como concluido.' },
        ],
    },
    {
        titulo: 'Atendimento',
        descricao: 'O que o bot responde quando o cliente pede para falar com uma pessoa.',
        campos: [
            {
                key: 'attendantMessage',
                label: 'Atendente solicitado',
                rows: 3,
                hint: 'Importante: o bot promete que alguem chama, e nao tem ninguemAutomatico. O atendente ve a conversa na aba Conversas.',
            },
        ],
    },
];

const TODOS_OS_CAMPOS = GRUPOS_BOT.flatMap((g) => g.campos);

function campoBot(f: CampoBot, e: EstadoMensagem): string {
    const id = 'msg-' + f.key;
    const selaoVariavel = f.comValores
        ? `
                            <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                                <span class="text-caption text-ink-3">Inserir:</span>
                                ${VARIAVEIS.map(
                                    (v) => `<button type="button" onclick="msgInserir('${v.token}')" class="badge badge-neutral font-mono hover:bg-surface-2 transition" title="Vira, por exemplo: ${escapeHtml(v.exemplo)}">${escapeHtml(v.token)}</button>`
                                ).join('')}
                                <span class="text-caption text-ink-3 ml-1">Pode usar varias vezes no mesmo texto.</span>
                            </div>`
        : '';

    return `                    <div class="surface-2 border line rounded-xl p-4" data-campo="${escapeHtml(f.key)}">
                        <div class="flex items-start justify-between gap-3 mb-1.5">
                            <label class="label mb-0" for="${id}">${escapeHtml(f.label)}</label>
                            <span class="flex items-center gap-2 shrink-0">
                                <span data-selo="${escapeHtml(f.key)}" class="badge ${e?.editado ? 'badge-amber' : 'badge-neutral'}">${e?.editado ? 'Editada' : 'Padrao'}</span>
                                <button type="button" data-restaurar="${escapeHtml(f.key)}" class="btn btn-ghost btn-sm ${e?.editado ? '' : 'hidden'}" title="Voltar ao texto padrao">
                                    <i class="fa-solid fa-rotate-left"></i> Padrao
                                </button>
                            </span>
                        </div>
                        ${f.hint ? `<p class="text-caption text-ink-3 mb-2">${escapeHtml(f.hint)}</p>` : ''}
                        <textarea id="${id}" name="${escapeHtml(f.key)}" rows="${f.rows}" spellcheck="false"
                                  class="input font-mono leading-relaxed resize-y">${escapeHtml(e?.texto ?? '')}</textarea>${selaoVariavel}
                    </div>`;
}

export function renderBot(d: BotData): string {
    const editadas = TODOS_OS_CAMPOS.filter((f) => d.mensagens[f.key]?.editado).length;

    return `        <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
            <p class="text-sm text-ink-3 max-w-2xl">
                O que o bot responde. O campo vazio usa o texto padrao.
            </p>
            <div class="flex items-center gap-2">
                <span class="badge ${editadas > 0 ? 'badge-amber' : 'badge-neutral'}" data-contador>
                    ${editadas === 0 ? 'Tudo no padrao' : editadas + ' de ' + TODOS_OS_CAMPOS.length + ' editadas'}
                </span>
                <button type="button" onclick="msgRestaurarTodas()" class="btn btn-ghost btn-sm ${editadas > 0 ? '' : 'hidden'}" data-restaurar-todas
                        title="Apagar todas as edicoes e voltar ao texto que vem com o programa">
                    <i class="fa-solid fa-rotate-left"></i> Voltar tudo ao padrao
                </button>
            </div>
        </div>

        <form onsubmit="return saveBotMessages(event)" class="space-y-6 max-w-4xl" data-form-mensagens>
${GRUPOS_BOT.map(
    (g) => `            <details class="card" ${g.campos.some((f) => d.mensagens[f.key]?.editado) ? 'open' : ''}>
                <summary class="cursor-pointer px-5 py-4 flex items-center gap-2 select-none">
                    <h3 class="text-title">${escapeHtml(g.titulo)}</h3>
                    <span class="text-caption text-ink-3 truncate hidden sm:inline">${escapeHtml(g.descricao)}</span>
                    <i class="fa-solid fa-chevron-down ml-auto text-ink-3 text-xs shrink-0"></i>
                </summary>
                <div class="px-5 pb-5 space-y-4">
${g.campos.map((f) => campoBot(f, d.mensagens[f.key])).join('\n')}
                </div>
            </details>`
).join('\n')}

            <div class="flex items-center gap-3">
                <button type="submit" class="btn btn-primary">
                    <i class="fa-solid fa-save"></i> Salvar mensagens
                </button>
                <span class="text-caption text-ink-3">Valem para a proxima mensagem enviada. O bot pode estar falando com um cliente agora.</span>
            </div>
        </form>

        <script>
            /*
             * Insere a variavel onde o cursor esta.
             *
             * No fim do texto quando o campo nunca recebeu foco, que e' o caso
             * de quem clica no botao direto. Inserir sempre no fim seria errado
             * para quem esta editando o meio da frase.
             */
            function msgInserir(token) {
                var area = document.activeElement;
                if (!area || area.tagName !== 'TEXTAREA') {
                    area = document.querySelector('textarea:focus') || document.querySelector('textarea[name="' + token + '"]');
                }
                if (!area || area.tagName !== 'TEXTAREA') return;

                var inicio = area.selectionStart;
                var fim = area.selectionEnd;
                var antes = area.value.slice(0, inicio);
                var depois = area.value.slice(fim);
                area.value = antes + token + depois;
                area.focus();
                var cursor = inicio + token.length;
                area.setSelectionRange(cursor, cursor);
                msgMarcaEditada(area.name);
            }

            function msgMarcaEditada(key) {
                var selo = document.querySelector('[data-selo="' + key + '"]');
                if (selo) selo.textContent = 'Nao salvo';
                msgConta();
            }

            /* Contador do topo: quantos campos estao diferentes do que esta no banco. */
            function msgConta() {
                var areas = document.querySelectorAll('[data-form-mensagens] textarea');
                var mudados = 0;
                for (var i = 0; i < areas.length; i++) {
                    if (areas[i].getAttribute('data-original') !== null &&
                        areas[i].value.trim() !== areas[i].getAttribute('data-original').trim()) mudados++;
                }
                var contador = document.querySelector('[data-contador]');
                if (contador && mudados > 0) {
                    contador.textContent = mudados + ' nao salva(s)';
                    contador.className = 'badge badge-amber';
                }
            }

            document.addEventListener('DOMContentLoaded', function () {
                // Guarda o valor original de cada campo, para o contador saber o
                // que mudou sem precisar consultar o servidor.
                var areas = document.querySelectorAll('[data-form-mensagens] textarea');
                for (var i = 0; i < areas.length; i++) {
                    areas[i].setAttribute('data-original', areas[i].value);
                    areas[i].addEventListener('input', msgConta);
                }
            });

            /*
             * Restaurar um campo: traz o padrao para a area de texto e deixa o
             * envio decidir. Nao grava nada agora -- se a pessoa restaurar e
             * logo depois voltar a mexer no mesmo campo, o que vale e o ultimo
             * estado, e salvar duas vezes e' uma confusao desnecessaria.
             */
            function msgRestaurar(key) {
                var area = document.querySelector('textarea[name="' + key + '"]');
                if (!area) return;
                if (!confirm('Voltar "' + key + '" ao texto padrao? Vale a pena se confirmar em Salvar.')) return;
                area.value = '';
                area.setAttribute('data-original', '');
                var selo = document.querySelector('[data-selo="' + key + '"]');
                if (selo) { selo.textContent = 'Padrao'; selo.className = 'badge badge-neutral'; }
                var botao = document.querySelector('[data-restaurar="' + key + '"]');
                if (botao) botao.classList.add('hidden');
                msgConta();
            }

            async function msgRestaurarTodas() {
                if (!confirm('Apagar todas as mensagens editadas e voltar ao padrao do programa?')) return;
                var r = await postJSON('/admin/bot-messages/restaurar-todas', {});
                if (!r.ok) { flash('err', r.data.error || 'Erro ao restaurar'); return; }
                flash('ok', 'Mensagens de volta ao padrao.');
                setTimeout(function () { window.location.reload(); }, 700);
            }

            async function saveBotMessages(event) {
                event.preventDefault();
                var btn = event.target.querySelector('button[type="submit"]');
                var original = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

                // Só o que mudou. A versao anterior mandava os 15 campos sempre,
                // e como os que nunca foram editados apareciam vazios, salvar
                // uma mensagem apagava as outras catorze.
                var areas = document.querySelectorAll('[data-form-mensagens] textarea');
                var payload = {};
                for (var i = 0; i < areas.length; i++) {
                    var original_ = areas[i].getAttribute('data-original') || '';
                    if (areas[i].value.trim() !== original_.trim()) payload[areas[i].name] = areas[i].value;
                }

                if (Object.keys(payload).length === 0) {
                    btn.disabled = false;
                    btn.innerHTML = original;
                    flash('ok', 'Nada mudou.');
                    return;
                }

                try {
                    var r = await postJSON('/admin/bot-messages/save', payload);
                    if (!r.ok) {
                        flash('err', r.data.error || 'Erro ao salvar');
                        return;
                    }
                    var quantas = (r.data.salvas || []).length + (r.data.restauradas || []).length;
                    flash('ok', quantas + ' mensagem(ns) salva(s).');
                    setTimeout(function () { window.location.reload(); }, 700);
                } catch (e) {
                    flash('err', 'Erro de conexao');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = original;
                }
            }
        </script>`;
}

/* ---------------------------------------------------------------- Sistema */
