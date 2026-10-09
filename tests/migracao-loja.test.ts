/*
 * A migracao da loja da nuvem para o PC, com dois bancos de verdade: o destino nasce de
 * um `VACUUM INTO` do banco da suite, com a loja apagada. E' o unico jeito de provar o
 * que quebra em silencio -- FK na ordem, o que nao atravessa e rodar duas vezes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { prisma } from '../src/database/prisma';
import { copiaLoja } from '../src/services/migracaoLoja';
import { cifrar } from '../src/services/marketplace';
import { garanteLojaDoTeste } from './lib/garante-loja';

const LOJA = process.env.DELIVERYADMIN_TENANT?.trim() || 'local';
/** A loja que "vive na nuvem" e vai ser migrada. */
const MIGRADA = 'loja-da-nuvem';
const CHAVE = 'chave-de-teste-da-migracao';

let destino: PrismaClient;
let pasta: string;

async function montaLojaNaOrigem(): Promise<void> {
    await prisma.tenant.upsert({
        where: { id: MIGRADA },
        update: {},
        create: { id: MIGRADA, name: 'Loja da nuvem', ativo: true },
    });
    await prisma.config.upsert({
        where: { id: MIGRADA },
        update: {},
        create: { id: MIGRADA, businessName: 'Padaria Migrada', relayChaveEnc: cifrar('segredo-da-nuvem') },
    });
    await prisma.user.upsert({
        where: { email: 'dono@migrada' },
        update: {},
        create: {
            tenantId: MIGRADA,
            email: 'dono@migrada',
            nome: 'Dono',
            senhaHash: 'hash',
            senhaSalt: 'sal',
            papel: 'admin',
        },
    });

    const grupo = await prisma.modifierGroup.create({ data: { tenantId: MIGRADA, name: 'Ponto' } });
    await prisma.modifierOption.create({ data: { tenantId: MIGRADA, groupId: grupo.id, name: 'Bem passado' } });

    const produto = await prisma.product.create({
        data: { tenantId: MIGRADA, name: 'Pao de queijo', price: 12, stock: 5, trackStock: true },
    });
    await prisma.productModifierGroup.create({ data: { tenantId: MIGRADA, productId: produto.id, groupId: grupo.id } });
    await prisma.stockMovement.create({
        data: { tenantId: MIGRADA, productId: produto.id, type: 'entrada', quantity: 5, delta: 5 },
    });

    const menu = await prisma.dailyMenu.create({ data: { tenantId: MIGRADA, date: new Date('2026-10-01T03:00:00Z') } });
    await prisma.dailyMenuItem.create({ data: { tenantId: MIGRADA, menuId: menu.id, productId: produto.id } });

    const chat = await prisma.chat.create({ data: { tenantId: MIGRADA, phone: '5511900000001@s.whatsapp.net' } });
    await prisma.message.create({ data: { tenantId: MIGRADA, chatId: chat.id, from: 'cliente', text: 'Ola' } });

    const turno = await prisma.cashShift.create({ data: { tenantId: MIGRADA, openingFloat: 50 } });
    await prisma.cashMovement.create({ data: { tenantId: MIGRADA, shiftId: turno.id, type: 'saida', amount: 10 } });
    await prisma.parkedSale.create({ data: { tenantId: MIGRADA, items: '[]' } });
    await prisma.reminder.create({ data: { tenantId: MIGRADA, date: new Date('2026-10-01T03:00:00Z'), text: 'Ligar' } });

    await prisma.order.create({
        data: { tenantId: MIGRADA, clientPhone: '5511900000001', items: '[]', total: 24 },
    });
}

/** O destino nasce do banco da suite do mesmo jeito que o PC recebe o dele do instalador. */
async function criaDestino(): Promise<PrismaClient> {
    pasta = mkdtempSync(join(tmpdir(), 'migracao-loja-'));
    const arquivo = join(pasta, 'loja.db').split('\\').join('/');
    // `VACUUM INTO` e' o mesmo truque do backup: um arquivo consistente, com o WAL
    // embutido, em vez de copiar o banco por cima (o que perderia o que esta no WAL).
    await prisma.$executeRawUnsafe(`VACUUM INTO '${arquivo}'`);
    return new PrismaClient({ datasourceUrl: 'file:' + arquivo });
}

test.before(async () => {
    await garanteLojaDoTeste();
    process.env.CHANNEL_SECRET = process.env.CHANNEL_SECRET?.trim() || CHAVE;
    await montaLojaNaOrigem();
    destino = await criaDestino();
    await destino.tenant.deleteMany({ where: { id: MIGRADA } });
});

test.after(async () => {
    await prisma.tenant.deleteMany({ where: { id: MIGRADA } });
    await destino?.$disconnect().catch(() => 0);
    if (pasta) rmSync(pasta, { recursive: true, force: true });
    await prisma.$disconnect();
});

