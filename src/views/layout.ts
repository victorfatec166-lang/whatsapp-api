import { escapeHtml } from './html';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('layout');

// O union so lista o que existe hoje em TABS. Caixa, Clientes, Bot, Stats,
// Reports e System saíram da barra, e isTabId() so aceita o que esta em TABS,
//entao mantê-los aqui dava a impressao de que ainda dava para abrir ?tab=caixa
// e nao dava: LEGACY_TABS e' que resolve o link antigo, com redirecionamento.
export type TabId = 'home' | 'kanban' | 'pdv' | 'estoque' | 'calendario' | 'faturamento' | 'whatsapp' | 'config';

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

    { id: 'whatsapp', group: 'whatsapp', label: 'WhatsApp', icon: 'fa-brands fa-whatsapp', hint: 'Conexao e textos do bot' },

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
                function confirmThen(message, fn) {
                    if (confirm(message)) fn();
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

    return `                    <aside class="w-60 shrink-0 bg-surface border-r border-line flex flex-col hidden md:flex">
                        <a href="/admin" title="Ir para o inicio" class="h-16 px-4 flex items-center gap-2.5 border-b border-line text-body font-bold tracking-tight hover:bg-surface-2 transition">
                            <i class="fa-solid fa-burger text-accent"></i>
                            <span class="truncate">${escapeHtml(businessName)}</span>
                        </a>
                        <nav class="flex-1 px-3 pb-3 overflow-y-auto">
${blocks}
                        </nav>
                        <div class="px-3 py-3 border-t border-line">
                            <span class="badge ${botOnline ? 'badge-success' : 'badge-danger'}">
                                <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
                                Bot ${botOnline ? 'online' : 'offline'}
                            </span>
                        </div>
                    </aside>

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
