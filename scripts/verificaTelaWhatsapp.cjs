/*
 * Confere a tela do WhatsApp com o estado real do servidor.
 *
 * O sintoma era o girador infinito: a fase "desconectado" deixava a caixa de
 * espera visivel, e ela dizia "aguardando um codigo de pareamento" quando nao
 * havia QR vindo. Aqui a tela e lida com a sessao de verdade, nao montada em teste.
 */

const { sessaoDeTeste, BASE } = require('../scripts/lib/sessaoDeTeste.cjs');

(async () => {
    const h = await sessaoDeTeste();
    const estado = await (await fetch(BASE + '/api/bot/connection', { headers: h })).json();
    const tela = await fetch(BASE + '/admin?tab=whatsapp', { headers: h });
    const html = await tela.text();

    const qrBox = html.match(/<div id="qrBox"[^>]*>/);
    const waitBox = html.match(/<div id="waitingBox"[^>]*>/);

    console.log('--- estado do servidor ---');
    console.log('fase      :', estado.phase);
    console.log('tem QR    :', estado.qr ? 'sim' : 'nao');
    console.log('erro      :', estado.lastError ?? '(nenhum)');
    console.log('outra maq :', estado.sessaoDeOutraMaquina ? 'SIM' : 'nao');

    console.log('--- tela ---');
    console.log('status    :', tela.status, '(' + html.length + ' bytes)');
    console.log('qrBox     :', qrBox ? qrBox[0] : '(nao encontrado)');
    console.log('waitingBox:', waitBox ? waitBox[0] : '(nao encontrado)');

    // O girador so pode ficar visivel quando ha QR chegando ou sincronizando.
    const esperando = /waitingBox[^>]*class="(?!hidden)/.test(waitBox?.[0] ?? '');
    const qrVisivel = /qrBox[^>]*class="(?!hidden)/.test(qrBox?.[0] ?? '');
    console.log('--- veredito ---');
    console.log('girador visivel sem QR:', esperando && !qrVisivel ? 'SIM (e o bug)' : 'nao');
    process.exit(0);
})().catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
});