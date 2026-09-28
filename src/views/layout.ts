import { escapeHtml } from './html';

export type TabId = 'home' | 'kanban' | 'pdv' | 'estoque' | 'config' | 'calendario' | 'stats' | 'bot' | 'reports' | 'system' | 'whatsapp';

/**
 * Ordem da sidebar: primeiro o que voce usa todo dia (operacao), depois o
 * setup do WhatsApp, depois analise e por ultimo ajustes. Within each group
 * the most used screen comes first.
 */
export const TAB_GROUPS = [
    { id: 'operacao', label: 'Operacao' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'analise', label: 'Analise' },
    { id: 'ajustes', label: 'Ajustes' },
] as const;

export type TabGroupId = (typeof TAB_GROUPS)[number]['id'];

export const TABS: Array<{ id: TabId; group: TabGroupId; label: string; icon: string; hint: string }> = [
    { id: 'home', group: 'operacao', label: 'Inicio', icon: 'fa-solid fa-house', hint: 'Resumo do dia e atalhos' },
    { id: 'kanban', group: 'operacao', label: 'Pedidos', icon: 'fa-solid fa-chart-pie', hint: 'Gestao de pedidos em tempo real' },
    { id: 'pdv', group: 'operacao', label: 'PDV e Cardapio', icon: 'fa-solid fa-cash-register', hint: 'Vender no balcao e gerenciar produtos' },
    { id: 'estoque', group: 'operacao', label: 'Estoque', icon: 'fa-solid fa-boxes-stacked', hint: 'Saldo de itens e movimentacoes' },
    { id: 'calendario', group: 'operacao', label: 'Calendario', icon: 'fa-solid fa-calendar-days', hint: 'Pedidos por dia' },

    { id: 'whatsapp', group: 'whatsapp', label: 'Conectar WhatsApp', icon: 'fa-solid fa-qrcode', hint: 'Parear e desconectar o bot' },
    { id: 'bot', group: 'whatsapp', label: 'Mensagens do Bot', icon: 'fa-solid fa-comment-dots', hint: 'Textos e respostas do bot' },

    { id: 'stats', group: 'analise', label: 'Estatisticas', icon: 'fa-solid fa-chart-line', hint: 'Indicadores e graficos' },
    { id: 'reports', group: 'analise', label: 'Relatorios', icon: 'fa-solid fa-file-lines', hint: 'Pedidos exportaveis' },

    { id: 'config', group: 'ajustes', label: 'Configuracoes', icon: 'fa-solid fa-gear', hint: 'Entrega e negocio' },
    { id: 'system', group: 'ajustes', label: 'Sistema / Admin', icon: 'fa-solid fa-server', hint: 'Saude do sistema' },
];

export function isTabId(v: unknown): v is TabId {
    return typeof v === 'string' && TABS.some((t) => t.id === v);
}

export function tabHint(id: TabId): string {
    return TABS.find((t) => t.id === id)?.hint ?? '';
}

/**
 * Tokens de tema. Todos os componentes usam estas variaveis em vez de cores
 * fixas, entao alternar a classe 'dark' no <html> troca o tema inteiro sem
 * nenhuma regra !important.
 */
