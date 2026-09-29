import { escapeHtml } from './html';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('layout');

// O union so lista o que existe hoje em TABS. Caixa, Clientes, Bot, Stats,
// Reports e System saíram da barra, e isTabId() so aceita o que esta em TABS,
//entao mantê-los aqui dava a impressao de que ainda dava para abrir ?tab=caixa
// e nao dava: LEGACY_TABS e' que resolve o link antigo, com redirecionamento.
export type TabId = 'home' | 'kanban' | 'pdv' | 'estoque' | 'calendario' | 'chat' | 'faturamento' | 'whatsapp' | 'marketplace' | 'config';

/**
 * Ordem da sidebar: primeiro o que voce usa todo dia (operacao), depois o
 * setup do WhatsApp, depois ajustes, e por ultimo o dinheiro.
 *
 * Faturamento fica no fim de proposito: e' a unica aba que mostra quanto o
 * negocio fatura, e ela esta pronta para receber um portao de senha.
 */
export const TAB_GROUPS = [
    { id: 'operacao', label: 'Operacao' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'ajustes', label: 'Ajustes' },
    { id: 'faturamento', label: 'Faturamento' },
] as const;

export type TabGroupId = (typeof TAB_GROUPS)[number]['id'];

export const TABS: Array<{ id: TabId; group: TabGroupId; label: string; icon: string; hint: string }> = [
    { id: 'home', group: 'operacao', label: 'Inicio', icon: 'fa-solid fa-house', hint: 'Resumo do dia e atalhos' },
    { id: 'kanban', group: 'operacao', label: 'Pedidos', icon: 'fa-solid fa-chart-pie', hint: 'Gestao de pedidos em tempo real' },
    { id: 'pdv', group: 'operacao', label: 'PDV', icon: 'fa-solid fa-cash-register', hint: 'Vender no balcao' },
    { id: 'estoque', group: 'operacao', label: 'Produtos e Estoque', icon: 'fa-solid fa-boxes-stacked', hint: 'Catalogo, saldos e reposicao' },
    { id: 'calendario', group: 'operacao', label: 'Calendario', icon: 'fa-solid fa-calendar-days', hint: 'Pedidos por dia' },

    /*
     * Conversas fica em Operacao, e nao em WhatsApp, porque e' onde se trabalha
     * durante o expediente, e nao onde se configura uma vez. A aba WhatsApp
     * continua sendo a do pareamento e dos textos do bot; as duas se complementam
     * e misturar as duas colocaria a conversa do dia junto do QR de ontem.
     *
     * A posicao depois de Calendario e' a do fluxo real: a loja atende o
     * cliente, o calendario mostra o dia, e a conversa e' o meio do dia.
     */
    { id: 'chat', group: 'operacao', label: 'Conversas', icon: 'fa-solid fa-comments', hint: 'Atender pelo WhatsApp' },

    { id: 'whatsapp', group: 'whatsapp', label: 'WhatsApp', icon: 'fa-brands fa-whatsapp', hint: 'Conexao e textos do bot' },

    // Marketplace fica em Ajustes, e nao em Operacao. Ele nao e' uma tela que se
    // usa o dia inteiro: e' onde se credencia o canal e se confere se os pedidos
    // estao entrando. Depois que a conta esta ativa, quem trabalha o pedido e' o
    // Kanban, que ja recebe o marketplace como mais um channel.
    { id: 'marketplace', group: 'ajustes', label: 'Marketplace', icon: 'fa-solid fa-store', hint: 'iFood e 99Food' },

    { id: 'config', group: 'ajustes', label: 'Configuracoes', icon: 'fa-solid fa-gear', hint: 'Entrega e negocio' },

    // Um item so: resumo, caixa, clientes e pedidos vivem em sub-abas aqui.
    { id: 'faturamento', group: 'faturamento', label: 'Faturamento', icon: 'fa-solid fa-chart-column', hint: 'Receita, caixa, clientes e pedidos' },
];

/**
 * Itens que sairam da sidebar e para onde vao.
 *
 * IsTabId() so aceita o que esta em TABS, entao um ?tab=antigo deixaria de
 * funcionar silenciosamente. Mapeamos para o destino real em vez disso.
 * O "#" aponta a sub-aba que a tela antiga virava.
 */
