/*
 * A guarda de rede separa "quem vende" de "quem comprou": se deixar passar, um
 * aparelho da mesma rede ve a lista de lojas e cria conta sem pagar. O caminho
 * errado importa tanto quanto o certo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { naRedeLiberada } from '../src/routes/opsRoutes';

test("localhost entra: e' a maquina do dono, e o unico lugar que deve entrar", () => {
    assert.equal(naRedeLiberada('127.0.0.1'), true);
    assert.equal(naRedeLiberada('::1'), true);
});

test('IPv4 chegando por IPv6 entra tambem', () => {
    /*
     * O Node entrega o IPv4 de uma conexao IPv6 com o prefixo `::ffff:`. Sem
     * tirar o prefixo, o painel apareceria bloqueado JUSTAMENTE na maquina do
     * dono -- que e' o pior lugar para um falso negativo.
     */
    assert.equal(naRedeLiberada('::ffff:127.0.0.1'), true);
});

test("outra maquina da mesma rede e' recusada", () => {
    // O ponto que o painel de admin protege: o vizinho de wifi.
    assert.equal(naRedeLiberada('192.168.0.15'), false);
    assert.equal(naRedeLiberada('10.0.0.1'), false);
    assert.equal(naRedeLiberada('189.45.67.89'), false);
});

test('sem origem a rota recusa, em vez de deixar passar', () => {
    // Header falsificado que chega sem `req.ip` e' o caso que nao pode vazar.
    assert.equal(naRedeLiberada(undefined), false);
    assert.equal(naRedeLiberada(''), false);
});

test("a faixa liberada vem do ambiente, e o padrao e' so o loopback", () => {
    const anterior = process.env.SAIDA_ADMIN_IP;
    delete process.env.SAIDA_ADMIN_IP;
    try {
        // Sem configurar, a rede da casa inteira NAO entra: so a propria maquina.
        assert.equal(naRedeLiberada('192.168.0.1'), false, 'padrao nao pode abrir a rede local');
        assert.equal(naRedeLiberada('127.0.0.1'), true);

        process.env.SAIDA_ADMIN_IP = '192.168.0.10,10.1.1.1';
        assert.equal(naRedeLiberada('192.168.0.10'), true, 'a lista do ambiente libera');
        assert.equal(naRedeLiberada('10.1.1.1'), true);
        assert.equal(naRedeLiberada('10.1.1.2'), false, 'e so os que estao na lista');
    } finally {
        if (anterior === undefined) delete process.env.SAIDA_ADMIN_IP;
        else process.env.SAIDA_ADMIN_IP = anterior;
    }
});