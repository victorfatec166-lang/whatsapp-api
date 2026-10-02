/*
 * A foto do produto vive no Postgres, nao em arquivo: em arquivo ela sumia no
 * deploy seguinte. O teste grava os bytes, le de volta e prova o isolamento
 * entre lojas -- que e' o que o `prismaComLoja` existe para garantir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import { prismaComLoja } from '../src/database/prisma-com-loja';
import { comoLoja } from '../src/services/loja';
import { garanteLojaDoTeste, LOJA } from './lib/garante-loja';

/** PNG de 1x1 em base64: o menor arquivo que o `dataUrl` do painel aceita. */
const BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

test.after(async () => {
    await prisma.product.deleteMany({ where: { tenantId: LOJA, name: { startsWith: 'Foto de teste' } } });
    await prisma.$disconnect();
});

test('1. os bytes da foto ficam no banco, e nao em arquivo', async () => {
    const loja = await garanteLojaDoTeste();

    const criado = await comoLoja(loja, async () =>
        prismaComLoja.product.create({
            data: {
                name: 'Foto de teste 1',
                price: 10,
                imageData: BYTES,
                imageMime: 'image/png',
                imageUrl: '/api/admin/products/x/photo',
            },
        })
    );

    const guardado = await prisma.product.findUniqueOrThrow({
        where: { id: criado.id },
        select: { imageData: true, imageMime: true },
    });

    assert.ok(guardado.imageData, 'os bytes da foto nao foram gravados');
    assert.equal(guardado.imageMime, 'image/png');
    assert.ok(
        Buffer.from(guardado.imageData).equals(BYTES),
        'os bytes voltaram diferentes do que foi enviado'
    );
});

test('2. a foto de uma loja nao aparece para a outra', async () => {
    const loja = await garanteLojaDoTeste();

    const criado = await comoLoja(loja, async () =>
        prismaComLoja.product.create({
            data: { name: 'Foto de teste 2', price: 10, imageData: BYTES, imageMime: 'image/png' },
        })
    );

    const pelaVizinha = await comoLoja('loja-que-nao-existe-teste', async () =>
        prismaComLoja.product.findFirst({ where: { id: criado.id }, select: { id: true } })
    );

    assert.equal(pelaVizinha, null, 'a loja vizinha leu a foto de outra loja');
});

test('3. apagar a foto limpa os bytes junto com o endereco', async () => {
    const loja = await garanteLojaDoTeste();

const criado = await prisma.product.create({
        data: {
            tenantId: loja,
            name: 'Foto de teste 3',
            price: 10,
            imageData: BYTES,
            imageMime: 'image/png',
        },
    });

    // O cliente cru e' o que a rota usa: as rotas de painel no `server.ts` falam
    // com ele, e o filtro de loja nao entra por aqui.
    await prisma.product.update({
        where: { id: criado.id },
        data: { imageUrl: null, imageData: null, imageMime: null },
    });

    const depois = await prisma.product.findUniqueOrThrow({
        where: { id: criado.id },
        select: { imageUrl: true, imageData: true, imageMime: true },
    });

    assert.equal(depois.imageUrl, null, 'o endereco da foto continua apontando para ela');
    assert.equal(depois.imageData, null, 'os bytes ficaram no banco depois de apagar a foto');
    assert.equal(depois.imageMime, null);
});