/**
 * Itens que sairam da sidebar e para onde vao.
 *
 * IsTabId() so aceita o que esta em TABS, entao um ?tab=antigo deixaria de
 * funcionar silenciosamente. Mapeamos para o destino real em vez disso.
 *
 * O destino ja vem como caminho pronto, e nao como "aba + subaba": as
 * sub-abas do Faturamento se escolhem por ?aba=, que e' o mesmo mecanismo que
 * o servidor usa para desenhar a tela certa ja no HTML. Um #caixa tambem
 * funcionaria, mas entao teriamos dois jeitos de escolher a mesma sub-aba e o
 * proximo bug seria um deles deixar de ser lido.
 */
export const LEGACY_TABS: Record<string, string> = {
    bot: '/admin?tab=whatsapp#textos-bot',
    stats: '/admin?tab=faturamento&aba=resumo',
    reports: '/admin?tab=faturamento&aba=pedidos',
    caixa: '/admin?tab=faturamento&aba=caixa',
    clientes: '/admin?tab=faturamento&aba=clientes',
    // O catalogo saiu do PDV e virou aba de Produtos e Estoque.
    products: '/admin?tab=estoque',
    system: '/admin?tab=config',
};

export function isTabId(v: unknown): v is TabId {
    return typeof v === 'string' && TABS.some((t) => t.id === v);
}

export function tabHint(id: TabId): string {
    return TABS.find((t) => t.id === id)?.hint ?? '';
}

const HEAD_SCRIPTS = `
                    // Aplica o tema salvo antes da primeira pintura para evitar
                    // "flash" do tema errado ao carregar a pagina.
                    //
                    // A estrategia darkMode: 'class' e definida em tailwind.config.js,
                    // na hora do build -- nao aqui. Uma atribuicao a "tailwind.config"
                    // neste ponto (sobra da versao que usava o CDN) lancava
                    // ReferenceError e abortava o script antes de ler o localStorage,
                    // o que fazia o tema escuro voltar ao claro a cada troca de aba.
                    (function () {
                        try {
                            var saved = localStorage.getItem('theme');
                            var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                            if (saved === 'dark' || (!saved && prefersDark)) {
                                document.documentElement.classList.add('dark');
                            }
                        } catch (e) {}
                    })();
`;

