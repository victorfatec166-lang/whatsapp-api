import { escapeHtml } from './html';
import { currency } from '../services/stats';
import { renderCatalog, type CatalogData } from './catalog';
import { kpi, cardVazio } from './ui/card';
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

    /*
     * A borda esquerda separa "precisa de acao" de "so informacao": sem ela os cinco cards sao
     * cinco caixas iguais e a pessoa le o numero de cada um para descobrir o que comprar. E o
     * zero, o caso mais grave, deixa de ser o unico numero sem cor.
     */

export function renderInventory(d: InventoryData): string {
    const body = d.rows
        .map((r) => {
            const status = stockStatus(r);
            const badge = STOCK_STATUS_BADGE[status];
            const label = STOCK_STATUS_LABEL[status];
            const semMinimo = needsMinStock(r);

            /*
             * Os tres controles recebem o nome do produto: o campo sozinho anunciava "campo de
             * texto, 12" ao leitor de tela, e o title dos botoes ajuda o mouse e nao ele. O
             * "menos" ainda e' ambiguo: em 40 produtos, "remover 1" de qual?
             */
            const estoqueDe = 'estoque de ' + r.name;
            const stockCell = r.trackStock
                ? `<div class="flex items-center gap-1">
                        <button type="button" data-stock-adj="-1" data-id="${escapeHtml(r.id)}" class="btn btn-ghost btn-icon font-bold" title="Remover 1" aria-label="Remover 1 de ${escapeHtml(estoqueDe)}">&minus;</button>
                        <input id="stock-${escapeHtml(r.id)}" type="number" value="${r.stock}" min="0" data-stock-input="${escapeHtml(r.id)}"
                            onchange="stockSet('${escapeHtml(r.id)}', this.value)"
                            aria-label="${escapeHtml(estoqueDe)}"
                            class="input w-16 px-2 py-1 text-center shrink-0">
                        <button type="button" data-stock-adj="1" data-id="${escapeHtml(r.id)}" class="btn btn-ghost btn-icon font-bold" title="Adicionar 1" aria-label="Adicionar 1 a ${escapeHtml(estoqueDe)}">+</button>
                    </div>`
                : '<span class="text-caption text-ink-3">sem controle</span>';

            const alertaMin = semMinimo
                ? '<span class="badge badge-warn badge-xs" title="Defina um minimo para receber alerta de reposicao">sem minimo</span>'
                : '';

            return `                    <tr data-stock-row data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name.toLowerCase())}" data-category="${escapeHtml(r.category.toLowerCase())}" data-status="${status}">
                        <td>
                            <div class="font-medium text-ink">${escapeHtml(r.name)}</div>
                            <div class="flex flex-wrap gap-1 mt-0.5">
                                <span class="badge badge-neutral badge-xs">${escapeHtml(r.category)}</span>
                                ${alertaMin}
                            </div>
                        </td>
                        <td class="text-accent-strong font-semibold whitespace-nowrap">${money(r.price)}</td>
                        <td>${stockCell}</td>
                        <td class="text-body text-ink-3">${r.trackStock ? r.minStock : '-'}</td>
                        <td><span class="badge ${badge} whitespace-nowrap">${label}</span></td>
                        <td class="whitespace-nowrap">${r.trackStock ? money(r.stock * r.price) : '-'}</td>
                        <td>
                            <div class="flex gap-1">
                                <button type="button" data-stock-entry="${escapeHtml(r.id)}" class="btn btn-ghost btn-icon" title="Registrar entrada">
                                    <i class="fa-solid fa-plus"></i>
                                </button>
                                <button type="button" data-stock-loss="${escapeHtml(r.id)}" class="btn btn-ghost btn-icon" title="Registrar perda (descarte ou validade)">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                                <button type="button" data-stock-edit="${escapeHtml(r.id)}" class="btn btn-ghost btn-icon" title="Ajustar minimo e custo">
                                    <i class="fa-solid fa-gear"></i>
                                </button>
                            </div>
                        </td>
                    </tr>`;
        })
        .join('\n');

    const movementRows = d.movements
        .map((m) => {
            const badge = MOVEMENT_BADGES[m.type] ?? 'badge-neutral';
            const label = MOVEMENT_LABELS[m.type] ?? m.type;
            const delta = movementDelta(m);
            const sign = delta > 0 ? '+' : delta < 0 ? '&minus;' : '=';
            const tone = delta > 0 ? 'text-accent-emerald' : delta < 0 ? 'text-accent-red' : 'text-ink-3';
            return `                    <tr>
                        <td class="text-caption text-ink-3 whitespace-nowrap">${escapeHtml(m.when)}</td>
                        <td class="font-medium">${escapeHtml(m.productName)}</td>
                        <td><span class="badge ${badge}">${label}</span></td>
                        <td class="font-semibold ${tone}">${sign}${Math.abs(delta || m.quantity)}</td>
                        <td class="text-caption text-ink-3">${escapeHtml(m.source)}</td>
                        <td class="text-caption text-ink-3 max-w-xs truncate" title="${escapeHtml(m.note ?? '')}">${escapeHtml(m.note ?? '')}</td>
                    </tr>`;
        })
        .join('\n');

    const reorderRows = d.reorder
        .map(
            (r) => `                    <tr>
                        <td class="font-medium">${escapeHtml(r.name)}</td>
                        <td><span class="badge ${r.stock <= 0 ? 'badge-danger' : 'badge-warn'}">${r.stock <= 0 ? 'Zerado' : 'Baixo'}</span></td>
                        <td class="text-center">${r.stock}</td>
                        <td class="text-center">${r.minStock}</td>
                        <td class="text-center font-bold text-accent-strong">${r.faltam > 0 ? r.faltam : '-'}</td>
                    </tr>`
        )
        .join('\n');

    const semAbertura = d.summary.missingMin;

    /*
     * "Saldos" era ambiguo numa tela que tambem mostra dinheiro: "saldo" e' a palavra do
     * dinheiro que sobrou, e a ambiguidade faz clicar no lugar errado achando que achou o
     * caixa. "Estoque" e' o nome que a coluna e a barra lateral ja usavam.
     */
    return `        <div class="inline-flex rounded-card border border-line overflow-hidden mb-5" role="tablist" aria-label="Produtos e estoque">
                <button type="button" id="tabCatalogo" onclick="stockSetTab('catalogo')" class="stock-tab flex items-center gap-2" aria-selected="true">
                    <i class="fa-solid fa-utensils"></i> Catalogo
                </button>
                <button type="button" id="tabEstoque" onclick="stockSetTab('estoque')" class="stock-tab flex items-center gap-2" aria-selected="false">
                    <i class="fa-solid fa-boxes-stacked"></i> Estoque
                </button>
            </div>

            <div id="painelCatalogo" class="hidden">
${renderCatalog(d.catalog)}
            </div>

            <div id="painelEstoque">
                <!--
                    Os cinco indicadores em grade, e nao empilhados.

                    Eles estavam soltos, um embaixo do outro,occupando cinco
                    faixas de tela inteira antes da lista de reposicao -- que e'
                    justamente a parte da aba que a pessoa abriu para ver. A ordem
                    tambem mudou: quem abre Estoque quer saber o que falta, entao
                    o que precisa de acao vem primeiro e o dinheiro por ultimo.
                -->
                <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
                    ${kpi('Estoque baixo', String(d.summary.low), 'no ou abaixo do minimo', 'warning', 'warning')}
                    ${kpi('Zerados', String(d.summary.empty), 'sem unidades para venda', 'danger', 'danger')}
                    ${kpi('Unidades em estoque', String(d.summary.units), 'soma de todos os itens')}
                    ${kpi('Itens controlados', String(d.summary.tracked), d.summary.untracked + ' sem controle')}
                    ${kpi('Capital em estoque', money(d.summary.costValue), 'valor de venda: ' + money(d.summary.value), 'success')}
                </div>


        ${
            d.reorder.length > 0 || semAbertura > 0
                ? `        <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4 items-start">
            <div class="xl:col-span-2 card overflow-hidden border-l-4 border-l-accent-orange">
                <div class="card-pad pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line">
                    <div>
                        <h3 class="text-title flex items-center gap-2"><i class="fa-solid fa-cart-shopping"></i> Lista de reposicao</h3>
                        <p class="text-caption text-ink-3">O que esta no ou abaixo do minimo</p>
                    </div>
                    <button type="button" onclick="stockPrintReorder()" class="btn btn-ghost btn-sm">
                        <i class="fa-solid fa-print"></i> Imprimir
                    </button>
                </div>
                ${
                    d.reorder.length === 0
                        ? cardVazio('Nada abaixo do minimo.', 'fa-cart-shopping')
                        : `<div class="table-wrap max-h-[calc(100vh-34rem)] overflow-y-auto">
                    <table id="reorderTable">
                        <thead class="bg-surface-2 text-ink-3">
                            <tr><th>Produto</th><th>Status</th><th>Estoque</th><th>Minimo</th><th>Comprar</th></tr>
                        </thead>
                        <tbody class="text-ink">
${reorderRows}
                        </tbody>
                    </table>
                </div>`
                }
            </div>
            <div class="card card-pad border-l-4 border-l-accent-red">
                <h3 class="text-title flex items-center gap-2"><i class="fa-solid fa-trash-can text-accent-red"></i> Perdas de hoje</h3>
                <p class="kpi-value text-accent-red mt-2">${d.waste.units} un.</p>
                <p class="kpi-sub">${d.waste.count} descarte(s) registrado(s)</p>
                <p class="text-body text-ink-2 mt-3">Impacto no custo: <strong class="text-ink">${money(d.waste.cost)}</strong></p>
                <p class="text-caption text-ink-3 mt-2">Salgados e doces vencem: registre o descarte para acompanhar o desperdicio.</p>
            </div>
        </div>`
                : ''
        }

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            <div class="xl:col-span-2 card overflow-hidden">
                <div class="card-pad pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line">
                    <div>
                        <h3 class="text-title flex items-center gap-2"><i class="fa-solid fa-boxes-stacked"></i> Estoque por produto</h3>
                        <p class="text-caption text-ink-3">Saldo, minimo e valor de cada item</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <!--
                            Mesma regra das outras telas: largura declarada e
                            shrink-0, senao o campo encolhe e o texto digitado
                            desaparece da caixa sem tecla nenhuma se perder.
                        -->
                        <input id="stockSearch" type="search" placeholder="Buscar produto..." oninput="stockFilter()"
                            class="input w-56 shrink-0" autocomplete="off">
                        <select id="stockCategory" onchange="stockFilter()" class="input w-auto shrink-0">
                            <option value="">Todas</option>
                            ${d.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                        </select>
                        <select id="stockStatusFilter" onchange="stockFilter()" class="input w-auto shrink-0">
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
                        ? cardVazio('Nenhum produto cadastrado.', 'fa-utensils')
                        : `<div class="table-wrap max-h-[calc(100vh-24rem)] overflow-y-auto">
                    <table>
                        <thead class="bg-surface-2 text-ink-3">
                            <tr>
                                <th>Produto</th><th>Preco</th><th>Estoque</th><th>Minimo</th><th>Status</th><th>Valor</th><th></th>
                            </tr>
                        </thead>
                        <tbody class="text-ink" id="stockBody">
${body}
                        </tbody>
                    </table>
                </div>
                <p id="stockEmptyMsg" class="hidden text-body text-ink-3 text-center py-8">Nenhum produto com esses filtros.</p>`
                }
            </div>

            <div class="card">
                <div class="card-pad pb-2">
                    <h3 class="text-title flex items-center gap-2"><i class="fa-solid fa-arrow-right-arrow-left"></i> Ultimos movimentos</h3>
                    <p class="text-caption text-ink-3">Entradas, perdas e ajustes recentes</p>
                </div>
                <div class="px-5 pb-5">
                    ${
                        d.movements.length === 0
                            ? cardVazio('Nenhum movimento registrado.', 'fa-right-left')
                            : `<div class="table-wrap max-h-[calc(100vh-28rem)] overflow-y-auto">
                    <table>
                        <thead class="text-ink-3">
                            <tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Qtd</th><th>Origem</th><th>Obs</th></tr>
                        </thead>
                        <tbody class="text-ink">
${movementRows}
                        </tbody>
                    </table>
                </div>`
                    }
                </div>
            </div>
        </div>

        ${
            semAbertura > 0
                ? `<div class="card card-pad mt-4 border-l-4 border-l-accent-orange">
            <p class="text-body text-accent-orange font-semibold flex items-center gap-2">
                <i class="fa-solid fa-triangle-exclamation"></i>
                ${semAbertura} item(ns) sem estoque minimo definido
            </p>
            <p class="text-caption text-ink-3 mt-1">Sem minimo, o item nunca entra na lista de reposicao nem gera alerta.</p>
        </div>`
                : ''
        }

        <details class="card card-pad mt-4">
            <summary class="cursor-pointer text-title flex items-center gap-2 select-none">
                <i class="fa-solid fa-gear text-accent"></i> Ativar controle de estoque em um produto
            </summary>
            <p class="text-body text-ink-2 mt-2 mb-3">
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
                    <button type="button" onclick="stockCloseModal()" class="btn btn-ghost btn-icon shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div id="stockModalBody" class="space-y-3"></div>
                <div class="flex gap-2 mt-5">
                    <button type="button" onclick="stockCloseModal()" class="btn btn-ghost flex-1">Cancelar</button>
                    <button type="button" onclick="stockSaveModal()" id="stockModalConfirm"
                        class="btn btn-primary flex-1 font-semibold">
                        Salvar
                    </button>
                </div>
            </div>
        </div>

        <!--
            Fecha o painel de Estoque.

            Este </div> faltou durante semanas e ninguem viu, porque o que vem
            depois -- a janela de entrada e o script -- nao precisa de espaco
            nenhum e ainda aparecia. O que sumia era o espaco em volta: com o
            painel sem fechar, o navegador jogava a janela e o script para
            dentro dele, e o <details> do formulario de controle de estoque
            acabava dentro da janela. A aba mostrava a lista de produtos sem a
            tabela.

            O sintoma aparece como "o conteudo desapareceu" e a causa e' uma tag
            sem fechador a duzentas linhas de distancia. Ver o teste de
           zincha de tags em check-ui.
        -->
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
                    + '<tr><th>Produto</th><th>Status</th><th>Estoque</th><th>Minimo</th><th>Comprar</th></tr>'
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
                var ps = document.getElementById('painelEstoque');
                var tc = document.getElementById('tabCatalogo');
                var ts = document.getElementById('tabEstoque');
                if (!pc || !ps || !tc || !ts) return;
                pc.classList.toggle('hidden', !catalogo);
                ps.classList.toggle('hidden', catalogo);
                /*
                 * Só o atributo muda aqui. A cor da aba vem do CSS, em
                 * .stock-tab[aria-selected='true'] -- e nao de trocar a classe do
                 * botao, que era o que segurava o text-white no tema escuro.
                 * Uma representacao do estado, e o CSS cuida do resto.
                 */
                tc.setAttribute('aria-selected', catalogo ? 'true' : 'false');
                ts.setAttribute('aria-selected', catalogo ? 'false' : 'true');
                try { localStorage.setItem('estoqueAba', qual); } catch (e) {}
            }

            (function restauraAba() {
                var qual = 'catalogo';
                try { qual = localStorage.getItem('estoqueAba') || 'catalogo'; } catch (e) {}
                stockSetTab(qual);
            })();

            /*
             * Delegacao dos botoes da tabela. Sem este bloco, entrada, perda,
             * ajustes e o "+"/"-" renderizavam e nao faziam nada: o data-* e'
             * escrito pelo HTML e ninguem lia. Delegacao e' o padrao do projeto
             * (ver catalog.ts), e e' por isso que o check:js via funcao orfa sem
             * acusar -- o vinculo e' pelo nome do atributo, nao por chamada.
             */
            document.addEventListener('click', function (ev) {
                var alvo = ev.target;
                if (!alvo || !alvo.closest) return;

                var entrada = alvo.closest('[data-stock-entry]');
                if (entrada) { stockEntry(entrada.dataset.stockEntry); return; }

                var perda = alvo.closest('[data-stock-loss]');
                if (perda) { stockLoss(perda.dataset.stockLoss); return; }

                var edita = alvo.closest('[data-stock-edit]');
                if (edita) { stockEdit(edita.dataset.stockEdit); return; }

                var soma = alvo.closest('[data-stock-adj]');
                if (soma) { stockAdjust(soma.dataset.id, parseInt(soma.dataset.stockAdj, 10) || 0); }
            });
        </script>`;
}
