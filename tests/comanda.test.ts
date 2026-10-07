/**
 * A comanda da cozinha e' lida com as maos sujas. Os dois casos abaixo sao
 * regressoes de erro barulhento: um telefone que nao existe e' pior do que
 * nenhum, e horario de UTC faz a cozinha achar que o pedido e' do dia anterior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarComanda } from '../src/services/comanda';

const PEDIDO = {
    id: 'abc',
    clientPhone: '55188887777@s.whatsapp.net',
    clientName: 'Marina',
    items: '1x Pastel de Queijo | 2x Coxinha de Frango [Bem passada]',
    notes: null,
    status: 'pendente',
    channel: 'whatsapp',
    createdAt: new Date('2026-10-07T15:04:00-03:00'),
};

function comanda(extra: Record<string, unknown> = {}) {
    return montarComanda({
        order: PEDIDO,
        businessName: 'Marmitaria',
        numero: 47,
        ...extra,
    } as Parameters<typeof montarComanda>[0]).linhas.join('\n');
}

test('telefone do jid vira so os digitos', () => {
    assert.match(comanda(), /\nTel 55188887777\n/);
});

test('endereco @lid nao fabrica telefone', () => {
    const texto = comanda({ order: { ...PEDIDO, clientPhone: '192479311741143@lid' } });
    assert.equal(/Tel /.test(texto), false);
    assert.equal(/79311741143/.test(texto), false);
});

test('telefone resolvido entra no lugar do @lid', () => {
    const texto = comanda({ order: { ...PEDIDO, clientPhone: '192479311741143@lid' }, telefone: '55188887777' });
    assert.match(texto, /\nTel 55188887777\n/);
});

test('device colado no jid nao vira digito do telefone', () => {
    const texto = comanda({ order: { ...PEDIDO, clientPhone: '55188887777:12@s.whatsapp.net' } });
    assert.match(texto, /\nTel 55188887777\n/);
});

test('horario sai no fuso do balcao, nao no do servidor', () => {
    assert.match(comanda(), /^#47 {3}15:04$/m);
});

test('o fuso de quem pede manda na hora impressa', () => {
    // 15:04 em Sao Paulo sao 18:04 UTC, que em Lisboa (UTC+1 em outubro) sao 19:04.
    assert.match(comanda({ fuso: 'Europe/Lisbon' }), /^#47 {3}19:04$/m);
});

test('sem fuso do pedido, o papel sai no padrao', () => {
    assert.match(comanda({ fuso: undefined }), /^#47 {3}15:04$/m);
});

test('o horario nao muda com o fuso da maquina que gera o papel', () => {
    // O Render roda em UTC; se a hora dependesse da maquina, o papel sairia 3h errado.
    const antes = process.env.TZ;
    process.env.TZ = 'UTC';
    const emUtc = comanda();
    process.env.TZ = 'America/New_York';
    const emNovaYork = comanda();
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
    assert.equal(emUtc, emNovaYork);
    assert.match(emUtc, /^#47 {3}15:04$/m);
});

test('modificador fica em linha propria, indentado', () => {
    assert.match(comanda(), /\n {3}- Bem passada\n/);
});

test('observacao e ultima, porque e o que a cozinha le por ultimo', () => {
    const texto = comanda({ order: { ...PEDIDO, notes: 'sem cebola' } });
    assert.ok(texto.indexOf('2x Coxinha de Frango') < texto.indexOf('OBS: sem cebola'));
});

test('comanda nao leva valor', () => {
    assert.equal(/R\$/.test(comanda()), false);
});