const APP_SCRIPTS = `
                // ---- Status do bot (polling) ----
                async function fetchBotStatus() {
                    try {
                        const res = await fetch('/api/bot-status');
                        const data = await res.json();
                        const dot = document.getElementById('botStatusDot');
                        const text = document.getElementById('botStatusText');
                        const box = document.getElementById('botStatus');
                        if (!dot || !text || !box) return;
                        if (data.online) {
                            dot.className = 'w-2 h-2 rounded-full bg-success animate-pulse';
                            text.textContent = 'Bot online';
                            box.className = 'badge badge-success';
                        } else {
                            dot.className = 'w-2 h-2 rounded-full bg-danger';
                            text.textContent = 'Bot offline';
                            box.className = 'badge badge-danger';
                        }
                    } catch (e) {
                        log.error('Erro ao buscar status do bot:', e);
                    }
                }
                setInterval(fetchBotStatus, 5000);
                fetchBotStatus();

                // ---- Tema claro/escuro ----
                function applyTheme(isDark) {
                    document.documentElement.classList.toggle('dark', isDark);
                    var icon = document.getElementById('themeIcon');
                    if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
                    var btn = document.getElementById('themeToggle');
                    if (btn) btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
                }
                function toggleTheme() {
                    var isDark = !document.documentElement.classList.contains('dark');
                    applyTheme(isDark);
                    try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch (e) {}
                }
                applyTheme(document.documentElement.classList.contains('dark'));

                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
                    var saved = null;
                    try { saved = localStorage.getItem('theme'); } catch (err) {}
                    if (!saved) applyTheme(e.matches);
                });
                window.addEventListener('storage', function (e) {
                    if (e.key === 'theme') applyTheme(e.newValue === 'dark');
                });

                // ---- Utilitarios compartilhados ----
                /*
                 * Recolher e trazer de volta a barra de abas.
                 *
                 * Duas pecas em vez de uma, e o motivo esta no comentario do
                 * HTML: o botao que guarda fica na cola da barra, e o que traz
                 * de volta fica no lugar onde ela estava. Um botao so, que
                 * muda de estado, esconderia o rotulo e o icone no lugar
                 * vazio -- e no lugar vazio nao ha nada que sugira que a barra
                 * pode voltar.
                 *
                 * O estado vai para o localStorage pelo mesmo motivo do tema e
                 * da aba de estoque: preferencia que se perde a cada F5 faz o
                 * botao parar de servir para o que foi criado.
                 */
                function aplicaSidebar(aberta) {
                    var barra = document.getElementById('sidebar');
                    var guardar = document.getElementById('sidebarToggle');
                    var abrir = document.getElementById('sidebarAbrir');
                    if (!barra || !guardar || !abrir) return;

                    if (aberta) {
                        barra.classList.remove('hidden');
                        guardar.classList.remove('hidden');
                        abrir.classList.add('hidden');
                        guardar.setAttribute('aria-expanded', 'true');
                    } else {
                        barra.classList.add('hidden');
                        guardar.classList.add('hidden');
                        abrir.classList.remove('hidden');
                        guardar.setAttribute('aria-expanded', 'false');
                    }
                    try { localStorage.setItem('sidebarAberta', aberta ? '1' : '0'); } catch (e) {}
                }

                function alternaSidebar() {
                    var barra = document.getElementById('sidebar');
                    if (!barra) return;
                    aplicaSidebar(barra.classList.contains('hidden'));
                }

                function abreSidebar() {
                    aplicaSidebar(true);
                }

                // Aplica assim que o corpo existe. Este script fica no <head>, e
                // o id da barra so aparece depois do corpo -- sem o guard, a
                // preferencia era perdida a cada recarga, que e' pior do que
                // nao ter preferencia nenhuma.
                document.addEventListener('DOMContentLoaded', function () {
                    var aberta = true;
                    try {
                        aberta = localStorage.getItem('sidebarAberta') !== '0';
                    } catch (e) {}
                    aplicaSidebar(aberta);
                });

                /*
                 * Confirmacao dentro do painel, e nao o confirm() do navegador.
                 *
                 * O dialogo do navegador era o unico lugar do sistema que nao
                 * parecia com o resto: fundo cinza do sistema operacional, botao
                 * "OK" sem nome, e o titulo "localhost:3000 diz" -- o nome do
                 * endereco no lugar de uma frase que diz o que vai acontecer. A
                 * acao mais destrutiva do sistema aparecia com a aparencia de um
                 * aviso de antivirus.
                 *
                 * A janela e' criada na hora, e nao declarada na tela, porque
                 * confirmThen e' chamado de paginas diferentes. Um esqueleto
                 * reaproveitado em vez de um por tela: e' o mesmo caminho que o
                 * renderModal faz do outro lado, so que em tempo de execucao.
                 *
                 * Tres detalhes que o dialogo do navegador nao tem e que aqui
                 * importam:
                 *
                 * 1. O foco vai para CANCELAR, nao para confirmar. No dialogo do
                 *    sistema, quem aperta Enter sem olhar apaga a sessao do
                 *    WhatsApp. Aqui o Enter nao faz nada, e quem quiser apagar
                 *    precisa clicar em "Apagar" -- um movimento deliberado.
                 * 2. Esc e o clique fora cancelam SEM rodar a acao. Sao os
                 *    mesmos ouvintes das outras janelas, e o modalHide abaixo
                 *    cuida de limpar o que ficou pendente.
                 * 3. O texto entra por textContent, nunca por innerHTML. A
                 *    frase costuma trazer nome de produto e nome de cliente, que
                 *    vem do banco -- e a tela do WhatsApp ja morreu uma vez
                 *    inteira por causa de um apostrofo interpolado em JS.
                 */
                var confirmarPendente = null;
                /** Botao que abriu a janela, para devolver o foco no fim. */
                var confirmarOrigem = null;

                function confirmarMonta() {
                    var existente = document.getElementById('confirmarJanela');
                    if (existente) return existente;

                    var div = document.createElement('div');
                    div.id = 'confirmarJanela';
                    div.className = 'modal-backdrop hidden';
                    div.setAttribute('role', 'dialog');
                    div.setAttribute('aria-modal', 'true');
                    div.setAttribute('aria-labelledby', 'confirmarJanela-titulo');
                    div.setAttribute('aria-describedby', 'confirmarJanela-texto');
                    div.innerHTML =
                        '<div class="modal-panel">' +
                        '  <div class="flex items-start justify-between gap-3 mb-1">' +
                        '    <h3 id="confirmarJanela-titulo" class="text-title flex items-center gap-2">' +
                        '      <i class="fa-solid fa-triangle-exclamation text-accent-orange"></i>' +
                        '      <span id="confirmarJanela-tituloTexto"></span>' +
                        '    </h3>' +
                        '    <button type="button" data-modal-cancel onclick="confirmarCancelar()" ' +
                        '      class="btn btn-ghost px-2 -mt-1 -mr-1 shrink-0" aria-label="Fechar">' +
                        '      <i class="fa-solid fa-xmark"></i>' +
                        '    </button>' +
                        '  </div>' +
                        '  <p id="confirmarJanela-texto" class="text-body text-ink-2 mb-5"></p>' +
                        '  <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">' +
                        '    <button type="button" data-modal-cancel onclick="confirmarCancelar()" ' +
                        '      id="confirmarJanela-cancelar" class="btn btn-ghost sm:min-w-[8rem]" autofocus>Cancelar</button>' +
                        '    <button type="button" onclick="confirmarAceitar()" ' +
                        '      id="confirmarJanela-aceitar" class="btn btn-danger sm:min-w-[9rem]">Confirmar</button>' +
                        '  </div>' +
                        '</div>';
                    document.body.appendChild(div);
                    return div;
                }

                /**
                 * opcoes aceita titulo e os rotulos dos botoes. O padrao e'
                 * "Tem certeza?" e um botao chamado "Confirmar": quando a acao
                 * e' destrutiva, quem chama passa um verbo -- "Apagar", "Descartar"
                 * -- porque o botao e' a ultima leitura antes do clique, e
                 * "Confirmar" nao diz o que esta sendo confirmado.
                 */
                function confirmThen(texto, fn, opcoes) {
                    var o = opcoes || {};
                    var janela = confirmarMonta();

                    // Confirmar duas vezes em linha nao empilha duas janelas: a
                    // segunda substitui a mensagem e a acao da primeira.
                    confirmarPendente = fn;

                    // O foco volta para o botao que abriu a janela quando ela
                    // fechar. Guardar aqui, e nao em modalHide, porque o
                    // activeElement no momento de fechar ja' e' o botao da
                    // propria janela. Sem isso, quem opera o teclado perde o
                    // lugar e precisa pegar o mouse de novo.
                    var ativo = document.activeElement;
                    confirmarOrigem = ativo && ativo !== document.body ? ativo : null;

                    document.getElementById('confirmarJanela-tituloTexto').textContent = o.titulo || 'Tem certeza?';
                    document.getElementById('confirmarJanela-texto').textContent = texto;
                    document.getElementById('confirmarJanela-aceitar').textContent = o.confirmar || 'Confirmar';
                    document.getElementById('confirmarJanela-cancelar').textContent = o.cancelar || 'Cancelar';
                    modalShow('confirmarJanela');
                }

                /** Cancelar e' o caminho que NUNCA roda a acao. */
                function confirmarCancelar() {
                    confirmarPendente = null;
                    modalHide('confirmarJanela');
                    devolverFocoConfirmar();
                }

                function confirmarAceitar() {
                    var fn = confirmarPendente;
                    confirmarPendente = null;
                    modalHide('confirmarJanela');
                    devolverFocoConfirmar();
                    if (fn) fn();
                }

                function devolverFocoConfirmar() {
                    if (confirmarOrigem && document.contains(confirmarOrigem)) {
                        try { confirmarOrigem.focus(); } catch (e) {}
                    }
                    confirmarOrigem = null;
                }

                async function postJSON(url, body) {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: body === undefined ? undefined : JSON.stringify(body)
                    });
                    let parsed = {};
                    try { parsed = await res.json(); } catch (e) {}
                    return { ok: res.ok, status: res.status, data: parsed };
                }
                function flash(kind, message) {
                    var box = document.getElementById('flash');
                    if (!box) return;
                    box.className = 'mb-4 px-4 py-3 rounded-card text-small font-medium border ' +
                        (kind === 'ok' ? 'badge-success' : 'badge-danger');
                    box.textContent = message;
                    box.classList.remove('hidden');
                }

                // ---- Janelas pop-up ----
                // Fica aqui, e' nao no corpo da pagina: modalBind depende de
                // postJSON e flash, que sao daqui. Se a janela declarasse o
                // proprio bloco de script no corpo, a ordem entre os dois
                // seria o que decide se o botao funciona -- e ja foi uma
                // janela que nao abria por causa disso.
                function modalShow(id) {
                    var m = document.getElementById(id);
                    if (!m) return;
                    m.classList.remove('hidden');
                    m.classList.add('flex');
                    var foco = m.querySelector('[autofocus]');
                    if (foco) foco.focus();
                }

                function modalHide(id) {
                    var m = document.getElementById(id);
                    if (!m) return;
                    m.classList.add('hidden');
                    m.classList.remove('flex');
                    /*
                     * Fechar a confirmacao por Esc ou clique fora e' cancelar.
                     *
                     * Esses dois caminhos vem pelo modalHide, e nao por
                     * confirmarCancelar -- entao sem esta linha a acao ficaria
                     * pendente na memoria depois de uma janela que a pessoa ja
                     * fechou. Nao chegaria a rodar, porque o botao esta escondido,
                     * mas "esconder o botao" e' seguranca por acaso, e nao e' o
                     * que a pessoa quis dizer quando apertou Esc.
                     */
                    if (id === 'confirmarJanela') {
                        confirmarPendente = null;
                        devolverFocoConfirmar();
                    }
                }

                // Clique fora do painel tambem fecha.
                document.addEventListener('click', function (ev) {
                    var alvo = ev.target;
                    if (!alvo || !alvo.classList) return;
                    if (!alvo.classList.contains('modal-backdrop')) return;
                    var painel = alvo.querySelector('.modal-panel');
                    if (painel && painel.contains(ev.target)) return;
                    modalHide(alvo.id);
                });

                // Esc fecha a janela do topo.
                document.addEventListener('keydown', function (ev) {
                    if (ev.key !== 'Escape') return;
                    var abertas = [].slice.call(document.querySelectorAll('.modal-backdrop.flex'));
                    var topo = abertas[abertas.length - 1];
                    if (topo) modalHide(topo.id);
                });

                /**
                 * Liga uma janela gerada por renderModal() ao comportamento
                 * acima. Deriva os nomes de id, entao duas janelas nao conflitam
                 * e nenhuma delas precisa de Javascript proprio.
                 */
                function modalBind(id, endpoint, pendingLabel, successMessage, after) {
                    window[id + 'Open'] = function () { modalShow(id); };
                    window[id + 'Close'] = function () { modalHide(id); };

                    window[id + 'Send'] = async function (ev) {
                        if (ev) ev.preventDefault();
                        var form = document.getElementById(id + '-form');
                        var btn = document.getElementById(id + '-submit');
                        if (!form || !btn) return false;

                        // Campo numerico volta como texto no value; converte.
                        var payload = {};
                        [].slice.call(form.elements).forEach(function (el) {
                            if (!el.name) return;
                            var v = el.value;
                            if (el.type === 'number') v = v === '' ? 0 : parseFloat(v);
                            payload[el.name] = v;
                        });

                        btn.disabled = true;
                        var original = btn.innerHTML;
                        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (pendingLabel || 'Salvando...');

                        var r = await postJSON(endpoint, payload);
                        btn.disabled = false;
                        btn.innerHTML = original;

                        if (!r.ok) {
                            flash('err', (r.data && r.data.error) || 'Nao foi possivel salvar.');
                            return false;
                        }

                        form.reset();
                        modalHide(id);
                        flash('ok', successMessage);
                        if (after && typeof window[after] === 'function') window[after](r, id);
                        return false;
                    };
                }
`;

