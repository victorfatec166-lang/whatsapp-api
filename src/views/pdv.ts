import { escapeHtml } from './html';
import { currency } from '../services/stats';
import { stockStatus, STOCK_STATUS_LABEL, STOCK_STATUS_BADGE } from '../services/stock';
import { CATEGORIA_PADRAO } from '../services/categorias';

type PdvModifier = {
    id: string;
    name: string;
    price: number;
    prefix: string;
};

type PdvGroup = {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    required: boolean;
    options: PdvModifier[];
};

type PdvProduct = {
    id: string;
    name: string;
    sku: string | null;
    imageUrl: string | null;
    price: number;
    costPrice: number;
    category: string;
    description: string | null;
    isAvailable: boolean;
    isCombo: boolean;
    stock: number;
    minStock: number;
    trackStock: boolean;
    groups: PdvGroup[];
    comboComponents: Array<{ componentId: string; quantity: number }>;
};

type PdvData = {
    products: PdvProduct[];
    categories: string[];
    todaySales: number;
    totals: { total: number; available: number; paused: number; soldOut: number };
    holds: Array<{ id: string; label: string; count: number; total: number; when: string }>;
};

const PAYMENTS = [
    { id: 'pix', label: 'PIX' },
    { id: 'dinheiro', label: 'Dinheiro' },
    { id: 'cartao', label: 'Cartao' },
];

function money(n: number): string {
    return escapeHtml(currency(n));
}

/** Item vendavel precisa estar disponivel e (se controlado) ter saldo. */
function sellable(p: PdvProduct): boolean {
    return p.isAvailable && (!p.trackStock || p.stock > 0);
}

function stockPill(p: PdvProduct): string {
    if (!p.trackStock) return '';
    const status = stockStatus(p);
    if (status === 'ok') return `<span class="text-[11px] ink-3">${p.stock} un.</span>`;
    return `<span class="${STOCK_STATUS_BADGE[status]} text-[10px] px-1.5 py-0.5 rounded font-bold">${STOCK_STATUS_LABEL[status]}</span>`;
}

/** Margem = (preco - custo) / preco. Sem custo cadastrado, nao e confiavel. */
function marginPill(p: PdvProduct): string {
    if (!p.costPrice || p.costPrice <= 0 || p.price <= 0) return '';
    const margin = Math.round(((p.price - p.costPrice) / p.price) * 100);
    if (margin < 0) return '<span class="accent-red text-[10px]">prejuizo</span>';
    const tone = margin < 20 ? 'accent-orange' : 'accent-emerald';
    return `<span class="${tone} text-[10px]">${margin}% marg</span>`;
}

