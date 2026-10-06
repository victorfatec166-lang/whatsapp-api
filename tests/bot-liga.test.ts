/*
 * O interruptor do bot e' por loja, e nao global: a marmitaria que pausou o
 * automatico nao pode calar o bot do vizinho. E o contrario tambem vale -- uma
 * loja com o bot ligado nunca pode ser silenciada por causa da outra.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import {
    botAtivo,
    defineBotAtivo,
    avisoDePausado,
    esqueceCacheDoBot,
    textoDePausado,
} from '../src/services/botLigaDesliga';

/** Loja de teste, com o Config criado (o interruptor mora no Config). */
async function montaLoja(nome: string) {
    const id = `botliga-${crypto.randomUUID().slice(0, 8)}`;
    await prisma.tenant.create({ data: { id, name: nome, ativo: true } });
    await prisma.config.create({ data: { id } });
    return id;
}

test('sem mudar nada, o bot responde', async () => {
    const loja = await montaLoja('Ligada');
    try {
        assert.equal(await botAtivo(loja), true, 'o padrao e' + ' responder: quem nao mexeu nao espera surra');
    } finally {
        await prisma.tenant.delete({ where: { id: loja } }).catch(() => 0);
        esqueceCacheDoBot();
    }
});

test('desligar e' + ' por loja: a vizinha continua respondendo', async () => {
    // O teste que impede o vazamento: o interruptor e' global na maioria das
    // implementacoes, e quem paga acaba calado por causa do cliente do lado.
    const a = await montaLoja('Pausada');
    const b = await montaLoja('Ligada');
    try {
        await defineBotAtivo(a, false);
        assert.equal(await botAtivo(a), false, 'a loja que pausou, esta pausada');
        assert.equal(await botAtivo(b), true, 'a vizinha nao foi afetada');
    } finally {
        await prisma.tenant.delete({ where: { id: a } }).catch(() => 0);
        await prisma.tenant.delete({ where: { id: b } }).catch(() => 0);
        esqueceCacheDoBot();
    }
});

test('religar funciona, e nao fica preso em desligado', async () => {
    const loja = await montaLoja('Volta');
    try {
        await defineBotAtivo(loja, false);
        assert.equal(await botAtivo(loja), false);
        await defineBotAtivo(loja, true);
        assert.equal(await botAtivo(loja), true, 'o botao nao pode ser de mao unica');
    } finally {
        await prisma.tenant.delete({ where: { id: loja } }).catch(() => 0);
        esqueceCacheDoBot();
    }
});

test('pausar sem mexer no aviso NAO apaga o texto que o dono escreveu', async () => {
    /*
     * `undefined` significa "nao mexe". Sem isso, quem pausou as tres da manha
     * perderia o aviso que escreveu ontem -- e o texto e' dele, nao do sistema.
     */
    const loja = await montaLoja('Com aviso');
    try {
        await defineBotAtivo(loja, false, 'Estamos fechando hoje, amanha de manha voltamos!');
        await defineBotAtivo(loja, true);
        await defineBotAtivo(loja, false);
        assert.match(await avisoDePausado(loja), /amanha de manha/, 'o aviso sobreviveu a ligar e pausar de novo');
    } finally {
        await prisma.tenant.delete({ where: { id: loja } }).catch(() => 0);
        esqueceCacheDoBot();
    }
});

test('sem aviso escrito, o cliente recebe o texto padrao', () => {
    assert.match(textoDePausado(''), /pausado no momento/);
    assert.match(textoDePausado(null), /pausado no momento/);
    assert.match(textoDePausado('   '), /pausado no momento/, "espaco em branco e' o mesmo que nada");
});

test('o aviso do dono entra no lugar do padrao', () => {
    assert.equal(textoDePausado('Voltamos as 14h'), 'Voltamos as 14h');
});

test('loja que nao existe responde, e nao trava a conversa', async () => {
    // O caminho quando o `Config` some: responder e' mais seguro do que calar, e
    // quem cala por uma leitura falha e' o cliente que pagou.
    assert.equal(await botAtivo('loja-que-nao-existe-1234'), true);
});