function sidebar(active: TabId, counters: Partial<Record<TabId, number>>, botOnline: boolean, businessName: string): string {
    const blocks = TAB_GROUPS.map((group) => {
        const items = TABS.filter((t) => t.group === group.id)
            .map((t) => {
                const isActive = t.id === active;
                const count = counters[t.id];
                const label = count === undefined ? t.label : `${t.label} (${count})`;

                // Sinaliza na propria sidebar quando o WhatsApp precisa de atencao.
                const alertDot =
                    t.id === 'whatsapp' && !botOnline
                        ? '<span class="ml-auto w-1.5 h-1.5 rounded-full bg-danger shrink-0" title="Bot desconectado"></span>'
                        : '';

                return `                            <a href="/admin?tab=${t.id}" title="${t.hint}" aria-current="${isActive ? 'page' : 'false'}"
                                class="nav-item ${isActive ? 'nav-item-active' : ''}">
                                <i class="${t.icon} nav-item-icon"></i>
                                <span class="truncate">${escapeHtml(label)}</span>
                                ${alertDot}
                            </a>`;
            })
            .join('\n');

        return `                            <p class="nav-group">${escapeHtml(group.label)}</p>
${items}`;
    }).join('\n');

    const mobileOptions = TAB_GROUPS.map((group) => {
        const options = TABS.filter((t) => t.group === group.id)
            .map((t) => `<option value="${t.id}"${t.id === active ? ' selected' : ''}>${escapeHtml(t.label)}</option>`)
            .join('');
        return `<optgroup label="${escapeHtml(group.label)}">${options}</optgroup>`;
    }).join('');

    /*
     * A barra lateral recolhivel, e o botao que a guarda.
     *
     * A largura (15rem) sai da tela quando ela recolhe, e o conteudo acompanha
     * por causa do `md:flex` do proprio `aside`: quem recolhe fica com a
     * coluna de conteudo inteira, o que e' o motivo de recolher em tela grande
     * -- no balcao, a area util e' o catalogo e o carrinho, nao a lista de abas.
     *
     * O estado fica em `localStorage`, como o resto das preferencias da tela
     * (tema, aba de estoque). Perder a preferencia a cada F5 faria a pessoa
     * recolher de novo toda vez, e o botao pararia de servir para o que foi
     * criado.
     *
     * O botao e' uma `button` de verdade, com `aria-expanded` -- e nao um
     * `div` com icone. Quem navega pelo teclado precisa achar o botao, e o
     * leitor de tela precisa dizer se a barra esta aberta ou fechada.
     */
    return `                    <aside id="sidebar" class="w-60 shrink-0 bg-surface border-r line flex-col hidden md:flex">
                        <a href="/admin" title="Ir para o inicio" class="h-16 px-4 flex items-center gap-2.5 border-b line text-body font-bold tracking-tight hover:bg-surface-2 transition">
                            <i class="fa-solid fa-burger text-accent"></i>
                            <span class="truncate">${escapeHtml(businessName)}</span>
                        </a>
                        <nav class="flex-1 px-3 pb-3 overflow-y-auto">
${blocks}
                        </nav>
                        <div class="px-3 py-3 border-t line">
                            <span class="badge ${botOnline ? 'badge-success' : 'badge-danger'}">
                                <span class="w-1 h-1 rounded-full bg-current"></span>
                                Bot ${botOnline ? 'online' : 'offline'}
                            </span>
                        </div>
                    </aside>

                    <!--
                        O botao que guarda a barra.

                        Fica na COLA dela, na vertical, e nao dentro dela: e o unico
                        lugar onde ele continua visivel com a barra recolhida.
                        Dentro, ele sumiria junto com o resto -- e a pessoa ficaria
                        sem caminho para trazer a barra de volta, que e' o pior
                        estado possivel para um controle de interface.
                    -->
                    <button type="button" id="sidebarToggle" onclick="alternaSidebar()"
                        class="hidden md:flex flex-col items-center justify-center gap-2 w-9 shrink-0 border-r line bg-surface hover:bg-surface-2 transition"
                        aria-controls="sidebar" aria-expanded="true" title="Recolher a barra de abas">
                        <span id="sidebarToggleIcon" class="fa-solid fa-angles-left text-sm ink-3"></span>
                        <span class="text-[10px] ink-3" id="sidebarToggleTexto">Esconder</span>
                    </button>

                    <!--
                        O botao que traz a barra de volta.

                        Fica no lugar onde a barra ESTAVA, e por isso e' invisivel
                        enquanto ela esta aberta. Uma peca so, mudando de estado,
                        seria menos codigo -- mas perderia o rotulo e o icone
                        certainos de que ali existe um botao, e no lugar vazio
                        nao ha nada que sugira que a barra pode voltar.
                    -->
                    <button type="button" id="sidebarAbrir" onclick="abreSidebar()"
                        class="hidden md:flex flex-col items-center justify-center gap-2 w-9 shrink-0 border-r line bg-surface hover:bg-surface-2 transition"
                        aria-controls="sidebar" aria-expanded="false" title="Mostrar a barra de abas">
                        <span class="fa-solid fa-bars text-sm ink-3"></span>
                        <span class="text-[10px] ink-3">Abas</span>
                    </button>

                    <!-- Navegacao mobile -->
                    <div class="md:hidden bg-surface border-b border-line px-4 py-3 flex items-center justify-between gap-3">
                        <a href="/admin" class="font-bold flex items-center gap-2 shrink-0">
                            <i class="fa-solid fa-burger text-accent"></i>
                            <span class="truncate">${escapeHtml(businessName)}</span>
                        </a>
                        <select id="mobileNav" class="input py-1.5 max-w-[58%]" onchange="location.href='/admin?tab=' + this.value">
                            ${mobileOptions}
                        </select>
                    </div>`;
}