export function renderPdv(d: PdvData): string {
    // Precos ja vem em reais do banco; o JS do carrinho usa a mesma unidade.
    const catalog = JSON.stringify(
        d.products.map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            price: p.price,
            category: p.category,
            isCombo: p.isCombo,
            trackStock: p.trackStock,
            stock: p.stock,
            groups: p.groups,
            comboComponents: p.comboComponents,
        }))
    ).replace(/</g, '\\u003c');

    const paymentOptions = PAYMENTS.map(
        (p, i) => `<option value="${p.id}"${i === 0 ? ' selected' : ''}>${p.label}</option>`
    ).join('');

    /* ------------------------------------------------ Modo Vender: catalogo */
    const sellCards = d.products
        .map((p) => {
            const ok = sellable(p);
            const thumb = p.imageUrl
                ? `<img src="${escapeHtml(p.imageUrl)}" alt="" class="w-full h-16 object-cover rounded-md mb-1">`
                : '';
            return `                    <button type="button" data-pdv-product="${escapeHtml(p.id)}" data-sellable="${ok ? '1' : '0'}" data-sku="${escapeHtml(p.sku ?? '')}"
                        class="text-left surface-2 border line rounded-xl p-3 row-hover transition flex flex-col gap-1 relative ${ok ? '' : 'opacity-50 cursor-not-allowed'}"
                        ${ok ? '' : 'disabled'}>
                        ${thumb}
                        <span class="font-semibold ink text-sm leading-snug">${escapeHtml(p.name)}</span>
                        <span class="text-[11px] ink-3 flex gap-2">${escapeHtml(p.category)}${marginPill(p)}</span>
                        <span class="mt-auto flex items-end justify-between gap-2">
                            <span class="font-bold accent-amber-strong text-sm">${money(p.price)}</span>
                            ${stockPill(p)}
                        </span>
                        ${p.isAvailable ? '' : '<span class="absolute top-1.5 right-1.5 badge-red text-[10px] px-1.5 py-0.5 rounded font-bold">Pausado</span>'}
                    </button>`;
        })
        .join('\n');

    /*
     * As abas de categoria, com a contagem de produtos em cada uma.
     *
     * A contagem e' de produtos visiveis (disponiveis), e nao de produtos
     * cadastrados: um grupo que mostra "Salgados (3)" e traz 1 salgado
     * pausado faz a pessoa procurar algo que nao esta la. E o que a contagem
     * responde e' "estou no grupo certo", nao "quantas coisas eu tenho".
     *
     * A aba de "Todos" vem primeiro e nao tem contagem: ela nao e' um grupo, e'
     * a ausencia de filtro.
     */
    const porCategoria = new Map<string, number>();
    for (const p of d.products) {
        if (!sellable(p)) continue;
        const c = p.category || CATEGORIA_PADRAO;
        porCategoria.set(c, (porCategoria.get(c) ?? 0) + 1);
    }
    const categoriasPdv = [
        `<button type="button" data-pdv-categoria="" class="chip px-3 py-1.5 rounded-lg text-xs font-semibold transition pdv-cat" aria-pressed="true">Todos</button>`,
        ...d.categories
            .filter((c) => porCategoria.has(c))
            .map(
                (c) =>
                    `<button type="button" data-pdv-categoria="${escapeHtml(c)}" class="chip px-3 py-1.5 rounded-lg text-xs font-semibold transition pdv-cat" aria-pressed="false">` +
                    `${escapeHtml(c)} <span class="ink-3">${porCategoria.get(c)}</span></button>`
            ),
    ].join('\n                        ');

    return `        <div class="flex flex-wrap items-center gap-3 mb-5">
                <div class="surface border line rounded-xl px-4 py-2 text-sm">
                    <span class="ink-3">Vendas no balcao hoje:</span>
                    <span class="font-bold ink ml-1">${d.todaySales}</span>
                </div>
                <div class="surface border line rounded-xl px-4 py-2 text-sm">
                    <span class="ink-3">Itens no cardapio:</span>
                    <span class="font-bold ink ml-1">${d.totals.available}</span>
                    <span class="ink-3">/ ${d.totals.total}</span>
                </div>
                ${
                    d.totals.soldOut > 0
                        ? `<div class="surface border line rounded-xl px-4 py-2 text-sm">
                               <span class="ink-3">Zerados:</span>
                               <span class="font-bold accent-red ml-1">${d.totals.soldOut}</span>
                           </div>`
                        : ''
                }
                <span class="text-xs ink-3">Vendas do balcao entram no Kanban e nos relatorios como canal <strong>PDV</strong>.</span>
            </div>

            <!-- ================= MODO VENDER ================= -->
            <div id="modeVender">
                <div class="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
                    <div class="xl:col-span-2 surface border line rounded-2xl p-5 shadow-sm">
                        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                            <h3 class="font-bold ink flex items-center gap-2"><i class="fa-solid fa-cash-register accent-amber"></i> Catalogo</h3>
                            <div class="flex flex-wrap items-center gap-2">
                            <!--
                                Os dois campos precisam de largura declarada e de
                                flex-shrink-0.

                                Sem isso, o campo de busca e' um input dentro de um
                                flex container sem largura: quando a janela e'
                                estreita, ele encolhe e o texto rola para fora da
                                caixa. A pessoa digita "arro" e ve "arro" -&gt; as
                                letras que ela acabou de apertar nao aparecem mais
                                nenhuma, sem que nenhuma tecla tenha sido perdida.
                                Encolher input e' o comportamento padrao do navegador
                                para form control, diferente de texto, que tem
                                min-width:auto -- entao nao e' preciso o campo
                                "crescer", ele simplesmente cede espaco ate
                                desaparecer.

                                E o container ganha flex-wrap porque, com as duas
                                caixas em tamanho fixo, o que deve quebrar a linha
                                em vez de espremer o campo e' o layout.
                            -->
                            <input id="pdvScan" type="text" placeholder="Codigo do produto..." onkeydown="if(event.key==='Enter'){event.preventDefault();if(!pdvScanCode(this.value)){flash('err','Codigo nao encontrado.');}this.value='';}" class="px-3 py-1.5 text-sm border line-in rounded-lg w-36 shrink-0" autocomplete="off">
                            <input id="pdvSearch" type="search" placeholder="Buscar produto..." oninput="pdvFilter()"
                                class="px-3 py-1.5 text-sm border line-in rounded-lg w-64 max-w-full shrink-0" autocomplete="off">
                        </div>
                        </div>

                        <!--
                            A categoria vira aba, e nao <select>.

                            A pergunta do balcao nao e' "qual categoria tem o item que
                            eu procuro": e' "que grupo de coisa o cliente esta
                            pedindo agora". Com um dropdown, essa pergunta custa
                            dois cliques e um pouco de leitura da lista -- e a lista
                            esta embaixo, dentro do catalogo, competing com 40
                            cartoes de produto. A aba responde em um clique, mostra
                            quantos itens tem em cada grupo (para a pessoa saber se
                            esta no lugar certo sem precisar rolar), e tem a largura
                            de um dedo.

                            E a aba cobre um caso que o dropdown nao cobria: a
                            categoria vazia. Sem produto em "Bebidas", ela nao
                            aparece -- e assim o grupo nao ocupa espaco para dizer
                            que esta vazio. Categoria so entra na barra quando tem
                            algo dentro.

                            O valor viaja em data-categoria, nao em id="pdvCategory":
                            o id era o que o filtro lia, e o id precisa existir uma
                            vez so. Ver pdvFiltroCategoria.
                        -->
                        <div id="pdvCategorias" class="flex flex-wrap gap-1.5 mb-4" role="tablist" aria-label="Categorias">
${categoriasPdv}
                        </div>

                        ${
                            d.products.length === 0
                                ? '<p class="text-sm ink-3 text-center py-10">Nenhum produto cadastrado. Use a aba <strong>Produtos</strong> ao lado.</p>'
                                : `<div id="pdvGrid" class="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[32rem] overflow-y-auto">
