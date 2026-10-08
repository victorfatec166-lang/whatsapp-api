/*
 * O relay: o iFood manda na nuvem, a nuvem enfileira, o PC da loja busca.
 * As garantias travadas aqui sao as que o dinheiro depende: loja local NAO ganha
 * pedido gravado pela nuvem, segredo errado nao abre a fila, e o reenvio nao duplica.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { prisma } from '../src/database/prisma';
import { prismaComLoja } from '../src/database/prisma-com-loja';
import { comoLoja } from '../src/services/loja';
import { geraChave, lojaDoSegredo, registraSegredo, segredoDaLoja } from '../src/services/relay';
import { cifrar } from '../src/services/marketplace';
import { receberPedido } from '../src/services/webhook';
import { podarDiaAnterior } from '../src/services/retencao';
import { garanteLojaDoTeste } from './lib/garante-loja';

const LOJA = process.env.DELIVERYADMIN_TENANT?.trim() || 'local';
const SEGREDO = 'segredo-de-teste-do-relay';
const CANAL = 'ifood';

function corpoDoPedido(externalId: string): string {
    return JSON.stringify({
        id: externalId,
        customer: { name: 'Cliente do relay', phone: '5511900000000' },
        items: [{ sku: 'SKU-RELAY-1', name: 'Item do relay', quantity: 1 }],
        total: 10,
    });
}

function cabecalho(corpo: string): Record<string, string | undefined> {
    const assinatura = createHmac('sha256', SEGREDO).update(corpo, 'utf8').digest('base64');
    return { 'x-hub-signature-256': assinatura };
}

test.before(async () => {
    await garanteLojaDoTeste();
    // `npm test` nao carrega o .env (e nao deve: o do dono tem `BOT_BOOT=0`), entao a
    // chave de cifra e' posta aqui. So o teste usa este valor.
    process.env.CHANNEL_SECRET = process.env.CHANNEL_SECRET?.trim() || 'chave-de-teste-do-relay';
    // O segredo do webhook e' lido de `MarketplaceAccount` **cifrado**: gravar em
    // claro faria a rota recusar por assinatura invalida e o teste mediria outra coisa.
    await comoLoja(LOJA, async () => {
        await prismaComLoja.marketplaceAccount.upsert({
            where: { tenantId_channel: { tenantId: LOJA, channel: CANAL } },
            create: { tenantId: LOJA, channel: CANAL, status: 'ativo', webhookSecretEnc: cifrar(SEGREDO) },
            update: { webhookSecretEnc: cifrar(SEGREDO) },
        });
    });
});

test.after(async () => {
    await prisma.chaveDeLoja.deleteMany({ where: { tenantId: LOJA } });
    await prisma.pedidoEntrante.deleteMany({ where: { tenantId: LOJA } });
    await prisma.$disconnect();
});

/* -------------------------------------------------------------- a chave de acesso */

test('o segredo certo abre a fila da loja, e o errado nao', async (t) => {
    const segredo = await geraChave(LOJA);
    t.after(() => prisma.chaveDeLoja.deleteMany({ where: { tenantId: LOJA } }));

    assert.equal(await lojaDoSegredo(segredo), LOJA, 'o segredo gerado abre a fila da loja');
    assert.equal(await lojaDoSegredo(`${segredo}x`), null, 'um caractere a mais nao abre');
    assert.equal(await lojaDoSegredo(''), null, 'vazio nao abre nem quebra');
});

test('a nuvem guarda o hash, nunca o segredo', async (t) => {
    const segredo = await geraChave(LOJA);
    t.after(() => prisma.chaveDeLoja.deleteMany({ where: { tenantId: LOJA } }));

    const linha = await prisma.chaveDeLoja.findUnique({ where: { tenantId: LOJA } });
    assert.ok(linha, 'a chave da loja existe');
    assert.notEqual(linha!.hash, segredo, 'o segredo em claro nao pode estar no banco da nuvem');
    assert.ok(!JSON.stringify(linha).includes(segredo), 'e nao aparece em nenhum campo da linha');
});

