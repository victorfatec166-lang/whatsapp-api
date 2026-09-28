import { escapeHtml } from './html';
import { currency } from '../services/stats';
import { stockStatus, STOCK_STATUS_LABEL, STOCK_STATUS_BADGE } from '../services/stock';

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
    todayRevenue: number;
    totals: { total: number; available: number; paused: number; soldOut: number };
    cash: {
        expected: number;
        cashSales: number;
        cashIn: number;
        cashOut: number;
    };
    holds: Array<{ id: string; label: string; count: number; total: number; when: string }>;
    shift: {
        id: string;
        openedAt: string;
        openingFloat: number;
        totals: {
            cashSales: number;
            cashIn: number;
            cashOut: number;
            expected: number;
            orders: number;
            revenue: number;
        };
    } | null;
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
                            <span class="font-bold accent-amber-strong text-sm">R$ ${money(p.price)}</span>
                            ${stockPill(p)}
                        </span>
                        ${p.isAvailable ? '' : '<span class="absolute top-1.5 right-1.5 badge-red text-[10px] px-1.5 py-0.5 rounded font-bold">Pausado</span>'}
                    </button>`;
        })
        .join('\n');

    /* -------------------------------------------- Modo Produtos: catalogo */
    const manageRows = d.products
        .map(
                    (p) => `                    <div data-product data-name="${escapeHtml(p.name.toLowerCase())}" data-sku="${escapeHtml((p.sku ?? '').toLowerCase())}" data-category="${escapeHtml(p.category.toLowerCase())}" data-available="${p.isAvailable}"
                        class="flex items-center justify-between gap-3 p-3 rounded-xl border line row-hover transition ${p.isAvailable ? '' : 'opacity-60'}">
                        <div class="min-w-0">
                            <h4 class="font-bold ink text-sm flex items-center gap-2 flex-wrap">
                                ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="" class="w-8 h-8 object-cover rounded">` : ''}
                                ${escapeHtml(p.name)}
                                ${p.sku ? `<span class="badge-slate text-[10px] px-1.5 py-0.5 rounded font-mono">${escapeHtml(p.sku)}</span>` : ''}
                                ${p.isAvailable ? '' : '<span class="badge-red text-[10px] px-1.5 py-0.5 rounded">Pausado</span>'}
                                ${p.trackStock ? `<span class="${p.stock > 0 ? 'badge-slate' : 'badge-red'} text-[10px] px-1.5 py-0.5 rounded">${p.stock} un.</span>` : ''}
                            </h4>
                            <p class="text-xs ink-3 truncate">${escapeHtml(p.description || 'Sem descricao')}</p>
                            <span class="inline-flex items-center gap-1 mt-1 text-[11px] badge-slate px-1.5 py-0.5 rounded">${escapeHtml(p.category)}${marginPill(p)}</span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="font-bold accent-amber-strong text-sm">R$ ${money(p.price)}</span>
                            <button onclick="uploadPhoto('${escapeHtml(p.id)}')" title="${p.imageUrl ? 'Trocar foto' : 'Enviar foto'}" class="w-8 h-8 rounded-lg badge-slate flex items-center justify-center transition">
                                <i class="fa-solid fa-camera text-xs"></i>
                            </button>
                            <button onclick="duplicateProduct('${escapeHtml(p.id)}')" title="Duplicar" class="w-8 h-8 rounded-lg badge-slate flex items-center justify-center transition">
                                <i class="fa-solid fa-copy text-xs"></i>
                            </button>
                            <button onclick="toggleAvailability('${escapeHtml(p.id)}')" title="${p.isAvailable ? 'Pausar' : 'Reativar'}"
                                class="w-8 h-8 rounded-lg ${p.isAvailable ? 'badge-amber' : 'badge-emerald'} flex items-center justify-center transition">
                                <i class="fa-solid ${p.isAvailable ? 'fa-pause' : 'fa-play'} text-xs"></i>
                            </button>
                            <button onclick="deleteProduct('${escapeHtml(p.id)}')" title="Remover"
                                class="w-8 h-8 rounded-lg badge-red flex items-center justify-center transition">
                                <i class="fa-solid fa-trash text-xs"></i>
                            </button>
                            <button type="button" class="w-8 h-8 rounded-lg badge-amber flex items-center justify-center transition"
                                data-cfg-open data-cfg-id="${escapeHtml(p.id)}" data-cfg-name="${escapeHtml(p.name)}"
                                title="Modificadores e combo">
                                <i class="fa-solid fa-sliders text-xs"></i>
                            </button>
                        </div>
                    </div>`
        )
        .join('\n');

    return `        <!-- Seletor de modo: vender no balcao ou gerenciar o cardapio -->
            <div class="inline-flex rounded-xl border line overflow-hidden mb-5" role="tablist">
                <button type="button" id="tabVender" onclick="setPdvMode('vender')"
                    class="px-4 py-2 text-sm font-medium transition bg-amber-600 text-white">
                    <i class="fa-solid fa-cash-register"></i> Vender
                </button>
                <button type="button" id="tabProdutos" onclick="setPdvMode('produtos')"
                    class="px-4 py-2 text-sm font-medium transition">
                    <i class="fa-solid fa-utensils"></i> Produtos
                </button>
            </div>

            <div class="flex flex-wrap items-center gap-3 mb-5">
                <div class="surface border line rounded-xl px-4 py-2 text-sm">
                    <span class="ink-3">Vendas no balcao hoje:</span>
                    <span class="font-bold ink ml-1">${d.todaySales}</span>
                </div>
                <div class="surface border line rounded-xl px-4 py-2 text-sm">
                    <span class="ink-3">Recebido hoje:</span>
                    <span class="font-bold accent-amber-strong ml-1">R$ ${money(d.todayRevenue)}</span>
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
                            <div class="flex items-center gap-2">
                                <input id="pdvScan" type="text" placeholder="Codigo do produto..." onkeydown="if(event.key==='Enter'){event.preventDefault();if(!pdvScanCode(this.value)){flash('err','Codigo nao encontrado.');}this.value='';}" class="px-3 py-1.5 text-sm border line-in rounded-lg w-36">
                                <input id="pdvSearch" type="search" placeholder="Buscar produto..." oninput="pdvFilter()"
                                    class="px-3 py-1.5 text-sm border line-in rounded-lg">
                                <select id="pdvCategory" onchange="pdvFilter()" class="px-2 py-1.5 text-sm border line-in rounded-lg">
                                    <option value="">Todas</option>
                                    ${d.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                                </select>
                            </div>
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
                                <label class="block text-xs font-semibold ink-2 mb-1">Desconto</label>
                                <div class="flex gap-1.5">
                                    ${['0', '5', '10', '15']
                                        .map(
                                            (p) =>
                                                `<button type="button" onclick="pdvSetPercent('discount', ${p})" class="pdv-pct flex-1 px-2 py-1.5 rounded-lg badge-slate text-xs font-semibold transition">${p === '0' ? 'Sem' : p + '%'}</button>`
                                        )
                                        .join('')}
                                </div>
                                <input id="pdvDiscount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00"
                                    oninput="pdvRender()" class="mt-1.5 w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Gorjeta</label>
                                <div class="flex gap-1.5">
                                    ${['0', '5', '10']
                                        .map(
                                            (p) =>
                                                `<button type="button" onclick="pdvSetPercent('tip', ${p})" class="pdv-pct flex-1 px-2 py-1.5 rounded-lg badge-slate text-xs font-semibold transition">${p === '0' ? 'Sem' : p + '%'}</button>`
                                        )
                                        .join('')}
                                </div>
                                <input id="pdvTip" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00"
                                    oninput="pdvRender()" class="mt-1.5 w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Observacao</label>
                                <textarea id="pdvNotes" rows="2" placeholder="Sem cebola, bem passado, entregar depois das 19h..."
                                    class="w-full px-3 py-2 text-sm border line-in rounded-lg"></textarea>
                            </div>
                        </div>

                        <div class="mt-4 space-y-3">
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Cliente (opcional)</label>
                                <input id="pdvCustomer" type="text" placeholder="Nome de quem levou" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label class="block text-xs font-semibold ink-2 mb-1">Pagamento</label>
                                    <select id="pdvPayment" class="w-full px-3 py-2 text-sm border line-in rounded-lg">${paymentOptions}</select>
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold ink-2 mb-1">Recebido (R$)</label>
                                    <input id="pdvPaid" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00"
                                        class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                                </div>
                            </div>
                            <p id="pdvChange" class="text-sm ink-3">Informe o valor recebido para calcular o troco.</p>
                        </div>

                        <button type="button" onclick="pdvCheckout()" id="pdvFinish"
                            class="mt-4 w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-sm py-2.5 rounded-lg font-semibold transition flex items-center justify-center gap-2">
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
                                class="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-sm py-2 rounded-lg font-semibold">
                                Adicionar
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Modal de gerenciamento: grupos e componentes de combo -->
                <div id="cfgModal" class="hidden fixed inset-0 z-50 items-center justify-center p-4" style="background: rgba(0,0,0,0.55)">
                    <div class="surface border line rounded-2xl shadow-lg w-full max-w-2xl max-h-[88vh] overflow-y-auto p-5">
                        <div class="flex items-start justify-between gap-3 mb-4">
                            <h3 id="cfgTitle" class="font-bold ink"></h3>
                            <button type="button" onclick="cfgClose()" class="w-8 h-8 rounded-lg badge-slate flex items-center justify-center shrink-0">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div id="cfgBody" class="space-y-5"></div>
                    </div>
                </div>

                <!-- Vendas suspensas e caixa do dia -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
                    <div class="surface border line rounded-2xl p-5 shadow-sm">
                        <div class="flex items-center justify-between gap-3 mb-3">
                            <h3 class="font-bold ink flex items-center gap-2"><i class="fa-solid fa-box-archive accent-amber"></i> Vendas suspensas</h3>
                            <span class="badge-slate text-xs px-2 py-0.5 rounded-full">${d.holds.length}</span>
                        </div>
                        ${
                            d.holds.length === 0
                                ? '<p class="text-sm ink-3 text-center py-6">Nenhuma venda suspensa.</p>'
                                : `<div class="space-y-2 max-h-72 overflow-y-auto">
                            ${d.holds
                                .map(
                                    (h) => `<div class="flex items-center justify-between gap-2 p-2.5 rounded-lg sunken">
                                        <button type="button" onclick="pdvRestore('${escapeHtml(h.id)}')" class="min-w-0 text-left flex-1">
                                            <div class="text-sm font-medium ink truncate">${escapeHtml(h.label)}</div>
                                            <div class="text-[11px] ink-3">${h.count} item(ns) &middot; R$ ${money(h.total)} &middot; ${escapeHtml(h.when)}</div>
                                        </button>
                                        <button type="button" onclick="pdvDropHold('${escapeHtml(h.id)}')" title="Descartar" class="w-7 h-7 rounded badge-red flex items-center justify-center shrink-0">
                                            <i class="fa-solid fa-xmark text-xs"></i>
                                        </button>
                                    </div>`
                                )
                                .join('')}
                        </div>`
                        }
                    </div>

                    <div class="surface border line rounded-2xl p-5 shadow-sm">
                        <div class="flex items-center justify-between gap-3 mb-3">
                            <h3 class="font-bold ink flex items-center gap-2"><i class="fa-solid fa-money-bill accent-amber"></i> Caixa</h3>
                            ${
                                d.shift
                                    ? '<span class="badge-emerald text-xs font-bold uppercase px-2 py-1 rounded-full">Turno aberto</span>'
                                    : '<span class="badge-slate text-xs font-bold uppercase px-2 py-1 rounded-full">Turno fechado</span>'
                            }
                        </div>

                        ${
                            d.shift
                                ? `<div class="text-center py-2">
                                    <p class="text-xs ink-3 uppercase tracking-wide">Esperado na gaveta</p>
                                    <p class="text-3xl font-extrabold accent-amber-strong">R$ ${money(d.shift.totals.expected)}</p>
                                    <p class="text-[11px] ink-3 mt-1">Aberto ${escapeHtml(d.shift.openedAt)} &middot; ${d.shift.totals.orders} pedido(s)</p>
                                </div>
                                <div class="grid grid-cols-4 gap-2 mt-3 text-center">
                                    <div class="sunken rounded-lg p-2">
                                        <p class="text-[10px] ink-3 uppercase">Float</p>
                                        <p class="text-sm font-bold ink">R$ ${money(d.shift.openingFloat)}</p>
                                    </div>
                                    <div class="sunken rounded-lg p-2">
                                        <p class="text-[10px] ink-3 uppercase">Vendas</p>
                                        <p class="text-sm font-bold ink">R$ ${money(d.shift.totals.cashSales)}</p>
                                    </div>
                                    <div class="sunken rounded-lg p-2">
                                        <p class="text-[10px] ink-3 uppercase">Entradas</p>
                                        <p class="text-sm font-bold accent-emerald">R$ ${money(d.shift.totals.cashIn)}</p>
                                    </div>
                                    <div class="sunken rounded-lg p-2">
                                        <p class="text-[10px] ink-3 uppercase">Sangrias</p>
                                        <p class="text-sm font-bold accent-red">R$ ${money(d.shift.totals.cashOut)}</p>
                                    </div>
                                </div>
                                <div class="flex gap-2 mt-3">
                                    <button type="button" onclick="pdvCash('saida')" class="flex-1 badge-red text-sm py-2 rounded-lg font-medium transition">
                                        <i class="fa-solid fa-arrow-up"></i> Sangria
                                    </button>
                                    <button type="button" onclick="pdvCash('entrada')" class="flex-1 badge-emerald text-sm py-2 rounded-lg font-medium transition">
                                        <i class="fa-solid fa-arrow-down"></i> Deposito
                                    </button>
                                </div>
                                <button type="button" onclick="pdvCloseShift()" class="mt-2 w-full bg-stone-700 hover:bg-stone-600 text-white text-sm py-2 rounded-lg font-semibold transition">
                                    <i class="fa-solid fa-lock"></i> Fechar turno e contar
                                </button>`
                                : `<p class="text-sm ink-3 text-center py-4">Abra o turno com o valor inicial da gaveta para acompanhar o caixa.</p>
                                <div class="flex gap-2">
                                    <input id="pdvFloat" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00" class="flex-1 px-3 py-2 text-sm border line-in rounded-lg">
                                    <button type="button" onclick="pdvOpenShift()" class="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition">
                                        Abrir turno
                                    </button>
                                </div>
                                <p class="text-[11px] ink-3 mt-2">Sem turno aberto as vendas de dinheiro nao entram no controle de caixa.</p>`
                        }
                    </div>
                </div>
            </div>

            <!-- ================ MODO PRODUTOS ================ -->
            <div id="modeProdutos" class="hidden">
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                    <div class="surface p-5 rounded-2xl shadow-sm border line">
                        <h3 class="font-bold ink mb-4 flex items-center gap-2"><i class="fa-solid fa-plus-circle accent-amber"></i> Novo Item</h3>
                        <form onsubmit="return createProduct(event)" class="space-y-3">
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Nome</label>
                                <input type="text" name="name" required placeholder="Ex: X-Burguer Especial" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label class="block text-xs font-semibold ink-2 mb-1">Preco (R$)</label>
                                    <input type="number" step="0.01" min="0" name="price" required placeholder="29.90" oninput="pdvMarginHint()" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold ink-2 mb-1">Custo (R$)</label>
                                    <input type="number" step="0.01" min="0" name="costPrice" placeholder="0.00" oninput="pdvMarginHint()" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                                </div>
                            </div>
                            <p id="pdvMarginHint" class="text-[11px] ink-3">Informe o preco de compra para calcular a margem.</p>
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Categoria</label>
                                <input type="text" name="category" list="categoryList" placeholder="Geral" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                                <datalist id="categoryList">
                                    ${d.categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}
                                </datalist>
                            </div>
                            <div>
                                <label class="block text-xs font-semibold ink-2 mb-1">Descricao (opcional)</label>
                                <textarea name="description" rows="2" placeholder="Ingredientes, detalhes..." class="w-full px-3 py-2 text-sm border line-in rounded-lg"></textarea>
                            </div>
                            <label class="flex items-center gap-2 text-sm ink-2">
                                <input type="checkbox" name="isAvailable" checked class="accent-amber-600 w-4 h-4"> Disponivel no cardapio
                            </label>
                            <label class="flex items-center gap-2 text-sm ink-2">
                                <input type="checkbox" name="trackStock" class="accent-amber-600 w-4 h-4"> Controlar estoque
                            </label>
                            <div class="grid grid-cols-2 gap-3 hidden" id="newStockFields">
                                <div>
                                    <label class="block text-xs font-semibold ink-2 mb-1">Saldo inicial</label>
                                    <input type="number" name="stock" min="0" value="0" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold ink-2 mb-1">Estoque minimo</label>
                                    <input type="number" name="minStock" min="0" value="0" class="w-full px-3 py-2 text-sm border line-in rounded-lg">
                                </div>
                            </div>
                            <button type="submit" class="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm py-2.5 rounded-lg font-medium transition shadow-sm">
                                Salvar no Cardapio
                            </button>
                        </form>
                    </div>

                <div class="surface p-5 rounded-2xl shadow-sm border line lg:col-span-2">
                    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <h3 class="font-bold ink flex items-center gap-2"><i class="fa-solid fa-utensils accent-amber"></i> Cardapio</h3>
                        <div class="flex items-center gap-2">
                            <input id="productSearch" type="search" placeholder="Buscar item ou SKU..." oninput="filterProducts()" class="px-3 py-1.5 text-sm border line-in rounded-lg">
                            <select id="productCategory" onchange="filterProducts()" class="px-2 py-1.5 text-sm border line-in rounded-lg">
                                <option value="">Todas</option>
                                ${d.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                            </select>
                            <a href="/api/admin/products.csv" class="chip px-2.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1" title="Baixar CSV do cardapio">
                                <i class="fa-solid fa-file-csv"></i> CSV
                            </a>
                            <button type="button" onclick="document.getElementById('importBox').classList.toggle('hidden')" class="chip px-2.5 py-1.5 rounded-lg text-xs font-medium transition" title="Importar CSV">
                                <i class="fa-solid fa-file-import"></i> Importar
                            </button>
                        </div>
                    </div>

                    <div id="importBox" class="hidden mb-4 p-3 rounded-xl surface-2 border line">
                        <p class="text-xs ink-3 mb-2">Cole o CSV com o cabecalho: <code class="badge-slate px-1 rounded">sku;nome;preco;custo;categoria;estoque;minimo;controlar_estoque;disponivel;descricao</code></p>
                        <textarea id="importCsv" rows="4" placeholder="nome;preco;custo&#10;Marmita de Frango;22,00;12,00" class="w-full px-3 py-2 text-sm border line-in rounded-lg font-mono text-xs"></textarea>
                        <div class="flex gap-2 mt-2">
                            <button type="button" onclick="importCsv()" class="bg-amber-600 hover:bg-amber-700 text-white text-xs px-3 py-1.5 rounded-lg font-medium">Importar</button>
                            <button type="button" onclick="fetchProductsCsv()" class="chip px-3 py-1.5 rounded-lg text-xs font-medium">Colar exemplo do cardapio atual</button>
                        </div>
                    </div>


                        <div id="productList" class="space-y-2 max-h-[36rem] overflow-y-auto">
                            ${d.products.length === 0 ? '<p class="text-sm ink-3 text-center py-8">Nenhum produto cadastrado.</p>' : ''}
                            ${manageRows}
                        </div>
                    </div>
                </div>
            </div>

        <script>
            var PDV_CATALOG = ${catalog};
            var pdvCart = {};
            var pdvMode = 'vender';
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

            function setPdvMode(mode) {
                pdvMode = mode;
                var isVender = mode === 'vender';
                document.getElementById('modeVender').classList.toggle('hidden', !isVender);
                document.getElementById('modeProdutos').classList.toggle('hidden', isVender);
                document.getElementById('tabVender').className = 'px-4 py-2 text-sm font-medium transition ' + (isVender ? 'bg-amber-600 text-white' : '');
                document.getElementById('tabProdutos').className = 'px-4 py-2 text-sm font-medium transition ' + (isVender ? '' : 'bg-amber-600 text-white');
            }

            function pdvFilter() {
                var q = (document.getElementById('pdvSearch').value || '').toLowerCase();
                var cat = (document.getElementById('pdvCategory').value || '').toLowerCase();
                document.querySelectorAll('#pdvGrid [data-pdv-product]').forEach(function (card) {
                    var p = PDV_CATALOG.filter(function (x) { return x.id === card.dataset.pdvProduct; })[0];
                    if (!p) return;
                    var ok = p.name.toLowerCase().indexOf(q) !== -1 && (!cat || p.category.toLowerCase() === cat);
                    card.style.display = ok ? '' : 'none';
                });
            }

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
                    b.classList.remove('bg-amber-600', 'text-white');
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
                    b.classList.remove('bg-amber-600', 'text-white');
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
                confirmThen('Descartar esta venda suspensa?', async function () {
                    await postJSON('/api/admin/pdv/holds/' + encodeURIComponent(id) + '/delete', {});
                    location.reload();
                });
            }

            function pdvCash(type) {
                var label = type === 'saida' ? 'Sangria' : 'Deposito';
                var value = prompt(label + ' - valor (R$):');
                if (value === null) return;
                var amount = parseFloat(String(value).replace(',', '.'));
                if (!isFinite(amount) || amount <= 0) { flash('err', 'Valor invalido.'); return; }
                var note = prompt('Motivo (opcional):', '') || '';
                postJSON('/api/admin/cash/movement', { type: type, amount: amount, note: note }).then(function (r) {
                    if (!r.ok) { flash('err', r.data.error || 'Erro'); return; }
                    flash('ok', label + ' registrada.');
                    setTimeout(function () { location.reload(); }, 900);
                });
            }

            async function pdvOpenShift() {
                var input = document.getElementById('pdvFloat');
                var value = input ? input.value : '0';
                var r = await postJSON('/api/admin/cash/shift/open', { openingFloat: parseFloat(String(value).replace(',', '.')) || 0 });
                if (!r.ok) { flash('err', r.data.error || 'Erro ao abrir turno'); return; }
                flash('ok', 'Turno aberto.');
                setTimeout(function () { location.reload(); }, 800);
            }

            async function pdvCloseShift() {
                var expected = ${d.shift ? d.shift.totals.expected : 0};
                var value = prompt('Dinheiro contado na gaveta (R$). Esperado: ' + expected.toFixed(2));
                if (value === null) return;
                var counted = parseFloat(String(value).replace(',', '.'));
                if (!isFinite(counted) || counted < 0) { flash('err', 'Valor contado invalido.'); return; }
                var diff = counted - expected;
                var msg = diff === 0
                    ? 'Caixa bateu. Fechar turno?'
                    : (diff > 0 ? 'SOBROU R\$ ' + diff.toFixed(2) : 'FALTOU R\$ ' + Math.abs(diff).toFixed(2)) + '. Fechar turno mesmo assim?';
                if (!confirm(msg)) return;
                var note = prompt('Observacao do fechamento (opcional):', '') || '';
                var r = await postJSON('/api/admin/cash/shift/close', { countedCash: counted, note: note });
                if (!r.ok) { flash('err', r.data.error || 'Erro ao fechar turno'); return; }
                flash('ok', 'Turno fechado.Veja o Z report em Relatorios.');
                setTimeout(function () { location.reload(); }, 1200);
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

            // ---- Gestao de produtos (aba produtos, dentro do PDV) ----
            function filterProducts() {
                var q = (document.getElementById('productSearch').value || '').toLowerCase();
                var cat = (document.getElementById('productCategory').value || '').toLowerCase();
                document.querySelectorAll('#productList [data-product]').forEach(function (row) {
                    var matchName = row.dataset.name.indexOf(q) !== -1;
                    var matchSku = (row.dataset.sku || '').indexOf(q) !== -1;
                    var matchCat = !cat || row.dataset.category === cat;
                    row.style.display = (matchName || matchSku) && matchCat ? '' : 'none';
                });
            }

            async function importCsv() {
                var box = document.getElementById('importCsv');
                if (!box.value.trim()) { flash('err', 'Cole o conteudo do CSV.'); return; }
                if (!confirm('Importar e atualizar os produtos deste CSV?')) return;
                try {
                    var r = await postJSON('/api/admin/products/import', { csv: box.value });
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao importar'); return; }
                    var msg = r.data.created + ' criado(s), ' + r.data.updated + ' atualizado(s), ' + r.data.skipped + ' ignorado(s)';
                    if (r.data.errors && r.data.errors.length) msg += ' | ' + r.data.errors.slice(0, 3).join(' | ');
                    flash(r.data.errors && r.data.errors.length ? 'err' : 'ok', msg);
                    if (!r.data.errors || !r.data.errors.length) setTimeout(function () { location.reload(); }, 1600);
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            async function fetchProductsCsv() {
                try {
                    var res = await fetch('/api/admin/products.csv');
                    var text = await res.text();
                    var box = document.getElementById('importCsv');
                    if (box) box.value = text;
                } catch (e) { flash('err', 'Erro ao baixar CSV'); }
            }

            /* Redimensiona no navegador para no max 400px e ~300KB antes de enviar. */
            function uploadPhoto(id) {
                var input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/png,image/jpeg,image/webp';
                input.onchange = function () {
                    var file = input.files && input.files[0];
                    if (!file) return;
                    var reader = new FileReader();
                    reader.onload = function () {
                        var img = new Image();
                        img.onload = function () {
                            var max = 400;
                            var scale = Math.min(1, max / Math.max(img.width, img.height));
                            var w = Math.max(1, Math.round(img.width * scale));
                            var h = Math.max(1, Math.round(img.height * scale));
                            var canvas = document.createElement('canvas');
                            canvas.width = w;
                            canvas.height = h;
                            var ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, w, h);
                            var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                            postJSON('/api/admin/products/' + encodeURIComponent(id) + '/photo', { dataUrl: dataUrl })
                                .then(function (r) {
                                    if (!r.ok) { flash('err', r.data.error || 'Erro ao enviar foto'); return; }
                                    flash('ok', 'Foto atualizada.');
                                    setTimeout(function () { location.reload(); }, 900);
                                });
                        };
                        img.onerror = function () { flash('err', 'Nao foi possivel ler a imagem.'); };
                        img.src = reader.result;
                    };
                    reader.readAsDataURL(file);
                };
                input.click();
            }

            /* ---- Gerenciador de grupos e combo (aba Produtos) ---- */

            var cfgProductId = null;

            function cfgClose() {
                cfgProductId = null;
                var m = document.getElementById('cfgModal');
                m.classList.add('hidden');
                m.classList.remove('flex');
            }

            async function openModifiers(productId, productName) {
                cfgProductId = productId;
                document.getElementById('cfgTitle').textContent = 'Modificadores - ' + productName;
                document.getElementById('cfgBody').innerHTML = '<p class="text-sm ink-3">Carregando...</p>';
                var m = document.getElementById('cfgModal');
                m.classList.remove('hidden');
                m.classList.add('flex');

                try {
                    var [full, groups] = await Promise.all([
                        fetch('/api/admin/products/' + encodeURIComponent(productId) + '/full').then(function (r) { return r.json(); }),
                        fetch('/api/admin/modifier-groups').then(function (r) { return r.json(); }),
                    ]);
                    cfgRender(full, groups);
                } catch (e) {
                    document.getElementById('cfgBody').innerHTML = '<p class="text-sm accent-red">Erro ao carregar.</p>';
                }
            }

            function cfgRender(full, groups) {
                var attached = {};
                full.modifierGroups.forEach(function (g) { attached[g.id] = true; });

                var html = '';

                // ---- grupos ligados ----
                html += '<div><h4 class="font-bold ink text-sm mb-2">Grupos neste produto</h4>';
                if (full.modifierGroups.length === 0) {
                    html += '<p class="text-sm ink-3">Nenhum grupo vinculado.</p>';
                } else {
                    full.modifierGroups.forEach(function (g) {
                        html += '<div class="p-3 rounded-lg sunken mb-2">'
                            + '<div class="flex items-center justify-between gap-2">'
                            + '<span class="text-sm font-medium ink">' + esc(g.name) + '</span>'
                            + '<div class="flex gap-1">'
                            + '<button onclick="cfgToggleGroup(\\'' + esc(g.id) + '\\')" class="badge-slate text-[10px] px-2 py-1 rounded">Desvincular</button>'
                            + '<button onclick="cfgDeleteGroup(\\'' + esc(g.id) + '\\')" class="badge-red text-[10px] px-2 py-1 rounded">Excluir</button>'
                            + '</div></div>'
                            + '<div class="text-[11px] ink-3 mt-1 mb-2">'
                            + (g.maxSelect <= 1 ? 'Escolha unica' : 'Ate ' + g.maxSelect + ' opcoes') + (g.required ? ' | obrigatorio' : '')
                            + ' | ' + g.options.length + ' opcao(oes)</div>'
                            + '<div class="space-y-1">'
                            + g.options.map(function (o) {
                                return '<div class="flex items-center gap-2 text-xs ink-2">'
                                    + '<span class="flex-1 truncate pl-2 border-l line">' + esc(o.name) + '</span>'
                                    + '<span class="ink-3">' + (o.price > 0 ? '+ R$ ' + o.price.toFixed(2) : 'sem acrescimo') + '</span>'
                                    + '<button onclick="cfgDeleteOption(\\'' + esc(o.id) + '\\')" class="badge-red w-6 h-6 rounded text-[10px] flex items-center justify-center" title="Remover opcao">'
                                    + '<i class="fa-solid fa-xmark"></i></button></div>';
                            }).join('')
                            + '</div>'
                            + '<div class="flex gap-1 mt-2">'
                            + '<input id="cfgOptName' + esc(g.id) + '" placeholder="Nova opcao" class="flex-1 px-2 py-1 text-xs border line-in rounded-lg">'
                            + '<input id="cfgOptPrice' + esc(g.id) + '" type="number" step="0.01" placeholder="+0,00" class="w-20 px-2 py-1 text-xs border line-in rounded-lg">'
                            + '<button onclick="cfgAddOption(\\'' + esc(g.id) + '\\')" class="chip w-8 h-7 rounded-lg text-xs flex items-center justify-center" title="Adicionar opcao">'
                            + '<i class="fa-solid fa-plus"></i></button></div>'
                            + '</div>';
                    });
                }
                html += '</div>';

                // ---- grupos disponiveis ----
                var avail = groups.filter(function (g) { return !attached[g.id]; });
                html += '<div><h4 class="font-bold ink text-sm mb-2">Vincular grupo</h4>';
                if (avail.length === 0) {
                    html += '<p class="text-sm ink-3">Crie um grupo abaixo ou todos ja estao vinculados.</p>';
                } else {
                    html += '<div class="flex flex-wrap gap-2">' + avail.map(function (g) {
                        return '<button onclick="cfgToggleGroup(\\'' + esc(g.id) + '\\')" class="chip px-2.5 py-1.5 rounded-lg text-xs font-medium transition">'
                            + '<i class="fa-solid fa-plus"></i> ' + esc(g.name) + '</button>';
                    }).join('') + '</div>';
                }
                html += '</div>';

                // ---- novo grupo ----
                html += '<details class="p-3 rounded-lg sunken"><summary class="cursor-pointer text-sm font-semibold ink">Criar novo grupo de modificadores</summary>'
                    + '<div class="grid grid-cols-2 gap-2 mt-3">'
                    + '<div class="col-span-2"><input id="cfgGroupName" placeholder="Nome (Ponto da carne)" class="w-full px-3 py-2 text-sm border line-in rounded-lg"></div>'
                    + '<div><input id="cfgGroupMax" type="number" min="1" max="20" value="1" placeholder="Max" class="w-full px-3 py-2 text-sm border line-in rounded-lg"></div>'
                    + '<div><input id="cfgGroupMin" type="number" min="0" max="20" value="0" placeholder="Min" class="w-full px-3 py-2 text-sm border line-in rounded-lg"></div>'
                    + '<div class="col-span-2 flex items-center gap-2"><input type="checkbox" id="cfgGroupReq" class="accent-amber-600 w-4 h-4"><span class="text-sm ink-2">Obrigatorio</span></div>'
                    + '<div class="col-span-2"><textarea id="cfgGroupOptions" rows="3" placeholder="Uma opcao por linha: Nome | acrescimo | prefixo&#10;Mal passado | 0 | P&#10;Bacon | 6 | Extra" class="w-full px-3 py-2 text-sm border line-in rounded-lg font-mono text-xs"></textarea></div>'
                    + '<button onclick="cfgCreateGroup()" class="col-span-2 bg-amber-600 hover:bg-amber-700 text-white text-sm py-2 rounded-lg font-medium">Criar grupo</button>'
                    + '</div></details>';

                // ---- combo ----
                html += '<div class="pt-3 border-t line"><h4 class="font-bold ink text-sm mb-2">Combo</h4>'
                    + '<label class="flex items-center gap-2 text-sm ink-2 mb-2">'
                    + '<input type="checkbox" id="cfgCombo" ' + (full.isCombo ? 'checked' : '') + ' class="accent-amber-600 w-4 h-4">'
                    + 'Este produto e um combo (baixa estoque nos componentes)</label>'
                    + '<div class="space-y-1" id="cfgComboList">'
                    + full.comboComponents.map(function (c) {
                        return '<div class="flex items-center gap-2 p-2 rounded-lg sunken">'
                            + '<span class="text-sm ink flex-1 truncate">' + esc(c.name) + '</span>'
                            + '<input type="number" min="1" value="' + c.quantity + '" data-cid="' + esc(c.componentId) + '" class="cfg-qty w-16 px-2 py-1 text-sm border line-in rounded-lg">'
                            + '<button onclick="cfgRemoveComponent(\\'' + esc(c.componentId) + '\\')" class="badge-red w-7 h-7 rounded text-xs">x</button></div>';
                    }).join('')
                    + '</div>'
                    + '<div class="flex gap-2 mt-2">'
                    + '<select id="cfgComponentPick" class="flex-1 px-2 py-1.5 text-sm border line-in rounded-lg"><option value="">Adicionar componente...</option>'
                    + PDV_CATALOG.filter(function (x) { return x.id !== cfgProductId; }).map(function (x) {
                        return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
                    }).join('') + '</select>'
                    + '<button onclick="cfgAddComponent()" class="chip px-3 py-1.5 rounded-lg text-sm font-medium">+</button></div>'
                    + '<button onclick="cfgSaveCombo()" class="mt-2 w-full bg-amber-600 hover:bg-amber-700 text-white text-sm py-2 rounded-lg font-medium">Salvar combo</button></div>';

                document.getElementById('cfgBody').innerHTML = html;
            }

            async function cfgToggleGroup(groupId) {
                var res = await postJSON('/api/admin/products/' + encodeURIComponent(cfgProductId) + '/modifier-groups', { groupId: groupId });
                if (!res.ok) { flash('err', res.data.error || 'Erro'); return; }
                var groups = await fetch('/api/admin/modifier-groups').then(function (r) { return r.json(); });
                cfgRender(res.data.product, groups);
            }

            async function cfgCreateGroup() {
                var name = document.getElementById('cfgGroupName').value.trim();
                if (!name) { flash('err', 'Informe o nome do grupo.'); return; }
                var options = document.getElementById('cfgGroupOptions').value
                    .split(String.fromCharCode(10)).map(function (l) { return l.trim(); }).filter(Boolean)
                    .map(function (l) {
                        var parts = l.split('|').map(function (x) { return x.trim(); });
                        return { name: parts[0] || '', price: parseFloat(String(parts[1] || '0').replace(',', '.')) || 0, prefix: parts[2] || '' };
                    }).filter(function (o) { return o.name; });

                var r = await postJSON('/api/admin/modifier-groups', {
                    name: name,
                    maxSelect: parseInt(document.getElementById('cfgGroupMax').value, 10) || 1,
                    minSelect: parseInt(document.getElementById('cfgGroupMin').value, 10) || 0,
                    required: document.getElementById('cfgGroupReq').checked,
                    options: options
                });
                if (!r.ok) { flash('err', r.data.error || 'Erro ao criar grupo'); return; }
                var groups = await fetch('/api/admin/modifier-groups').then(function (r) { return r.json(); });
                var full = await fetch('/api/admin/products/' + encodeURIComponent(cfgProductId) + '/full').then(function (r) { return r.json(); });
                cfgRender(full, groups);
                flash('ok', 'Grupo criado.');
            }

            async function cfgAddOption(groupId) {
                var nameEl = document.getElementById('cfgOptName' + groupId);
                var priceEl = document.getElementById('cfgOptPrice' + groupId);
                var name = nameEl.value.trim();
                if (!name) { flash('err', 'Informe o nome da opcao.'); return; }
                var r = await postJSON('/api/admin/modifier-groups/' + encodeURIComponent(groupId) + '/options', {
                    name: name,
                    price: parseFloat(priceEl.value.replace(',', '.')) || 0
                });
                if (!r.ok) { flash('err', r.data.error || 'Erro ao criar opcao'); return; }
                cfgRefresh();
            }

            async function cfgDeleteOption(optionId) {
                var r = await fetch('/api/admin/modifier-options/' + encodeURIComponent(optionId), { method: 'DELETE' });
                if (!r.ok) { flash('err', 'Erro ao remover opcao.'); return; }
                cfgRefresh();
            }

            async function cfgDeleteGroup(groupId) {
                if (!confirm('Excluir este grupo de modificadores? Ele será removido de todos os produtos.')) return;
                var r = await fetch('/api/admin/modifier-groups/' + encodeURIComponent(groupId), { method: 'DELETE' });
                if (!r.ok) { flash('err', 'Erro ao excluir grupo.'); return; }
                flash('ok', 'Grupo excluido.');
                cfgRefresh();
            }

            async function cfgRefresh() {
                var groups = await fetch('/api/admin/modifier-groups').then(function (r) { return r.json(); });
                var full = await fetch('/api/admin/products/' + encodeURIComponent(cfgProductId) + '/full').then(function (r) { return r.json(); });
                cfgRender(full, groups);
            }

            function cfgAddComponent() {
                var pick = document.getElementById('cfgComponentPick');
                var id = pick.value;
                if (!id) return;
                var list = document.getElementById('cfgComboList');
                if (list.querySelector('[data-cid="' + id + '"]')) { flash('err', 'Componente ja adicionado.'); return; }
                var p = pdvProduct(id);
                var div = document.createElement('div');
                div.className = 'flex items-center gap-2 p-2 rounded-lg sunken';
                div.innerHTML = '<span class="text-sm ink flex-1 truncate">' + esc(p.name) + '</span>'
                    + '<input type="number" min="1" value="1" data-cid="' + esc(id) + '" class="cfg-qty w-16 px-2 py-1 text-sm border line-in rounded-lg">'
                    + '<button type="button" class="badge-red w-7 h-7 rounded text-xs" onclick="cfgRemoveComponent(\\'' + esc(id) + '\\')">x</button>';
                list.appendChild(div);
                pick.value = '';
            }

            function cfgRemoveComponent(componentId) {
                var el = document.getElementById('cfgComboList').querySelector('[data-cid="' + componentId + '"]');
                if (el) el.remove();
            }

            async function cfgSaveCombo() {
                var isCombo = document.getElementById('cfgCombo').checked;
                var components = [];
                document.querySelectorAll('#cfgComboList [data-cid]').forEach(function (input) {
                    components.push({ componentId: input.getAttribute('data-cid'), quantity: parseInt(input.value, 10) || 1 });
                });
                if (isCombo && components.length === 0) { flash('err', 'Combo precisa de ao menos um componente.'); return; }

                var r = await postJSON('/api/admin/products/' + encodeURIComponent(cfgProductId) + '/combo', { isCombo: isCombo, components: components });
                if (!r.ok) { flash('err', r.data.error || 'Erro ao salvar combo'); return; }
                cfgClose();
                flash('ok', 'Combo salvo.');
                setTimeout(function () { location.reload(); }, 900);
            }

            async function createProduct(event) {
                event.preventDefault();
                var fd = new FormData(event.target);
                var track = fd.get('trackStock') === 'on';
                try {
                    var r = await postJSON('/api/admin/products', {
                        name: fd.get('name'),
                        price: fd.get('price'),
                        costPrice: fd.get('costPrice') || 0,
                        description: fd.get('description') || '',
                        category: fd.get('category') || 'Geral',
                        isAvailable: fd.get('isAvailable') === 'on',
                        trackStock: track,
                        stock: track ? (parseInt(fd.get('stock'), 10) || 0) : 0,
                        minStock: track ? (parseInt(fd.get('minStock'), 10) || 0) : 0
                    });
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao criar produto'); return; }
                    location.reload();
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            function pdvMarginHint() {
                var form = document.getElementById('modeProdutos');
                if (!form) return;
                var price = parseFloat(form.querySelector('[name="price"]').value) || 0;
                var cost = parseFloat(form.querySelector('[name="costPrice"]').value) || 0;
                var out = document.getElementById('pdvMarginHint');
                if (!cost) {
                    out.textContent = 'Informe o preco de compra para calcular a margem.';
                    out.className = 'text-[11px] ink-3';
                    return;
                }
                var margin = Math.round(((price - cost) / price) * 100);
                out.textContent = 'Custo R$ ' + cost.toFixed(2) + ' | margem ' + margin + '% | lucro R$ ' + (price - cost).toFixed(2);
                out.className = 'text-[11px] ' + (margin < 20 ? 'accent-orange' : 'accent-emerald');
            }

            async function duplicateProduct(id) {
                try {
                    var r = await postJSON('/api/admin/products/' + encodeURIComponent(id) + '/duplicate', {});
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao duplicar'); return; }
                    flash('ok', 'Copia criada e pausada. Revise e ative.');
                    setTimeout(function () { location.reload(); }, 1200);
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            async function toggleAvailability(id) {
                try {
                    var r = await postJSON('/api/admin/products/' + encodeURIComponent(id) + '/availability', {});
                    if (!r.ok) { flash('err', r.data.error || 'Erro'); return; }
                    location.reload();
                } catch (e) { flash('err', 'Erro de conexao'); }
            }

            function deleteProduct(id) {
                confirmThen('Remover este produto do cardapio?', async function () {
                    try {
                        var r = await postJSON('/api/admin/products/' + encodeURIComponent(id) + '/delete', {});
                        if (!r.ok) { flash('err', r.data.error || 'Erro ao apagar'); return; }
                        location.reload();
                    } catch (e) { flash('err', 'Erro de conexao'); }
                });
            }

            // Liga primeiro o que é essencial (seletor de modo, carrinho, clique
            // no catálogo). Assim um erro em um binding opcional abaixo nunca
            // derruba a aba inteira.
            document.addEventListener('click', function (e) {
                var cfg = e.target.closest('[data-cfg-open]');
                if (cfg) {
                    openModifiers(cfg.dataset.cfgId, cfg.dataset.cfgName || '');
                    return;
                }
                var dec = e.target.closest('[data-cart-dec]');
                if (dec) { pdvSet(dec.dataset.cartDec, (pdvCart[dec.dataset.cartDec] || 1) - 1); return; }
                var inc = e.target.closest('[data-cart-inc]');
                if (inc) { pdvSet(inc.dataset.cartInc, (pdvCart[inc.dataset.cartInc] || 0) + 1); return; }
                var del = e.target.closest('[data-cart-del]');
                if (del) { pdvRemove(del.dataset.cartDel); return; }

                var card = e.target.closest('[data-pdv-product]');
                if (card && card.dataset.sellable === '1') pdvModOpen(card.dataset.pdvProduct);
            });

            var paidInput = document.getElementById('pdvPaid');
            if (paidInput) paidInput.addEventListener('input', pdvChange);
            var paySelect = document.getElementById('pdvPayment');
            if (paySelect) paySelect.addEventListener('change', pdvChange);
            pdvRender();

            // Opcional: revela os campos de estoque no formulario de novo item.
            try {
                var newForm = document.querySelector('#modeProdutos form');
                var trackBox = newForm ? newForm.querySelector('[name="trackStock"]') : null;
                var stockFields = document.getElementById('newStockFields');
                if (trackBox && stockFields) {
                    trackBox.addEventListener('change', function () {
                        stockFields.classList.toggle('hidden', !trackBox.checked);
                    });
                }
            } catch (err) {
                console.warn('Campo de controle de estoque nao encontrado', err);
            }
        </script>`;
}

export const PDV_PAYMENT_LABELS: Record<string, string> = {
    pix: 'PIX',
    dinheiro: 'Dinheiro',
    cartao: 'Cartao',
};
