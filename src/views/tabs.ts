import { escapeHtml } from './html';
import { currency, statusLabel, type OrderWithProductless } from '../services/stats';
import type { DashboardStats } from '../services/stats';

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

    return `                        <div class="surface p-3 rounded-xl border card-${tint.replace('bg-', '')} shadow-sm">
                            <div class="flex justify-between items-start gap-2 font-semibold ink text-sm mb-1">
                                <span class="truncate">${escapeHtml(o.clientName || 'Cliente')}</span>
                                <span class="${accent} shrink-0">R$ ${money(o.total)}</span>
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
        </script>`;
}

/* ----------------------------------------------------------- Configuracoes */

type ConfigData = {
    businessName: string;
    originAddress: string;
    baseFee: number;
    feePerKm: number;
    googleApiKey: string;
    minOrderValue: number;
    estimatedPrepMinutes: number;
    pixKey: string;
    /** Agenda automatica do caixa. Horarios em "HH:MM", vazio = desativado. */
    cashAutoOpen: string;
    cashAutoClose: string;
    cashDefaultFloat: number;
};

export function renderConfig(c: ConfigData): string {
    return `        <form onsubmit="return saveConfig(event)" class="space-y-5 max-w-4xl">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div class="surface p-5 rounded-2xl shadow-sm border line">
                    <h3 class="font-bold ink mb-4 flex items-center gap-2"><i class="fa-solid fa-store accent-amber"></i> Negocio</h3>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-semibold ink-2 mb-1">Nome do negocio</label>
                            <input type="text" name="businessName" value="${escapeHtml(c.businessName)}" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Pedido minimo (R$)</label>
                                <input type="number" step="0.01" min="0" name="minOrderValue" value="${escapeHtml(c.minOrderValue)}" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Tempo de preparo (min)</label>
                                <input type="number" min="0" name="estimatedPrepMinutes" value="${escapeHtml(c.estimatedPrepMinutes)}" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-semibold ink-2 mb-1">Chave PIX</label>
                            <input type="text" name="pixKey" value="${escapeHtml(c.pixKey)}" placeholder="Chave para recebimento" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                        </div>
                    </div>
                </div>

                <div class="surface p-5 rounded-2xl shadow-sm border line">
                    <h3 class="font-bold ink mb-4 flex items-center gap-2"><i class="fa-solid fa-truck accent-amber"></i> Entrega</h3>
                    <div class="space-y-3">
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Taxa base (R$)</label>
                                <input type="number" step="0.01" min="0" name="baseFee" value="${escapeHtml(c.baseFee)}" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Taxa por km (R$)</label>
                                <input type="number" step="0.01" min="0" name="feePerKm" value="${escapeHtml(c.feePerKm)}" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-semibold ink-2 mb-1">Endereco de origem</label>
                            <input type="text" name="originAddress" value="${escapeHtml(c.originAddress)}" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                        </div>
                        <div>
                            <label class="block text-xs font-semibold ink-2 mb-1">Google Maps API Key</label>
                            <input type="password" name="googleApiKey" value="${escapeHtml(c.googleApiKey)}" placeholder="Vazio = estimativa padrao" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                        </div>
                    </div>
                </div>
                <div class="surface p-5 rounded-2xl shadow-sm border line">
                    <h3 class="font-bold ink mb-1 flex items-center gap-2"><i class="fa-solid fa-clock accent-amber"></i> Agenda do caixa</h3>
                    <p class="text-xs ink-3 mb-4">
                        Abre e fecha o turno de caixa sozinho. O fechamento automatico nao conta o dinheiro da gaveta:
                        ele registra o valor esperado e deixa a conferencia para depois.
                    </p>
                    <div class="space-y-3">
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Abre as</label>
                                <input type="time" name="cashAutoOpen" value="${escapeHtml(c.cashAutoOpen)}" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Fecha as</label>
                                <input type="time" name="cashAutoClose" value="${escapeHtml(c.cashAutoClose)}" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-semibold ink-2 mb-1">Fundo de troco (R$)</label>
                            <input type="number" step="0.01" min="0" name="cashDefaultFloat" value="${escapeHtml(c.cashDefaultFloat)}" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                        </div>
                        <p class="text-xs ink-3">
                            A abertura so fica ativa com o fundo de troco preenchido: um valor estimado contaminaria a
                            diferenca de caixa de todo fechamento. Para fechar depois da meia-noite, use um horario
                            menor que o de abertura (ex.: abre 22:00, fecha 00:30).
                        </p>
                    </div>
                </div>
            </div>

            <button type="submit" class="px-5 py-2 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition flex items-center gap-2">
                <i class="fa-solid fa-save"></i> Salvar Configuracoes
            </button>
        </form>

        <script>
            async function saveConfig(event) {
                event.preventDefault();
                var fd = new FormData(event.target);
                var payload = Object.fromEntries(fd.entries());
                try {
                    var r = await postJSON('/admin/config/save', payload);
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao salvar'); return; }
                    flash('ok', 'Configuracoes salvas com sucesso!');
                } catch (e) { flash('err', 'Erro de conexao'); }
            }
        </script>`;
}

