import { escapeHtml } from './html';
import { currency } from '../services/stats';
import { CATEGORIAS } from '../services/categorias';
import { cardVazio } from './ui/card';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('catalog');

export type CatalogProduct = {
    id: string;
    name: string;
    sku: string | null;
    imageUrl: string | null;
    price: number;
    costPrice: number;
    description: string | null;
    category: string;
    isAvailable: boolean;
    trackStock: boolean;
    stock: number;
    minStock: number;
    isCombo: boolean;
};

export type CatalogData = {
    products: CatalogProduct[];
    categories: string[];
    /** Itens controlados no minimo ou zerados, para o aviso no topo. */
    lowStock: number;
};

function money(n: number): string {
    return escapeHtml(currency(n));
}

/** Contador de saldo no catalogo: zerado e baixo exigem reposicao. */
function stockPill(p: CatalogProduct): string {
    if (!p.trackStock) return '';
    if (p.stock <= 0) return '<span class="badge badge-danger">Zerado</span>';
    if (p.minStock > 0 && p.stock <= p.minStock) return '<span class="badge badge-warn">Baixo</span>';
    return `<span class="badge badge-neutral">${p.stock} un.</span>`;
}

const manageRows = (d: CatalogData) =>
    d.products
        .map(
            (p) => `                <div data-product data-name="${escapeHtml(p.name.toLowerCase())}" data-sku="${escapeHtml((p.sku ?? '').toLowerCase())}" data-category="${escapeHtml(p.category.toLowerCase())}" data-available="${p.isAvailable}"
                    class="flex items-center justify-between gap-3 p-3 rounded-card border border-line row-hover ${p.isAvailable ? '' : 'opacity-60'}">
                    <div class="min-w-0">
                        <h4 class="text-body font-bold text-ink flex items-center gap-2 flex-wrap">
                            ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="" class="w-8 h-8 object-cover rounded">` : ''}
                            ${escapeHtml(p.name)}
                            ${p.sku ? `<span class="badge badge-neutral badge-xs font-mono">${escapeHtml(p.sku)}</span>` : ''}
                            ${p.isCombo ? '<span class="badge badge-info badge-xs">Combo</span>' : ''}
                            ${p.isAvailable ? '' : '<span class="badge badge-danger badge-xs">Pausado</span>'}
                            ${p.trackStock ? stockPill(p) : ''}
                        </h4>
                        <p class="text-caption text-ink-3 truncate">${escapeHtml(p.description || 'Sem descricao')}</p>
                        <span class="badge badge-neutral badge-xs mt-1">${escapeHtml(p.category)}</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="text-body font-bold text-accent-strong">${money(p.price)}</span>
                        <button type="button" data-prod-photo="${escapeHtml(p.id)}" title="${p.imageUrl ? 'Trocar foto' : 'Enviar foto'}" aria-label="Foto do produto" class="btn btn-ghost btn-icon">
                            <i class="fa-solid fa-camera"></i>
                        </button>
                        <button type="button" data-prod-dup="${escapeHtml(p.id)}" title="Duplicar" aria-label="Duplicar produto" class="btn btn-ghost btn-icon">
                            <i class="fa-solid fa-copy"></i>
                        </button>
                        <button type="button" data-prod-toggle="${escapeHtml(p.id)}" title="${p.isAvailable ? 'Pausar' : 'Reativar'}" aria-label="Pausar ou reativar produto" class="btn btn-ghost btn-icon">
                            <i class="fa-solid ${p.isAvailable ? 'fa-pause' : 'fa-play'}"></i>
                        </button>
                        <button type="button" data-cfg-open data-cfg-id="${escapeHtml(p.id)}" data-cfg-name="${escapeHtml(p.name)}" title="Modificadores e combo" aria-label="Modificadores e combo" class="btn btn-ghost btn-icon">
                            <i class="fa-solid fa-sliders"></i>
                        </button>
                        <button type="button" data-prod-del="${escapeHtml(p.id)}" data-prod-name="${escapeHtml(p.name)}" title="Remover" aria-label="Remover produto" class="btn btn-danger btn-icon">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>`
        )
        .join('\n');

/**
 * Catalogo de produtos.
 *
 * Veio do "modo Produtos" do PDV, que ocupava cerca de 900 linhas e era 60% do
 * arquivo. Ficou aqui para o PDV voltar a ser so venda e o cadastro ficar ao
 * lado do estoque -- a entidade e a mesma, entao tambem o lugar e o mesmo.
 */
export function renderCatalog(d: CatalogData): string {
    return `        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                <div class="card card-pad">
                    <h3 class="text-title flex items-center gap-2"><i class="fa-solid fa-plus-circle text-accent"></i> Novo Item</h3>
                    <p class="text-caption text-ink-3 mb-4">Entra no cardapio e no PDV na hora</p>
                    <form id="catForm" onsubmit="return createProduct(event)" class="space-y-3">
                        <div>
                            <label class="label" for="catName">Nome</label>
                            <input id="catName" type="text" name="name" required maxlength="80" placeholder="Ex: X-Burguer Especial" class="input">
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="label" for="catPrice">Preco (R$)</label>
                                <input id="catPrice" type="number" step="0.01" min="0" name="price" required inputmode="decimal" placeholder="29.90" oninput="catMarginHint()" class="input">
                            </div>
                            <div>
                                <label class="label" for="catCost">Custo (R$)</label>
                                <input id="catCost" type="number" step="0.01" min="0" name="costPrice" inputmode="decimal" placeholder="0.00" oninput="catMarginHint()" class="input">
                            </div>
                        </div>
                        <p id="catMarginHint" class="text-caption text-ink-3">Informe o preco de compra para calcular a margem.</p>
                        <div>
                            <label class="label" for="catCategory">Categoria</label>
                            <input id="catCategory" type="text" name="category" list="categoryList" maxlength="40" placeholder="Escolha ou escreva" class="input">
                            <!--
                                As sugeridas entram na lista mesmo sem nenhum
                                produto nelas.

                                A datalist so oferece o que ja existe no catalogo, e
                                por isso ela nasce vazia: a loja ainda nao
                                classificou nada, entao o campo oferece "Geral" e a
                                pessoa digita "salgado" com a caixa baixa, que vira
                                uma categoria so dela. Offer as canonicas antes de
                                existir e' o que faz a separacao por tipo
                                aparecer no filtro do PDV -- sem esperar alguem
                                inventar o nome certo.
                            -->
                            <datalist id="categoryList">
                                ${[...new Set([...CATEGORIAS, ...d.categories])]
                                    .map((c) => `<option value="${escapeHtml(c)}"></option>`)
                                    .join('')}
                            </datalist>
                            <p class="text-caption text-ink-3 mt-1">Sugestoes: ${CATEGORIAS.slice(0, 4).map((c) => escapeHtml(c)).join(', ')}</p>
                        </div>
                        <div>
                            <label class="label" for="catDescription">Descricao (opcional)</label>
                            <textarea id="catDescription" name="description" rows="2" maxlength="200" placeholder="Ingredientes, detalhes..." class="input"></textarea>
                        </div>
                        <label class="flex items-center gap-2 text-body text-ink-2">
                            <input type="checkbox" name="isAvailable" checked class="accent-accent w-4 h-4"> Disponivel no cardapio
                        </label>
                        <label class="flex items-center gap-2 text-body text-ink-2">
                            <input type="checkbox" name="trackStock" class="accent-accent w-4 h-4"> Controlar estoque
                        </label>
                        <div class="grid grid-cols-2 gap-3 hidden" id="newStockFields">
                            <div>
                                <label class="label" for="catStock">Saldo inicial</label>
                                <input id="catStock" type="number" name="stock" min="0" value="0" inputmode="numeric" class="input">
                            </div>
                            <div>
                                <label class="label" for="catMinStock">Estoque minimo</label>
                                <input id="catMinStock" type="number" name="minStock" min="0" value="0" inputmode="numeric" class="input">
                            </div>
                        </div>
                        <button type="submit" class="btn btn-primary w-full">
                            <i class="fa-solid fa-save"></i> Salvar no Cardapio
                        </button>
                    </form>
                </div>

            <div class="card lg:col-span-2 flex flex-col overflow-hidden">
                <div class="card-pad pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line">
                    <div>
                        <h3 class="text-title flex items-center gap-2"><i class="fa-solid fa-utensils text-accent"></i> Cardapio</h3>
                        <p class="text-caption text-ink-3">${d.products.length} item(ns)${d.lowStock > 0 ? ` &middot; ${d.lowStock} precisando de reposicao` : ''}</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <!--
                            Largura declarada e shrink-0 em busca e select.

                            Sem isso, o campo de busca encolhe ate quase nada e o
                            texto digitado rola para fora da caixa: a pessoa ve
                            "arro" e nenhuma das teclas se perdeu. Input nao tem
                            min-width:auto como o texto tem, entao ele cede espaco
                            sem avisar -- e o select do lado faz o mesmo. Ja
                            aconteceu nesta tela, no Estoque e no PDV; o que
                            resolve e' o mesmo nos tres.
                        -->
                        <input id="productSearch" type="search" placeholder="Buscar item ou SKU..." oninput="filterProducts()" class="input w-56 shrink-0" autocomplete="off">
                        <select id="productCategory" onchange="filterProducts()" class="input w-auto shrink-0">
                            <option value="">Todas</option>
                            ${d.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                        </select>
                        <a href="/api/admin/products.csv" class="chip" title="Baixar CSV do cardapio">
                            <i class="fa-solid fa-file-csv"></i> CSV
                        </a>
                        <button type="button" onclick="document.getElementById('importBox').classList.toggle('hidden')" class="chip" title="Importar CSV">
                            <i class="fa-solid fa-file-import"></i> Importar
                        </button>
                    </div>
                </div>

                <div class="px-5 pb-5">
                    <div id="importBox" class="hidden mb-4 p-3 rounded-card bg-surface-2 border border-line">
                        <p class="text-caption text-ink-3 mb-2">Cole o CSV com o cabecalho: <code class="badge badge-neutral badge-xs font-mono">sku;nome;preco;custo;categoria;estoque;minimo;controlar_estoque;disponivel;descricao</code></p>
                        <textarea id="importCsv" rows="4" placeholder="nome;preco;custo&#10;Marmita de Frango;22,00;12,00" class="input font-mono text-caption"></textarea>
                        <div class="flex gap-2 mt-2">
                            <button type="button" onclick="importCsv()" class="btn btn-primary btn-sm">Importar</button>
                            <button type="button" onclick="fetchProductsCsv()" class="chip">Colar exemplo do cardapio atual</button>
                        </div>
                    </div>


                    <div id="productList" class="space-y-2 max-h-[calc(100vh-19rem)] overflow-y-auto">
                        ${d.products.length === 0 ? cardVazio('Nenhum produto cadastrado.', 'fa-utensils') : ''}
                        ${manageRows(d)}
                    </div>
                </div>
            </div>
        </div>

        <script>
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

            /*
             * Um listener so para os cinco botoes de cada linha.
             *
             * Antes cada botao chamava a sua funcao por onclick com o id escrito
             * dentro do atributo. Um id interpolado em codigo e' uma string feita
             * no servidor: se um deles trouxer uma aspa, o bloco de script para
             * de fazer sentido e a pagina perde TODOS os ouvintes de uma vez --
             * os botoes continuam visiveis e nenhum responde. O nome do produto
             * vai em data-prod-name e nao entra no codigo.
             *
             * Registrado antes de qualquer outra coisa deste arquivo, e a
             * delegacao vai no document: e' o que garante que um erro em um
             * ouvinte posterior nao deixe esta tela sem botao nenhum.
             */
            document.addEventListener('click', function (ev) {
                var alvo = ev.target;
                if (!alvo || !alvo.closest) return;

                var foto = alvo.closest('[data-prod-photo]');
                if (foto) { uploadPhoto(foto.dataset.prodPhoto); return; }

                var dup = alvo.closest('[data-prod-dup]');
                if (dup) { duplicateProduct(dup.dataset.prodDup); return; }

                var pausa = alvo.closest('[data-prod-toggle]');
                if (pausa) { toggleAvailability(pausa.dataset.prodToggle); return; }

                var apaga = alvo.closest('[data-prod-del]');
                if (apaga) { deleteProduct(apaga.dataset.prodDel, apaga.dataset.prodName); return; }
            });

            async function importCsv() {
                var box = document.getElementById('importCsv');
                if (!box.value.trim()) { flash('err', 'Cole o conteudo do CSV.'); return; }
                confirmThen(
                    'Os produtos do CSV entram no catalogo e substituem os que temem o mesmo codigo. ' +
                        'O catalogo atual continua como esta, entao confira a contagem depois de importar.',
                    async function () {
                        try {
                            var r = await postJSON('/api/admin/products/import', { csv: box.value });
                            if (!r.ok) { flash('err', r.data.error || 'Erro ao importar'); return; }
                            var msg = r.data.created + ' criado(s), ' + r.data.updated + ' atualizado(s), ' + r.data.skipped + ' ignorado(s)';
                            if (r.data.errors && r.data.errors.length) msg += ' | ' + r.data.errors.slice(0, 3).join(' | ');
                            flash(r.data.errors && r.data.errors.length ? 'err' : 'ok', msg);
                            if (!r.data.errors || !r.data.errors.length) setTimeout(function () { location.reload(); }, 1600);
                        } catch (e) { flash('err', 'Erro de conexao'); }
                    },
                    { titulo: 'Importar produtos', confirmar: 'Importar' }
                );
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

            async function cfgOpen(productId, productName) {
                cfgProductId = productId;
                document.getElementById('cfgTitle').textContent = 'Modificadores - ' + productName;
                document.getElementById('cfgBody').innerHTML = '<p class="text-body text-ink-3">Carregando...</p>';
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
                    document.getElementById('cfgBody').innerHTML = '<p class="text-body text-accent-red">Erro ao carregar.</p>';
                }
            }

            function cfgRender(full, groups) {
                var attached = {};
                full.modifierGroups.forEach(function (g) { attached[g.id] = true; });

                var html = '';

                // ---- grupos ligados ----
                html += '<div><h4 class="text-body font-bold text-ink mb-2">Grupos neste produto</h4>';
                if (full.modifierGroups.length === 0) {
                    html += '<p class="text-body text-ink-3">Nenhum grupo vinculado.</p>';
                } else {
                    full.modifierGroups.forEach(function (g) {
                        html += '<div class="p-3 rounded-card bg-sunken mb-2">'
                            + '<div class="flex items-center justify-between gap-2">'
                            + '<span class="text-sm font-medium ink">' + esc(g.name) + '</span>'
                            + '<div class="flex gap-1">'
                            + '<button type="button" onclick="cfgToggleGroup(\\'' + esc(g.id) + '\\')" class="badge badge-neutral badge-xs">Desvincular</button>'
                            + '<button type="button" onclick="cfgDeleteGroup(\\'' + esc(g.id) + '\\')" class="badge badge-danger badge-xs">Excluir</button>'
                            + '</div></div>'
                            + '<div class="text-caption text-ink-3 mt-1 mb-2">'
                            + (g.maxSelect <= 1 ? 'Escolha unica' : 'Ate ' + g.maxSelect + ' opcoes') + (g.required ? ' | obrigatorio' : '')
                            + ' | ' + g.options.length + ' opcao(oes)</div>'
                            + '<div class="space-y-1">'
                            + g.options.map(function (o) {
                                return '<div class="flex items-center gap-2 text-xs ink-2">'
                                    + '<span class="flex-1 truncate pl-2 border-l line">' + esc(o.name) + '</span>'
                                    + '<span class="text-ink-3">' + (o.price > 0 ? '+ R$ ' + o.price.toFixed(2) : 'sem acrescimo') + '</span>'
                                    + '<button type="button" onclick="cfgDeleteOption(\\'' + esc(o.id) + '\\')" class="badge badge-danger badge-xs" title="Remover opcao">'
                                    + '<i class="fa-solid fa-xmark"></i></button></div>';
                            }).join('')
                            + '</div>'
                            + '<div class="flex gap-1 mt-2">'
                            + '<input id="cfgOptName' + esc(g.id) + '" placeholder="Nova opcao" class="flex-1 px-2 py-1 text-xs input">'
                            + '<input id="cfgOptPrice' + esc(g.id) + '" type="number" step="0.01" placeholder="+0,00" class="w-20 px-2 py-1 text-xs input">'
                            + '<button type="button" onclick="cfgAddOption(\\'' + esc(g.id) + '\\')" class="chip w-8 h-7 rounded-lg text-xs flex items-center justify-center" title="Adicionar opcao">'
                            + '<i class="fa-solid fa-plus"></i></button></div>'
                            + '</div>';
                    });
                }
                html += '</div>';

                // ---- grupos disponiveis ----
                var avail = groups.filter(function (g) { return !attached[g.id]; });
                html += '<div><h4 class="text-body font-bold text-ink mb-2">Vincular grupo</h4>';
                if (avail.length === 0) {
                    html += '<p class="text-body text-ink-3">Crie um grupo abaixo ou todos ja estao vinculados.</p>';
                } else {
                    html += '<div class="flex flex-wrap gap-2">' + avail.map(function (g) {
                        return '<button type="button" onclick="cfgToggleGroup(\\'' + esc(g.id) + '\\')" class="chip px-2.5 py-1.5 rounded-lg text-xs font-medium transition">'
                            + '<i class="fa-solid fa-plus"></i> ' + esc(g.name) + '</button>';
                    }).join('') + '</div>';
                }
                html += '</div>';

                // ---- novo grupo ----
                html += '<details class="p-3 rounded-card bg-sunken"><summary class="cursor-pointer text-sm font-semibold ink">Criar novo grupo de modificadores</summary>'
                    + '<div class="grid grid-cols-2 gap-2 mt-3">'
                    + '<div class="col-span-2"><input id="cfgGroupName" placeholder="Nome (Ponto da carne)" class="w-full px-3 py-2 text-sm input"></div>'
                    + '<div><input id="cfgGroupMax" type="number" min="1" max="20" value="1" placeholder="Max" class="w-full px-3 py-2 text-sm input"></div>'
                    + '<div><input id="cfgGroupMin" type="number" min="0" max="20" value="0" placeholder="Min" class="w-full px-3 py-2 text-sm input"></div>'
                    + '<div class="col-span-2 flex items-center gap-2"><input type="checkbox" id="cfgGroupReq" class="accent-accent w-4 h-4"><span class="text-sm ink-2">Obrigatorio</span></div>'
                    + '<div class="col-span-2"><textarea id="cfgGroupOptions" rows="3" placeholder="Uma opcao por linha: Nome | acrescimo | prefixo&#10;Mal passado | 0 | P&#10;Bacon | 6 | Extra" class="w-full px-3 py-2 text-sm input font-mono text-xs"></textarea></div>'
                    + '<button type="button" onclick="cfgCreateGroup()" class="btn btn-primary col-span-2 text-sm py-2 font-medium">Criar grupo</button>'
                    + '</div></details>';

                // ---- combo ----
                html += '<div class="pt-3 border-t border-line"><h4 class="text-body font-bold text-ink mb-2">Combo</h4>'
                    + '<label class="flex items-center gap-2 text-sm ink-2 mb-2">'
                    + '<input type="checkbox" id="cfgCombo" ' + (full.isCombo ? 'checked' : '') + ' class="accent-accent w-4 h-4">'
                    + 'Este produto e um combo (baixa estoque nos componentes)</label>'
                    + '<div class="space-y-1" id="cfgComboList">'
                    + full.comboComponents.map(function (c) {
                        /*
                         * A quantidade de cada componente.
                         *
                         * O campo fica DENTRO de um rotulo, e nao apontado por
                         * "for". O id teria de ser unico por componente e a
                         * lista e' montada aqui a cada abertura da janela --
                         * um id gerado resolveria, mas o texto do rotulo e' o
                         * nome do proprio componente, entao o rotulo involve o
                         * campo e o nome acessivel sai de graça.
                         */
                        return '<label class="flex items-center gap-2 p-2 rounded-card bg-sunken">'
                            + '<span class="text-sm ink flex-1 truncate">' + esc(c.name) + '</span>'
                            + '<input type="number" min="1" value="' + c.quantity + '" data-cid="' + esc(c.componentId) + '" class="cfg-qty w-16 px-2 py-1 text-sm input">'
                            + '<button type="button" onclick="cfgRemoveComponent(\\'' + esc(c.componentId) + '\\')" class="badge-red w-7 h-7 rounded text-xs" aria-label="Remover ' + esc(c.name) + ' do combo">x</button></div>';
                    }).join('')
                    + '</div>'
                    + '<div class="flex gap-2 mt-2">'
                    + '<select id="cfgComponentPick" class="flex-1 px-2 py-1.5 text-sm input"><option value="">Adicionar componente...</option>'
                    + PDV_CATALOG.filter(function (x) { return x.id !== cfgProductId; }).map(function (x) {
                        return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
                    }).join('') + '</select>'
                    + '<button type="button" onclick="cfgAddComponent()" class="chip px-3 py-1.5 rounded-lg text-sm font-medium">+</button></div>'
                    + '<button type="button" onclick="cfgSaveCombo()" class="btn btn-primary mt-2 w-full text-sm py-2 font-medium">Salvar combo</button></div>';

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
                confirmThen(
                    'O grupo sai de todos os produtos que o usam. Os produtos continuam no catalogo, sem as opcoes dele.',
                    async function () {
                        var r = await fetch('/api/admin/modifier-groups/' + encodeURIComponent(groupId), { method: 'DELETE' });
                        if (!r.ok) { flash('err', 'Erro ao excluir grupo.'); return; }
                        flash('ok', 'Grupo excluido.');
                        cfgRefresh();
                    },
                    { titulo: 'Excluir grupo de modificadores', confirmar: 'Excluir' }
                );
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
                div.className = 'flex items-center gap-2 p-2 rounded-card bg-sunken';
                div.innerHTML = '<span class="text-sm ink flex-1 truncate">' + esc(p.name) + '</span>'
                    + '<input type="number" min="1" value="1" data-cid="' + esc(id) + '" class="cfg-qty w-16 px-2 py-1 text-sm input">'
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

            function catMarginHint() {
                var form = document.querySelector('#catForm');
                if (!form) return;
                var price = parseFloat(form.querySelector('[name="price"]').value) || 0;
                var cost = parseFloat(form.querySelector('[name="costPrice"]').value) || 0;
                var out = document.getElementById('catMarginHint');
                if (!cost) {
                    out.textContent = 'Informe o preco de compra para calcular a margem.';
                    out.className = 'text-caption text-ink-3';
                    return;
                }
                var margin = Math.round(((price - cost) / price) * 100);
                out.textContent = 'Custo R$ ' + cost.toFixed(2) + ' | margem ' + margin + '% | lucro R$ ' + (price - cost).toFixed(2);
                out.className = 'text-caption font-semibold ' + (margin < 20 ? 'text-accent-orange' : 'text-accent-emerald');
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

            function deleteProduct(id, nome) {
                confirmThen(
                    (nome ? 'O produto "' + nome + '" sai' : 'O produto sai') +
                        ' do cardapio e some do PDV. O que ja foi pedido continua no historico.',
                    async function () {
                        try {
                            var r = await postJSON('/api/admin/products/' + encodeURIComponent(id) + '/delete', {});
                            if (!r.ok) { flash('err', r.data.error || 'Erro ao apagar'); return; }
                            location.reload();
                        } catch (e) { flash('err', 'Erro de conexao'); }
                    },
                    { titulo: 'Remover do cardapio', confirmar: 'Remover' }
                );
            }

            // Botao de configuracao de modificadores/combo (delegado: o nome do
            // produto vai em data attribute para nao quebrar o JS com apostrofo).
            document.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-cfg-open]');
                if (btn) cfgOpen(btn.dataset.cfgId, btn.dataset.cfgName || '');
            });

            // Revela os campos de saldo quando "controlar estoque" e marcado.
            try {
                var form = document.getElementById('catForm');
                var trackBox = form ? form.querySelector('[name="trackStock"]') : null;
                var stockFields = document.getElementById('newStockFields');
                if (trackBox && stockFields) {
                    trackBox.addEventListener('change', function () {
                        stockFields.classList.toggle('hidden', !trackBox.checked);
                    });
                }
            } catch (err) {
                log.warn('Campo de controle de estoque nao encontrado', err);
            }
        </script>`;
}
