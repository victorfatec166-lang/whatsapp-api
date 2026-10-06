/*
 * A garantia que o dono pediu: cada cliente com o seu WhatsApp, o seu bot e o seu SaaS.
 * O que se prova aqui e' a parte que decide -- socket e carrinho seguem a loja do
 * contexto. Nao ha Baileys neste arquivo: a regra do isolamento mora em botLojas.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { comoLoja } from '../src/services/loja';
import {
    esqueceLoja,
    getConnectionState,
    isBotOnline,
    onConnectionChange,
    registroDeLojas,
    setConnection,
    socket,
    sessoes,
} from '../src/services/botLojas';

const PADARIA = 'loja-bot-padaria';
const SUSHI = 'loja-bot-sushi';

/** Socket falso: o que importa e' que cada loja tenha o seu. */
function socketFalso(nome: string) {
    return { nome, enviados: [] as string[], sendMessage: async (_jid: string, m: any) => m.text };
}

function limpa(t: any) {
    t.after(() => {
        esqueceLoja(PADARIA);
        esqueceLoja(SUSHI);
    });
}

test('1. cada loja tem o seu socket, e o contexto decide qual', async (t) => {
    limpa(t);
    const daPadaria = socketFalso('padaria');
    const doSushi = socketFalso('sushi');
    registroDeLojas().set(PADARIA, {
        loja: PADARIA,
        sock: daPadaria,
        sessoes: {},
        estado: { phase: 'conectado', online: true, qr: null, qrIssuedAt: null, phone: null, name: null, platform: null, since: null, lastError: null, sessaoDeOutraMaquina: null },
        estranha: null,
        listeners: new Set(),
    });
    registroDeLojas().set(SUSHI, {
        loja: SUSHI,
        sock: doSushi,
        sessoes: {},
        estado: { phase: 'conectado', online: true, qr: null, qrIssuedAt: null, phone: null, name: null, platform: null, since: null, lastError: null, sessaoDeOutraMaquina: null },
        estranha: null,
        listeners: new Set(),
    });

    assert.equal(await comoLoja(PADARIA, () => socket()), daPadaria);
    assert.equal(await comoLoja(SUSHI, () => socket()), doSushi);
    assert.notEqual(daPadaria, doSushi, 'as duas lojas com o mesmo objeto de socket');
});

test('2. o carrinho de um cliente nao aparece na outra loja', async (t) => {
    limpa(t);
    registroDeLojas().set(PADARIA, {
        loja: PADARIA, sock: socketFalso('padaria'), sessoes: {}, estado: {} as any, estranha: null, listeners: new Set(),
    });
    registroDeLojas().set(SUSHI, {
        loja: SUSHI, sock: socketFalso('sushi'), sessoes: {}, estado: {} as any, estranha: null, listeners: new Set(),
    });

    const JID = '5511999999999@s.whatsapp.net';
    await comoLoja(PADARIA, () => {
        sessoes()[JID] = { step: 'PEDINDO', carrinho: [{ id: 'pao-de-queijo', nome: 'Pao de queijo', qtd: 2, modificadores: {} }] };
    });

    // Mesmo telefone nas duas lojas: e' o caso real do cliente que pede na padaria
    // e no sushi. A conversa e' da loja, nao da pessoa.
    await comoLoja(SUSHI, () => {
        assert.equal(sessoes()[JID], undefined, 'o carrinho da padaria vazou para o sushi');
        sessoes()[JID] = { step: 'PEDINDO', carrinho: [{ id: 'temaki', nome: 'Temaki', qtd: 1, modificadores: {} }] };
    });

    const daPadaria = await comoLoja(PADARIA, () => sessoes()[JID].carrinho?.[0]?.nome);
    assert.equal(daPadaria, 'Pao de queijo');
    const doSushi = await comoLoja(SUSHI, () => sessoes()[JID].carrinho?.[0]?.nome);
    assert.equal(doSushi, 'Temaki');
});

test('3. o pareamento de uma loja nao aparece no painel da outra', async (t) => {
    limpa(t);
    setConnection(PADARIA, { phase: 'conectado', online: true, phone: '5511900000001' });

    assert.equal(getConnectionState(PADARIA).phone, '5511900000001');
    assert.equal(getConnectionState(SUSHI).phone, null, 'a loja B viu o numero da loja A');
    assert.equal(getConnectionState(SUSHI).phase, 'desconectado');

    assert.equal(isBotOnline(PADARIA), true);
    assert.equal(isBotOnline(SUSHI), false, 'a loja B se achou online por causa da A');
});

test("4. o aviso de outra instalacao e da loja, e nao global", async (t) => {
    limpa(t);
    setConnection(SUSHI, { phase: 'desconectado' });
    const conexao = registroDeLojas().get(SUSHI)!;
    conexao.estranha = { motivo: 'A mesma loja tem sessao em outra maquina', podeAparear: true };

    // `setConnection` e' o que publica o aviso; sem ele, o texto fica guardado.
    setConnection(SUSHI, { phase: 'aguardando-qr', qr: 'QR-DA-SUSHI', qrIssuedAt: Date.now() });

    assert.match(getConnectionState(SUSHI).sessaoDeOutraMaquina ?? '', /outra maquina/);
    assert.equal(getConnectionState(PADARIA).sessaoDeOutraMaquina, null);
});

test("5. QR de uma loja nao e reaproveitado na outra, e o velho nao volta", async (t) => {
    limpa(t);
    setConnection(PADARIA, { phase: 'aguardando-qr', qr: 'QR-PADARIA', qrIssuedAt: Date.now() });
    setConnection(SUSHI, { phase: 'aguardando-qr', qr: 'QR-SUSHI', qrIssuedAt: Date.now() });

    assert.equal(getConnectionState(PADARIA).qr, 'QR-PADARIA');
    assert.equal(getConnectionState(SUSHI).qr, 'QR-SUSHI');

    // QR tem 30s de validade: um QR velho tem de chegar como null, nao na tela.
    registroDeLojas().get(PADARIA)!.estado.qrIssuedAt = Date.now() - 31_000;
    assert.equal(getConnectionState(PADARIA).qr, null);
    assert.equal(getConnectionState(SUSHI).qr, 'QR-SUSHI', 'o sushi perdeu o QR por causa do velho da padaria');
});

test("6. o painel da loja A nao e avisado quando a loja B muda de estado", async (t) => {
    limpa(t);
    const daPadaria: string[] = [];
    const doSushi: string[] = [];

    await comoLoja(PADARIA, () => onConnectionChange((estado) => daPadaria.push(estado.phase)));
    await comoLoja(SUSHI, () => onConnectionChange((estado) => doSushi.push(estado.phase)));
    const fimDaPadaria = daPadaria.length;
    const fimDoSushi = doSushi.length;

    setConnection(SUSHI, { phase: 'conectado', online: true });

    assert.deepEqual(daPadaria.slice(fimDaPadaria), [], 'a padaria foi avisada da mudanca do sushi');
    assert.ok(doSushi.slice(fimDoSushi).includes('conectado'));
});

test("7. sem loja no contexto, o socket nao e adivinhado", async (t) => {
    limpa(t);
    registroDeLojas().set(PADARIA, {
        loja: PADARIA, sock: socketFalso('padaria'), sessoes: {}, estado: {} as any, estranha: null, listeners: new Set(),
    });

    assert.equal(socket(), null, 'devolveu o socket da padaria para quem nao tem loja');
    assert.throws(() => sessoes(), /sem conexao/i, 'o carrinho foi lido sem loja');
});