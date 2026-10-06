/*
 * Conversa assumida e' uma promessa. O teste que segura essa promessa e' o do
 * prazo: um cliente que pediu atendente e foi ignorado nao pode ficar preso no
 * silencio para sempre, porque ai o bot calado e' indistinguivel de bot quebrado.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import { comoLoja } from '../src/services/loja';
import { botPodeResponder, assumirConversa, devolverAoBot, PRAZO_ATENDENTE_MS } from '../src/services/chat';

const LOJA = 'chat-prazo-teste';

/** A loja precisa existir: `Chat.tenantId` tem chave estrangeira. */
const garanteLoja = () => prisma.tenant.upsert({
    where: { id: LOJA },
    update: {},
    create: { id: LOJA, name: 'Loja do teste de prazo', ativo: true },
});

/** O servico exige loja no contexto, como em uma requisicao de verdade. */
const naLoja = <T>(acao: () => Promise<T>) => comoLoja(LOJA, acao);

/** Chat de teste no jid do Baileys, que e' a chave de `Chat.phone`. */
async function chatAssumido(assumidoHa: number) {
    await garanteLoja();
    const phone = `55119${crypto.randomUUID().slice(0, 5)}@s.whatsapp.net`;
    await prisma.chat.create({
        data: {
            tenantId: LOJA,
            phone,
            name: 'Teste do prazo',
            atendente: 'humano',
            assumidoAt: new Date(Date.now() - assumidoHa),
        },
    });
    return phone;
}

const limpa = (phone: string) => prisma.chat.deleteMany({ where: { phone } });

test('conversa assumida agora: o bot fica quieto', async () => {
    // O comportamento que o dono espera: pediu atendente, o automatico para.
    const phone = await chatAssumido(0);
    try {
        assert.equal(await naLoja(() => botPodeResponder(phone)), false, 'logo apos pedir, o bot nao atropela o humano');
    } finally {
        await limpa(phone);
    }
});

test('assumida ha 14 minutos, sem ninguem responder: continua humana', async () => {
    const phone = await chatAssumido(PRAZO_ATENDENTE_MS - 60_000);
    try {
        assert.equal(await naLoja(() => botPodeResponder(phone)), false, 'atendimento em andamento nao e abandono');
    } finally {
        await limpa(phone);
    }
});

test('passado o prazo, sem ninguem responder, o bot volta sozinho', async () => {
    // O caso que motivou o prazo: loja fechada, dono longe, cliente esperando.
    // Sem isto ele ficava calado para sempre achando que o bot quebrou.
    const phone = await chatAssumido(PRAZO_ATENDENTE_MS + 60_000);
    try {
        assert.equal(await naLoja(() => botPodeResponder(phone)), true, 'o cliente nao pode ficar preso no silencio');
        const depois = await prisma.chat.findFirst({
            where: { phone },
            select: { atendente: true, assumidoAt: true },
        });
        assert.equal(depois?.atendente, 'bot', 'a conversa volta a ser do bot de verdade');
        assert.equal(depois?.assumidoAt, null, 'sem data de assumida, o prazo nao conta de novo');
    } finally {
        await limpa(phone);
    }
});

test('quem pede o menu nao espera o prazo: volta na hora', async () => {
    const phone = await chatAssumido(0);
    try {
        await naLoja(() => devolverAoBot(phone));
        assert.equal(await naLoja(() => botPodeResponder(phone)), true, 'voltar pelo menu e imediato');
    } finally {
        await limpa(phone);
    }
});

test('assumir de novo depois do prazo limpa o relogio', async () => {
    // Sem isto o prazo seria contado desde o primeiro pedido, e um segundo
    // pedido de atendente nao valeria nada.
    const phone = await chatAssumido(PRAZO_ATENDENTE_MS + 60_000);
    try {
        await naLoja(() => botPodeResponder(phone));
        const chat = await prisma.chat.findFirst({ where: { phone }, select: { id: true } });
        await naLoja(() => assumirConversa(chat!.id));
        assert.equal(await naLoja(() => botPodeResponder(phone)), false, 'chamar de novo silencia o bot de novo');
    } finally {
        await limpa(phone);
    }
});

test('conversa que nunca foi assumida responde na hora', async () => {
    await garanteLoja();
    const phone = `55119${crypto.randomUUID().slice(0, 5)}@s.whatsapp.net`;
    assert.equal(await naLoja(() => botPodeResponder(phone)), true, 'cliente novo nunca esperou atendente');
});