/* ------------------------------------------------------------ Calendario */

type CalendarData = { totalOrders: number; totalRevenue: number };

export function renderCalendar(d: CalendarData): string {
    return `        <div class="flex flex-wrap items-center gap-3 mb-5">
            <div class="surface border line rounded-xl px-4 py-2 text-sm"><span class="ink-3">Pedidos no periodo:</span> <span class="font-bold ink ml-1">${d.totalOrders}</span></div>
            <div class="surface border line rounded-xl px-4 py-2 text-sm"><span class="ink-3">Faturamento no periodo:</span> <span class="font-bold accent-amber-strong ml-1">R$ ${money(d.totalRevenue)}</span></div>
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
                s.byChannel.length ? 'R$ ' + money(s.byChannel[0].revenue) : 'sem dados',
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
                    ${s.revenueByDay.map((d) => `                    <div class="flex-1 flex flex-col items-center gap-1" title="${d.label}: R$ ${money(d.revenue)} (${d.orders} pedidos)">
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

type ReportData = {
    rowsHtml: string;
    count: number;
    total: number;
    from: string;
    to: string;
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

export function renderReports(d: ReportData): string {
    return `        <form method="GET" action="/admin" class="surface border line rounded-2xl p-4 shadow-sm mb-5 flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="reports">
            <div>
                <label class="block text-xs font-semibold ink-2 mb-1">De</label>
                <input type="date" name="from" value="${escapeHtml(d.from)}" class="px-3 py-2 text-sm border line-in rounded-lg">
            </div>
            <div>
                <label class="block text-xs font-semibold ink-2 mb-1">Ate</label>
                <input type="date" name="to" value="${escapeHtml(d.to)}" class="px-3 py-2 text-sm border line-in rounded-lg">
            </div>
            <div>
                <label class="block text-xs font-semibold ink-2 mb-1">Status</label>
                <select name="status" class="px-3 py-2 text-sm border line-in rounded-lg">
                    <option value="">Todos</option>
                    <option value="pendente">Pendente</option>
                    <option value="preparando">Preparando</option>
                    <option value="entrega">Em entrega</option>
                    <option value="concluido">Concluido</option>
                </select>
            </div>
            <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"><i class="fa-solid fa-filter"></i> Filtrar</button>
            <a href="/admin/reports.csv?from=${escapeHtml(d.from)}&to=${escapeHtml(d.to)}" class="chip px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
                <i class="fa-solid fa-file-csv"></i> Exportar CSV
            </a>
            <span class="text-sm ink-3 ml-auto">${d.count} pedido(s) &middot; R$ ${money(d.total)}</span>
        </form>

        <div class="surface border line rounded-2xl shadow-sm overflow-hidden">
            ${d.count === 0 ? '<p class="text-sm ink-3 text-center py-10">Nenhum pedido encontrado no periodo.</p>' : `            <div class="table-wrap">
                <table>
                    <thead class="surface-2 ink-3">
                        <tr>
                            <th>Data</th><th>Cliente</th><th>Contato</th><th>Itens</th><th>Desc/Gorj</th><th>Total</th><th>Status</th><th>Canal</th>
                        </tr>
                    </thead>
                    <tbody class="ink">${d.rowsHtml}</tbody>
                </table>
            </div>`}
        </div>

        <h3 class="font-bold ink mt-8 mb-3 flex items-center gap-2"><i class="fa-solid fa-receipt accent-amber"></i> Fechos de caixa (Z report)</h3>
        ${
            d.shifts.length === 0
                ? '<p class="text-sm ink-3">Nenhum turno fechado ainda. Abra um turno no PDV para controlar o caixa.</p>'
                : `<div class="surface border line rounded-2xl shadow-sm overflow-hidden">
            <div class="table-wrap">
                <table>
                    <thead class="surface-2 ink-3">
                        <tr>
                            <th>Aberto</th><th>Fechado</th><th>Float</th><th>Vendas</th><th>Pedidos</th>
                            <th>Esperado</th><th>Contado</th><th>Resultado</th>
                        </tr>
                    </thead>
                    <tbody class="ink">
                        ${d.shifts
                            .map((s) => {
                                const diff = s.difference ?? 0;
                                const tone = Math.abs(diff) < 0.01 ? 'badge-emerald' : diff > 0 ? 'badge-amber' : 'badge-red';
                                const label = Math.abs(diff) < 0.01 ? 'Bateu' : diff > 0 ? 'Sobrou' : 'Faltou';
                                return `<tr>
                                    <td class="text-xs ink-3">${escapeHtml(s.openedAt)}</td>
                                    <td class="text-xs ink-3">${escapeHtml(s.closedAt)}</td>
                                    <td class="text-sm">R$ ${escapeHtml(s.openingFloat.toFixed(2))}</td>
                                    <td class="text-sm">R$ ${escapeHtml(s.revenue.toFixed(2))}</td>
                                    <td class="text-sm">${s.orders}</td>
                                    <td class="text-sm">R$ ${escapeHtml((s.expectedCash ?? 0).toFixed(2))}</td>
                                    <td class="text-sm">R$ ${escapeHtml((s.countedCash ?? 0).toFixed(2))}</td>
                                    <td><span class="${tone} text-xs px-2 py-0.5 rounded-full">${label} ${Math.abs(diff) < 0.01 ? '' : 'R$ ' + Math.abs(diff).toFixed(2)}</span></td>
                                </tr>`;
                            })
                            .join('')}
                    </tbody>
                </table>
            </div>
        </div>`
        }`;
}

/* -------------------------------------------------------------------- Bot */

type BotData = { messages: Record<string, string> };

const BOT_FIELDS: Array<{ key: string; label: string; rows: number; hint?: string }> = [
    { key: 'mainMenu', label: 'Mensagem de boas-vindas', rows: 7, hint: 'Enviada quando o cliente manda "menu" ou "oi".' },
    { key: 'menuHeader', label: 'Cabecalho do cardapio', rows: 1 },
    { key: 'menuFooter', label: 'Rodape do cardapio', rows: 2 },
    { key: 'menuEmpty', label: 'Cardapio vazio', rows: 2 },
    { key: 'orderReceived', label: 'Pedido recebido', rows: 5, hint: 'Use {items} e {total} como variaveis.' },
    { key: 'invalidOption', label: 'Opcao invalida', rows: 2 },
    { key: 'invalidProduct', label: 'Produto invalido', rows: 2 },
    { key: 'noOrders', label: 'Sem pedidos', rows: 2 },
    { key: 'statusPreparando', label: 'Status: preparando', rows: 5, hint: 'Use {items} e {total}.' },
    { key: 'statusEntrega', label: 'Status: em entrega', rows: 5, hint: 'Use {items} e {total}.' },
    { key: 'statusConcluido', label: 'Status: concluido', rows: 4 },
    { key: 'attendantMessage', label: 'Atendente humano', rows: 3 },
];

export function renderBot(d: BotData): string {
    return `        <p class="text-sm ink-3 mb-5 max-w-3xl">
            Edite as mensagens que o bot envia automaticamente. Use <code class="badge-slate px-1 rounded">{items}</code> e
            <code class="badge-slate px-1 rounded">{total}</code> como variaveis. As alteracoes valem na proxima mensagem.
        </p>

        <form onsubmit="return saveBotMessages(event)" class="space-y-5 max-w-4xl">
            ${BOT_FIELDS.map((f) => `            <div class="surface-2 border line rounded-xl p-4">
                <label class="block text-xs font-semibold ink-2 mb-1">${f.label}${f.hint ? ` <span class="ink-3 font-normal">&mdash; ${f.hint}</span>` : ''}</label>
                <textarea name="${f.key}" rows="${f.rows}" class="w-full px-3 py-2 text-sm border line-in rounded-lg font-mono leading-relaxed">${escapeHtml(d.messages[f.key] || '')}</textarea>
            </div>`).join('\n')}

            <button type="submit" class="px-5 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition flex items-center gap-2">
                <i class="fa-solid fa-save"></i> Salvar Mensagens
            </button>
        </form>

        <script>
            async function saveBotMessages(event) {
                event.preventDefault();
                var payload = Object.fromEntries(new FormData(event.target).entries());
                try {
                    var r = await postJSON('/admin/bot-messages/save', payload);
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao salvar'); return; }
                    flash('ok', 'Mensagens salvas com sucesso!');
                } catch (e) { flash('err', 'Erro de conexao'); }
            }
        </script>`;
}

/* ---------------------------------------------------------------- Sistema */

type SystemData = {
    botOnline: boolean;
    dbPath: string;
    nodeVersion: string;
    platform: string;
    uptime: string;
    memoryMb: number;
    counts: { orders: number; products: number; messages: number; config: number };
    validStatuses: string[];
};

export function renderSystem(d: SystemData): string {
    const info = (label: string, value: string) => `                    <div class="flex justify-between gap-3 py-2 border-b line last:border-0">
                        <span class="text-sm ink-3">${label}</span>
                        <span class="text-sm font-medium ink text-right">${value}</span>
                    </div>`;

    return `        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-5xl">
            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-4 flex items-center gap-2"><i class="fa-solid fa-heart-pulse accent-emerald"></i> Saude do sistema</h3>
                <div class="flex items-center justify-between p-3 rounded-xl mb-4 ${d.botOnline ? 'badge-emerald' : 'badge-red'}">
                    <span class="text-sm font-semibold flex items-center gap-2">
                        <i class="fa-solid fa-whatsapp"></i> Bot WhatsApp
                    </span>
                    <span class="text-xs font-bold uppercase">${d.botOnline ? 'Online' : 'Offline'}</span>
                </div>
                ${info('Node.js', escapeHtml(d.nodeVersion))}
                ${info('Plataforma', escapeHtml(d.platform))}
                ${info('Uptime', escapeHtml(d.uptime))}
                ${info('Memoria', d.memoryMb + ' MB')}
                ${info('Banco de dados', escapeHtml(d.dbPath))}
            </div>

            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-4 flex items-center gap-2"><i class="fa-solid fa-database accent-amber"></i> Registros</h3>
                ${info('Pedidos', String(d.counts.orders))}
                ${info('Produtos', String(d.counts.products))}
                ${info('Mensagens do bot', String(d.counts.messages))}
                ${info('Configuracoes', String(d.counts.config))}
                <div class="mt-4 flex flex-wrap gap-2">
                    <a href="/admin/reports.csv" class="chip px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"><i class="fa-solid fa-file-csv"></i> Backup CSV</a>
                </div>
            </div>

            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-4 flex items-center gap-2"><i class="fa-solid fa-list-check accent-amber"></i> Status validos de pedido</h3>
                <p class="text-sm ink-3 mb-3">Use exatamente um destes valores ao mudar o status pela API:</p>
                <div class="flex flex-wrap gap-2">
                    ${d.validStatuses.map((s) => `<span class="badge-slate px-2.5 py-1 rounded-lg text-xs font-mono">${escapeHtml(s)}</span>`).join('')}
                </div>
            </div>

            <div class="surface border line rounded-2xl p-5 shadow-sm border-l-4" style="border-left-color: var(--badge-red-ink)">
                <h3 class="font-bold accent-red mb-2 flex items-center gap-2"><i class="fa-solid fa-triangle-exclamation"></i> Zona de risco</h3>
                <p class="text-sm ink-3 mb-4">Acoes destrutivas nao podem ser desfeitas.</p>
                <div class="flex flex-wrap gap-2">
                    <button onclick="resetCompleted()" class="px-3 py-2 rounded-lg text-sm font-medium transition badge-amber">Desfazer concluidos</button>
                    <button onclick="reconnectBot()" class="px-3 py-2 rounded-lg text-sm font-medium transition badge-slate">Reconectar bot</button>
                </div>
            </div>
        </div>

        <script>
            async function resetCompleted() {
                confirmThen('Desfazer TODOS os pedidos concluidos? Eles voltam para "Pendente", inclusive os de hoje. Use apenas se conclusion por engano.', async function () {
                    var r = await postJSON('/admin/orders/reset-completed', {});
                    flash(r.ok ? 'ok' : 'err', r.ok ? (r.data.reset + ' pedido(s) resetados.') : (r.data.error || 'Erro'));
                });
            }
            async function reconnectBot() {
                var r = await postJSON('/admin/bot/reconnect', {});
                flash(r.ok ? 'ok' : 'err', r.ok ? 'Solicitacao de reconexao enviada.' : (r.data.error || 'Erro'));
            }
        </script>`;
}