${sellCards}
                    </div>`
                        }
                    </div>

                    <div class="surface border line rounded-2xl p-5 shadow-sm sticky top-4">
                        <h3 class="font-bold ink mb-4 flex items-center gap-2"><i class="fa-solid fa-cart-shopping accent-amber"></i> Venda atual</h3>

                        <div id="pdvCart" class="space-y-2 min-h-[8rem] max-h-[18rem] overflow-y-auto">
                            <p class="text-sm ink-3 text-center py-8">Toque em um produto para adicionar.</p>
                        </div>

                        <div class="mt-4 pt-3 border-t line space-y-2">
                            <div class="flex justify-between text-sm">
                                <span class="ink-3">Itens</span>
                                <span id="pdvCount" class="font-medium ink">0</span>
                            </div>
                            <div class="flex justify-between text-sm">
                                <span class="ink-3">Subtotal</span>
                                <span id="pdvSubtotal" class="font-medium ink">R$ 0,00</span>
                            </div>
                            <div class="flex justify-between text-sm">
                                <span class="ink-3">Desconto</span>
                                <span id="pdvDiscountLabel" class="accent-red">- R$ 0,00</span>
                            </div>
                            <div class="flex justify-between text-sm">
                                <span class="ink-3">Gorjeta</span>
                                <span id="pdvTipLabel" class="accent-emerald">+ R$ 0,00</span>
                            </div>
                            <div class="flex justify-between text-lg font-bold pt-1 border-t line">
                                <span class="ink">Total</span>
                                <span id="pdvTotal" class="accent-amber-strong">R$ 0,00</span>
                            </div>
                        </div>

                        <div class="mt-3 space-y-2">
                            <div>
                                <label class="label" for="pdvDiscount">Desconto</label>
                                <div class="flex gap-1.5" role="group" aria-label="Atalhos de desconto">
                                    ${['0', '5', '10', '15']
                                        .map(
                                            (p) =>
                                                `<button type="button" onclick="pdvSetPercent('discount', ${p})" class="pdv-pct flex-1 px-2 py-1.5 rounded-lg badge-slate text-xs font-semibold transition" aria-label="Desconto de ${p === '0' ? 'zero por cento' : p + ' por cento'}">${p === '0' ? 'Sem' : p + '%'}</button>`
                                        )
                                        .join('')}
                                </div>
                                <input id="pdvDiscount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00"
                                    oninput="pdvRender()" class="mt-1.5 input">
                            </div>
                            <div>
                                <label class="label" for="pdvTip">Gorjeta</label>
                                <div class="flex gap-1.5" role="group" aria-label="Atalhos de gorjeta">
                                    ${['0', '5', '10']
                                        .map(
                                            (p) =>
                                                `<button type="button" onclick="pdvSetPercent('tip', ${p})" class="pdv-pct flex-1 px-2 py-1.5 rounded-lg badge-slate text-xs font-semibold transition" aria-label="Gorjeta de ${p === '0' ? 'zero por cento' : p + ' por cento'}">${p === '0' ? 'Sem' : p + '%'}</button>`
                                        )
                                        .join('')}
                                </div>
                                <input id="pdvTip" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00"
                                    oninput="pdvRender()" class="mt-1.5 input">
                            </div>
                            <div>
                                <label class="label" for="pdvNotes">Observacao</label>
                                <textarea id="pdvNotes" rows="2" placeholder="Sem cebola, bem passado, entregar depois das 19h..."
                                    class="input"></textarea>
                            </div>
                        </div>

                        <div class="mt-4 space-y-3">
                            <div>
                                <label class="label" for="pdvCustomer">Cliente (opcional)</label>
                                <input id="pdvCustomer" type="text" placeholder="Nome de quem levou" class="input">
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label class="label" for="pdvPayment">Pagamento</label>
                                    <select id="pdvPayment" class="input">${paymentOptions}</select>
                                </div>
                                <div>
                                    <label class="label" for="pdvPaid">Recebido (R$)</label>
                                    <input id="pdvPaid" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00"
                                        class="input">
                                </div>
                            </div>
                            <p id="pdvChange" class="text-sm ink-3">Informe o valor recebido para calcular o troco.</p>
                        </div>

                        <button type="button" onclick="pdvCheckout()" id="pdvFinish"
                            class="btn btn-primary mt-4 w-full disabled:opacity-40 text-sm py-2.5 font-semibold transition flex items-center justify-center gap-2">
                            <i class="fa-solid fa-check"></i> Finalizar venda
                        </button>
                        <div class="mt-4 flex gap-2">
                            <button type="button" onclick="pdvHold()" id="pdvHoldBtn"
                                class="flex-1 badge-amber text-sm py-2 rounded-lg font-medium transition flex items-center justify-center gap-2">
                                <i class="fa-solid fa-pause"></i> Suspender
                            </button>
                            <button type="button" onclick="pdvClear()" class="flex-1 badge-slate text-sm py-2 rounded-lg font-medium transition">
                                Limpar
                            </button>
                        </div>

                        <div id="pdvDone" class="hidden mt-4 p-3 rounded-xl badge-emerald text-sm"></div>
                    </div>
                </div>

                <!-- Modal de modificadores -->
                <div id="modModal" class="hidden fixed inset-0 z-50 items-center justify-center p-4" style="background: rgba(0,0,0,0.55)">
                    <div class="surface border line rounded-2xl shadow-lg w-full max-w-md max-h-[85vh] overflow-y-auto p-5">
                        <div class="flex items-start justify-between gap-3 mb-3">
                            <div>
                                <h3 id="modTitle" class="font-bold ink"></h3>
                                <p id="modPrice" class="text-sm accent-amber-strong"></p>
                            </div>
                            <button type="button" onclick="pdvModClose()" class="w-8 h-8 rounded-lg badge-slate flex items-center justify-center shrink-0">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div id="modBody" class="space-y-4"></div>
                        <div class="flex gap-2 mt-5">
                            <button type="button" onclick="pdvModClose()" class="flex-1 badge-slate text-sm py-2 rounded-lg font-medium">Cancelar</button>
                            <button type="button" onclick="pdvModConfirm()" id="modConfirm"
                                class="btn btn-primary flex-1 text-sm py-2 font-semibold">
                                Adicionar
                            </button>
                        </div>
                    </div>
                </div>

                        <script>
            var PDV_CATALOG = ${catalog};
            var pdvCart = {};
            var modOpen = null;   // { productId, picked: { groupId: [optionId] } }
            var modKey = 0;      // separa linhas com modificadores diferentes

            function pdvMoney(v) {
                return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            }

            function esc(v) {
                return String(v === null || v === undefined ? '' : v)
                    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
            }

            function pdvProduct(id) {
                return PDV_CATALOG.filter(function (x) { return x.id === id; })[0];
            }

            /* --------- modificadores --------- */

            function pdvModOpen(productId) {
                var p = pdvProduct(productId);
                if (!p) return;
                if (!p.groups || p.groups.length === 0) { pdvAdd(productId, {}); return; }

                modOpen = { productId: productId, picked: {} };
                p.groups.forEach(function (g) { modOpen.picked[g.id] = []; });

                document.getElementById('modTitle').textContent = p.name;
                document.getElementById('modPrice').textContent = pdvMoney(p.price);

                var html = '';
                p.groups.forEach(function (g) {
                    var rule = g.maxSelect <= 1 ? 'Escolha 1' : 'Ate ' + g.maxSelect;
                    html += '<div><div class="flex items-center justify-between mb-1">'
                        + '<span class="text-sm font-semibold ink">' + esc(g.name) + (g.required ? ' *' : '') + '</span>'
                        + '<span class="text-[11px] ink-3">' + rule + '</span></div>'
                        + '<div class="space-y-1">';
                    g.options.forEach(function (o) {
                        var price = o.price > 0 ? ' + ' + pdvMoney(o.price) : '';
                        /*
                         * O campo do modificador fica DENTRO do rotulo, e nao
                         * apontado por "for". Envolver a caixa de marcacao e o
                         * texto do item e o que faz clicar no "+ bacon" marcar a
                         * caixa -- e o "for" nao chega a isso, porque a lista de
                         * modificadores e' montada aqui e o id teria de ser
                         * unico por item e por janela.
                         */
                        html += '<label class="flex items-center gap-2 p-2 rounded-lg sunken cursor-pointer hover:brightness-95">'
                            + '<input type="' + (g.maxSelect <= 1 ? 'radio' : 'checkbox') + '" name="mod-' + esc(g.id) + '" value="' + esc(o.id) + '" data-group="' + esc(g.id) + '" onchange="pdvModPick(this)" class="accent-amber-600">'
                            + '<span class="text-sm ink">' + esc((o.prefix ? o.prefix + ' ' : '') + o.name) + '</span>'
                            + (price ? '<span class="ml-auto text-xs accent-amber-strong">' + price + '</span>' : '')
                            + '</label>';
                    });
                    html += '</div></div>';
                });
                if (p.isCombo) {
                    html += '<p class="text-[11px] ink-3">Combo: o estoque e baixado nos componentes.</p>';
                }

                document.getElementById('modBody').innerHTML = html;
                var modal = document.getElementById('modModal');
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }

            function pdvModPick(input) {
                if (!modOpen) return;
                var gid = input.getAttribute('data-group');
                var group = pdvProduct(modOpen.productId).groups.filter(function (g) { return g.id === gid; })[0];
                if (!group) return;

                if (group.maxSelect <= 1) {
                    modOpen.picked[gid] = input.checked ? [input.value] : [];
                } else {
                    var list = modOpen.picked[gid];
                    if (input.checked) {
                        if (list.length >= group.maxSelect) {
                            input.checked = false;
                            flash('err', 'Maximo de ' + group.maxSelect + ' em ' + group.name + '.');
                            return;
                        }
                        list.push(input.value);
                    } else {
                        modOpen.picked[gid] = list.filter(function (v) { return v !== input.value; });
                    }
                }
                pdvModTotal();
            }

            function pdvModTotal() {
                if (!modOpen) return;
                var p = pdvProduct(modOpen.productId);
                var extra = 0;
                p.groups.forEach(function (g) {
                    (modOpen.picked[g.id] || []).forEach(function (oid) {
                        var o = g.options.filter(function (x) { return x.id === oid; })[0];
                        if (o) extra += o.price;
                    });
                });
                document.getElementById('modConfirm').textContent = 'Adicionar ' + pdvMoney(p.price + extra);
            }

            function pdvModClose() {
                modOpen = null;
                var modal = document.getElementById('modModal');
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }

            function pdvModConfirm() {
                if (!modOpen) return;
                var p = pdvProduct(modOpen.productId);
                var missing = null;
                p.groups.forEach(function (g) {
                    if (missing) return;
                    if (g.required && (modOpen.picked[g.id] || []).length < Math.max(1, g.minSelect)) missing = g.name;
                });
                if (missing) { flash('err', 'Escolha obrigatoria: ' + missing); return; }

                var picked = modOpen.picked;
                var pid = modOpen.productId;
                pdvModClose();
                pdvAdd(pid, picked);
            }


            function pdvFilter() {
                var q = (document.getElementById('pdvSearch').value || '').toLowerCase();
                var cat = pdvCategoriaAtual().toLowerCase();
                document.querySelectorAll('#pdvGrid [data-pdv-product]').forEach(function (card) {
                    var p = PDV_CATALOG.filter(function (x) { return x.id === card.dataset.pdvProduct; })[0];
                    if (!p) return;
                    var ok = p.name.toLowerCase().indexOf(q) !== -1 && (!cat || p.category.toLowerCase() === cat);
                    card.style.display = ok ? '' : 'none';
                });
            }

            /** A categoria escolhida, ou string vazia para "Todos". */
            function pdvCategoriaAtual() {
                var botao = document.querySelector('#pdvCategorias .pdv-cat[aria-pressed="true"]');
                return botao ? botao.dataset.pdvCategoria : '';
            }

            /*
             * Trocar de categoria e um clique, entao o filtro tem que estar pronto
             * antes do clique -- por isso o estado mora no atributo do botao, e nao
             * em variavel. Um botao recem-criado ja entra no estado certo sem
             * ninguem precisar lembrar de sincronizar.
             */
            document.addEventListener('click', function (e) {
                var botao = e.target.closest('#pdvCategorias .pdv-cat');
                if (!botao) return;
                document.querySelectorAll('#pdvCategorias .pdv-cat').forEach(function (b) {
                    b.setAttribute('aria-pressed', b === botao ? 'true' : 'false');
                });
                pdvFilter();
            });

            function pdvModKey(id, picked) {
                var groups = (picked && Object.keys(picked).length)
                    ? Object.keys(picked).sort().map(function (g) { return g + ':' + [].concat(picked[g] || []).sort().join('+'); }).join('|')
                    : '';
                return id + '#' + groups;
            }

            /** Rotulo e acrescimo de uma linha (usado no carrinho e no total). */
            function pdvLineInfo(key) {
                var parts = key.split('#');
                var p = pdvProduct(parts[0]);
                if (!p) return null;
                var labels = [];
                var extra = 0;
                if (parts[1]) {
                    parts[1].split('|').forEach(function (chunk) {
                        var bits = chunk.split(':');
                        var gid = bits[0];
                        var ids = bits[1] ? bits[1].split('+') : [];
                        var g = (p.groups || []).filter(function (x) { return x.id === gid; })[0];
                        if (!g) return;
                        ids.forEach(function (oid) {
                            var o = g.options.filter(function (x) { return x.id === oid; })[0];
                            if (o) { labels.push((o.prefix ? o.prefix + ' ' : '') + o.name); extra += o.price; }
                        });
                    });
                }
                return { product: p, labels: labels, extra: extra, unit: p.price + extra, name: p.name };
            }

            /** Traduz o carrinho para o formato { id, qty, groups } esperado pelo servidor. */
            function pdvPayload() {
                return Object.keys(pdvCart).map(function (key) {
                    var info = pdvLineInfo(key);
                    if (!info) return null;
                    var groups = {};
                    if (key.indexOf('#') !== -1) {
                        key.split('#')[1].split('|').forEach(function (chunk) {
                            var bits = chunk.split(':');
                            groups[bits[0]] = bits[1] ? bits[1].split('+') : [];
                        });
                    }
                    return { id: info.product.id, qty: pdvCart[key], groups: groups };
                }).filter(Boolean);
            }

            function pdvSubtotal() {
                var total = 0;
                Object.keys(pdvCart).forEach(function (key) {
                    var info = pdvLineInfo(key);
                    if (info) total += info.unit * pdvCart[key];
                });
                return total;
            }

            function pdvAdd(id, picked) {
                var p = pdvProduct(id);
                if (!p) return;
                var key = pdvModKey(id, picked);
                pdvCart[key] = (pdvCart[key] || 0) + 1;
                pdvRender();
            }

            function pdvSet(key, qty) {
                if (qty <= 0) { delete pdvCart[key]; } else { pdvCart[key] = Math.min(99, qty); }
                pdvRender();
            }

            function pdvRemove(key) {
                delete pdvCart[key];
                pdvRender();
            }

            function pdvSetPercent(field, percent) {
                var sub = pdvSubtotal();
                var value = sub * (percent / 100);
                var input = document.getElementById(field === 'discount' ? 'pdvDiscount' : 'pdvTip');
                input.value = percent === 0 ? '' : value.toFixed(2);
                document.querySelectorAll('.pdv-pct').forEach(function (b) {
                    b.classList.remove('btn-primary');
                });
                pdvRender();
            }

            function pdvRender() {
                var box = document.getElementById('pdvCart');
                var keys = Object.keys(pdvCart);
                if (keys.length === 0) {
                    box.innerHTML = '<p class="text-sm ink-3 text-center py-8">Toque em um produto para adicionar.</p>';
                } else {
                    var html = '';
                    keys.forEach(function (key) {
                        var info = pdvLineInfo(key);
                        if (!info) return;
                        var line = info.unit * pdvCart[key];
                        var title = info.name + (info.labels.length ? ' (' + info.labels.join(', ') + ')' : '');
                        html += '<div class="p-2 rounded-lg sunken">'
                            + '<div class="flex items-center gap-2">'
                            + '<div class="min-w-0 flex-1">'
                            + '<div class="text-sm font-medium ink truncate" title="' + esc(title) + '">' + esc(title) + '</div>'
                            + '<div class="text-xs ink-3">' + pdvMoney(info.unit) + ' cada &middot; <b>' + pdvMoney(line) + '</b></div>'
                            + '</div>'
                            + '<div class="flex items-center gap-1 shrink-0">'
                            + '<button type="button" data-cart-dec="' + esc(key) + '" class="w-6 h-6 rounded badge-slate text-xs font-bold">-</button>'
                            + '<span class="w-5 text-center text-sm font-semibold ink">' + pdvCart[key] + '</span>'
                            + '<button type="button" data-cart-inc="' + esc(key) + '" class="w-6 h-6 rounded badge-slate text-xs font-bold">+</button>'
                            + '<button type="button" data-cart-del="' + esc(key) + '" title="Remover" class="w-6 h-6 rounded badge-red text-xs font-bold">x</button>'
                            + '</div></div></div>';
                    });
                    box.innerHTML = html;
                }

                var count = 0;
                keys.forEach(function (key) { count += pdvCart[key]; });
                var total = pdvSubtotal();

                var discount = Math.min(total, Math.max(0, parseFloat(document.getElementById('pdvDiscount').value) || 0));
                var tip = Math.max(0, parseFloat(document.getElementById('pdvTip').value) || 0);
                var grand = total - discount + tip;

                document.getElementById('pdvCount').textContent = count;
                document.getElementById('pdvSubtotal').textContent = pdvMoney(total);
                document.getElementById('pdvDiscountLabel').textContent = '- ' + pdvMoney(discount);
                document.getElementById('pdvTipLabel').textContent = '+ ' + pdvMoney(tip);
                document.getElementById('pdvTotal').textContent = pdvMoney(grand);
                document.getElementById('pdvFinish').disabled = count === 0;

                var holdBtn = document.getElementById('pdvHoldBtn');
                if (holdBtn) holdBtn.disabled = count === 0;

                pdvChange();
            }

            function pdvChange() {
                var total = pdvSubtotal();
                var discount = Math.min(total, Math.max(0, parseFloat(document.getElementById('pdvDiscount').value) || 0));
                var tip = Math.max(0, parseFloat(document.getElementById('pdvTip').value) || 0);
                var grand = total - discount + tip;
                var out = document.getElementById('pdvChange');
                var paid = parseFloat(document.getElementById('pdvPaid').value);
                if (document.getElementById('pdvPayment').value === 'dinheiro' && isFinite(paid) && paid > 0) {
                    var diff = paid - grand;
                    out.textContent = diff >= 0 ? 'Troco: ' + pdvMoney(diff) : 'Faltam ' + pdvMoney(Math.abs(diff));
                    out.className = diff >= 0 ? 'text-sm font-semibold accent-emerald' : 'text-sm font-semibold accent-red';
                } else {
                    out.textContent = 'Informe o valor recebido para calcular o troco.';
                    out.className = 'text-sm ink-3';
                }
            }

            function pdvClear() {
                pdvCart = {};
                ['pdvPaid', 'pdvCustomer', 'pdvDiscount', 'pdvTip', 'pdvNotes'].forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el) el.value = '';
                });
                document.querySelectorAll('.pdv-pct').forEach(function (b) {
                    b.classList.remove('btn-primary');
                });
                var done = document.getElementById('pdvDone');
                if (done) done.classList.add('hidden');
                pdvRender();
            }

            async function pdvCheckout() {
                var items = pdvPayload();
                if (items.length === 0) return;
                try {
                    var r = await postJSON('/api/admin/pdv/orders', {
                        items: items,
                        customer: document.getElementById('pdvCustomer').value || '',
                        paymentMethod: document.getElementById('pdvPayment').value,
                        discount: parseFloat(document.getElementById('pdvDiscount').value) || 0,
                        tip: parseFloat(document.getElementById('pdvTip').value) || 0,
                        notes: document.getElementById('pdvNotes').value || ''
                    });
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao finalizar venda'); return; }

                    var box = document.getElementById('pdvDone');
                    box.classList.remove('hidden');
                    var detail = r.data.count + ' item(ns)';
                    if (r.data.discount && parseFloat(r.data.discount.replace(/[^0-9,.-]/g, '').replace(',', '.')) > 0) {
                        detail += ' &middot; desconto ' + esc(r.data.discount);
                    }
                    if (r.data.tip && parseFloat(r.data.tip.replace(/[^0-9,.-]/g, '').replace(',', '.')) > 0) {
                        detail += ' &middot; gorjeta ' + esc(r.data.tip);
                    }
                    box.innerHTML = '<div class="font-semibold">Venda #' + esc(r.data.id.slice(0, 8)) + ' registrada</div>'
                        + '<div class="mt-1">' + detail + '</div>'
                        + '<div class="mt-1 font-bold">' + esc(r.data.total) + ' &middot; ' + esc(r.data.paymentLabel) + '</div>';
                    pdvClear();
                    setTimeout(function () { location.reload(); }, 2500);
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            async function pdvHold() {
                var keys = Object.keys(pdvCart);
                if (keys.length === 0) return;
                var label = document.getElementById('pdvCustomer').value || '';
                try {
                    var r = await postJSON('/api/admin/pdv/hold', { items: pdvPayload(), label: label });
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao suspender'); return; }
                    flash('ok', 'Venda suspensa.');
                    pdvClear();
                    setTimeout(function () { location.reload(); }, 800);
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            async function pdvRestore(id) {
                try {
                    var res = await fetch('/api/admin/pdv/holds');
                    var holds = await res.json();
                    var found = holds.filter(function (h) { return h.id === id; })[0];
                    if (!found) { flash('err', 'Venda nao encontrada'); return; }
                    pdvCart = {};
                    found.items.forEach(function (i) {
                        var key = pdvModKey(i.id, i.groups);
                        pdvCart[key] = (pdvCart[key] || 0) + i.qty;
                    });
                    await postJSON('/api/admin/pdv/holds/' + encodeURIComponent(id) + '/delete', {});
                    document.getElementById('pdvCustomer').value = found.label === 'Sem nome' ? '' : found.label;
                    pdvRender();
                    flash('ok', 'Venda restaurada.');
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            function pdvDropHold(id) {
                confirmThen(
                    'A venda suspensa e descartada na hora. O carrinho nao volta, e o cliente precisa refazer.',
                    async function () {
                        await postJSON('/api/admin/pdv/holds/' + encodeURIComponent(id) + '/delete', {});
                        location.reload();
                    },
                    { titulo: 'Descartar venda suspensa', confirmar: 'Descartar' }
                );
            }




            /* Leitura de codigo de barras: o leitor digita o SKU e envia Enter. */
            function pdvScanCode(code) {
                var sku = String(code || '').trim();
                if (!sku) return false;
                var found = PDV_CATALOG.filter(function (x) { return (x.sku || '').toLowerCase() === sku.toLowerCase(); })[0];
                if (!found) return false;
                pdvModOpen(found.id);
                return true;
            }

            /* --------------------------------------------------------- bindings */

            /*
             * Um clique so no catalogo, e um nos botoes do carrinho.
             *
             * Delegacao no document, e nao um onclick em cada card. O card e'
             * redesenhado a cada filtro, a cada busca e a cada item novo: com
             * onclick=inline, ligar cada card a cada redesenho e' trabalho que se
             * perde na primeira troca, e o sintoma e' o botao que "as vezes"
             * funciona. Com delegacao, o card pode ser reescrito a vontade.
             *
             * ESTE BLOCO SUMIU uma vez e o PDV inteiro ficou inerte.
             *
             * O commit 9931723 (Faturamento numa aba so) reescreveu esta tela e,
             * no meio da reescrita, levou junto o listener de delegacao inteiro:
             * clicar num produto nao acrescentava nada, o "+" e o "-" do
             * carrinho nao faziam nada, e o calculo do troco nao era recalculado
             * ao digitar o valor recebido. Nenhum aviso apareceu: o tsc passa, o
             * check:js so olha sintaxe, o check:ui so olha rotulos, e a tela
             * abre perfeita -- so que morta. E o botao de finalizar venda
             * nasce desabilitado, entao a venda nem tinha como comecar.
             *
             * A licao que fica registrada: botao sem handler e' um erro que
             * nenhuma checagem de texto pega. Ele so aparece quando alguem
             * clica. Por isso o check:js agora tambem exige que todo atributo
             * data-* entregue no HTML seja lido por algum script da pagina.
             */
            document.addEventListener('click', function (e) {
                var card = e.target.closest('[data-pdv-product]');
                if (card) {
                    // sellable = 0 quando o produto esta pausado ou sem saldo
                    // controlado. Clicar num cartao pausado nao pode acrescentar
                    // nada: a regra e' do servidor, e o servidor recusaria
                    // depois, quando a pessoa ja acreditava ter vendido.
                    if (card.dataset.sellable === '1') pdvModOpen(card.dataset.pdvProduct);
                    return;
                }

                var inc = e.target.closest('[data-cart-inc]');
                if (inc) { pdvSet(inc.dataset.cartInc, (pdvCart[inc.dataset.cartInc] || 0) + 1); return; }

                var dec = e.target.closest('[data-cart-dec]');
                if (dec) { pdvSet(dec.dataset.cartDec, (pdvCart[dec.dataset.cartDec] || 1) - 1); return; }

                var del = e.target.closest('[data-cart-del]');
                if (del) { pdvRemove(del.dataset.cartDel); return; }
            });

            /*
             * Troco recalculado enquanto a pessoa digita.
             *
             * Sem estes dois ouvintes, o troco so era recalculado quando o
             * carrinho era redesenhado -- ou seja, quando o total mudava. Digitar
             * "50" no campo Recebido nao mostrava troco nenhum, e a frase de
             * ajuda continuava la embaixo como se fosse a unica informacao
             * possivel.
             *
             * "change" em vez de "input" na forma de pagamento e' o suficiente:
             * ela e' uma escolha, nao uma digitacao. No valor recebido e' "input",
             * porque e' a digitacao que muda a resposta a cada tecla.
             */
            var paidInput = document.getElementById('pdvPaid');
            if (paidInput) paidInput.addEventListener('input', pdvChange);
            var paySelect = document.getElementById('pdvPayment');
            if (paySelect) paySelect.addEventListener('change', pdvChange);

            // A primeira pintura vem do HTML do servidor, mas o estado inicial
            // tambem passa pelo mesmo codigo que desenha qualquer outro -- senao
            // a tela inicial e a pos-clique podem divergir em um detalhe.
            pdvRender();

            </script>`;
}

export const PDV_PAYMENT_LABELS: Record<string, string> = {
    pix: 'PIX',
    dinheiro: 'Dinheiro',
    cartao: 'Cartao',
};
