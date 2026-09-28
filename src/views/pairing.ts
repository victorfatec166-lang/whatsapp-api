import { escapeHtml } from './html';
import type { ConnectionState } from '../services/bot';
import { QR_TTL_MS } from '../services/bot';

export type PairData = {
    state: ConnectionState;
    authPath: string;
    hasSavedSession: boolean;
};

const PHASES: Record<string, { label: string; badge: string; hint: string }> = {
    desconectado: {
        label: 'Desconectado',
        badge: 'badge-red',
        hint: 'Sem conexao com o WhatsApp. Se nao houver sessao salva, um QR de pareamento aparece aqui.',
    },
    'aguardando-qr': {
        label: 'Aguardando QR',
        badge: 'badge-amber',
        hint: 'No celular: WhatsApp > Aparelhos conectados > Conectar com numero de telefone. Leia o codigo abaixo.',
    },
    escaneado: {
        label: 'QR lido',
        badge: 'badge-amber',
        hint: 'Codigo lido. Aguarde alguns segundos enquanto o WhatsApp sincroniza a conta.',
    },
    sincronizando: {
        label: 'Sincronizando',
        badge: 'badge-amber',
        hint: 'Reabrindo o socket e sincronizando as mensagens.',
    },
    conectado: {
        label: 'Conectado',
        badge: 'badge-emerald',
        hint: 'Bot ativo e respondendo as mensagens.',
    },
    deslogado: {
        label: 'Sessao encerrada',
        badge: 'badge-red',
        hint: 'A sessao foi encerrada pelo celular. Leia um novo QR para parear novamente.',
    },
};

function phonePretty(raw: string | null): string {
    if (!raw) return '-';
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11) return '+55 ' + digits.slice(0, 2) + ' ' + digits.slice(2, 7) + '-' + digits.slice(7);
    if (digits.length === 13) return '+' + digits.slice(0, 2) + ' ' + digits.slice(2, 4) + ' ' + digits.slice(4, 9) + '-' + digits.slice(9);
    return raw;
}

function infoRow(label: string, value: string): string {
    return '                    <div class="flex justify-between gap-3 py-2 border-b line last:border-0">'
        + '<span class="text-sm ink-3">' + label + '</span>'
        + '<span class="text-sm font-medium ink text-right">' + value + '</span>'
        + '</div>';
}

export function renderPairing(d: PairData): string {
    const phase = PHASES[d.state.phase] ?? PHASES.desconectado;
    const showQr = d.state.phase === 'aguardando-qr' || d.state.phase === 'escaneado';
    const connected = d.state.phase === 'conectado';

    const reconnectBtn =
        '<button onclick="reconnect()" class="px-3 py-2 rounded-lg text-sm font-medium transition badge-slate flex items-center gap-2">'
        + '<i class="fa-solid fa-rotate"></i> Reconectar</button>';

    const unpairBtn =
        '<button onclick="unpair()" class="px-3 py-2 rounded-lg text-sm font-medium transition badge-red flex items-center gap-2">'
        + '<i class="fa-solid fa-link-slash"></i> Desconectar e parear outro numero</button>';

    return [
        '        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">',

        '            <div class="surface border line rounded-2xl p-5 shadow-sm">',
        '                <div class="flex items-center justify-between gap-3 mb-4">',
        '                    <h3 class="font-bold ink flex items-center gap-2"><i class="fa-brands fa-whatsapp accent-emerald"></i> Pareamento</h3>',
        '                    <span id="phaseBadge" class="' + phase.badge + ' text-xs font-bold uppercase px-2.5 py-1 rounded-full">' + phase.label + '</span>',
        '                </div>',

        '                <div id="qrBox" class="' + (showQr ? '' : 'hidden') + ' flex flex-col items-center gap-3 py-2">',
        // bg-white e proposital: um QR so e lido com/modules escuros sobre fundo
        // claro, entao este container nao acompanha o tema escuro.
        '                    <div id="qrCode" class="p-3 rounded-2xl bg-white border line"></div>',
        '                    <p class="text-xs ink-3 text-center">O codigo renova sozinho e expira em ~' + Math.round(QR_TTL_MS / 1000) + 's.</p>',
        '                </div>',

        '                <div id="waitingBox" class="' + (showQr ? 'hidden' : '') + ' py-8 text-center">',
        '                    <i class="fa-solid fa-circle-notch fa-spin text-3xl ink-3"></i>',
        '                    <p class="text-sm ink-3 mt-3">Aguardando o WhatsApp emitir um codigo de pareamento...</p>',
        '                </div>',

        '                <p id="phaseHint" class="text-sm ink-2 mt-3">' + phase.hint + '</p>',
        '                <p id="lastError" class="text-xs accent-red mt-2 ' + (d.state.lastError ? '' : 'hidden') + '">' + escapeHtml(d.state.lastError ?? '') + '</p>',

        '                <div class="mt-4 flex flex-wrap gap-2">',
        connected ? '' : reconnectBtn,
        d.hasSavedSession || connected ? unpairBtn : '',
        '                </div>',
        '            </div>',

        '            <div class="space-y-5">',
        '                <div class="surface border line rounded-2xl p-5 shadow-sm">',
        '                    <h3 class="font-bold ink mb-3 flex items-center gap-2"><i class="fa-solid fa-list-ol accent-amber"></i> Como conectar</h3>',
        '                    <ol class="space-y-2 text-sm ink-2 list-decimal list-inside">',
        '                        <li>No celular, abra o WhatsApp.</li>',
        '                        <li>Menu <strong>Aparelhos conectados</strong>.</li>',
        '                        <li>Toque em <strong>Conectar com numero de telefone</strong>.</li>',
        '                        <li>Leia o codigo QR exibido ao lado com a camera do celular.</li>',
        '                        <li>Use o <strong>codigo de 8 digitos</strong> se o WhatsApp pedir (a tela mostra o codigo de pareamento).</li>',
        '                    </ol>',
        '                </div>',

        '                <div class="surface border line rounded-2xl p-5 shadow-sm">',
        '                    <h3 class="font-bold ink mb-3 flex items-center gap-2"><i class="fa-solid fa-address-card accent-amber"></i> Conta pareada</h3>',
        infoRow('Numero', escapeHtml(phonePretty(d.state.phone))),
        infoRow('Nome', escapeHtml(d.state.name ?? '-')),
        infoRow('Aparelho', escapeHtml(d.state.platform ?? '-')),
        infoRow('Sessao salva', d.hasSavedSession ? 'Sim' : 'Nao'),
        infoRow('Credenciais', escapeHtml(d.authPath)),
        '                </div>',

        '                <div class="surface border line rounded-2xl p-5 shadow-sm" style="border-left: 4px solid var(--badge-red-ink)">',
        '                    <h3 class="font-bold accent-red mb-2 flex items-center gap-2"><i class="fa-solid fa-triangle-exclamation"></i> Atencao</h3>',
        '                    <p class="text-sm ink-2">O QR Code daqui concede controle total da conta do WhatsApp. '
        + 'Mantenha o painel em rede local e nunca exponha esta pagina na internet aberta.</p>',
        '                </div>',
        '            </div>',
        '        </div>',
    ].join('\n');
}