test('a loja atravessa inteira, e nada cifrado atravessa com ela', async () => {
    await copiaLoja(prisma, destino, MIGRADA);

    const loja = await destino.tenant.findUnique({ where: { id: MIGRADA } });
    assert.ok(loja, 'a loja existe no destino');
    assert.equal(loja!.name, 'Loja da nuvem');

    const config = await destino.config.findUnique({ where: { id: MIGRADA } });
    assert.equal(config!.businessName, 'Padaria Migrada');
    assert.equal(config!.relayChaveEnc, '', 'o segredo da nuvem nao chega cifrado para o PC');

    assert.equal(await destino.user.count({ where: { tenantId: MIGRADA } }), 1, 'a conta do dono vem junto');
    assert.equal(await destino.product.count({ where: { tenantId: MIGRADA } }), 1);
    assert.equal(await destino.order.count({ where: { tenantId: MIGRADA } }), 1);
    assert.equal(await destino.message.count({ where: { tenantId: MIGRADA } }), 1);
    assert.equal(await destino.cashMovement.count({ where: { tenantId: MIGRADA } }), 1);
    assert.equal(await destino.modifierOption.count({ where: { tenantId: MIGRADA } }), 1);
    assert.equal(await destino.dailyMenuItem.count({ where: { tenantId: MIGRADA } }), 1);
    assert.equal(await destino.parkedSale.count({ where: { tenantId: MIGRADA } }), 1);
    assert.equal(await destino.reminder.count({ where: { tenantId: MIGRADA } }), 1);
    assert.equal(await destino.productModifierGroup.count({ where: { tenantId: MIGRADA } }), 1);

    assert.equal(await destino.tenant.count({ where: { id: LOJA } }), 1, 'a loja vizinha segue no destino');
});

test('o segredo do marketplace tambem nao atravessa', async () => {
    await prisma.marketplaceAccount.deleteMany({ where: { tenantId: MIGRADA } });
    await prisma.marketplaceAccount.create({
        data: {
            tenantId: MIGRADA,
            channel: 'ifood',
            status: 'ativo',
            secretsEnc: cifrar('credencial-ifood'),
            webhookSecretEnc: cifrar('segredo-do-webhook'),
        },
    });

    await copiaLoja(prisma, destino, MIGRADA);

    const conta = await destino.marketplaceAccount.findFirst({ where: { tenantId: MIGRADA, channel: 'ifood' } });
    assert.ok(conta, 'a conta do marketplace veio');
    assert.equal(conta!.status, 'ativo');
    assert.equal(conta!.secretsEnc, '', 'credencial da nuvem nao abre no PC: a loja recredencia');
    assert.equal(conta!.webhookSecretEnc, '');
});

test('rodar de novo completa sem duplicar nem sobrescrever', async () => {
    const antes = await destino.product.findFirst({ where: { tenantId: MIGRADA } });
    const segunda = await copiaLoja(prisma, destino, MIGRADA);

    assert.equal(await destino.product.count({ where: { tenantId: MIGRADA } }), 1, 'o produto continua um');
    assert.equal(await destino.order.count({ where: { tenantId: MIGRADA } }), 1, 'o pedido continua um');

    const lidas = segunda.reduce((soma, r) => soma + r.lidas, 0);
    assert.equal(segunda.reduce((soma, r) => soma + r.gravadas, 0), 0, 'nada foi gravado na segunda passagem');
    assert.equal(segunda.reduce((soma, r) => soma + r.repetidas, 0), lidas, 'toda linha lida ja estava la');

    const depois = await destino.product.findFirst({ where: { tenantId: MIGRADA } });
    assert.deepEqual(depois, antes, 'e o que estava no PC continua igual');
});

test('simular conta e nao grava', async () => {
    await destino.tenant.deleteMany({ where: { id: MIGRADA } });

    const resultado = await copiaLoja(prisma, destino, MIGRADA, { simular: true });

    assert.ok(resultado.reduce((soma, r) => soma + r.lidas, 0) > 0, 'a contagem mostra o que viria');
    assert.equal(resultado.reduce((soma, r) => soma + r.gravadas, 0), 0);
    assert.equal(await destino.tenant.count({ where: { id: MIGRADA } }), 0, 'e nada foi gravado');
});

test('a sessao do WhatsApp fica de fora por padrao', async () => {
    await prisma.chaveWhatsApp.deleteMany({ where: { tenantId: MIGRADA } });
    await prisma.sessaoWhatsApp.deleteMany({ where: { tenantId: MIGRADA } });
    await prisma.sessaoWhatsApp.create({
        data: { tenantId: MIGRADA, maquinaId: 'maq-da-nuvem', creds: '{"creds":"x"}' },
    });

    const sem = await copiaLoja(prisma, destino, MIGRADA);
    assert.equal(sem.find((r) => r.modelo === 'sessaoWhatsApp'), undefined, 'sem a flag, nem e' + ' lida');

    const com = await copiaLoja(prisma, destino, MIGRADA, { sessaoWhatsApp: true });
    assert.equal(com.find((r) => r.modelo === 'sessaoWhatsApp')!.lidas, 1);
    assert.equal(await destino.sessaoWhatsApp.count({ where: { tenantId: MIGRADA } }), 1);
});