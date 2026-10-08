/*
 * Valida o isolamento multi-tenant do Prisma com duas lojas em paralelo:
 * leitura isolada, escrita com tenant automatico e recusa estrita fora de contexto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import { prismaComLoja } from '../src/database/prisma-com-loja';
import { comoLoja } from '../src/services/loja';
import { applyMovement } from '../src/services/stock';

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
        await prisma.stockMovement.deleteMany({ where: { tenantId: loja } });
        await prisma.product.deleteMany({ where: { tenantId: loja } });
        await prisma.chat.deleteMany({ where: { tenantId: loja } });
        await prisma.message.deleteMany({ where: { tenantId: loja } });
    }
    for (const loja of [PADARIA, SUSHI]) {
        await prisma.tenant.delete({ where: { id: loja } }).catch(() => 0);
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

/*
 * O `tx` do `$transaction` e' o cliente CRU: a extensao do Prisma nao chega nele.
 * Sem o embrulho, uma loja lia e alterava o produto da vizinha de dentro da
 * transacao -- e era assim que o estoque de outra loja mudava sem ninguem pedir.
 */
test('6. dentro da transacao a loja continua valendo', async () => {
    await criaLoja(PADARIA);
    await criaLoja(SUSHI);

    const daVizinha = await comoLoja(SUSHI, () =>
        prismaComLoja.product.create({ data: { name: 'item da B na transacao', price: 7, stock: 50, trackStock: true } })
    );
    await comoLoja(PADARIA, () =>
        prismaComLoja.product.create({ data: { name: 'item da A na transacao', price: 7, stock: 3 } })
    );

    await assert.rejects(
        () =>
            comoLoja(PADARIA, () =>
                prismaComLoja.$transaction((tx) => tx.product.findUnique({ where: { id: daVizinha.id } }))
            ),
        /sem a loja/i,
        'a chave unica sem loja passou dentro da transacao'
    );

    const listados = await comoLoja(PADARIA, () => prismaComLoja.$transaction((tx) => tx.product.findMany({})));
    assert.ok(
        listados.every((p) => p.tenantId === PADARIA),
        'a listagem na transacao trouxe produto de outra loja'
    );
    assert.ok(
        listados.some((p) => p.name === 'item da A na transacao'),
        'a listagem na transacao nem trouxe o proprio produto'
    );
});

test('7. o movimento de estoque nao alcança o produto da loja vizinha', async () => {
    const daVizinha = await comoLoja(SUSHI, () =>
        prismaComLoja.product.create({ data: { name: 'item da B no estoque', price: 7, stock: 50, trackStock: true } })
    );

    // A loja A tenta baixar o saldo de um produto que nao e' dela, pelo id.
    const baixa = await comoLoja(PADARIA, () =>
        applyMovement({ productId: daVizinha.id, type: 'saida', quantity: 40, source: 'manual' })
    );
    assert.equal(baixa.ok, false, 'a loja A baixou o estoque de um produto da loja B');
    assert.match(String(baixa.error), /nao encontrado/i, 'e o erro tem de dizer que o produto nao e' + ' dela');

    const depois = await prisma.product.findUnique({ where: { id: daVizinha.id }, select: { stock: true } });
    assert.equal(depois?.stock, 50, 'o saldo da loja B foi alterado por outra loja');
    const gravados = await comoLoja(PADARIA, () => prismaComLoja.stockMovement.count());
    assert.equal(gravados, 0, 'o movimento da loja B ficou registrado na loja A');
});

test("8. o que e' global continua global dentro da transacao", async () => {
    // `Tenant` esta na lista de isentos pelo nome em PascalCase, e o `tx` entrega o
    // delegate em camelCase: se o nome nao casasse, a loja entraria no filtro.
    const achado = await comoLoja(PADARIA, () =>
        prismaComLoja.$transaction((tx) => tx.tenant.findUnique({ where: { id: PADARIA } }))
    );
    assert.equal(achado?.id, PADARIA, 'a loja global sumiu dentro da transacao');
});

/*
 * A chave composta fecha a porta depois das 23 correcoes: em todo o sistema a chave
 * unica carrega a loja, entao um id da loja vizinha nao encontra linha nenhuma. Sem a
 * unique no banco a primeira consulta ja estoura, e o teste diz qual model esta sem ela.
 */
const MODELOS_COM_CHAVE = ['product', 'cashShift', 'user', 'reminder'] as const;

test('9. a chave composta acha o produto da loja e recusa o id da vizinha', async () => {
    await criaLoja(PADARIA);
    await criaLoja(SUSHI);

    // Chaveado pelo NOME DO DELEGATE, que e' como o codigo chama o model.
    const idDaVizinha: Record<string, string> = {
        product: (await comoLoja(SUSHI, () => prismaComLoja.product.create({ data: { name: 'item da B', price: 9 } }))).id,
        cashShift: (await comoLoja(SUSHI, () => prismaComLoja.cashShift.create({ data: { openingFloat: 0 } }))).id,
        user: (
            await comoLoja(SUSHI, () =>
                prismaComLoja.user.create({
                    data: { email: 'b@exemplo.com', nome: 'B', senhaHash: 'x', senhaSalt: 'y', papel: 'caixa' },
                })
            )
        ).id,
        reminder: (
            await comoLoja(SUSHI, () => prismaComLoja.reminder.create({ data: { date: new Date(), text: 'da B' } }))
        ).id,
    };

    for (const modelo of MODELOS_COM_CHAVE) {
        // A loja A pede o id que pertence a B: nao pode vir linha nenhuma. O delegate
        // e' lido DENTRO do `comoLoja` de proposito: e' o `get` do proxy que le a loja.
        const vazamento = await comoLoja(PADARIA, () =>
            (prismaComLoja[modelo] as { findUnique: (a: unknown) => Promise<unknown> }).findUnique({
                where: { tenantId_id: { tenantId: PADARIA, id: idDaVizinha[modelo] } },
            })
        );
        assert.equal(vazamento, null, `${modelo}: a loja A leu a linha da loja B pela chave composta`);
    }

    // E a loja A alcanca o que e' dela, com a mesma chave.
    const meu = await comoLoja(PADARIA, async () => {
        const produto = await prismaComLoja.product.create({ data: { name: 'item da A', price: 9 } });
        return prismaComLoja.product.findUnique({
            where: { tenantId_id: { tenantId: PADARIA, id: produto.id } },
        });
    });
    assert.equal(meu?.name, 'item da A', 'a chave composta deixou de achar o proprio produto');
});

test('10. apagar o produto da loja vizinha pela chave composta nao apaga nada', async () => {
    const daVizinha = await comoLoja(SUSHI, () =>
        prismaComLoja.product.create({ data: { name: 'produto a proteger', price: 9 } })
    );

    // Sem a loja na chave, o `delete` ESTOURA: e' o que a extensao garante. Se um dia
    // alguem trocar por `where: { id }`, este teste acusa.
    await assert.rejects(
        () =>
            comoLoja(PADARIA, () =>
                prismaComLoja.product.delete({ where: { id: daVizinha.id } })
            ),
        /sem a loja/i,
        'apagar por id sozinho passou: a loja vizinha esta' + ' a alcance'
    );

    const sobreviveu = await prisma.product.findFirst({ where: { id: daVizinha.id } });
    assert.ok(sobreviveu, 'o produto da loja vizinha foi apagado');
});
