/* O caminho que o cliente sente: escolher pelo NUMERO. O sintoma era menu -> "1" ->
 * "deu um erro" -> menu de novo, porque `loadProductFull` lia o produto por `id` sem a
 * loja e a extensao recusava. Aqui as duas pontas rodam com a loja no contexto. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import { comoLoja } from '../src/services/loja';
import { loadProductFull } from '../src/services/modifiers';

const LOJA = 'bot-numero-aa';

async function montaLoja() {
    await prisma.tenant.upsert({
        where: { id: LOJA },
        update: {},
        create: { id: LOJA, name: 'Loja do teste', ativo: true },
    });
    const existente = await prisma.product.findFirst({ where: { tenantId: LOJA }, select: { id: true } });
    if (existente) return existente!.id;
    const p = await prisma.product.create({
        data: { tenantId: LOJA, sku: 'NUM-1', name: 'Arroz, feijao e salada', price: 13.99, category: 'Pratos' },
    });
    return p.id;
}

const limpa = async (t: any) =>
    t.after(async () => {
        await prisma.product.deleteMany({ where: { tenantId: LOJA } });
        await prisma.tenant.deleteMany({ where: { id: LOJA } });
    });

test('ler o produto escolhido pelo numero traz nome e grupos', async (t) => {
    /*
     * E' o passo que quebrava: o cliente mandava "1", o bot tentava ler o produto e
     * a extensao recusava o `id` sem a loja. O nome voltando e' a prova de que o
     * caminho inteiro -- escolher, ler, conferir modificadores -- funciona.
     */
    await limpa(t);
    const id = await montaLoja();

    const produto = await comoLoja(LOJA, () => loadProductFull(id));

    assert.ok(produto, 'o produto escolhido pelo numero nao veio');
    assert.equal(produto.id, id);
    assert.equal(produto.name, 'Arroz, feijao e salada');
    assert.deepEqual(produto.modifierGroups, [], 'grupo de modificador voltou sem ser pedido');
});

test('produto de outra loja devolve vazio, e nao o produto dela', async (t) => {
    /*
     * `id` e' chave primaria global, entao o teste nao pode forcar dois iguais. O
     * que prova o isolamento e' o inverso: um id valido de outra loja tem de dar
     * `null`, e nao o produto. E' o que o `tenantId_id` garante.
     */
    await limpa(t);
    const id = await montaLoja();
    const OUTRA = 'bot-numero-cc';
    await prisma.tenant.upsert({
        where: { id: OUTRA },
        update: {},
        create: { id: OUTRA, name: 'Vizinha', ativo: true },
    });

    const vazamento = await comoLoja(OUTRA, () => loadProductFull(id));
    assert.equal(vazamento, null, 'produto de outra loja atravessou');

    await prisma.tenant.deleteMany({ where: { id: OUTRA } });
});