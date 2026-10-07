/*
 * Print da tela do WhatsApp com o servidor de verdade.
 *
 * O sintoma era visual -- girador infinito, caixa de QR vazia -- e nenhum gate
 * pega isso: `check:html` olha rotulo e id, `check:js` olha listener. Precisa de
 * olho. Chrome headless + CDP puro, sem Playwright (Node 24 tem WebSocket global).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { sessaoDeTeste, BASE } = require('./lib/sessaoDeTeste.cjs');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAIDA = path.join(__dirname, '..', 'tmp-tela-whatsapp.png');
const PORTA = 9333;

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function conecta(url) {
    for (let i = 0; i < 40; i++) {
        try {
            const r = await fetch(url);
            if (r.ok) return r.json();
        } catch {
            /* o Chrome ainda subindo */
        }
        await espera(500);
    }
    throw new Error('Chrome nao respondeu na porta de depuracao');
}

(async () => {
    const cookie = await sessaoDeTeste();

    const chrome = spawn(
        CHROME,
        [
            '--headless=new',
            `--remote-debugging-port=${PORTA}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu',
            '--hide-scrollbars',
            '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-deliveryadmin'),
            'about:blank',
        ],
        { stdio: 'ignore' }
    );

    let ws;
    try {
        const alvo = (await conecta(`http://127.0.0.1:${PORTA}/json/version`)).webSocketDebuggerUrl;
        ws = new WebSocket(alvo);
        await new Promise((ok, er) => {
            ws.onopen = ok;
            ws.onerror = er;
        });

        let id = 0;
        const esperando = new Map();
        ws.onmessage = (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id && esperando.has(m.id)) {
                esperando.get(m.id)(m);
                esperando.delete(m.id);
            }
        };
        const envia = (method, params = {}, sessionId) =>
            new Promise((ok, er) => {
                const meu = ++id;
                esperando.set(meu, ok);
                try {
                    ws.send(JSON.stringify({ id: meu, method, params, sessionId }));
                } catch (e) {
                    er(e);
                }
            });

        // Sessao de destino propria, como o CDP moderno exige.
        const { targetId } = (await envia('Target.createTarget', { url: 'about:blank' })).result;
        const { sessionId } = (await envia('Target.attachToTarget', { targetId, flatten: true })).result;

        await envia('Page.enable', {}, sessionId);
        await envia('Network.enable', {}, sessionId);

        // O cookie e' da sessao real: sem ele a pagina cairia na tela de login.
        for (const par of cookie.Cookie.split(';').map((c) => c.trim())) {
            const [nome, ...resto] = par.split('=');
            await envia(
                'Network.setCookie',
                { name: nome, value: resto.join('='), domain: 'localhost', path: '/' },
                sessionId
            );
        }

        await envia(
            'Emulation.setEmulatedMedia',
            { features: [{ name: 'prefers-color-scheme', value: 'dark' }] },
            sessionId
        );
        // Janela alta de proposito: a pagina e' longa e o painel rola num container
        // interno, entao rolar por script e' mais fragil do que caber tudo na captura.
        await envia(
            'Emulation.setDeviceMetricsOverride',
            {
                width: 1280,
                height: Number(process.env.ALTURA || 1600),
                deviceScaleFactor: 1,
                mobile: false,
            },
            sessionId
        );

        await envia('Page.navigate', { url: `${BASE}/admin?tab=whatsapp` }, sessionId);
        // O SSE entrega o estado; 3s e' o que a tela leva para montar o QR.
        await espera(3500);

        const tiro = await envia('Page.captureScreenshot', { format: 'png' }, sessionId);
        if (!tiro.result?.data) throw new Error('captureScreenshot sem imagem');
        fs.writeFileSync(SAIDA, Buffer.from(tiro.result.data, 'base64'));
        console.log('print em', SAIDA);
    } finally {
        try {
            ws?.close();
        } catch {
            /* ja estava fechado */
        }
        chrome.kill();
    }
    process.exit(0);
})().catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
});