test('trocar a chave derruba a antiga', async (t) => {
    const primeira = await geraChave(LOJA);
    const segunda = await geraChave(LOJA);
    t.after(() => prisma.chaveDeLoja.deleteMany({ where: { tenantId: LOJA } }));

    assert.equal(await lojaDoSegredo(segunda), LOJA, 'a nova funciona');
    assert.equal(await lojaDoSegredo(primeira), null, 'a antiga e' + ' o que corta o acesso do PC perdido');
});

/* ------------------------------------------------------------ loja nova, sem Config */

test('colar a chave funciona em loja recem-instalada, que ainda nao tem Config', async (t) => {
    /*
     * Regressao de primeira instalacao: a linha de Config nasce quando alguem abre
     * a tela de ajustes, e colar a chave e' o primeiro passo de quem instalou agora.
     * Com `update` em vez de `upsert`, a loja nova ficava travada no primeiro erro.
     */
    await comoLoja(LOJA, async () => {
        await prismaComLoja.config.deleteMany({ where: { id: LOJA } });
        await registraSegredo('chave-colada-pela-loja');
        assert.equal(await segredoDaLoja(), 'chave-colada-pela-loja');

        // Colar de novo troca, e nao duplica.
        await registraSegredo('outra-chave');
        assert.equal(await segredoDaLoja(), 'outra-chave');
    });
    t.after(() => comoLoja(LOJA, () => prismaComLoja.config.upsert({
        where: { id: LOJA },
        update: {},
        create: { id: LOJA },
    })));
});

/* -------------------------------------------------------------- a fila da nuvem */

test('loja local: o pedido vira fila na nuvem e nao vira pedido la', async (t) => {
    /*
     * E' o coracao do local-first. Se a nuvem gravasse o pedido, o painel da loja
     * mostraria um pedido que o PC dela nunca viu -- e a baixa de estoque acontece no
     * PC, ou seja, o estoque da loja e' do PC.
     */
    await prisma.tenant.update({ where: { id: LOJA }, data: { local: true } });
    t.after(() => prisma.tenant.update({ where: { id: LOJA }, data: { local: false } }));

    const externalId = `RELAY-TESTE-${Date.now()}`;
    const corpo = corpoDoPedido(externalId);
    const resposta = await receberPedido(CANAL, corpo, cabecalho(corpo));

    assert.equal(resposta.aceito, true, 'a plataforma tem que receber 200, senao reenvia para sempre');
    assert.equal(resposta.enfileirado, true, 'loja local enfileira em vez de processar');

    const naFila = await prisma.pedidoEntrante.findMany({ where: { tenantId: LOJA, externalId } });
    assert.equal(naFila.length, 1, 'o pedido entrou na fila');
    assert.equal(naFila[0].entregueEm, null, 'e ainda espera o PC buscar');

    const gravados = await comoLoja(LOJA, () => prismaComLoja.order.count({ where: { channel: CANAL, externalId } }));
    assert.equal(gravados, 0, 'nenhum pedido gravado na loja pela nuvem');

    await prisma.pedidoEntrante.deleteMany({ where: { tenantId: LOJA, externalId } });
});

test('loja que ainda esta na nuvem continua sendo atendida na hora', async (t) => {
    /*
     * A virada e' por loja, nao global: enquanto a loja nao foi migrada, o webhook
     * dela precisa continuar entrando direto, senao o cliente que paga some.
     */
    await prisma.tenant.update({ where: { id: LOJA }, data: { local: false } });

    const externalId = `RELAY-DIRETO-${Date.now()}`;
    const corpo = corpoDoPedido(externalId);
    const resposta = await receberPedido(CANAL, corpo, cabecalho(corpo));

    assert.equal(resposta.aceito, true);
    assert.notEqual(resposta.enfileirado, true, 'na vitrine antiga nao existe fila');

    const naFila = await prisma.pedidoEntrante.count({ where: { tenantId: LOJA, externalId } });
    assert.equal(naFila, 0, 'nada foi para a fila');

    const gravados = await comoLoja(LOJA, () => prismaComLoja.order.count({ where: { channel: CANAL, externalId } }));
    assert.equal(gravados, 1, 'o pedido entrou direto no painel, como antes');

    t.after(() => comoLoja(LOJA, () => prismaComLoja.order.deleteMany({ where: { channel: CANAL, externalId } })));
});

