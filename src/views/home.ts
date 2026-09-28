import { escapeHtml } from './html';
import { currency } from '../services/stats';
import type { HomeData } from '../services/home';

function money(n: number): string {
    return escapeHtml(currency(n));
}

/**
 * Variacao vs ontem. Sem base de comparacao (primeiro dia, ou ontem sem
 * venda) devolvemos null e a view diz "sem comparacao", em vez de mostrar
 * +100% que seria mentira.
 */
function deltaBadge(value: number | null, invert = false): string {
    if (value === null) return '<span class="text-[11px] ink-3">sem comparacao</span>';
    const up = value >= 0;
    const good = invert ? !up : up;
    const tone = good ? 'accent-emerald' : 'accent-red';
    const arrow = up ? 'fa-arrow-up' : 'fa-arrow-down';
    return `<span class="text-[11px] ${tone} font-semibold"><i class="fa-solid ${arrow}"></i> ${Math.abs(value).toFixed(1).replace('.', ',')}%</span>`;
}

function card(label: string, value: string, sub: string, tone: string): string {
    return `                <div class="surface border line rounded-2xl p-4 shadow-sm">
                    <p class="text-xs font-semibold ink-3 uppercase tracking-wide">${label}</p>
                    <p class="text-2xl font-extrabold ${tone} mt-1">${value}</p>
                    <p class="text-xs ink-3 mt-1">${sub}</p>
                </div>`;
}

