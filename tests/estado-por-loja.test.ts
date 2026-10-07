/* O cabecalho e o card precisam falar da MESMA loja. O video mostrou "conectado" num e
 * "desconectado" no outro, na mesma tela: `getConnectionState()` sem argumento cai em
 * `lojaDoBoot()`, que no Render e' outra loja. Cada tela lia o estado de outra. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { comoLoja } from '../src/services/loja';
import { getConnectionState, setConnection, esqueceLoja } from '../src/services/botLojas';

const LOJA_DE_TESTE = 'loja-do-boot-painel';
const OUTRA = 'loja-que-a-pessoa-esta-vendo';

const limpa = (t: any) =>
    t.after(() => {
        esqueceLoja(LOJA_DE_TESTE);
        esqueceLoja(OUTRA);
    });

test('o estado lido dentro da loja e o dela, nao o do boot', async (t) => {
    limpa(t);
    // A loja do boot e' a que o processo acordou; a outra e' a da tela.
    setConnection(LOJA_DE_TESTE, { phase: 'conectado', online: true });
    setConnection(OUTRA, { phase: 'desconectado', online: false, lastError: 'Stream Errored (conflict)' });

    const naTela = await comoLoja(OUTRA, async () => getConnectionState());

    assert.equal(naTela.phase, 'desconectado', 'a tela mostrou o estado do boot em vez do dela');
    assert.match(naTela.lastError ?? '', /conflict/, 'o erro da loja da tela sumiu');
});

test('cada loja tem seu estado, e um nao escreve no outro', async (t) => {
    limpa(t);
    setConnection(LOJA_DE_TESTE, { phase: 'conectado', online: true });
    setConnection(OUTRA, { phase: 'desconectado', online: false });

    const doBoot = await comoLoja(LOJA_DE_TESTE, async () => getConnectionState());
    const daTela = await comoLoja(OUTRA, async () => getConnectionState());

    assert.equal(doBoot.phase, 'conectado');
    assert.equal(daTela.phase, 'desconectado', 'o estado do boot vazou para a outra loja');
});

test('badge e card leem a mesma fonte: o mesmo objeto', async (t) => {
    /*
     * A tela tem dois lugares mostrando o estado -- o badge no cabecalho e o card do
     * pareamento. Se eles chamarem com argumentos diferentes, um deles mente. Aqui os
     * dois leem dentro da loja e tem de dar exatamente o mesmo objeto.
     */
    limpa(t);
    setConnection(OUTRA, { phase: 'escaneado', online: false, qr: 'QR-TESTE', qrIssuedAt: Date.now() });

    const paraOBadge = await comoLoja(OUTRA, async () => getConnectionState());
    const paraOCard = await comoLoja(OUTRA, async () => getConnectionState());

    assert.equal(paraOBadge.phase, paraOCard.phase, 'badge e card discordam');
    assert.equal(paraOBadge.qr, paraOCard.qr, 'o QR do badge difere do card');
    assert.equal(paraOBadge.phase, 'escaneado');
});