export const PAIRING_CLIENT_SCRIPT = [
    '        // ---- Pareamento WhatsApp ----',
    '        var PHASE_META = {',
    '            "desconectado": ["Desconectado", "badge-red"],',
    '            "aguardando-qr": ["Aguardando QR", "badge-amber"],',
    '            "escaneado": ["QR lido", "badge-amber"],',
    '            "sincronizando": ["Sincronizando", "badge-amber"],',
    '            "conectado": ["Conectado", "badge-emerald"],',
    '            "deslogado": ["Sessao encerrada", "badge-red"]',
    '        };',
    '        var lastQr = null;',
    '',
    '        function applyConnection(state) {',
    '            var meta = PHASE_META[state.phase] || PHASE_META.desconectado;',
    '            var badge = document.getElementById("phaseBadge");',
    '            if (badge) {',
    '                badge.textContent = meta[0];',
    '                badge.className = meta[1] + " text-xs font-bold uppercase px-2.5 py-1 rounded-full";',
    '            }',
    '            var err = document.getElementById("lastError");',
    '            if (err) {',
    '                if (state.lastError) { err.textContent = state.lastError; err.classList.remove("hidden"); }',
    '                else { err.classList.add("hidden"); }',
    '            }',
    '            var wantsQr = state.phase === "aguardando-qr" || state.phase === "escaneado";',
    '            var qrBox = document.getElementById("qrBox");',
    '            var waitBox = document.getElementById("waitingBox");',
    '            if (qrBox) qrBox.classList.toggle("hidden", !wantsQr);',
    '            if (waitBox) waitBox.classList.toggle("hidden", wantsQr);',
    '            if (state.qr && state.qr !== lastQr) {',
    '                lastQr = state.qr;',
    '                fetch("/api/bot/qr.svg?v=" + encodeURIComponent(state.qrIssuedAt || 0))',
    '                    .then(function (r) { return r.ok ? r.text() : ""; })',
    '                    .then(function (svg) {',
    '                        var box = document.getElementById("qrCode");',
    '                        if (box) box.innerHTML = svg || "<p class=\'text-xs text-stone-500\'>Nao foi possível carregar o QR.</p>";',
    '                    })',
    '                    .catch(function () {});',
    '            }',
    '            if (!state.qr) lastQr = null;',
    '        }',
    '',
    '        function connectStream() {',
    '            var es = new EventSource("/admin/events");',
    '            es.addEventListener("connection", function (e) {',
    '                try { applyConnection(JSON.parse(e.data)); } catch (err) {}',
    '            });',
    '            es.addEventListener("update", function () {',
    '                if (document.getElementById("phaseBadge")) fetch("/api/bot/connection").then(function (r) { return r.json(); }).then(applyConnection).catch(function () {});',
    '                else location.reload();',
    '            });',
    '        }',
    '        connectStream();',
    '        fetch("/api/bot/connection").then(function (r) { return r.json(); }).then(applyConnection).catch(function () {});',
    '',
    '        async function reconnect() {',
    '            flash("ok", "Solicitando reconexao...");',
    '            var r = await postJSON("/admin/bot/reconnect", {});',
    '            if (!r.ok) flash("err", r.data.error || "Erro ao reconectar");',
    '        }',
    '        async function unpair() {',
    '            confirmThen("Isso encerra a sessao atual e apaga os credenciais salvos. Continuar?", async function () {',
    '                var r = await postJSON("/admin/bot/logout", {});',
    '                if (r.ok) { lastQr = null; location.reload(); }',
    '                else flash("err", r.data.error || "Erro ao desconectar");',
    '            });',
    '        }',
].join('\n');