test('a plataforma reenviando o mesmo pedido nao enfileira duas vezes', async (t) => {
    await prisma.tenant.update({ where: { id: LOJA }, data: { local: true } });
    t.after(() => prisma.tenant.update({ where: { id: LOJA }, data: { local: false } }));

    const externalId = `RELAY-REENVIO-${Date.now()}`;
    const corpo = corpoDoPedido(externalId);

    await receberPedido(CANAL, corpo, cabecalho(corpo));
    // A fila foi confirmada (o PC ja gravou) e a plataforma nao recebeu o retorno.
    const gravados = await comoLoja(LOJA, () => prismaComLoja.order.count({ where: { channel: CANAL, externalId } }));
    assert.equal(gravados, 0, 'a loja e' + ' local: a nuvem nao grava pedido');
    await prisma.pedidoEntrante.updateMany({
        where: { tenantId: LOJA, externalId },
        data: { entregueEm: new Date() },
    });

    await receberPedido(CANAL, corpo, cabecalho(corpo));
    const naFila = await prisma.pedidoEntrante.count({ where: { tenantId: LOJA, externalId } });
    assert.equal(naFila, 1, 'o reenvio acha a fila ja confirmada e nao cria outra');

    t.after(() => prisma.pedidoEntrante.deleteMany({ where: { tenantId: LOJA, externalId } }));
});

test('assinatura errada nao enfileira nada', async (t) => {
    await prisma.tenant.update({ where: { id: LOJA }, data: { local: true } });
    t.after(() => prisma.tenant.update({ where: { id: LOJA }, data: { local: false } }));

    const externalId = `RELAY-ASSINATURA-${Date.now()}`;
    const corpo = corpoDoPedido(externalId);
    const resposta = await receberPedido(CANAL, corpo, { 'x-hub-signature-256': 'invalida' });

    assert.equal(resposta.aceito, false);
    const naFila = await prisma.pedidoEntrante.count({ where: { tenantId: LOJA, externalId } });
    assert.equal(naFila, 0, 'quem nao assina nao escreve na fila de ninguem');
});

/* ------------------------------------------------------------------ a poda */

test('a fila percorre o prazo dela, e nao o dia da loja', async (t) => {
    /*
     * Um pedido que chegou ontem e continua esperando o PC -- desligado, na loja
     * fechada -- nao pode ser apagado pela virada do dia: a virada corta o dia da
     * loja, e o prazo da fila e' outro. Vencido o prazo, o que ficou e' lixo de fila.
     */
    {
        const antiga = `RELAY-VENCIDA-${Date.now()}`;
        const nova = `RELAY-VIGENTE-${Date.now()}`;
        await prisma.pedidoEntrante.create({
            data: {
                tenantId: LOJA,
                channel: CANAL,
                externalId: antiga,
                corpo: corpoDoPedido(antiga),
                criadoEm: new Date(Date.now() - 48 * 3600_000),
                expiraEm: new Date(Date.now() - 3600_000),
            },
        });
        await prisma.pedidoEntrante.create({
            data: {
                tenantId: LOJA,
                channel: CANAL,
                externalId: nova,
                corpo: corpoDoPedido(nova),
                expiraEm: new Date(Date.now() + 3600_000),
            },
        });

        const r = await podarDiaAnterior(new Date());

        t.after(() => prisma.pedidoEntrante.deleteMany({ where: { tenantId: LOJA } }));
        assert.equal(r.fila, 1, 'so o vencido saiu');
        assert.equal(
            await prisma.pedidoEntrante.count({ where: { tenantId: LOJA, externalId: nova } }),
            1,
            'o que ainda esta no prazo continua esperando o PC'
        );
    }
});