const THEME_CSS = `
                    :root {
                        --page: #fffbeb;
                        --surface: #ffffff;
                        --surface-2: #fafaf9;
                        --sunken: #f5f5f4;
                        --line: #fde68a;
                        --line-in: #d6d3d1;
                        --ink: #1c1917;
                        --ink-2: #57534e;
                        --ink-3: #a8a29e;
                        --rail: #1c1917;
                        --rail-ink: #ffffff;
                        --accent: #d97706;
                        --accent-strong: #b45309;
                        --accent-emerald: #059669;
                        --accent-orange: #ea580c;
                        --accent-red: #dc2626;
                        --chip-bg: #fde68a;
                        --chip-ink: #78350f;
                        --chip-hover: #fcd34d;
                        --row-hover: rgba(253, 230, 138, 0.3);
                        --badge-amber-bg: #fde68a;
                        --badge-amber-ink: #92400e;
                        --badge-emerald-bg: #d1fae5;
                        --badge-emerald-ink: #065f46;
                        --badge-orange-bg: #ffedd5;
                        --badge-orange-ink: #9a3412;
                        --badge-red-bg: #fee2e2;
                        --badge-red-ink: #b91c1c;
                        --badge-red-hover: #fecaca;
                        --badge-slate-bg: #e7e5e4;
                        --badge-slate-ink: #44403c;
                    }
                    .dark {
                        --page: #0c0a09;
                        --surface: #1c1917;
                        --surface-2: #231f1d;
                        --sunken: #292524;
                        --line: #44403c;
                        --line-in: #57534e;
                        --ink: #fafaf9;
                        --ink-2: #d6d3d1;
                        --ink-3: #a8a29e;
                        --rail: #0c0a09;
                        --rail-ink: #e7e5e4;
                        --accent: #fbbf24;
                        --accent-strong: #fcd34d;
                        --accent-emerald: #34d399;
                        --accent-orange: #fb923c;
                        --accent-red: #f87171;
                        --chip-bg: #292524;
                        --chip-ink: #fcd34d;
                        --chip-hover: #3f3a37;
                        --row-hover: rgba(68, 64, 60, 0.55);
                        --badge-amber-bg: #451a03;
                        --badge-amber-ink: #fcd34d;
                        --badge-emerald-bg: #022c22;
                        --badge-emerald-ink: #6ee7b7;
                        --badge-orange-bg: #431407;
                        --badge-orange-ink: #fdba74;
                        --badge-red-bg: #450a0a;
                        --badge-red-ink: #fca5a5;
                        --badge-red-hover: #7f1d1d;
                        --badge-slate-bg: #292524;
                        --badge-slate-ink: #d6d3d1;
                    }

                    body { background-color: var(--page); color: var(--ink); }

                    .page { background-color: var(--page); }
                    .surface { background-color: var(--surface); }
                    .surface-2 { background-color: var(--surface-2); }
                    .sunken { background-color: var(--sunken); }
                    .line { border-color: var(--line); }
                    .line-in { border-color: var(--line-in); }
                    .ink { color: var(--ink); }
                    .ink-2 { color: var(--ink-2); }
                    .ink-3 { color: var(--ink-3); }
                    .rail { background-color: var(--rail); }
                    .rail-ink { color: var(--rail-ink); }
                    .rail-line { border-color: #292524; }
                    .rail-hover:hover { background-color: #292524; }
                    .row-hover:hover { background-color: var(--row-hover); }

                    .chip { background-color: var(--chip-bg); color: var(--chip-ink); border: 1px solid transparent; }
                    .chip:hover { background-color: var(--chip-hover); }

                    .badge-amber { background-color: var(--badge-amber-bg); color: var(--badge-amber-ink); }
                    .badge-emerald { background-color: var(--badge-emerald-bg); color: var(--badge-emerald-ink); }
                    .badge-orange { background-color: var(--badge-orange-bg); color: var(--badge-orange-ink); }
                    .badge-red { background-color: var(--badge-red-bg); color: var(--badge-red-ink); }
                    .badge-red:hover { background-color: var(--badge-red-hover); }
                    .badge-slate { background-color: var(--badge-slate-bg); color: var(--badge-slate-ink); }

                    .accent-amber { color: var(--accent); }
                    .accent-amber-strong { color: var(--accent-strong); }
                    .accent-emerald { color: var(--accent-emerald); }
                    .accent-orange { color: var(--accent-orange); }
                    .accent-red { color: var(--accent-red); }

                    .card-orange { border-color: #fed7aa; }
                    .dark .card-orange { border-color: #7c2d12; }
                    .card-emerald { border-color: #a7f3d0; }
                    .dark .card-emerald { border-color: #065f46; }

                    input, textarea, select { background-color: var(--surface); color: var(--ink); }
                    .dark input, .dark textarea, .dark select { background-color: var(--sunken); }
                    input::placeholder, textarea::placeholder { color: var(--ink-3); }

                    .dark .shadow-sm { box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.45); }
                    .dark .shadow-md { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.55); }
                    .dark .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.65); }

                    /* barras de grafico sem library externa */
                    .bar-track { background-color: var(--sunken); border-radius: 9999px; overflow: hidden; }
                    .bar-fill { background-color: var(--accent); height: 100%; border-radius: 9999px; }
                    .bar-fill-emerald { background-color: var(--accent-emerald); }
                    .bar-fill-orange { background-color: var(--accent-orange); }
                    .bar-fill-slate { background-color: var(--ink-3); }

                    /* tabela rolavel no mobile */
                    .table-wrap { overflow-x: auto; }
                    .table-wrap table { width: 100%; border-collapse: collapse; }
                    .table-wrap th, .table-wrap td { padding: 0.625rem 0.75rem; text-align: left; white-space: nowrap; }
                    .table-wrap thead th { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em; }
                    .table-wrap tbody tr { border-top: 1px solid var(--line); }
                    .table-wrap tbody tr:hover { background-color: var(--row-hover); }
`;

