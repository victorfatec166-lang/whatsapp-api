import { escapeHtml } from './html';
import { kpi, faixaKpi, cardVazio } from './ui/card';
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
    if (status === 'ok') return `<span class="text-caption text-ink-3">${p.stock} un.</span>`;
    return `<span class="${STOCK_STATUS_BADGE[status]} badge badge-xs font-bold">${STOCK_STATUS_LABEL[status]}</span>`;
}

/** Margem = (preco - custo) / preco. Sem custo cadastrado, nao e confiavel. */
function marginPill(p: PdvProduct): string {
    if (!p.costPrice || p.costPrice <= 0 || p.price <= 0) return '';
    const margin = Math.round(((p.price - p.costPrice) / p.price) * 100);
    if (margin < 0) return '<span class="text-accent-red">prejuizo</span>';
    const tone = margin < 20 ? 'accent-orange' : 'accent-emerald';
    return `<span class="${tone} text-caption">${margin}% marg</span>`;
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
                        class="text-left bg-surface-2 border border-line rounded-card p-3 row-hover transition flex flex-col gap-1 relative ${ok ? '' : 'opacity-50 cursor-not-allowed'}"
                        ${ok ? '' : 'disabled'}>
                        ${thumb}
                        <span class="font-semibold text-body text-ink leading-snug">${escapeHtml(p.name)}</span>
                        <span class="text-caption text-ink-3 flex gap-2">${escapeHtml(p.category)}${marginPill(p)}</span>
                        <span class="mt-auto flex items-end justify-between gap-2">
                            <span class="font-bold text-accent-strong text-body">${money(p.price)}</span>
                            ${stockPill(p)}
                        </span>
                        ${p.isAvailable ? '' : '<span class="absolute top-1.5 right-1.5 badge badge-danger badge-xs font-bold">Pausado</span>'}
                    </button>`;
        })
        .join('\n');

    /*
     * A contagem e' de produtos visiveis, nao cadastrados: um grupo que mostra "Salgados (3)" e
     * traz 1 salgado pausado faz a pessoa procurar algo que nao esta la. "Todos" vem primeiro e
     * sem contagem: nao e' um grupo, e' a ausencia de filtro.
     */
    const porCategoria = new Map<string, number>();
    for (const p of d.products) {
        if (!sellable(p)) continue;
        const c = p.category || CATEGORIA_PADRAO;
        porCategoria.set(c, (porCategoria.get(c) ?? 0) + 1);
    }
    const categoriasPdv = [
        `<button type="button" data-pdv-categoria="" class="chip pdv-cat" aria-pressed="true">Todos</button>`,
        ...d.categories
            .filter((c) => porCategoria.has(c))
            .map(
                (c) =>
                    `<button type="button" data-pdv-categoria="${escapeHtml(c)}" class="chip pdv-cat" aria-pressed="false">` +
                    `${escapeHtml(c)} <span class="text-ink-3">${porCategoria.get(c)}</span></button>`
            ),
    ].join('\n                        ');

    /*
     * Mesma faixa de KPI do resto do painel. Antes eram tres capsulas soltas mais uma frase de
     * explicacao, o que dava a impressao de quatro coisas independentes; a frase virou legenda do
     * primeiro numero, onde informa em vez de ocupar uma linha.
     */
    return `${faixaKpi([
        kpi('Vendas no balcao hoje', String(d.todaySales), 'entradas pelo PDV', 'accent'),
        kpi('Itens no cardapio', `${d.totals.available}`, `de ${d.totals.total} cadastrados`),
        kpi('Zerados', String(d.totals.soldOut), d.totals.soldOut > 0 ? 'precisam de reposicao' : 'nenhum item travado', d.totals.soldOut > 0 ? 'danger' : 'success', d.totals.soldOut > 0 ? 'danger' : undefined),
    ])}

            <!-- ================= VENDAS SUSPENSAS ================= -->
            ${d.holds.length > 0 ? `
            <div class="card mt-4">
                <div class="card-pad pb-3 border-b border-line flex items-center gap-2">
                    <h3 class="text-title flex items-center gap-2"><i class="fa-solid fa-pause text-accent-orange"></i> Vendas suspensas</h3>
                    <span class="badge badge-warn">${d.holds.length}</span>
                </div>
                <!--
                    Sem esta lista o "Suspender" era um beco sem saida: o servidor
                    guardava a venda e nao havia onde ver nem retomar. O d.holds
                    ja vinha no dado da tela desde o inicio, sem ninguem renderizar.
                -->
                <ul class="divide-y divide-line">
                    ${d.holds.map((h) => `
                    <li class="px-4 py-3 flex items-center gap-3 flex-wrap">
                        <div class="min-w-0 flex-1">
                            <p class="text-body font-medium truncate">${escapeHtml(h.label || 'Sem nome')} <span class="text-ink-3">- ${h.count} item(ns)</span></p>
                            <p class="text-caption text-ink-3">${money(h.total)} - ${escapeHtml(h.when)}</p>
                        </div>
                        <button type="button" onclick="pdvRestore('${escapeHtml(h.id)}')" class="btn btn-primary btn-sm shrink-0">
                            <i class="fa-solid fa-rotate-left"></i> Retomar
                        </button>
                        <button type="button" onclick="pdvDropHold('${escapeHtml(h.id)}')" class="btn btn-ghost btn-sm shrink-0" aria-label="Descartar venda suspensa de ${escapeHtml(h.label || 'Sem nome')}">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </li>`).join('')}
                </ul>
            </div>` : ''}

            <!-- ================= MODO VENDER ================= -->
            <div id="modeVender">
                <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
                    <div class="xl:col-span-2 card">
                        <div class="card-pad pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line">
                            <div>
                                <h3 class="text-title flex items-center gap-2"><i class="fa-solid fa-cash-register text-accent"></i> Catalogo</h3>
                                <p class="text-caption text-ink-3">Toque para adicionar a venda atual</p>
                            </div>
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

                                A classe e' "input" -- e nao uma receita de borda e
                                padding. Sem ela o campo nao tem cor de fundo nem cor
                                de texto: quem pinta e' o navegador, e no tema escuro
                                ele pinta do jeito dele. Ver color-scheme no
                                app.css, e o check:contrast, que barra o campo sem a
                                classe.
                            -->
                            <input id="pdvScan" type="text" placeholder="Codigo do produto..." onkeydown="if(event.key==='Enter'){event.preventDefault();if(!pdvScanCode(this.value)){flash('err','Codigo nao encontrado.');}this.value='';}" class="input w-36 shrink-0" autocomplete="off">
                            <input id="pdvSearch" type="search" placeholder="Buscar produto..." oninput="pdvFilter()"
                                class="input w-56 shrink-0" autocomplete="off">
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

                        <div class="px-5 pb-5 min-h-0 flex flex-col flex-1 overflow-hidden">
                        ${
                            d.products.length === 0
                                ? cardVazio('Nenhum produto cadastrado. Use a aba Catalogo ao lado.', 'fa-utensils')
                                : `<div id="pdvGrid" class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[calc(100vh-22rem)] overflow-y-auto pr-1">
${sellCards}
                    </div>`
                        }
                        </div>
                    </div>

                    <!--
                        O cartao e' o unico lugar da tela que rola por dentro.

                        A coluna do carrinho tem mais conteudo do que cabe num
                        monitor de balcao: lista, cinco totais, atalhos de
                        desconto, atalhos de gorjeta, observacao, cliente,
                        pagamento, valor recebido e tres botoes. Somados, passam
                        da altura util -- e o max-height sozinho nao resolve
                        nada: sem overflow, o conteudo transborda POR FORA do
                        cartao e invade a grade de produtos. Foi o que apareceu.

                        Duas medidas, nesta ordem:

                        1. Desconto, gorjeta e observacao foram para uma secao
                        recolhida. Nao e' perda de funcao: os valores continuam
                        aparecendo nos totais, entao quem precisa so de ver o
                        desconto aplicado le em cima e nao precisa abrir nada
                        para isso. Abrir e' para QUERER MUDAR, que e' occasional.
                        Sobrou o que se usa em toda venda: lista, total, como
                        paga, e finalizar.

                        2. O cartao tem overflow, entao se ainda assim faltar
                        altura em tela muito baixa, a rolagem acontece aqui e nao
                        na pagina. O teto da lista e' em vh e nao em flex-1: a
                        lista e' a unica parte que cresce com os itens, mas
                        deixar ela comer o resto e' o que empurrava os botoes
                        para fora do cartao.
                    -->
                    <div class="card card-pad sticky top-4 flex flex-col max-h-[calc(100vh-7rem)] overflow-y-auto">
                        <h3 class="text-title flex items-center gap-2 shrink-0"><i class="fa-solid fa-cart-shopping text-accent"></i> Venda atual</h3>

                        <div id="pdvCart" class="space-y-2 max-h-[38vh] overflow-y-auto mt-3">
                            <p class="text-body text-ink-3 text-center py-6">Toque em um produto para adicionar.</p>
                        </div>

                        <div class="mt-4 pt-3 border-t border-line space-y-1.5 shrink-0">


                            <div class="flex justify-between text-body">
                                <span class="text-ink-3">Itens</span>
                                <span id="pdvCount" class="font-medium text-ink">0</span>
                            </div>
                            <div class="flex justify-between text-body">
                                <span class="text-ink-3">Subtotal</span>
                                <span id="pdvSubtotal" class="font-medium text-ink">R$ 0,00</span>
                            </div>
                            <div class="flex justify-between text-body">
                                <span class="text-ink-3">Desconto</span>
                                <span id="pdvDiscountLabel" class="text-accent-red">- R$ 0,00</span>
                            </div>
                            <div class="flex justify-between text-body">
                                <span class="text-ink-3">Gorjeta</span>
                                <span id="pdvTipLabel" class="text-accent-emerald">+ R$ 0,00</span>
                            </div>
                            <div class="flex justify-between text-title pt-1 border-t border-line mt-1">
                                <span class="text-ink">Total</span>
                                <span id="pdvTotal" class="text-accent-strong">R$ 0,00</span>
                            </div>
                        </div>

                        <!--
                            Desconto, gorjeta e observacao, recolhidos.

                            Sao tres controles que se mexem uma vez por venda, e
                            nao em toda venda. Acessiveis ficavam entre o total e
                            o pagamento, empurrando o botao de finalizar para
                            baixo da dobra num monitor de 1366x768.

                            Recolhidos, sobram visiveis as tres coisas que se usa
                            sempre: os itens, o total e como se paga. Quem ja
                            aplicou o desconto continua vendo o valor dele nos
                            totais -- o recolhimento esconde o CONTROLE, nunca o
                            resultado.
                        -->
                        <details class="mt-3 shrink-0 border border-line rounded-card">
                            <summary class="cursor-pointer text-body font-medium text-ink-2 px-3 py-2 flex items-center gap-2">
                                <i class="fa-solid fa-sliders text-accent"></i>
                                Desconto, gorjeta e observacao
                                <i class="fa-solid fa-chevron-down ml-auto text-caption text-ink-3"></i>
                            </summary>
                            <div class="px-3 pb-3 space-y-2">
                            <div>
                                <label class="label" for="pdvDiscount">Desconto</label>
                                <div class="flex gap-1.5" role="group" aria-label="Atalhos de desconto">
                                    ${['0', '5', '10', '15']
                                        .map(
                                            (p) =>
                                                `<button type="button" data-pdv-pct="discount" data-pct="${p}" class="pdv-pct btn btn-ghost btn-sm flex-1 font-semibold" aria-label="Desconto de ${p === '0' ? 'zero por cento' : p + ' por cento'}">${p === '0' ? 'Sem' : p + '%'}</button>`
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
                                                `<button type="button" data-pdv-pct="tip" data-pct="${p}" class="pdv-pct btn btn-ghost btn-sm flex-1 font-semibold" aria-label="Gorjeta de ${p === '0' ? 'zero por cento' : p + ' por cento'}">${p === '0' ? 'Sem' : p + '%'}</button>`
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
                        </details>

                        <div class="mt-3 space-y-2 shrink-0">
                            <div>
                                <label class="label" for="pdvCustomer">Cliente (opcional)</label>
                                <input id="pdvCustomer" type="text" placeholder="Nome de quem levou" class="input">
                            </div>
                            <div class="grid grid-cols-2 gap-2">
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
                            <p id="pdvChange" class="text-caption text-ink-3">Informe o valor recebido para calcular o troco.</p>
                        </div>

                        <button type="button" onclick="pdvCheckout()" id="pdvFinish"
                            class="btn btn-primary mt-4 w-full shrink-0">
                            <i class="fa-solid fa-check"></i> Finalizar venda
                        </button>
                        <div class="mt-2 flex gap-2 shrink-0">
                            <button type="button" onclick="pdvHold()" id="pdvHoldBtn" class="btn btn-ghost flex-1">
                                <i class="fa-solid fa-pause"></i> Suspender
                            </button>
                            <button type="button" onclick="pdvClear()" class="btn btn-ghost flex-1">
                                Limpar
                            </button>
                        </div>

                        <div id="pdvDone" class="hidden mt-4 p-3 rounded-card bg-success-bg text-body shrink-0"></div>
                    </div>
                </div>

                <!-- Modal de modificadores -->
                <div id="modModal" class="hidden modal-backdrop">
                    <div class="modal-panel max-w-md">
                        <div class="flex items-start justify-between gap-3 mb-3">
                            <div>
                                <h3 id="modTitle" class="text-title"></h3>
                                <p id="modPrice" class="text-body text-accent-strong"></p>
                            </div>
                            <button type="button" onclick="pdvModClose()" class="btn btn-ghost btn-icon shrink-0">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div id="modBody" class="space-y-4"></div>
                        <div class="flex gap-2 mt-5">
                            <button type="button" onclick="pdvModClose()" class="btn btn-ghost flex-1">Cancelar</button>
                            <button type="button" onclick="pdvModConfirm()" id="modConfirm" class="btn btn-primary flex-1">
                                Adicionar
                            </button>
                        </div>
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
                        + '<span class="text-caption text-ink-3">' + rule + '</span></div>'
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
                            + (price ? '<span class="ml-auto text-body text-accent-strong">' + price + '</span>' : '')
                            + '</label>';
                    });
                    html += '</div></div>';
                });
                if (p.isCombo) {
                    html += '<p class="text-caption text-ink-3">Combo: o estoque e baixado nos componentes.</p>';
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
                    box.innerHTML = '<p class="text-body text-ink-3 text-center py-6">Toque em um produto para adicionar.</p>';
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
                            + '<div class="text-caption text-ink-3">' + pdvMoney(info.unit) + ' cada &middot; <b>' + pdvMoney(line) + '</b></div>'
                            + '</div>'
                            + '<div class="flex items-center gap-1 shrink-0">'
                            + '<button type="button" data-cart-dec="' + esc(key) + '" class="btn btn-ghost btn-icon font-bold">-</button>'
                            + '<span class="w-5 text-center text-sm font-semibold ink">' + pdvCart[key] + '</span>'
                            + '<button type="button" data-cart-inc="' + esc(key) + '" class="btn btn-ghost btn-icon font-bold">+</button>'
                            + '<button type="button" data-cart-del="' + esc(key) + '" title="Remover" class="btn btn-danger btn-icon font-bold">x</button>'
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
                    out.className = 'text-caption text-ink-3';
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
                    // controlado: clicar num cartao pausado nao pode acrescentar nada, ou o
                    // servidor recusaria depois, quando a pessoa ja acreditava ter vendido.
                    if (card.dataset.sellable === '1') pdvModOpen(card.dataset.pdvProduct);
                    return;
                }

                var inc = e.target.closest('[data-cart-inc]');
                if (inc) { pdvSet(inc.dataset.cartInc, (pdvCart[inc.dataset.cartInc] || 0) + 1); return; }

                var dec = e.target.closest('[data-cart-dec]');
                if (dec) { pdvSet(dec.dataset.cartDec, (pdvCart[dec.dataset.cartDec] || 1) - 1); return; }

                var del = e.target.closest('[data-cart-del]');
                if (del) { pdvRemove(del.dataset.cartDel); return; }

                /*
                 * Atalhos de desconto e gorjeta.
                 *
                 * O valor vinha escrito dentro do onclick, como
                 * pdvSetPercent('tip', 10). Um argumento de string no atributo
                 * nao quebra a pagina como acontece com um id de produto, mas
                 * e' o mesmo caminho: a regra vira codigo no HTML em vez de
                 * dado. Aqui os dois campos vem em data-*, e a lista de botoes
                 * some do markup: sete atributos repetidos viram um so.
                 */
                var pct = e.target.closest('[data-pdv-pct]');
                if (pct) { pdvSetPercent(pct.dataset.pdvPct, pct.dataset.pct); return; }
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