export function renderHome(d: HomeData): string {
    /* ---------------------------------------------------------- checklist */
    const pendentes = d.setup.filter((s) => !s.done);
    const feitos = d.setup.length - pendentes.length;

    const checklist =
        pendentes.length === 0
            ? ''
            : `        <div class="surface border line rounded-2xl shadow-sm border-l-4 mb-5" style="border-left-color: var(--badge-emerald-ink)">
            <div class="p-5">
                <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h3 class="font-bold ink flex items-center gap-2">
                        <i class="fa-solid fa-list-check accent-amber"></i> Deixe a loja pronta
                    </h3>
                    <span class="badge-amber text-xs px-2.5 py-1 rounded-full font-bold">${feitos} de ${d.setup.length} concluidos</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    ${d.setup
                        .map(
                            (s) => `                    <a href="${s.href}"
                        class="flex items-start gap-3 p-3 rounded-xl border line transition row-hover ${s.done ? 'opacity-60' : ''}">
                        <i class="fa-solid ${s.done ? 'fa-circle-check accent-emerald' : 'fa-circle accent-amber'} mt-0.5 shrink-0"></i>
                        <span class="min-w-0">
                            <span class="block text-sm font-medium ink">${escapeHtml(s.label)}</span>
                            <span class="block text-xs ink-3 truncate">${escapeHtml(s.detail)}</span>
                        </span>
                    </a>`
                        )
                        .join('\n')}
                </div>
            </div>
        </div>`;

    /* ------------------------------------------------------------ alertas */
    const alerts =
        d.alerts.length === 0
            ? ''
            : `        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
            ${d.alerts
                .map((a) => {
                    const border =
                        a.tone === 'red' ? 'var(--badge-red-ink)' : a.tone === 'amber' ? 'var(--badge-amber-ink)' : 'var(--badge-slate-ink)';
                    const icon = a.tone === 'red' ? 'fa-triangle-exclamation' : 'fa-bell';
                    return `                <a href="${a.href}" class="surface border line rounded-2xl p-4 shadow-sm border-l-4 row-hover transition" style="border-left-color: ${border}">
                    <div class="flex items-start gap-3">
                        <i class="fa-solid ${icon} mt-0.5 shrink-0 ${a.tone === 'red' ? 'accent-red' : 'accent-amber'}"></i>
                        <div class="min-w-0 flex-1">
                            <p class="text-sm font-semibold ink">${escapeHtml(a.title)}</p>
                            <p class="text-xs ink-3 truncate mt-0.5">${escapeHtml(a.detail)}</p>
                        </div>
                    </div>
                    <p class="text-xs font-semibold accent-amber-strong mt-2">${escapeHtml(a.cta)} <i class="fa-solid fa-arrow-right text-[10px]"></i></p>
                </a>`;
                })
                .join('\n')}
        </div>`;

    /* --------------------------------------------------------- grafico 7d */
    const maxRevenue = Math.max(...d.last7Days.map((x) => x.revenue), 1);
    const bars = d.last7Days
        .map(
            (x) => `                    <div class="flex-1 min-w-0 flex flex-col items-center gap-1">
                        <span class="text-[10px] ink-3">${x.revenue > 0 ? money(x.revenue) : ''}</span>
                        <div class="w-full max-w-[2.5rem] rounded-t bg-amber-500/70" style="height: ${Math.max(3, Math.round((x.revenue / maxRevenue) * 100))}px"></div>
                        <span class="text-[10px] ink-3">${escapeHtml(x.label)}</span>
                    </div>`
        )
        .join('\n');

    const grafico =
        d.last7Days.length > 0
            ? `        <div class="surface border line rounded-2xl p-5 shadow-sm">
            <h3 class="font-bold ink mb-1">Faturamento dos ultimos dias</h3>
            <p class="text-xs ink-3 mb-5">Receita por dia, em reais</p>
            <div class="flex items-end gap-2 h-[8.5rem]">
${bars}
            </div>
        </div>`
            : '';

    /* ------------------------------------------------------------- caixa */
    const c = d.cash;
    const agendaTexto = c.scheduleOn
        ? `Abre ${c.autoOpen || '--:--'} e fecha ${c.autoClose || '--:--'}${
              !c.hasFloat && c.autoOpen ? ' (abertura desativada: falta o fundo de troco)' : ''
          }`
        : 'Agenda desativada';

    const caixaEstado = c.shift
        ? `<p class="text-sm ink mt-2"><i class="fa-solid fa-circle-check accent-emerald"></i> Turno aberto desde ${escapeHtml(c.shift.openedAt)}</p>
           <p class="text-xs ink-3 mt-1">Esperado na gaveta: <strong class="ink">R$ ${money(c.shift.totals.expected)}</strong></p>`
        : `<p class="text-sm ink-3 mt-2"><i class="fa-solid fa-circle-xmark"></i> Nenhum turno aberto</p>`;

    const caixa = `        <div class="surface border line rounded-2xl p-5 shadow-sm">
            <h3 class="font-bold ink mb-1 flex items-center gap-2"><i class="fa-solid fa-cash-register accent-amber"></i> Caixa</h3>
            <p class="text-xs ink-3">${escapeHtml(agendaTexto)}</p>
            ${caixaEstado}
            ${
                c.pendingCount > 0
                    ? `<p class="text-xs accent-orange mt-2"><i class="fa-solid fa-triangle-exclamation"></i> ${c.pendingCount} turno(s) aguardando conferencia</p>`
                    : ''
            }
            <a href="/admin?tab=reports" class="chip px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-2 mt-3">
                <i class="fa-solid fa-receipt"></i> Ver turnos
            </a>
        </div>`;

    /* ------------------------------------------------------- mais vendidos */
    const top =
        d.topProducts.length === 0
            ? `<p class="text-sm ink-3 py-4">Sem vendas registradas ainda.</p>`
            : d.topProducts
                  .map(
                      (p) => `                    <div class="flex items-center justify-between gap-3 py-2 border-b line last:border-0">
                        <span class="text-sm ink truncate">${escapeHtml(p.name)}</span>
                        <span class="text-sm font-semibold accent-amber-strong shrink-0">${p.qty} un.</span>
                    </div>`
                  )
                  .join('\n');

    /* ------------------------------------------------------------- fila */
    const filaItem = (label: string, value: number, cor: string) =>
        `                    <div class="flex items-center justify-between gap-2">
                            <span class="text-sm ink-2 flex items-center gap-2"><span class="w-2 h-2 rounded-full ${cor}"></span>${label}</span>
                            <span class="text-sm font-bold ink">${value}</span>
                        </div>`;

    /* -------------------------------------------------------- menu do dia */
    const dm = d.dailyMenu;
    const menuSection = `        <div class="surface border line rounded-2xl p-5 shadow-sm border-l-4" style="border-left-color: var(--accent)">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                    <h3 class="font-bold ink flex items-center gap-2">
                        <i class="fa-solid fa-star accent-amber"></i> Menu de hoje
                    </h3>
                    <p class="text-xs ink-3 mt-0.5">Aparece no topo do cardapio do WhatsApp</p>
                </div>
                <button type="button" onclick="menuOpen()" class="bg-amber-600 hover:bg-amber-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition">
                    <i class="fa-solid fa-pen"></i> ${dm ? 'Editar' : 'Definir'}
                </button>
            </div>
            ${
                dm && dm.items.length > 0
                    ? `${dm.note ? `<p class="text-sm ink-2 mb-3 italic">${escapeHtml(dm.note)}</p>` : ''}
            <div class="space-y-1.5">
                ${dm.items
                    .map(
                        (i) => `                <div class="flex items-center justify-between gap-3 py-1.5 border-b line last:border-0">
                    <span class="text-sm ink truncate">${escapeHtml(i.name)}</span>
                    <span class="text-sm font-semibold accent-amber-strong shrink-0">${money(i.price)}</span>
                </div>`
                    )
                    .join('\n')}
            </div>`
                    : '<p class="text-sm ink-3 py-2">Nenhum prato definido para hoje. O cardapio normal continua valendo.</p>'
            }
            ${
                dm && dm.items.length > 0
                    ? `<p class="text-[11px] ink-3 mt-3"><i class="fa-solid fa-circle-info"></i> Editar aqui ja muda o que o cliente ve no WhatsApp.</p>`
                    : ''
            }
        </div>`;

    return `        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            ${card('Faturamento hoje', money(d.today.revenue), deltaBadge(d.delta.revenue), 'accent-amber-strong')}
            ${card('Pedidos hoje', String(d.today.orders), deltaBadge(d.delta.orders), 'accent-amber')}
            ${card(
                'Ticket medio',
                money(d.averageTicket),
                d.yesterday ? `ontem: ${money(d.yesterday.revenue)}` : 'sem pedidos ontem',
                'accent-orange'
            )}
            ${card(
                'Lucro estimado',
                d.margin ? money(d.margin.value) : '--',
                d.margin
                    ? `margem de ${String(d.margin.percent).replace('.', ',')}%`
                    : 'cadastre o custo dos produtos',
                d.margin ? 'accent-emerald' : 'ink-3'
            )}
        </div>

        ${alerts}
        ${checklist}

        ${menuSection}

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-1 flex items-center gap-2"><i class="fa-solid fa-list accent-amber"></i> Fila de hoje</h3>
                <p class="text-xs ink-3 mb-4">Pedidos em aberto agora</p>
                <div class="space-y-2">
                    ${filaItem('Aguardando', d.queue.pendente, 'bg-amber-500')}
                    ${filaItem('Na cozinha', d.queue.preparando, 'bg-orange-500')}
                    ${filaItem('Em entrega', d.queue.entrega, 'bg-emerald-600')}
                    ${filaItem('Concluidos hoje', d.queue.concluidoHoje, 'bg-stone-400')}
                </div>
                <a href="/admin?tab=pedidos" class="chip px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-2 mt-4">
                    <i class="fa-solid fa-chart-pie"></i> Abrir pedidos
                </a>
            </div>

            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-1 flex items-center gap-2"><i class="fa-solid fa-trophy accent-amber"></i> Mais vendidos</h3>
                <p class="text-xs ink-3 mb-3">No historico completo</p>
${top}
            </div>

            ${caixa}
        </div>

        ${grafico}

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
            <a href="/admin?tab=pdv" class="surface border line rounded-2xl p-4 shadow-sm row-hover transition flex items-center gap-3">
                <i class="fa-solid fa-cash-register text-amber-500"></i>
                <span><span class="block text-sm font-semibold ink">Venda rapida</span><span class="block text-xs ink-3">Abrir o PDV</span></span>
            </a>
            <a href="/admin?tab=estoque" class="surface border line rounded-2xl p-4 shadow-sm row-hover transition flex items-center gap-3">
                <i class="fa-solid fa-boxes-stacked text-amber-500"></i>
                <span><span class="block text-sm font-semibold ink">Estoque</span><span class="block text-xs ink-3">Saldos e entradas</span></span>
            </a>
            <a href="/admin?tab=whatsapp" class="surface border line rounded-2xl p-4 shadow-sm row-hover transition flex items-center gap-3">
                <i class="fa-solid ${d.botOnline ? 'fa-whatsapp text-emerald-500' : 'fa-plug-circle-xmark accent-red'}"></i>
                <span><span class="block text-sm font-semibold ink">WhatsApp</span><span class="block text-xs ink-3">${d.botOnline ? 'Bot conectado' : 'Bot desconectado'}</span></span>
            </a>
        </div>

        <!-- Modal: menu do dia -->
        <div id="menuModal" class="hidden fixed inset-0 z-50 items-center justify-center p-4" style="background: rgba(0,0,0,0.55)">
            <div class="surface border line rounded-2xl shadow-lg w-full max-w-lg max-h-[88vh] overflow-y-auto p-5">
                <div class="flex items-start justify-between gap-3 mb-1">
                    <h3 class="font-bold ink">Menu do dia</h3>
                    <button type="button" onclick="menuClose()" class="w-8 h-8 rounded-lg badge-slate flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <p class="text-xs ink-3 mb-4">Escolha os pratos de hoje. Eles aparecem no topo do cardapio do WhatsApp.</p>

                <!-- Montar na hora: cria o prato e ja coloca no menu de hoje -->
                <div class="mb-3">
                    <button type="button" id="menuAddBtn" onclick="menuQuickOpen()" class="w-full badge-emerald text-sm py-2 rounded-lg font-medium transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-plus"></i> Montar um prato novo para hoje
                    </button>

                    <div id="menuAddForm" class="hidden mt-2 p-3 rounded-xl sunken border line">
                        <p class="text-xs font-semibold ink-2 mb-2">
                            Novo prato
                            <span class="ink-3 font-normal">- entra no cardapio e no menu de hoje na hora</span>
                        </p>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div class="sm:col-span-2">
                                <label class="block text-[11px] font-semibold ink-2 mb-1">Nome do prato</label>
                                <input id="qaName" maxlength="80" placeholder="Coxinha de.catupiry" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                            <div>
                                <label class="block text-[11px] font-semibold ink-2 mb-1">Preco (R$)</label>
                                <input id="qaPrice" type="number" step="0.01" min="0" value="" placeholder="0,00" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                            <div>
                                <label class="block text-[11px] font-semibold ink-2 mb-1">Categoria</label>
                                <input id="qaCategory" list="menuCategoryList" maxlength="40" placeholder="Salgados" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                                <datalist id="menuCategoryList">
                                    ${[...new Set(d.menuProducts.map((p) => p.category))].map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}
                                </datalist>
                            </div>
                            <div class="sm:col-span-2">
                                <label class="block text-[11px] font-semibold ink-2 mb-1">Descricao (opcional)</label>
                                <input id="qaDesc" maxlength="120" placeholder="Massa que derrete na boca" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                        </div>
                        <div class="flex gap-2 mt-3">
                            <button type="button" onclick="menuQuickCancel()" class="flex-1 badge-slate text-xs py-2 rounded-lg font-medium">Cancelar</button>
                            <button type="button" onclick="menuQuickSave()" id="qaSave" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs py-2 rounded-lg font-semibold">
                                Criar e incluir no menu
                            </button>
                        </div>
                    </div>
                </div>

                <div class="mb-3">
                    <label class="block text-xs font-semibold ink-2 mb-1">Observacao (opcional)</label>
                    <input id="menuNote" maxlength="140" value="${dm && dm.note ? escapeHtml(dm.note) : ''}"
                        placeholder="Feito na hora, serve 2 pessoas..." class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                </div>

                <div class="flex items-center justify-between gap-2 mb-2">
                    <p class="text-xs font-semibold ink-2">Pratos de hoje <span id="menuCount" class="ink-3"></span></p>
                    <div class="flex gap-1">
                        ${
                            d.previousMenu
                                ? `<button type="button" onclick="menuCopyPrevious()" class="badge-slate text-[10px] px-2 py-1 rounded" title="Copiar o menu de ${escapeHtml(d.previousMenu.date)}">
                                       <i class="fa-solid fa-copy"></i> Copiar ${escapeHtml(d.previousMenu.date.split('-').reverse().join('/'))}
                                   </button>`
                                : ''
                        }
                        <button type="button" onclick="menuClear()" class="badge-slate text-[10px] px-2 py-1 rounded">Limpar</button>
                    </div>
                </div>

                <p id="menuEmptyPick" class="text-sm ink-3 py-4 text-center hidden">Nenhum produto disponivel no cardapio.</p>
                <div id="menuList" class="space-y-1.5 max-h-72 overflow-y-auto">
                    ${d.menuProducts
                        .map(
                            (p) => `                    <label class="flex items-center gap-3 p-2 rounded-lg sunken cursor-pointer row-hover transition">
                        <input type="checkbox" data-menu-pick="${escapeHtml(p.id)}" value="${escapeHtml(p.id)}"
                            ${dm && dm.items.some((i) => i.id === p.id) ? 'checked' : ''} class="accent-amber-600 w-4 h-4 shrink-0">
                        <span class="min-w-0 flex-1">
                            <span class="block text-sm font-medium ink truncate">${escapeHtml(p.name)}</span>
                            <span class="block text-[11px] ink-3">${escapeHtml(p.category)}</span>
                        </span>
                        <span class="text-sm font-semibold accent-amber-strong shrink-0">${money(p.price)}</span>
                    </label>`
                        )
                        .join('\n')}
                </div>

                <div class="flex gap-2 mt-5">
                    <button type="button" onclick="menuClose()" class="flex-1 badge-slate text-sm py-2 rounded-lg font-medium">Cancelar</button>
                    <button type="button" onclick="menuSave()" class="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-sm py-2 rounded-lg font-semibold">
                        Salvar menu
                    </button>
                </div>
                <p class="text-[11px] ink-3 mt-3 text-center">
                    Salvar ja publica no WhatsApp. Clientes que ja receberam o cardapio antigo continuam vendo a lista antiga ate pedir de novo.
                </p>
            </div>
        </div>

        <script>
            var MENU_PREVIOUS = ${JSON.stringify(d.previousMenu ? d.previousMenu.items.map((i) => i.id) : [])};

            function menuCount() {
                return document.querySelectorAll('[data-menu-pick]:checked').length;
            }

            function menuSyncCount() {
                document.getElementById('menuCount').textContent = '(' + menuCount() + ')';
                var empty = document.getElementById('menuEmptyPick');
                var list = document.getElementById('menuList');
                if (empty && list) empty.classList.toggle('hidden', list.children.length > 0);
            }

            function menuOpen() {
                var m = document.getElementById('menuModal');
                m.classList.remove('hidden');
                m.classList.add('flex');
                menuSyncCount();
            }

            function menuClose() {
                var m = document.getElementById('menuModal');
                m.classList.add('hidden');
                m.classList.remove('flex');
                menuQuickCancel();
            }

            // ---- montar um prato na hora ----

            function menuQuickOpen() {
                document.getElementById('menuAddBtn').classList.add('hidden');
                document.getElementById('menuAddForm').classList.remove('hidden');
                document.getElementById('qaName').focus();
            }

            function menuQuickCancel() {
                var form = document.getElementById('menuAddForm');
                var btn = document.getElementById('menuAddBtn');
                if (!form || !btn) return;
                form.classList.add('hidden');
                btn.classList.remove('hidden');
            }

            function menuCheckedIds() {
                var ids = [];
                document.querySelectorAll('[data-menu-pick]:checked').forEach(function (c) { ids.push(c.value); });
                return ids;
            }

            async function menuQuickSave() {
                var nome = document.getElementById('qaName').value.trim();
                var precoRaw = document.getElementById('qaPrice').value.replace(',', '.');
                var preco = parseFloat(precoRaw);

                if (!nome) { flash('err', 'Informe o nome do prato.'); return; }
                if (!isFinite(preco) || preco < 0) { flash('err', 'Informe um preco valido.'); return; }

                var btn = document.getElementById('qaSave');
                btn.disabled = true;
                btn.textContent = 'Criando...';

                try {
                    // 1. cria o produto (ja entra disponivel no cardapio)
                    var novo = await postJSON('/api/admin/products', {
                        name: nome,
                        price: preco,
                        category: document.getElementById('qaCategory').value.trim(),
                        description: document.getElementById('qaDesc').value.trim()
                    });
                    if (!novo.ok) { flash('err', novo.data.error || 'Erro ao criar o prato'); return; }

                    // 2. inclui no menu de hoje, preservando o que ja estava marcado
                    var ids = menuCheckedIds();
                    if (ids.indexOf(novo.data.id) === -1) ids.push(novo.data.id);

                    var menu = await postJSON('/api/admin/daily-menu', {
                        productIds: ids,
                        note: document.getElementById('menuNote').value
                    });
                    if (!menu.ok) {
                        flash('err', menu.data.error || 'Prato criado, mas falhou ao incluir no menu.');
                        return;
                    }

                    flash('ok', nome + ' criado e incluido no menu de hoje.');
                    setTimeout(function () { location.reload(); }, 800);
                } catch (e) {
                    flash('err', 'Erro de conexao');
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Criar e incluir no menu';
                }
            }

            function menuClear() {
                document.querySelectorAll('[data-menu-pick]').forEach(function (c) { c.checked = false; });
                menuSyncCount();
            }

            function menuCopyPrevious() {
                if (!MENU_PREVIOUS.length) { flash('err', 'Nao ha menu anterior para copiar.'); return; }
                menuClear();
                MENU_PREVIOUS.forEach(function (id) {
                    var box = document.querySelector('[data-menu-pick="' + id + '"]');
                    if (box) box.checked = true;
                });
                menuSyncCount();
            }

            async function menuSave() {
                var ids = menuCheckedIds();
                var note = document.getElementById('menuNote').value;
                try {
                    var r = await postJSON('/api/admin/daily-menu', { productIds: ids, note: note });
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao salvar'); return; }
                    menuClose();
                    flash('ok', ids.length ? 'Menu de hoje publicado no WhatsApp.' : 'Menu de hoje removido.');
                    setTimeout(function () { location.reload(); }, 800);
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            document.addEventListener('change', function (e) {
                if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-menu-pick')) menuSyncCount();
            });
        </script>`;
}
