import { escapeHtml } from './html';
import { currency } from '../services/stats';
import { renderCatalog, type CatalogData } from './catalog';
import {
    summarize,
    stockStatus,
    needsMinStock,
    STOCK_STATUS_LABEL,
    STOCK_STATUS_BADGE,
    MOVEMENT_LABELS,
    MOVEMENT_BADGES,
    type StockRow,
    type MovementView,
    type InventorySummary,
    type WasteSummary,
} from '../services/stock';

type InventoryData = {
    rows: StockRow[];
    summary: InventorySummary;
    movements: MovementView[];
    categories: string[];
    /** Produtos controlledos no minimo ou zerados, com a quantidade sugerida. */
    reorder: Array<StockRow & { faltam: number }>;
    /** Perdas por descarte/validade desde a meia-noite. */
    waste: WasteSummary;
    /** Dados do catalogo, que virou a aba "Catalogo" desta mesma tela. */
    catalog: CatalogData;
};

function money(n: number): string {
    return escapeHtml(currency(n));
}

function card(label: string, value: string, sub: string, tone: string): string {
    return `                <div class="surface border line rounded-2xl p-4 shadow-sm">
                    <p class="text-xs font-semibold ink-3 uppercase tracking-wide">${label}</p>
                    <p class="text-2xl font-extrabold ${tone} mt-1">${value}</p>
                    <p class="text-xs ink-3 mt-1">${sub}</p>
                </div>`;
}

/** Sinal efetivo do movimento; linhas antigas (delta 0) deduzem pelo tipo. */
function movementDelta(m: MovementView): number {
    if (m.delta !== 0) return m.delta;
    if (m.type === 'entrada') return m.quantity;
    if (m.type === 'saida' || m.type === 'perda') return -m.quantity;
    return 0;
}