const HEAD_SCRIPTS = `
                    tailwind.config = { darkMode: 'class' };
                    // Aplica o tema salvo antes da primeira pintura para evitar
                    // "flash" do tema errado ao carregar a pagina.
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
                            dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
                            text.textContent = 'ONLINE';
                            box.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold border badge-emerald';
                        } else {
                            dot.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
                            text.textContent = 'OFFLINE';
                            box.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold border badge-red';
                        }
                    } catch (e) {
                        console.error('Erro ao buscar status do bot:', e);
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
                    box.className = 'mb-4 px-4 py-3 rounded-xl text-sm font-medium border ' +
                        (kind === 'ok' ? 'badge-emerald' : 'badge-red');
                    box.textContent = message;
                    box.classList.remove('hidden');
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
                        ? '<span class="ml-auto w-2 h-2 rounded-full bg-red-500 shrink-0" title="Bot desconectado"></span>'
                        : '';

                return `                            <a href="/admin?tab=${t.id}" title="${t.hint}"
                                class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                                    isActive
                                        ? 'bg-amber-600 text-white shadow-md'
                                        : 'ink-3 rail-hover hover:text-white'
                                }">
                                <i class="${t.icon} w-4 text-center shrink-0 ${isActive ? '' : 'accent-amber'}"></i>
                                <span class="truncate">${label}</span>
                                ${alertDot}
                            </a>`;
            })
            .join('\n');

        return `                            <p class="px-3 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">${group.label}</p>
${items}`;
    }).join('\n');

    const mobileOptions = TAB_GROUPS.map((group) => {
        const options = TABS.filter((t) => t.group === group.id)
            .map((t) => `<option value="${t.id}"${t.id === active ? ' selected' : ''}>${t.label}</option>`)
            .join('');
        return `<optgroup label="${group.label}">${options}</optgroup>`;
    }).join('');

    return `                    <aside class="w-60 shrink-0 rail rail-ink flex flex-col hidden md:flex">
                        <a href="/admin" title="Ir para o inicio" class="p-4 text-base font-bold tracking-wide flex items-center gap-3 border-b rail-line rail-hover transition">
                            <i class="fa-solid fa-burger accent-amber"></i>
                            <span class="truncate">${escapeHtml(businessName)}</span>
                        </a>
                        <nav class="flex-1 px-2 pb-3 overflow-y-auto">
${blocks}
                        </nav>
                        <div class="p-3 border-t rail-line">
                            <div class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg ${botOnline ? 'text-emerald-400' : 'text-red-400'}">
                                <span class="text-xs font-semibold flex items-center gap-2">
                                    <span class="w-1.5 h-1.5 rounded-full ${botOnline ? 'bg-emerald-400' : 'bg-red-400'}"></span>
                                    Bot ${botOnline ? 'online' : 'offline'}
                                </span>
                            </div>
                        </div>
                    </aside>

                    <!-- Navegacao mobile -->
                    <div class="md:hidden surface border-b line px-4 py-3 flex items-center justify-between gap-3">
                        <a href="/admin" class="font-bold flex items-center gap-2 shrink-0">
                            <i class="fa-solid fa-burger accent-amber"></i>
                            <span class="truncate">${escapeHtml(businessName)}</span>
                        </a>
                        <select id="mobileNav" class="text-sm rounded-lg px-2 py-1 line-in max-w-[60%]" onchange="location.href='/admin?tab=' + this.value">
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
    <script src="https://cdn.tailwindcss.com"></script>
    <script>${HEAD_SCRIPTS}    </script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>${THEME_CSS}    </style>
</head>
<body class="page font-sans ink">
    <div class="flex min-h-screen flex-col md:flex-row overflow-hidden">
${sidebar(opts.active, opts.counters ?? { pdv: opts.productCount }, opts.botOnline, opts.businessName)}

        <div class="flex-1 flex flex-col overflow-y-auto min-w-0">
            <header class="surface shadow-sm h-16 shrink-0 flex items-center justify-between gap-4 pl-4 md:pl-8 pr-4 border-b line">
                <h1 class="text-lg md:text-xl font-bold ink truncate">${opts.title}</h1>
                <div class="flex items-center gap-2 md:gap-3 shrink-0">
                    <span id="botStatus" class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold border">
                        <span id="botStatusDot" class="w-2.5 h-2.5 rounded-full"></span>
                        <span id="botStatusText">Verificando...</span>
                    </span>
                    <a href="/admin" class="chip px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-2" title="Atualizar">
                        <i class="fa-solid fa-rotate"></i>
                        <span class="hidden sm:inline">Atualizar</span>
                    </a>
                    <button
                        id="themeToggle"
                        type="button"
                        onclick="toggleTheme()"
                        class="chip w-9 h-9 rounded-lg flex items-center justify-center transition shrink-0"
                        title="Alternar tema claro/escuro"
                        aria-label="Alternar tema claro/escuro"
                    >
                        <i id="themeIcon" class="fa-solid fa-moon"></i>
                    </button>
                </div>
            </header>

            <main class="flex-1 p-4 md:p-8 w-full max-w-[1400px] mx-auto">
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
