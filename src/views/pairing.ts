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
    return '                    <div class="flex justify-between gap-3 py-2 border-b border-line last:border-0">'
        + '<span class="text-caption text-ink-3">' + label + '</span>'
        + '<span class="text-body font-medium text-ink text-right">' + value + '</span>'
        + '</div>';
}

export function renderPairing(d: PairData): string {
    const phase = PHASES[d.state.phase] ?? PHASES.desconectado;
    const showQr = d.state.phase === 'aguardando-qr' || d.state.phase === 'escaneado';
    const connected = d.state.phase === 'conectado';

    /*
     * type="button" explicito: um button sem type dentro de um form vira submit. Estes dois nao
     * estao em form nenhum hoje, mas a regra vale para os botoes de tabela e de card, que a
     * pessoa rearranja -- e o defeito so apareceria quando alguem movesse o HTML.
     */
    const reconnectBtn =
        '<button type="button" onclick="reconnect()" class="btn btn-ghost">'
        + '<i class="fa-solid fa-rotate"></i> Reconectar</button>';

    const unpairBtn =
        '<button type="button" onclick="unpair()" class="btn btn-danger">'
        + '<i class="fa-solid fa-link-slash"></i> Desconectar e parear outro numero</button>';

    /*
     * Fica no topo do card, antes do QR, e nao como aviso generico no fim da tela: a pessoa
     * chega aqui querendo saber por que o WhatsApp nao conectou. Antes do QR porque o QR e' a
     * solucao, e o aviso diz o que fazer em vez de so accusar.
     */
    const sessaoEstranha = d.state.sessaoDeOutraMaquina
        ? [
              '        <div id="sessaoEstranha" class="card card-pad mb-4 flex items-start gap-3 border-l-4 border-l-accent-red">',
              '            <i class="fa-solid fa-triangle-exclamation text-accent-red mt-0.5 shrink-0"></i>',
              '            <div class="min-w-0">',
              '                <p class="font-semibold text-accent-red mb-1">A sessao do WhatsApp veio de outra maquina</p>',
              '                <p id="sessaoEstranhaTexto" class="text-body text-ink-2">' + escapeHtml(d.state.sessaoDeOutraMaquina) + '</p>',
              '                <p class="text-body text-ink-2 mt-2">'
              + 'A solucao e\' escanear o QR ao lado com o celular. A sessao antiga so e\' reescrita '
              + 'quando voce le o codigo; ate la, esta maquina fica sem WhatsApp.</p>',
              '                <p class="text-caption text-ink-3 mt-1">Se voce <strong>acabou de reinstalar o Windows</strong> '
              + 'ou trocou o disco, isso e\' esperado. Se nao foi o caso, a pasta '
              + '<code class="font-mono">' + escapeHtml(d.authPath) + '</code> veio de outra instalacao.</p>',
              '            </div>',
              '        </div>',
          ].join('\n')
        : '';

    return [
        sessaoEstranha,
        /*
         * As tres placas da direita viraram blocos recolhidos: abertas, a coluna ficava mais alta
         * que o QR e empurrava os textos do bot para fora da tela. O aviso de seguranca e' a
         * excecao, e continua aberto: e' o que ninguem deve descobrir tarde demais.
         */
        '        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">',

        '            <div class="card card-pad">',
        '                <div class="flex items-center justify-between gap-3 mb-4">',
        '                    <h3 class="text-title flex items-center gap-2"><i class="fa-brands fa-whatsapp text-accent-emerald"></i> Pareamento</h3>',
        '                    <span id="phaseBadge" class="badge ' + phase.badge + '">' + phase.label + '</span>',
        '                </div>',

        '                <div id="qrBox" class="' + (showQr ? '' : 'hidden') + ' flex flex-col items-center gap-3 py-2">',
        // O fundo branco e' proposital: QR so e' lido com modulos escuros sobre
        // fundo claro, entao este container nao acompanha o tema escuro.
        '                    <div id="qrCode" class="p-3 rounded-card bg-white border border-line max-w-[15rem]"></div>',
        '                    <p class="text-caption text-ink-3 text-center">O codigo renova sozinho e expira em ~' + Math.round(QR_TTL_MS / 1000) + 's.</p>',
        '                </div>',

        /*
         * Tres estados e nao dois. A espera aparecia mesmo com o celular JA conectado, e nenhum
         * QR viria nunca: a tela girando para sempre esperando algo que ela mesma sabia que nao
         * vem. Conectado e' o estado terminal, com frase propria.
         */
        '                <div id="waitingBox" class="' + (showQr || connected ? 'hidden' : '') + ' py-8 text-center">',
        '                    <i class="fa-solid fa-circle-notch fa-spin text-3xl text-ink-3"></i>',
        '                    <p class="text-body text-ink-3 mt-3">Aguardando o WhatsApp emitir um codigo de pareamento...</p>',
        '                </div>',

        '                <div id="conectadoBox" class="' + (connected ? '' : 'hidden') + ' py-6 text-center">',
        '                    <i class="fa-brands fa-whatsapp text-4xl text-accent-emerald"></i>',
        '                    <p class="font-semibold text-ink mt-3">WhatsApp conectado</p>',
        '                    <p class="text-body text-ink-3 mt-1">Este numero ja esta pareado com este painel. Nao ha nada para esperar.</p>',
        '                </div>',

        '                <p id="phaseHint" class="text-body text-ink-2 mt-3">' + phase.hint + '</p>',
        '                <p id="lastError" class="text-caption text-accent-red mt-2 ' + (d.state.lastError ? '' : 'hidden') + '">' + escapeHtml(d.state.lastError ?? '') + '</p>',

        '                <div class="mt-4 flex flex-wrap gap-2">',
        connected ? '' : reconnectBtn,
        d.hasSavedSession || connected ? unpairBtn : '',
        '                </div>',
        '            </div>',

        '            <div class="space-y-3 min-h-0">',
        /*
         * O aviso de seguranca fica aberto. Os outros dois vao recolhidos.
         */
        '                <div class="card card-pad border-l-4 border-l-accent-red">',
        '                    <h3 class="text-title text-accent-red flex items-center gap-2"><i class="fa-solid fa-triangle-exclamation"></i> Atencao</h3>',
        '                    <p class="text-body text-ink-2 mt-1">O QR Code daqui concede controle total da conta do WhatsApp. '
        + 'Mantenha o painel em rede local e nunca exponha esta pagina na internet aberta.</p>',
        '                </div>',

        '                <details class="card">',
        '                    <summary class="cursor-pointer text-title flex items-center gap-2 select-none card-pad">',
        '                        <i class="fa-solid fa-address-card text-accent"></i> Conta pareada',
        '                        <i class="fa-solid fa-chevron-down ml-auto text-caption text-ink-3"></i>',
        '                    </summary>',
        '                    <div class="px-5 pb-5 border-t border-line pt-4">',
        infoRow('Numero', escapeHtml(phonePretty(d.state.phone))),
        infoRow('Nome', escapeHtml(d.state.name ?? '-')),
        infoRow('Aparelho', escapeHtml(d.state.platform ?? '-')),
        infoRow('Sessao salva', d.hasSavedSession ? 'Sim' : 'Nao'),
        infoRow('Credenciais', escapeHtml(d.authPath)),
        '                    </div>',
        '                </details>',

        '                <details class="card">',
        '                    <summary class="cursor-pointer text-title flex items-center gap-2 select-none card-pad">',
        '                        <i class="fa-solid fa-list-ol text-accent"></i> Como conectar',
        '                        <i class="fa-solid fa-chevron-down ml-auto text-caption text-ink-3"></i>',
        '                    </summary>',
        '                    <div class="px-5 pb-5 border-t border-line pt-4">',
        '                        <ol class="space-y-2 text-body text-ink-2 list-decimal list-inside">',
        '                            <li>No celular, abra o WhatsApp.</li>',
        '                            <li>Menu <strong>Aparelhos conectados</strong>.</li>',
        '                            <li>Toque em <strong>Conectar com numero de telefone</strong>.</li>',
        '                            <li>Leia o codigo QR exibido ao lado com a camera do celular.</li>',
        '                            <li>Use o <strong>codigo de 8 digitos</strong> se o WhatsApp pedir (a tela mostra o codigo de pareamento).</li>',
        '                        </ol>',
        '                    </div>',
        '                </details>',
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
    '            var estranha = document.getElementById("sessaoEstranha");',
    '            if (estranha && state.sessaoDeOutraMaquina) {',
    '                // Aparece sem recarregar a pagina. O aviso nasce no boot, e',
    '                // quem abre a aba do WhatsApp depois disso precisa ver sem',
    '                // precisar de F5 -- senao ele simplesmente nao existe para',
    '                // essa pessoa.',
    '                var texto = document.getElementById("sessaoEstranhaTexto");',
    '                if (texto) texto.textContent = state.sessaoDeOutraMaquina;',
    '                estranha.classList.remove("hidden");',
    '            }',
    '            var wantsQr = state.phase === "aguardando-qr" || state.phase === "escaneado";',
    '            var isConectado = state.phase === "conectado";',
    '            var qrBox = document.getElementById("qrBox");',
    '            var waitBox = document.getElementById("waitingBox");',
    '            var feitoBox = document.getElementById("conectadoBox");',
    '            if (qrBox) qrBox.classList.toggle("hidden", !wantsQr);',
    /*
     * A caixa de espera so fica visivel quando ha algo para esperar. Com o
     * celular ja conectado, o girador ficava parado na tela a toa: o sistema
     * ja estava pronto e a unica coisa que faltava era a tela dizer isso.
     */
    '            if (waitBox) waitBox.classList.toggle("hidden", wantsQr || isConectado);',
    '            if (feitoBox) feitoBox.classList.toggle("hidden", !isConectado);',
    '            if (state.qr && state.qr !== lastQr) {',
    '                lastQr = state.qr;',
    '                fetch("/api/bot/qr.svg?v=" + encodeURIComponent(state.qrIssuedAt || 0))',
    '                    .then(function (r) { return r.ok ? r.text() : ""; })',
    '                    .then(function (svg) {',
    '                        var box = document.getElementById("qrCode");',
    '                        if (box) box.innerHTML = svg || "<p class=\'text-xs text-ink-3\'>Nao foi possível carregar o QR.</p>";',
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
    /*
     * Titulo e verbo proprios em vez de "Confirmar": ao lado de "Desconectar e parear outro
     * numero", o botao exigia duas leituras -- e a segunda e' a que a pessoa faz com o mouse ja
     * a caminho de outro lugar.
     */
    '            confirmThen(',
    '                "Isso encerra a sessao atual e apaga os credenciais salvos deste numero. Para parear de novo, o painel vai pedir o QR outra vez.",',
    '                async function () {',
    '                    var r = await postJSON("/admin/bot/logout", {});',
    '                    if (r.ok) { lastQr = null; location.reload(); }',
    '                    else flash("err", r.data.error || "Erro ao desconectar");',
    '                },',
    '                { titulo: "Desconectar o WhatsApp", confirmar: "Desconectar" }',
    '            );',
    '        }',
].join('\n');