export type LayoutOptions = {
    active: TabId;
    title: string;
    productCount: number;
    botOnline: boolean;
    /** Nome do negocio exibido no logo e no titulo da aba. */
    businessName: string;
    /** Contadores exibidos entre parenteses na sidebar. */
    counters?: Partial<Record<TabId, number>>;
    body: string;
    /** Scripts extras de uma aba especifica. */
    scripts?: string;
};

export function renderLayout(opts: LayoutOptions): string {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(opts.title)} | ${escapeHtml(opts.businessName)}</title>
    <script>${HEAD_SCRIPTS}    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="/styles/app.css">
</head>
<body>
    <div class="flex min-h-screen flex-col md:flex-row overflow-hidden">
${sidebar(opts.active, opts.counters ?? { pdv: opts.productCount }, opts.botOnline, opts.businessName)}

        <div class="flex-1 flex flex-col overflow-y-auto min-w-0">
            <header class="bg-surface h-14 md:h-16 shrink-0 flex items-center justify-between gap-4 px-4 md:px-8 border-b border-line sticky top-0 z-20">
                <h1 class="text-title truncate">${opts.title}</h1>
                <div class="flex items-center gap-2 shrink-0">
                    <span id="botStatus" class="badge hidden sm:inline-flex">
                        <span id="botStatusDot" class="w-2 h-2 rounded-full"></span>
                        <span id="botStatusText">Verificando...</span>
                    </span>
                    <a href="/admin" class="btn btn-ghost btn-sm" title="Atualizar">
                        <i class="fa-solid fa-rotate"></i>
                        <span class="hidden sm:inline">Atualizar</span>
                    </a>
                    <button
                        id="themeToggle"
                        type="button"
                        onclick="toggleTheme()"
                        class="btn btn-ghost px-2"
                        title="Alternar tema claro/escuro"
                        aria-label="Alternar tema claro/escuro"
                    >
                        <i id="themeIcon" class="fa-solid fa-moon"></i>
                    </button>
                </div>
            </header>

            <main class="flex-1 w-full max-w-content mx-auto px-4 md:px-8 py-5 md:py-8">
                <div id="flash" class="hidden"></div>
${opts.body}
            </main>
        </div>
    </div>
${opts.scripts ? `<script>${opts.scripts}</script>` : ''}
    <script>${APP_SCRIPTS}    </script>
</body>
</html>`;
}
