/**
 * Fuso do dono, e o dia que ele fecha. A comanda nasce no servidor (Render, UTC), entao o
 * relogio de quem imprime so chega se o navegador mandar. E o corte do dia tinha o mesmo
 * fuso errado: `setHours(0,0,0,0)` virava o dia as 21h e o "#1" recomecava cedo demais.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FUSO,
    fimDoDiaNoFuso,
    fusoDoRequisicao,
    fusoValido,
    inicioDoDiaNoFuso,
} from '../src/services/fuso';

const SAO_PAULO = 'America/Sao_Paulo';
const LISBOA = 'Europe/Lisbon';

function comoUtc(d: Date): string {
    return d.toISOString();
}

test('o fuso do navegador manda na comanda', () => {
    const req = { headers: { 'x-fuso': LISBOA }, query: {} };
    assert.equal(fusoDoRequisicao(req), LISBOA);
});

test('o download, que nao leva header, manda por query', () => {
    const req = { headers: {}, query: { fuso: LISBOA } };
    assert.equal(fusoDoRequisicao(req), LISBOA);
});

test('quem nao manda fuso nenhum recebe o padrao', () => {
    // Agente de impressao chamando a rota direto: nao tem navegador, nao tem header.
    assert.equal(fusoDoRequisicao({ headers: {}, query: {} }), FUSO);
});

test('fuso invalido nao derruba o painel: cai no padrao', () => {
    // O texto vem do navegador. Invalido num toLocaleTimeString joga excecao, e a
    // comanda inteira viraria 500 por causa de um header.
    for (const lixo of ['Agora/Aqui', '../../etc/passwd', 'x'.repeat(80), '', '   ']) {
        assert.equal(fusoValido(lixo), null, `aceitou lixo: ${lixo}`);
    }
    assert.equal(fusoDoRequisicao({ headers: { 'x-fuso': 'Agora/Aqui' }, query: {} }), FUSO);
});

test('header tem preferencia sobre a query', () => {
    const req = { headers: { 'x-fuso': SAO_PAULO }, query: { fuso: LISBOA } };
    assert.equal(fusoDoRequisicao(req), SAO_PAULO);
});

test('a meia-noite de Sao Paulo eh a hora de Sao Paulo, nao a de UTC', () => {
    // 2026-10-07 00:30 em Sao Paulo e' 03:30 UTC. O dia comeca as 03:00 UTC.
    const dentroDaNoite = new Date('2026-10-07T00:30:00-03:00');
    assert.equal(comoUtc(inicioDoDiaNoFuso(dentroDaNoite, SAO_PAULO)), '2026-10-07T03:00:00.000Z');
});

test('o dia de Sao Paulo nao termina as 21h', () => {
    // 19:30 do dia 8 ainda e' o dia 8. Em UTC ja e' dia 9, e o numero da cozinha
    // voltava a 1 enquanto o restaurante servia.
    const noite = new Date('2026-10-08T19:30:00-03:00');
    assert.equal(comoUtc(fimDoDiaNoFuso(noite, SAO_PAULO)), '2026-10-09T03:00:00.000Z');
    assert.ok(fimDoDiaNoFuso(noite, SAO_PAULO).getTime() > noite.getTime());
});

test('uma hora antes da meia-noite ainda pertence ao dia de hoje', () => {
    const quaseMeiaNoite = new Date('2026-10-07T23:30:00-03:00');
    const inicio = inicioDoDiaNoFuso(quaseMeiaNoite, SAO_PAULO);
    assert.ok(inicio.getTime() <= quaseMeiaNoite.getTime(), 'o dia fechou antes de comecar');
});

test('cada fuso fecha o dia no seu horario', () => {
    // O mesmo instante e' 23:30 em Sao Paulo e 00:30 em Lisboa: dias diferentes.
    const instante = new Date('2026-10-07T23:30:00-03:00');
    assert.equal(comoUtc(inicioDoDiaNoFuso(instante, SAO_PAULO)), '2026-10-07T03:00:00.000Z');
    assert.equal(comoUtc(inicioDoDiaNoFuso(instante, LISBOA)), '2026-10-07T23:00:00.000Z');
});

test('o dia tem 24 horas inteiras', () => {
    const qualquer = new Date('2026-10-07T12:00:00-03:00');
    const tamanho = fimDoDiaNoFuso(qualquer, SAO_PAULO).getTime() - inicioDoDiaNoFuso(qualquer, SAO_PAULO).getTime();
    assert.equal(tamanho, 86_400_000);
});