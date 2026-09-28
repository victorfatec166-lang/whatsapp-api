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
                    box.className = 'mb-4 px-4 py-3 rounded-card text-small font-medium border ' +
                        (kind === 'ok' ? 'badge-success' : 'badge-danger');
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