export function renderInventory(d: InventoryData): string {
    const body = d.rows
        .map((r) => {
            const status = stockStatus(r);
            const badge = STOCK_STATUS_BADGE[status];
            const label = STOCK_STATUS_LABEL[status];
            const semMinimo = needsMinStock(r);

            /*
             * Celula de saldo: menos, campo, mais.
             *
             * Os tres controles recebem nome proprio com o nome do produto. O
             * campo de numero sozinho anunciava "campo de texto, 12" para quem
             * usa leitor de tela -- o suficiente para o campo existir e nada
             * para dizer QUAL saldo. Os botoes de menos e mais tinham `title`,
             * que ajuda o mouse e nao o leitor de tela, e o "menos" ainda e'
             * ambiguo: em uma tela com 40 produtos, "remover 1" de qual?
             */
            const estoqueDe = 'estoque de ' + r.name;
            const stockCell = r.trackStock
                ? `<div class="flex items-center gap-1">
                        <button type="button" onclick="stockAdjust('${escapeHtml(r.id)}', -1)" class="w-7 h-7 rounded badge-slate text-xs font-bold transition" title="Remover 1" aria-label="Remover 1 de ${escapeHtml(estoqueDe)}">&minus;</button>
                        <input id="stock-${escapeHtml(r.id)}" type="number" value="${r.stock}" min="0" data-stock-input="${escapeHtml(r.id)}"
                            onchange="stockSet('${escapeHtml(r.id)}', this.value)"
                            aria-label="${escapeHtml(estoqueDe)}"
                            class="w-16 px-2 py-1 text-center text-sm border line-in rounded">
                        <button type="button" onclick="stockAdjust('${escapeHtml(r.id)}', 1)" class="w-7 h-7 rounded badge-emerald text-xs font-bold transition" title="Adicionar 1" aria-label="Adicionar 1 a ${escapeHtml(estoqueDe)}">+</button>
                    </div>`
                : '<span class="text-xs ink-3">sem controle</span>';

            const alertaMin = semMinimo
                ? '<span class="badge-amber text-[10px] px-1.5 py-0.5 rounded" title="Defina um minimo para receber alerta de reposicao">sem minimo</span>'
                : '';

            return `                    <tr data-stock-row data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name.toLowerCase())}" data-category="${escapeHtml(r.category.toLowerCase())}" data-status="${status}">
                        <td>
                            <div class="font-medium ink">${escapeHtml(r.name)}</div>
                            <div class="flex flex-wrap gap-1 mt-0.5">
                                <span class="badge-slate text-[10px] px-1.5 py-0.5 rounded">${escapeHtml(r.category)}</span>
                                ${alertaMin}
                            </div>
                        </td>
                        <td class="accent-amber-strong font-semibold whitespace-nowrap">${money(r.price)}</td>
                        <td>${stockCell}</td>
                        <td class="text-sm ink-3">${r.trackStock ? r.minStock : '-'}</td>
                        <td><span class="${badge} text-xs px-2 py-0.5 rounded-full whitespace-nowrap">${label}</span></td>
                        <td class="whitespace-nowrap">${r.trackStock ? money(r.stock * r.price) : '-'}</td>
                        <td>
                            <div class="flex gap-1">
                                <button type="button" onclick="stockEntry('${escapeHtml(r.id)}')" class="badge-emerald text-xs px-2 py-1.5 rounded-lg font-medium transition whitespace-nowrap" title="Registrar entrada">
                                    <i class="fa-solid fa-plus"></i>
                                </button>
                                <button type="button" onclick="stockLoss('${escapeHtml(r.id)}')" class="badge-orange text-xs px-2 py-1.5 rounded-lg font-medium transition whitespace-nowrap" title="Registrar perda (descarte ou validade)">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                                <button type="button" onclick="stockEdit('${escapeHtml(r.id)}')" class="badge-slate text-xs px-2 py-1.5 rounded-lg font-medium transition whitespace-nowrap" title="Ajustar minimo e custo">
                                    <i class="fa-solid fa-gear"></i>
                                </button>
                            </div>
                        </td>
                    </tr>`;
        })
        .join('\n');

    const movementRows = d.movements
        .map((m) => {
            const badge = MOVEMENT_BADGES[m.type] ?? 'badge-slate';
            const label = MOVEMENT_LABELS[m.type] ?? m.type;
            const delta = movementDelta(m);
            const sign = delta > 0 ? '+' : delta < 0 ? '&minus;' : '=';
            const tone = delta > 0 ? 'accent-emerald' : delta < 0 ? 'accent-red' : 'ink-3';
            return `                    <tr>
                        <td class="text-xs ink-3 whitespace-nowrap">${escapeHtml(m.when)}</td>
                        <td class="font-medium">${escapeHtml(m.productName)}</td>
                        <td><span class="${badge} text-xs px-2 py-0.5 rounded-full">${label}</span></td>
                        <td class="font-semibold ${tone}">${sign}${Math.abs(delta || m.quantity)}</td>
                        <td class="text-xs ink-3">${escapeHtml(m.source)}</td>
                        <td class="text-xs ink-3 max-w-xs truncate" title="${escapeHtml(m.note ?? '')}">${escapeHtml(m.note ?? '')}</td>
                    </tr>`;
        })
        .join('\n');

    const reorderRows = d.reorder
        .map(
            (r) => `                    <tr>
                        <td class="font-medium">${escapeHtml(r.name)}</td>
                        <td><span class="${r.stock <= 0 ? 'badge-red' : 'badge-amber'} text-xs px-2 py-0.5 rounded-full">${r.stock <= 0 ? 'Zerado' : 'Baixo'}</span></td>
                        <td class="text-center">${r.stock}</td>
                        <td class="text-center">${r.minStock}</td>
                        <td class="text-center font-bold accent-amber-strong">${r.faltam > 0 ? r.faltam : '-'}</td>
                    </tr>`
        )
        .join('\n');

    const semAbertura = d.summary.missingMin;

    return `        <div class="inline-flex rounded-card border border-line overflow-hidden mb-5" role="tablist" aria-label="Produtos e estoque">
                <button type="button" id="tabCatalogo" onclick="stockSetTab('catalogo')" class="px-4 py-2 text-body font-medium transition bg-accent text-white" aria-selected="true">
                    <i class="fa-solid fa-utensils"></i> Catalogo
                </button>
                <button type="button" id="tabSaldos" onclick="stockSetTab('saldos')" class="px-4 py-2 text-body font-medium transition" aria-selected="false">
                    <i class="fa-solid fa-boxes-stacked"></i> Saldos
                </button>
            </div>

            <div id="painelCatalogo" class="hidden">
${renderCatalog(d.catalog)}
            </div>

            <div id="painelSaldos">

            ${card('Itens controlados', String(d.summary.tracked), d.summary.untracked + ' sem controle', 'ink')}
            ${card('Unidades em estoque', String(d.summary.units), 'soma de todos os itens', 'accent-amber-strong')}
            ${card('Estoque baixo', String(d.summary.low), 'no ou abaixo do minimo', 'accent-orange')}
            ${card('Zerados', String(d.summary.empty), 'sem unidades para venda', 'accent-red')}
            ${card('Capital em estoque', money(d.summary.costValue), 'valor de venda: ' + money(d.summary.value), 'accent-emerald')}
        </div>

        ${
            d.reorder.length > 0 || semAbertura > 0
                ? `        <div class="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5 items-start">
            <div class="xl:col-span-2 surface border line rounded-2xl shadow-sm overflow-hidden border-l-4" style="border-left-color: var(--badge-amber-ink)">
                <div class="p-4 flex flex-wrap items-center justify-between gap-3 border-b line">
                    <h3 class="font-bold ink flex items-center gap-2"><i class="fa-solid fa-cart-shopping accent-amber"></i> Lista de reposicao</h3>
                    <button type="button" onclick="stockPrintReorder()" class="badge-slate text-xs px-2.5 py-1.5 rounded-lg font-medium transition">
                        <i class="fa-solid fa-print"></i> Imprimir
                    </button>
                </div>
                ${
                    d.reorder.length === 0
                        ? '<p class="text-sm ink-3 text-center py-8">Nada abaixo do minimo.</p>'
                        : `<div class="table-wrap">
                    <table id="reorderTable">
                        <thead class="surface-2 ink-3">
                            <tr><th>Produto</th><th>Status</th><th>Saldo</th><th>Minimo</th><th>Comprar</th></tr>
                        </thead>
                        <tbody class="ink">
${reorderRows}
                        </tbody>
                    </table>
                </div>`
                }
            </div>
            <div class="surface border line rounded-2xl p-5 shadow-sm border-l-4" style="border-left-color: var(--badge-red-ink)">
                <h3 class="font-bold ink mb-2 flex items-center gap-2"><i class="fa-solid fa-trash-can accent-red"></i> Perdas de hoje</h3>
                <p class="text-3xl font-extrabold accent-red">${d.waste.units} un.</p>
                <p class="text-sm ink-3 mt-1">${d.waste.count} descarte(s) registrado(s)</p>
                <p class="text-sm ink-3 mt-2">Impacto no custo: <strong class="ink">${money(d.waste.cost)}</strong></p>
                <p class="text-xs ink-3 mt-3">Salgados e doces vencem: registre o descarte para acompanhar o desperdicio.</p>
            </div>
        </div>`
                : ''
        }

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
            <div class="xl:col-span-2 surface border line rounded-2xl shadow-sm overflow-hidden">
                <div class="p-4 flex flex-wrap items-center justify-between gap-3 border-b line">
                    <h3 class="font-bold ink flex items-center gap-2"><i class="fa-solid fa-boxes-stacked accent-amber"></i> Saldo por produto</h3>
                    <div class="flex flex-wrap items-center gap-2">
                        <input id="stockSearch" type="search" placeholder="Buscar produto..." oninput="stockFilter()"
                            class="px-3 py-1.5 text-sm border line-in rounded-lg">
                        <select id="stockCategory" onchange="stockFilter()" class="px-2 py-1.5 text-sm border line-in rounded-lg">
                            <option value="">Todas</option>
                            ${d.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                        </select>
                        <select id="stockStatusFilter" onchange="stockFilter()" class="px-2 py-1.5 text-sm border line-in rounded-lg">
                            <option value="">Tudo</option>
                            <option value="baixo">So estoque baixo</option>
                            <option value="zerado">So zerados</option>
                            <option value="ok">So ok</option>
                            <option value="sem-controle">Sem controle</option>
                        </select>
                    </div>
                </div>

                ${
                    d.rows.length === 0
                        ? '<p class="text-sm ink-3 text-center py-10">Nenhum produto cadastrado.</p>'
                        : `<div class="table-wrap">
                    <table>
                        <thead class="surface-2 ink-3">
                            <tr>
                                <th>Produto</th><th>Preco</th><th>Estoque</th><th>Minimo</th><th>Status</th><th>Valor</th><th></th>
                            </tr>
                        </thead>
                        <tbody class="ink" id="stockBody">
${body}
                        </tbody>
                    </table>
                </div>
                <p id="stockEmptyMsg" class="hidden text-sm ink-3 text-center py-8">Nenhum produto com esses filtros.</p>`
                }
            </div>

            <div class="surface border line rounded-2xl p-5 shadow-sm">
                <h3 class="font-bold ink mb-3 flex items-center gap-2"><i class="fa-solid fa-arrow-right-arrow-left accent-amber"></i> Ultimos movimentos</h3>
                ${
                    d.movements.length === 0
                        ? '<p class="text-sm ink-3 py-6 text-center">Nenhum movimento registrado.</p>'
                        : `<div class="table-wrap max-h-[32rem] overflow-y-auto">
                    <table>
                        <thead class="ink-3">
                            <tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Qtd</th><th>Origem</th><th>Obs</th></tr>
                        </thead>
                        <tbody class="ink">
${movementRows}
                        </tbody>
                    </table>
                </div>`
                }
            </div>
        </div>

        ${
            semAbertura > 0
                ? `<div class="surface border line rounded-2xl p-4 mt-5 shadow-sm">
            <p class="text-sm accent-amber-strong font-semibold flex items-center gap-2">
                <i class="fa-solid fa-triangle-exclamation"></i>
                ${semAbertura} item(ns) sem estoque minimo definido
            </p>
            <p class="text-xs ink-3 mt-1">Sem minimo, o item nunca entra na lista de reposicao nem gera alerta.</p>
        </div>`
                : ''
        }

        <details class="surface border line rounded-2xl p-4 mt-5 shadow-sm">
            <summary class="cursor-pointer font-bold ink flex items-center gap-2 select-none">
                <i class="fa-solid fa-gear accent-amber"></i> Ativar controle de estoque em um produto
            </summary>
            <p class="text-xs ink-3 mt-2 mb-3">
                Sem controle, o produto aparece no cardapio mesmo com saldo zerado (util para receitas e itens por peso).
                Ao ativar, o saldo passa a baixar sozinho a cada venda.
            </p>
            <form onsubmit="return stockToggleTracking(event)" class="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div class="sm:col-span-2">
                    <label class="label" for="trk-produto">Produto</label>
                    <select id="trk-produto" name="productId" required class="input">
                        ${d.rows.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="label" for="trk-saldo">Saldo inicial</label>
                    <input id="trk-saldo" type="number" name="stock" min="0" value="0" inputmode="numeric" class="input">
                </div>
                <div>
                    <label class="label" for="trk-minimo">Estoque minimo</label>
                    <input id="trk-minimo" type="number" name="minStock" min="1" value="1" inputmode="numeric" class="input">
                </div>
                <button type="submit" class="btn btn-primary sm:col-span-4 sm:w-auto">
                    <i class="fa-solid fa-save"></i> Salvar controle
                </button>
            </form>
        </details>

        <div id="stockModal" class="hidden fixed inset-0 z-50 items-center justify-center p-4" style="background: rgba(0,0,0,0.55)">
            <div class="surface border line rounded-2xl shadow-lg w-full max-w-md p-5">
                <div class="flex items-start justify-between gap-3 mb-4">
                    <h3 id="stockModalTitle" class="font-bold ink"></h3>
                    <button type="button" onclick="stockCloseModal()" class="w-8 h-8 rounded-lg badge-slate flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div id="stockModalBody" class="space-y-3"></div>
                <div class="flex gap-2 mt-5">
                    <button type="button" onclick="stockCloseModal()" class="flex-1 badge-slate text-sm py-2 rounded-lg font-medium">Cancelar</button>
                    <button type="button" onclick="stockSaveModal()" id="stockModalConfirm"
                        class="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-sm py-2 rounded-lg font-semibold">
                        Salvar
                    </button>
                </div>
            </div>
        </div>

        <script>
            var STOCK_ROWS = ${JSON.stringify(
                d.rows.map((r) => ({
                    id: r.id,
                    name: r.name,
                    minStock: r.minStock,
                    costPrice: r.costPrice,
                    stock: r.stock,
                    trackStock: r.trackStock,
                }))
            ).replace(/</g, '\\u003c')};

            var stockModal = { mode: '', id: null };

            function stockFilter() {
                var q = (document.getElementById('stockSearch').value || '').toLowerCase();
                var cat = (document.getElementById('stockCategory').value || '').toLowerCase();
                var stt = document.getElementById('stockStatusFilter').value;
                var visiveis = 0;

                document.querySelectorAll('#stockBody [data-stock-row]').forEach(function (row) {
                    var ok = row.dataset.name.indexOf(q) !== -1
                        && (!cat || row.dataset.category === cat)
                        && (!stt || row.dataset.status === stt);
                    row.style.display = ok ? '' : 'none';
                    if (ok) visiveis++;
                });

                var empty = document.getElementById('stockEmptyMsg');
                if (empty) empty.classList.toggle('hidden', visiveis > 0);
            }

            /** Atualiza o saldo e o status exibidos, sem recarregar a pagina. */
            function stockPaint(id, saldo) {
                var input = document.querySelector('[data-stock-input="' + id + '"]');
                if (input) input.value = saldo;

                var row = document.querySelector('[data-stock-row][data-id="' + id + '"]');
                var meta = STOCK_ROWS.filter(function (r) { return r.id === id; })[0];
                if (!row || !meta) return;

                meta.stock = saldo;
                var stt = !meta.trackStock ? 'sem-controle'
                    : saldo <= 0 ? 'zerado'
                    : (meta.minStock > 0 && saldo <= meta.minStock) ? 'baixo' : 'ok';
                row.dataset.status = stt;

                var badge = row.querySelector('td:nth-child(5) span');
                if (badge) {
                    var mapa = {
                        ok: ['Em estoque', 'badge-emerald'],
                        baixo: ['Estoque baixo', 'badge-amber'],
                        zerado: ['Zerado', 'badge-red'],
                        'sem-controle': ['Sem controle', 'badge-slate']
                    };
                    badge.textContent = mapa[stt][0];
                    badge.className = mapa[stt][1] + ' text-xs px-2 py-0.5 rounded-full whitespace-nowrap';
                }
            }

            async function stockSet(id, value) {
                var qty = Math.max(0, parseInt(value, 10) || 0);
                try {
                    var r = await postJSON('/api/admin/stock/set', { productId: id, stock: qty });
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao salvar saldo'); return; }
                    stockPaint(id, r.data.stock);
                    flash('ok', 'Saldo atualizado para ' + r.data.stock + '.');
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            async function stockAdjust(id, delta) {
                try {
                    var r = await postJSON('/api/admin/stock/adjust', { productId: id, delta: delta });
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao ajustar'); return; }
                    stockPaint(id, r.data.stock);
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            /*
             * Os ids smQty e smNote aparecem em duas funcoes, e isso e' seguro:
             * o innerHTML do corpo da janela e' substituido inteiro a cada
             * abertura, entao so uma versao existe no DOM por vez. O que
             * faltava era o for no rotulo -- o campo existia, o texto nao
             * apontava para ele, e clicar no texto nao focava nada.
             */
            function stockEntry(id) {
                stockModal = { mode: 'entrada', id: id };
                var meta = STOCK_ROWS.filter(function (r) { return r.id === id; })[0];
                document.getElementById('stockModalTitle').textContent = 'Entrada - ' + meta.name;
                document.getElementById('stockModalBody').innerHTML =
                    '<div><label class="label" for="smQty">Quantidade</label>'
                    + '<input id="smQty" type="number" min="1" value="1" inputmode="numeric" class="input"></div>'
                    + '<div><label class="label" for="smNote">Observacao</label>'
                    + '<input id="smNote" placeholder="Compra, producao, reposicao..." class="input"></div>';
                document.getElementById('stockModalConfirm').textContent = 'Registrar entrada';
                document.getElementById('stockModal').classList.remove('hidden');
                document.getElementById('stockModal').classList.add('flex');
                document.getElementById('smQty').focus();
            }

            function stockLoss(id) {
                stockModal = { mode: 'perda', id: id };
                var meta = STOCK_ROWS.filter(function (r) { return r.id === id; })[0];
                document.getElementById('stockModalTitle').textContent = 'Perda - ' + meta.name;
                document.getElementById('stockModalBody').innerHTML =
                    '<p class="text-xs ink-3">Saldo atual: ' + meta.stock + ' un.</p>'
                    + '<div><label class="label" for="smQty">Quantidade perdida</label>'
                    + '<input id="smQty" type="number" min="1" value="1" inputmode="numeric" class="input"></div>'
                    + '<div><label class="label" for="smNote">Motivo</label>'
                    + '<select id="smNote" class="input">'
                    + '<option>Validade</option><option>Descarte</option><option>Quebra</option>'
                    + '<option>Roubo</option><option>Emprestado</option><option>Outro</option></select></div>'
                    + '<p class="text-xs accent-orange">Perdas reduzem o estoque e entram no indicador de desperdicio.</p>';
                document.getElementById('stockModalConfirm').textContent = 'Registrar perda';
                document.getElementById('stockModal').classList.remove('hidden');
                document.getElementById('stockModal').classList.add('flex');
                document.getElementById('smQty').focus();
            }

            function stockEdit(id) {
                stockModal = { mode: 'editar', id: id };
                var meta = STOCK_ROWS.filter(function (r) { return r.id === id; })[0];
                document.getElementById('stockModalTitle').textContent = 'Ajustes - ' + meta.name;
                document.getElementById('stockModalBody').innerHTML =
                    '<div><label class="label" for="smMin">Estoque minimo (0 = sem alerta)</label>'
                    + '<input id="smMin" type="number" min="0" value="' + meta.minStock + '" inputmode="numeric" class="input"></div>'
                    + '<div><label class="label" for="smCost">Preco de custo (R$)</label>'
                    + '<input id="smCost" type="number" step="0.01" min="0" inputmode="decimal" value="' + meta.costPrice + '" class="input"></div>'
                    + '<p class="text-xs ink-3">O custo alimenta a margem e o valor real do estoque.</p>';
                document.getElementById('stockModalConfirm').textContent = 'Salvar ajustes';
                document.getElementById('stockModal').classList.remove('hidden');
                document.getElementById('stockModal').classList.add('flex');
                document.getElementById('smMin').focus();
            }

            function stockCloseModal() {
                document.getElementById('stockModal').classList.add('hidden');
                document.getElementById('stockModal').classList.remove('flex');
            }

            async function stockSaveModal() {
                var id = stockModal.id;
                var qty = parseInt(document.getElementById('smQty').value, 10) || 0;
                var note = (document.getElementById('smNote') || {}).value || '';

                try {
                    if (stockModal.mode === 'entrada') {
                        if (qty <= 0) { flash('err', 'Quantidade invalida.'); return; }
                        var r = await postJSON('/api/admin/stock/movement', {
                            productId: id, type: 'entrada', quantity: qty, note: note
                        });
                        if (!r.ok) { flash('err', r.data.error || 'Erro'); return; }
                        stockCloseModal();
                        flash('ok', 'Entrada de ' + qty + ' un. registrada.');
                        setTimeout(function () { location.reload(); }, 500);
                        return;
                    }
                    if (stockModal.mode === 'perda') {
                        if (qty <= 0) { flash('err', 'Quantidade invalida.'); return; }
                        var r2 = await postJSON('/api/admin/stock/loss', {
                            productId: id, quantity: qty, reason: note
                        });
                        if (!r2.ok) { flash('err', r2.data.error || 'Erro'); return; }
                        stockCloseModal();
                        flash('ok', 'Perda de ' + qty + ' un. registrada.');
                        setTimeout(function () { location.reload(); }, 500);
                        return;
                    }
                    if (stockModal.mode === 'editar') {
                        var r3 = await postJSON('/api/admin/products/' + encodeURIComponent(id), {
                            minStock: parseInt(document.getElementById('smMin').value, 10) || 0,
                            costPrice: parseFloat(document.getElementById('smCost').value.replace(',', '.')) || 0
                        });
                        if (!r3.ok) { flash('err', r3.data.error || 'Erro'); return; }
                        stockCloseModal();
                        flash('ok', 'Ajustes salvos.');
                        setTimeout(function () { location.reload(); }, 500);
                    }
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            function stockPrintReorder() {
                var t = document.getElementById('reorderTable');
                if (!t) { flash('err', 'Nada para imprimir.'); return; }
                var w = window.open('', '_blank', 'width=520,height=700');
                if (!w) { flash('err', 'Permita pop-ups para imprimir.'); return; }
                var linhas = '';
                t.querySelectorAll('tbody tr').forEach(function (tr) {
                    var c = tr.querySelectorAll('td');
                    linhas += '<tr><td>' + c[0].textContent + '</td><td>' + c[1].textContent
                        + '</td><td>' + c[2].textContent + '</td><td>' + c[3].textContent
                        + '</td><td><b>' + c[4].textContent + '</b></td></tr>';
                });
                w.document.write('<h2 style="font-family:sans-serif">Lista de reposicao</h2>'
                    + '<p style="font-family:sans-serif;font-size:12px">' + new Date().toLocaleDateString('pt-BR') + '</p>'
                    + '<table style="font-family:sans-serif;width:100%;border-collapse:collapse" border="1">'
                    + '<tr><th>Produto</th><th>Status</th><th>Saldo</th><th>Minimo</th><th>Comprar</th></tr>'
                    + linhas + '</table>');
                w.document.close();
                w.print();
            }

            async function stockToggleTracking(event) {
                event.preventDefault();
                var fd = new FormData(event.target);
                try {
                    var r = await postJSON('/api/admin/stock/tracking', {
                        productId: fd.get('productId'),
                        stock: parseInt(fd.get('stock'), 10) || 0,
                        minStock: parseInt(fd.get('minStock'), 10) || 0,
                        trackStock: true
                    });
                    if (!r.ok) { flash('err', r.data.error || 'Erro'); return; }
                    location.reload();
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            /* Abas Catalogo / Saldos. O catalogo e a acao mais comum do dono
               da loja, entao e a aba que abre por padrao. */
            function stockSetTab(qual) {
                var catalogo = qual === 'catalogo';
                var pc = document.getElementById('painelCatalogo');
                var ps = document.getElementById('painelSaldos');
                var tc = document.getElementById('tabCatalogo');
                var ts = document.getElementById('tabSaldos');
                if (!pc || !ps || !tc || !ts) return;
                pc.classList.toggle('hidden', !catalogo);
                ps.classList.toggle('hidden', catalogo);
                tc.className = 'px-4 py-2 text-body font-medium transition ' + (catalogo ? 'bg-accent text-white' : '');
                ts.className = 'px-4 py-2 text-body font-medium transition ' + (catalogo ? '' : 'bg-accent text-white');
                tc.setAttribute('aria-selected', catalogo ? 'true' : 'false');
                ts.setAttribute('aria-selected', catalogo ? 'false' : 'true');
                try { localStorage.setItem('estoqueAba', qual); } catch (e) {}
            }

            (function restauraAba() {
                var qual = 'catalogo';
                try { qual = localStorage.getItem('estoqueAba') || 'catalogo'; } catch (e) {}
                stockSetTab(qual);
            })();
        </script>`;
}
