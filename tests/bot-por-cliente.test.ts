/*
 * Cada loja tem o seu bot, socket, QR e carrinho. A chave e' a loja em tudo:
 * `registroDeLojas` e' um `Map` por loja e a sessao e' `@@id([tenantId, maquinaId])`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { comoLoja } from '../src/services/loja';
import {
    esqueceLoja,
    registroDeLojas,
    socket,
    getConnectionState,
    setConnection,
    sessoes,
} from '../src/services/botLojas';

const PADARIA = 'loja-a-padaria';
const SUSHI = 'loja-b-sushi';

const limpa = (t: any) =>
    t.after(() => {
        esqueceLoja(PADARIA);
        esqueceLoja(SUSHI);
    });

test('o QR de uma loja nunca aparece para a outra', async (t) => {
    limpa(t);
    setConnection(PADARIA, { phase: 'aguardando-qr', qr: 'QR-DA-PADARIA', qrIssuedAt: Date.now() });
    setConnection(SUSHI, { phase: 'aguardando-qr', qr: 'QR-DO-SUSHI', qrIssuedAt: Date.now() });

    assert.equal(getConnectionState(PADARIA).qr, 'QR-DA-PADARIA');
    assert.equal(getConnectionState(SUSHI).qr, 'QR-DO-SUSHI');
    assert.notEqual(getConnectionState(PADARIA).qr, getConnectionState(SUSHI).qr);
});

test('cada loja tem o proprio socket e o proprio carrinho', async (t) => {
    /*
     * Este e' o teste que segura a separacao de verdade. Se o socket fosse
     * global, a padaria atenderia o sushi e vice-versa -- e o dono nem veria,
     * porque os dois numeros respondem.
     */
    limpa(t);
    const daPadaria = { nome: 'padaria', enviados: [] as string[] };
    const doSushi = { nome: 'sushi', enviados: [] as string[] };
    registroDeLojas().set(PADARIA, {
        loja: PADARIA, sock: daPadaria, sessoes: {}, estado: {} as any, estranha: null, listeners: new Set(),
    });
    registroDeLojas().set(SUSHI, {
        loja: SUSHI, sock: doSushi, sessoes: {}, estado: {} as any, estranha: null, listeners: new Set(),
    });

    const sockDaPadaria = await comoLoja(PADARIA, async () => socket());
    const sockDoSushi = await comoLoja(SUSHI, async () => socket());

    assert.notEqual(sockDaPadaria, sockDoSushi, 'as duas lojas estao com o mesmo socket');
    assert.equal(sockDaPadaria.nome, 'padaria', 'a padaria pegou o socket errado');
    assert.equal(sockDoSushi.nome, 'sushi', 'o sushi pegou o socket errado');
});

test('o carrinho de um cliente nao invade o do outro', async (t) => {
    /*
     * O mesmo telefone pede na loja A e na loja B. Sem o socket certo por loja,
     * o segundo pedido continuaria o primeiro -- e o cliente receberia comida de
     * um lugar que ele nao pediu.
     */
    limpa(t);
    registroDeLojas().set(PADARIA, {
        loja: PADARIA, sock: {}, sessoes: {}, estado: {} as any, estranha: null, listeners: new Set(),
    });
    registroDeLojas().set(SUSHI, {
        loja: SUSHI, sock: {}, sessoes: {}, estado: {} as any, estranha: null, listeners: new Set(),
    });

    await comoLoja(PADARIA, async () => {
        sessoes()['5511999999999'] = { itens: [{ nome: 'Coxinha', qtd: 2 }] } as any;
    });

    await comoLoja(SUSHI, async () => {
        const doSushi = sessoes()['5511999999999'];
        assert.equal(doSushi, undefined, 'o sushi herdou o carrinho da padaria');
    });
});

test('pausar o bot de uma loja nao cala a outra', async (t) => {
    limpa(t);
    setConnection(PADARIA, { phase: 'desconectado', online: false });
    setConnection(SUSHI, { phase: 'conectado', online: true });

    assert.equal(getConnectionState(PADARIA).online, false);
    assert.equal(getConnectionState(SUSHI).online, true, 'o sushi foi desligado junto');
});