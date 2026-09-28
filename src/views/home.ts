import { escapeHtml } from './html';
import { currency } from '../services/stats';
import type { HomeData } from '../services/home';
import { renderCashModals, cashModalsScript } from './cashModals';

function money(n: number): string {
    return escapeHtml(currency(n));
}

/**
 * Variacao vs ontem. Sem base de comparacao (primeiro dia, ou ontem sem
 * venda) devolvemos null e a view diz "sem comparacao", em vez de mostrar
 * +100% que seria mentira.
 */
function deltaBadge(value: number | null, invert = false): string {
    if (value === null) return '<span class="text-caption text-ink-3">sem comparacao</span>';
    const up = value >= 0;
    const good = invert ? !up : up;
    const tone = good ? 'text-accent-emerald' : 'text-accent-red';
    const arrow = up ? 'fa-arrow-up' : 'fa-arrow-down';
    return `<span class="text-caption ${tone} font-semibold"><i class="fa-solid ${arrow}"></i> ${Math.abs(value).toFixed(1).replace('.', ',')}%</span>`;
}

/** KPI do topo. Esta era a 4a copia quase identica deste bloco no projeto. */
function kpi(label: string, value: string, sub: string, tone: string): string {
    return `                <div class="kpi">
                    <p class="kpi-label">${label}</p>
                    <p class="kpi-value ${tone}">${value}</p>
                    <p class="kpi-sub">${sub}</p>
                </div>`;
}

