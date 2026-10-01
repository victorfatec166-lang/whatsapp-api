/*
 * Valida o isolamento multi-tenant do Prisma com duas lojas em paralelo:
 * leitura isolada, escrita com tenant automatico e recusa estrita fora de contexto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import { prismaComLoja } from '../src/database/prisma-com-loja';
import { comoLoja } from '../src/services/loja';

const PADARIA = 'loja-padaria-teste';
const SUSHI = 'loja-sushi-teste';

const criado: string[] = [];

async function criaLoja(id: string): Promise<void> {
    await prisma.tenant.create({ data: { id, name: id, ativo: true } }).catch(() => {});
}

test.after(async () => {
    // A limpeza usa o cliente CRU de proposito: ela roda fora de requisicao, e
    // e' justamente por isso que a prova 3 exige que a cliente com loja estoure.
    for (const loja of [PADARIA, SUSHI]) {
        await prisma.product.deleteMany({ where: { tenantId: loja } });
        await prisma.chat.deleteMany({ where: { tenantId: loja } });
        await prisma.message.deleteMany({ where: { tenantId: loja } });
    }
    for (const loja of [PADARIA, SUSHI]) {
        await prisma.tenant.delete({ where: { id: loja } }).catch(() => {});
    }
    await prisma.$disconnect();
});

test('1. leitura: a loja A nao ve o produto da loja B', async () => {
    await criaLoja(PADARIA);
    await criaLoja(SUSHI);

    const daPadaria = await comoLoja(PADARIA, async () => {
        const p = await prismaComLoja.product.create({
            data: { name: 'Pao de queijo', price: 12, stock: 5 },
        });
        criado.push(p.id);
        return p;
    });
    const doSushi = await comoLoja(SUSHI, async () => {
        const p = await prismaComLoja.product.create({
            data: { name: 'Sushi de salmão', price: 39, stock: 3 },
        });
        criado.push(p.id);
        return p;
    });

    // A loja A busca pelo nome EXATO do produto da loja B. Acharia, se a extensao
    // nao estivesse filtrando -- e o nome e' unico entre as duas por construcao.
    const vistoPelaPadaria = await comoLoja(PADARIA, () =>
        prismaComLoja.product.findMany({ where: { name: doSushi.name } })
    );
    assert.equal(vistoPelaPadaria.length, 0, 'a loja A viu o produto da loja B pelo nome');

    // E a listagem dela tem de trazer o dela, senao o filtro esta' batendo errado.
    const seus = await comoLoja(PADARIA, () => prismaComLoja.product.findMany({}));
    assert.ok(
        seus.some((p) => p.id === daPadaria.id),
        'a loja A nao viu o proprio produto'
    );
    assert.ok(
        !seus.some((p) => p.id === doSushi.id),
        'a listacao da loja A trouxe o produto da loja B'
    );
});

test('2. escrita: o que a loja grava nasce com a loja, sem pedir', async () => {
    const p = await comoLoja(SUSHI, async () => {
        const chat = await prismaComLoja.chat.create({ data: { phone: '5511999999999@s.whatsapp.net' } });
        const msg = await prismaComLoja.message.create({
            data: { chatId: chat.id, from: 'cliente', text: 'um sushi de salmão' },
        });
        return { chat, msg };
    });

    const chatLido = await prisma.chat.findFirst({ where: { id: p.chat.id } });
    assert.equal(chatLido?.tenantId, SUSHI, 'a conversa nasceu sem a loja da loja B');

    const msgLida = await prisma.message.findFirst({ where: { id: p.msg.id } });
    assert.equal(msgLida?.tenantId, SUSHI, 'a mensagem nasceu sem a loja');
});

test('3. fora de uma requisicao, a consulta ESTOURA em vez de vazar', async () => {
    // Erro sincrono disparado no proxy do cliente quando chamado sem loja;
    // throws valida a excecao antes da resolucao da query.
    assert.throws(
        () => prismaComLoja.product.findMany({}),
        /sem loja/i,
        'a consulta sem loja passou em vez de estourar'
    );
});

test('4. o mesmo telefone pode ser cliente das duas lojas', async () => {
    // `phone` e' unico POR LOJA. Com a unique global, a segunda loja receberia
    // erro de criacao num cliente legitimo -- e o dono veria "telefone ja
    // cadastrado" para o proprio cliente, na loja errada.
    const telefone = '5511888888888@s.whatsapp.net';
    const a = await comoLoja(PADARIA, () =>
        prismaComLoja.chat.create({ data: { phone: telefone } })
    );
    const b = await comoLoja(SUSHI, () =>
        prismaComLoja.chat.create({ data: { phone: telefone } })
    );
    assert.notEqual(a.id, b.id);
    assert.equal(a.tenantId, PADARIA);
    assert.equal(b.tenantId, SUSHI);
});

test('5. deleteMany sem filtro nao apaga a loja vizinha', async () => {
    // A virada da meia-noite usa `deleteMany`. Sem a loja no `where`, ela
    // apagaria a conversa de TODO MUNDO e nao so da loja que esta' rodando.
    const marca = await comoLoja(PADARIA, () =>
        prismaComLoja.product.create({ data: { name: 'item a sobreviver', price: 1 } })
    );
    const daVizinha = await comoLoja(SUSHI, () =>
        prismaComLoja.product.create({ data: { name: 'item da vizinha', price: 1 } })
    );

    await comoLoja(SUSHI, () => prismaComLoja.product.deleteMany({ where: { price: 1 } }));

    const sobrou = await prisma.product.findFirst({ where: { id: marca.id } });
    assert.ok(sobrou, 'o delete sem filtro da loja B apagou o produto da loja A');
    const apagado = await prisma.product.findFirst({ where: { id: daVizinha.id } });
    assert.equal(apagado, null, 'o delete da propria loja nao apagou nada');
});