export function renderHome(d: HomeData): string {
    /* ------------------------------------------------------ precisa de atencao */
    // Alertas e pendencias eram dois blocos empilhados, cada um com um card
    // por item. Sao a mesma coisa -- "faca isto agora" -- entao viraram uma
    // lista so, no topo da tela, e o bloco some quando esta vazio.
    const pendentes = d.setup.filter((s) => !s.done);

    const atencaoLista = [
        ...d.alerts.map(
            (a) => `                    <li class="border-b border-line last:border-0">
                        <a href="${a.href}" class="flex items-center gap-3 py-3 row-hover">
                            <i class="fa-solid ${a.tone === 'red' ? 'fa-triangle-exclamation text-accent-red' : 'fa-bell text-accent-orange'} shrink-0"></i>
                            <span class="min-w-0 flex-1">
                                <span class="block text-body font-medium text-ink">${escapeHtml(a.title)}</span>
                                <span class="block text-caption text-ink-3">${escapeHtml(a.detail)}</span>
                            </span>
                            <span class="text-caption font-semibold text-accent-strong shrink-0 hidden sm:block">${escapeHtml(a.cta)}</span>
                            <i class="fa-solid fa-chevron-right text-ink-3 text-xs shrink-0"></i>
                        </a>
                    </li>`
        ),
        ...pendentes.map(
            (s) => `                    <li class="border-b border-line last:border-0">
                        <a href="${s.href}" class="flex items-center gap-3 py-3 row-hover">
                            <i class="fa-regular fa-circle text-ink-3 shrink-0"></i>
                            <span class="min-w-0 flex-1">
                                <span class="block text-body font-medium text-ink">${escapeHtml(s.label)}</span>
                                <span class="block text-caption text-ink-3">${escapeHtml(s.detail)}</span>
                            </span>
                            <i class="fa-solid fa-chevron-right text-ink-3 text-xs shrink-0"></i>
                        </a>
                    </li>`
        ),
    ].join('\n');

    const atencao =
        d.alerts.length === 0 && pendentes.length === 0
            ? d.setup.length > 0
                ? `        <div class="card card-pad mb-5 flex items-center gap-3">
                    <i class="fa-solid fa-circle-check text-accent-emerald"></i>
                    <p class="text-body text-ink">Nada pendente. Loja pronta.</p>
                </div>`
                : ''
            : `        <div class="card mb-5">
            <div class="card-pad">
                <div class="flex items-baseline justify-between gap-3 mb-4">
                    <h3 class="text-title">Precisa de atencao</h3>
                    <span class="text-caption text-ink-3">${d.alerts.length + pendentes.length} item(ns)</span>
                </div>
                <ul>
${atencaoLista}
                </ul>
            </div>
        </div>`;

    /* ------------------------------------------------------------- caixa */
    const c = d.cash;
    const agendaTexto = c.scheduleOn
        ? `Abre ${c.autoOpen || '--:--'} e fecha ${c.autoClose || '--:--'}${
              !c.hasFloat && c.autoOpen ? ' (abertura desativada: falta o fundo de troco)' : ''
          }`
        : 'Agenda desativada';

    // O card diz se o turno esta aberto e deixa abrir/fechar direto daqui --
    // sao o primeiro e o ultimo gesto do dia. Nao mostra dinheiro: o valor
    // guardado e a conferencia morao na aba Faturamento, que exige senha.
    const caixaEstado = c.shift
        ? `<p class="text-body text-ink mt-2"><i class="fa-solid fa-circle-check text-accent-emerald"></i> Turno aberto desde ${escapeHtml(c.shift.openedAt)}</p>`
        : `<p class="text-body text-ink-3 mt-2"><i class="fa-solid fa-circle-xmark"></i> Nenhum turno aberto</p>`;

    const botaoCaixa = c.shift
        ? `<button type="button" onclick="cashCloseModalOpen()" class="btn btn-danger btn-sm flex-1">
                    <i class="fa-solid fa-lock"></i> Fechar caixa
                </button>`
        : `<button type="button" onclick="cashOpenModalOpen()" class="btn btn-primary btn-sm flex-1">
                    <i class="fa-solid fa-lock-open"></i> Abrir caixa
                </button>`;

    const caixa = `        <div class="card">
            <div class="card-pad pb-3">
                <h3 class="text-title">Caixa</h3>
                <p class="text-caption text-ink-3">${escapeHtml(agendaTexto)}</p>
                ${caixaEstado}
                ${
                    c.pendingCount > 0
                        ? `<p class="text-caption text-accent-orange mt-2"><i class="fa-solid fa-triangle-exclamation"></i> ${c.pendingCount} turno(s) aguardando conferencia</p>`
                        : ''
                }
            </div>
            <div class="px-5 pb-5 flex gap-2">
                ${botaoCaixa}
                <a href="/admin?tab=faturamento&aba=caixa" class="btn btn-ghost btn-sm">
                    <i class="fa-solid fa-receipt"></i> Turnos
                </a>
            </div>
        </div>`;

    /* ------------------------------------------------------- mais vendidos */
    const topSection = `        <div class="card">
            <div class="card-pad pb-2">
                <h3 class="text-title">Mais vendidos</h3>
                <p class="text-caption text-ink-3">No historico completo</p>
            </div>
            <div class="px-5 pb-3">
                ${
                    d.topProducts.length === 0
                        ? '<p class="text-body text-ink-3 py-3">Sem vendas registradas ainda.</p>'
                        : d.topProducts
                              .map(
                                  (p, i) => `                <div class="flex items-center gap-3 py-2.5 ${i < d.topProducts.length - 1 ? 'border-b border-line' : ''}">
                            <span class="text-caption font-semibold text-ink-3 w-4 shrink-0">${i + 1}</span>
                            <span class="text-body text-ink truncate flex-1">${escapeHtml(p.name)}</span>
                            <span class="text-body font-semibold text-accent-strong shrink-0">${p.qty} un.</span>
                        </div>`
                              )
                              .join('\n')
                }
            </div>
        </div>`;

    /* ------------------------------------------------------------- acoes */
    // Subiram para o topo da coluna lateral: sao as quatro telas que o dono
    // abre o dia inteiro. Antes eram tres cards no fim da pagina, embaixo de
    // todo o resto, o que obrigava a rolar para chegar neles.
    const acoes = `        <div class="card">
            <div class="card-pad pb-2">
                <h3 class="text-title">Ir para</h3>
            </div>
            <div class="px-2 pb-2">
                <a href="/admin?tab=pdv" class="flex items-center gap-3 px-3 py-2.5 rounded-card row-hover">
                    <i class="fa-solid fa-cash-register text-accent"></i>
                    <span class="text-body font-medium text-ink flex-1">Vender no balcao</span>
                    <i class="fa-solid fa-chevron-right text-ink-3 text-xs"></i>
                </a>
                <a href="/admin?tab=kanban" class="flex items-center gap-3 px-3 py-2.5 rounded-card row-hover">
                    <i class="fa-solid fa-chart-pie text-accent"></i>
                    <span class="text-body font-medium text-ink flex-1">Ver pedidos</span>
                    <i class="fa-solid fa-chevron-right text-ink-3 text-xs"></i>
                </a>
                <a href="/admin?tab=estoque" class="flex items-center gap-3 px-3 py-2.5 rounded-card row-hover">
                    <i class="fa-solid fa-boxes-stacked text-accent"></i>
                    <span class="text-body font-medium text-ink flex-1">Produtos e estoque</span>
                    <i class="fa-solid fa-chevron-right text-ink-3 text-xs"></i>
                </a>
                <a href="/admin?tab=whatsapp" class="flex items-center gap-3 px-3 py-2.5 rounded-card row-hover">
                    <i class="fa-solid ${d.botOnline ? 'fa-whatsapp text-accent-emerald' : 'fa-plug-circle-xmark text-accent-red'}"></i>
                    <span class="text-body font-medium text-ink flex-1">WhatsApp</span>
                    <span class="text-micro text-ink-3 shrink-0">${d.botOnline ? 'conectado' : 'desconectado'}</span>
                </a>
            </div>
        </div>`;

    /* ------------------------------------------------------------- fila */
    // A fila vira uma faixa de contadores lado a lado: da para ler os quatro
    // numeros de relance, sem varrer quatro linhas com o olho.
    const filaContador = (label: string, value: number, cor: string) => `                <div class="flex-1 min-w-0 text-center px-2">
                    <p class="text-3xl font-extrabold ink leading-none">${value}</p>
                    <p class="text-micro text-ink-3 mt-1.5 flex items-center justify-center gap-1.5">
                        <span class="w-1.5 h-1.5 rounded-full ${cor}"></span>${label}
                    </p>
                </div>`;

    const filaSection = `        <div class="card mb-5">
            <div class="flex flex-wrap items-center justify-between gap-3 card-pad pb-3">
                <div>
                    <h3 class="text-title">Pedidos agora</h3>
                    <p class="text-caption text-ink-3">O que esta em aberto neste momento</p>
                </div>
                <a href="/admin?tab=kanban" class="btn btn-ghost btn-sm">
                    <i class="fa-solid fa-chart-pie"></i> Abrir pedidos
                </a>
            </div>
            <div class="flex divide-x divide-line border-t border-line">
                ${filaContador('Aguardando', d.queue.pendente, 'bg-accent')}
                ${filaContador('Na cozinha', d.queue.preparando, 'bg-accent-orange')}
                ${filaContador('Em entrega', d.queue.entrega, 'bg-accent-emerald')}
                ${filaContador('Concluidos', d.queue.concluidoHoje, 'bg-ink-3')}
            </div>
        </div>`;

    // Janelas de abrir e fechar caixa. O layout vem de ui/modal.ts.
    const cashModalsHtml = renderCashModals();
    const cashModalsHtmlScript = cashModalsScript();

    /* -------------------------------------------------------- menu do dia */
    const dm = d.dailyMenu;    const temMenu = !!dm && dm.items.length > 0;
    const menuSection = `        <div class="card">
            <div class="flex flex-wrap items-center justify-between gap-3 card-pad pb-3">
                <div>
                    <h3 class="text-title">Menu de hoje</h3>
                    <p class="text-caption text-ink-3">Aparece no topo do cardapio do WhatsApp</p>
                </div>
                <button type="button" onclick="menuOpen()" class="btn ${temMenu ? 'btn-ghost' : 'btn-primary'} btn-sm">
                    <i class="fa-solid ${temMenu ? 'fa-pen' : 'fa-plus'}"></i> ${temMenu ? 'Editar' : 'Definir'}
                </button>
            </div>
            ${
                temMenu
                    ? `<div class="px-5 pb-4">
                ${dm.note ? `<p class="text-body text-ink-2 mb-3 italic">${escapeHtml(dm.note)}</p>` : ''}
                <ul>
                    ${dm.items
                        .map(
                            (i, idx) => `                    <li class="flex items-center justify-between gap-3 py-2 ${idx < dm.items.length - 1 ? 'border-b border-line' : ''}">
                        <span class="text-body text-ink truncate">${escapeHtml(i.name)}</span>
                        <span class="text-body font-semibold text-accent-strong shrink-0">${money(i.price)}</span>
                    </li>`
                        )
                        .join('\n')}
                </ul>
            </div>`
                    : `<div class="px-5 pb-4">
                <p class="text-body text-ink-3">Nenhum prato definido para hoje. O cardapio normal continua valendo.</p>
            </div>`
            }
        </div>`;

    return `        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            ${kpi('Pedidos hoje', String(d.today.orders), deltaBadge(d.delta.orders), 'text-accent')}
            ${kpi('Em aberto', String(d.queue.pendente + d.queue.preparando + d.queue.entrega), 'aguardando ou em preparo', 'text-accent-orange')}
            ${kpi('Concluidos', String(d.queue.concluidoHoje), 'finalizados hoje', 'text-accent-emerald')}
            ${kpi('Itens no cardapio', String(d.menuProducts.length), 'disponiveis para vender', 'text-ink-2')}
        </div>

        ${atencao}

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            <div class="lg:col-span-2 space-y-5">
                ${filaSection}
                ${menuSection}
            </div>

            <div class="space-y-5">
                ${acoes}
                ${caixa}
                ${topSection}
            </div>
        </div>

        ${cashModalsHtml}

        <!-- Modal: menu do dia -->
        <div id="menuModal" class="modal-backdrop hidden">
            <div class="modal-panel">
                <div class="flex items-start justify-between gap-3 mb-1">
                    <h3 class="text-title">Menu do dia</h3>
                    <button type="button" onclick="menuClose()" class="btn btn-ghost px-2 -mt-1 -mr-1" aria-label="Fechar">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <p class="text-caption text-ink-3 mb-4">Escolha os pratos de hoje. Eles aparecem no topo do cardapio do WhatsApp.</p>

                <!-- Montar na hora: cria o prato e ja coloca no menu de hoje -->
                <div class="mb-3">
                    <button type="button" id="menuAddBtn" onclick="menuQuickOpen()" class="btn btn-ghost w-full border-success text-success-ink">
                        <i class="fa-solid fa-plus"></i> Montar um prato novo para hoje
                    </button>

                    <div id="menuAddForm" class="hidden mt-2 p-3 rounded-card bg-sunken border border-line">
                        <p class="text-caption font-semibold text-ink-2 mb-2">
                            Novo prato
                            <span class="text-ink-3 font-normal">- entra no cardapio e no menu de hoje na hora</span>
                        </p>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div class="sm:col-span-2">
                                <label class="label" for="qaName">Nome do prato</label>
                                <input id="qaName" maxlength="80" placeholder="Coxinha de catupiry" class="input">
                            </div>
                            <div>
                                <label class="label" for="qaPrice">Preco (R$)</label>
                                <input id="qaPrice" type="number" step="0.01" min="0" value="" placeholder="0,00" class="input">
                            </div>
                            <div>
                                <label class="label" for="qaCategory">Categoria</label>
                                <input id="qaCategory" list="menuCategoryList" maxlength="40" placeholder="Salgados" class="input">
                                <datalist id="menuCategoryList">
                                    ${[...new Set(d.menuProducts.map((p) => p.category))].map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}
                                </datalist>
                            </div>
                            <div class="sm:col-span-2">
                                <label class="label" for="qaDesc">Descricao (opcional)</label>
                                <input id="qaDesc" maxlength="120" placeholder="Massa que derrete na boca" class="input">
                            </div>
                        </div>
                        <div class="flex gap-2 mt-3">
                            <button type="button" onclick="menuQuickCancel()" class="btn btn-ghost flex-1">Cancelar</button>
                            <button type="button" onclick="menuQuickSave()" id="qaSave" class="btn btn-primary flex-1">
                                Criar e incluir no menu
                            </button>
                        </div>
                    </div>
                </div>

                <div class="mb-3">
                    <label class="label" for="menuNote">Observacao (opcional)</label>
                    <input id="menuNote" maxlength="140" value="${dm && dm.note ? escapeHtml(dm.note) : ''}"
                        placeholder="Feito na hora, serve 2 pessoas..." class="input">
                </div>

                <div class="flex items-center justify-between gap-2 mb-2">
                    <p class="text-caption font-semibold text-ink-2">Pratos de hoje <span id="menuCount" class="text-ink-3"></span></p>
                    <div class="flex gap-1">
                        ${
                            d.previousMenu
                                ? `<button type="button" onclick="menuCopyPrevious()" class="btn btn-ghost btn-sm" title="Copiar o menu de ${escapeHtml(d.previousMenu.date)}">
                                       <i class="fa-solid fa-copy"></i> Copiar ${escapeHtml(d.previousMenu.date.split('-').reverse().join('/'))}
                                   </button>`
                                : ''
                        }
                        <button type="button" onclick="menuClear()" class="btn btn-ghost btn-sm">Limpar</button>
                    </div>
                </div>

                <p id="menuEmptyPick" class="text-body text-ink-3 py-4 text-center hidden">Nenhum produto disponivel no cardapio.</p>
                <div id="menuList" class="space-y-1.5 max-h-72 overflow-y-auto">
                    ${d.menuProducts
                        .map(
                            (p) => `                    <label class="flex items-center gap-3 p-2 rounded-card bg-sunken cursor-pointer row-hover">
                        <input type="checkbox" data-menu-pick="${escapeHtml(p.id)}" value="${escapeHtml(p.id)}"
                            ${dm && dm.items.some((i) => i.id === p.id) ? 'checked' : ''} class="w-4 h-4 shrink-0 accent-accent">
                        <span class="min-w-0 flex-1">
                            <span class="block text-body font-medium text-ink truncate">${escapeHtml(p.name)}</span>
                            <span class="block text-caption text-ink-3">${escapeHtml(p.category)}</span>
                        </span>
                        <span class="text-body font-semibold text-accent-strong shrink-0">${money(p.price)}</span>
                    </label>`
                        )
                        .join('\n')}
                </div>

                <div class="flex gap-2 mt-5">
                    <button type="button" onclick="menuClose()" class="btn btn-ghost flex-1">Cancelar</button>
                    <button type="button" onclick="menuSave()" class="btn btn-primary flex-1">Salvar menu</button>
                </div>
                <p class="text-caption text-ink-3 mt-3 text-center">
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
        </script>

        ${cashModalsHtmlScript}`;
}
