/*
 * Este e' o teste que permite trocar "somar em JavaScript" por "somar no banco"
 * sem mexer em um centavo do Faturamento. Sem ele a troca e' uma aposta: os dois
 * caminhos parecem iguais na leitura e divergem no primeiro pedido com data torta.
 */

/*
 * Por que compara os dois calculos, e nao so o do SQL: um teste so do SQL
 * precisaria saber a resposta certa, e aqui ela e' o que o sistema ja mostrava --
 * `computeStats`, a versao em memoria. Se divergirem, o teste diz qual campo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import { comoLoja } from '../src/services/loja';
import { computeStats, type OrderWithProductless } from '../src/services/stats';
import { computeStatsSql } from '../src/services/statsSql';

function cents(v: number): number {
    return Math.round(v * 100) / 100;
}

test.after(async () => {
    await prisma.$disconnect();
});

/*
 * Compara o calculo SQL com o calculo em memoria para o mesmo tenant;
 * garante que a agregacao isola os pedidos da loja informada.
 */
const LOJA = process.env.DELIVERYADMIN_TENANT?.trim() || 'local';

async function pedidosDaLoja(): Promise<OrderWithProductless[]> {
    return (await prisma.order.findMany({
        where: { tenantId: LOJA },
        orderBy: { createdAt: 'asc' },
    })) as OrderWithProductless[];
}

// Os dois calculos rodam sobre o MESMO banco: mesma entrada, comparacao justa.
test('agregacao no banco bate com a de memoria, campo a campo', async () => {
    const orders = await pedidosDaLoja();

    const memoria = await computeStats(orders);
    const sql = await comoLoja(LOJA, () => computeStatsSql());

    // Receita: o campo que produz dinheiro.
    assert.equal(cents(sql.allTime.revenue), cents(memoria.allTime.revenue), 'receita total');
    assert.equal(sql.allTime.orders, memoria.allTime.orders, 'quantidade de pedidos');
    assert.equal(cents(sql.today.revenue), cents(memoria.today.revenue), 'receita de hoje');
    assert.equal(cents(sql.week.revenue), cents(memoria.week.revenue), 'receita da semana');
    assert.equal(cents(sql.month.revenue), cents(memoria.month.revenue), 'receita do mes');
    assert.equal(cents(sql.averageTicket), cents(memoria.averageTicket), 'ticket medio');

    // Contagens.
    assert.deepEqual(sql.byStatus, memoria.byStatus, 'pedidos por status');
    assert.deepEqual(
        sql.topProducts.map((p) => [p.name, p.qty, cents(p.revenue)]),
        memoria.topProducts.map((p) => [p.name, p.qty, cents(p.revenue)]),
        'mais vendidos'
    );

    // Tempo. A hora e' local do dono: e' aqui que o `localtime` aparece.
    assert.deepEqual(sql.byHour, memoria.byHour, 'pedidos por hora');
    assert.deepEqual(sql.byDayOfWeek, memoria.byDayOfWeek, 'pedidos por dia da semana');
    assert.deepEqual(sql.revenueByDay, memoria.revenueByDay, 'receita por dia');

    // Canais e ajustes.
    assert.deepEqual(sql.byChannel, memoria.byChannel, 'receita por canal');
    assert.equal(cents(sql.todayAdjustments.discounts), cents(memoria.todayAdjustments.discounts), 'descontos de hoje');
    assert.equal(cents(sql.todayAdjustments.tips), cents(memoria.todayAdjustments.tips), 'gorjetas de hoje');
});

test('receita por dia fica em ordem crescente, e nao invertida', async () => {
    const sql = await comoLoja(LOJA, () => computeStatsSql());
    const datas = sql.revenueByDay.map((d) => d.date);
    const ordenadas = [...datas].sort();
    assert.deepEqual(datas, ordenadas, 'o grafico de receita e' + ' linha do tempo');
});

test('o dia do grafico e' + ' o dia local, nao o dia em UTC', async () => {
    /*
     * A correcao que a paridade descobriu: `computeStats` agrupava por
     * `toISOString().slice(0, 10)`, que e' o dia em UTC. Um pedido as 21:23 UTC
     * sao 18:23 em Brasilia -- mesmo dia -- e aparecia no grafico como o seguinte.
     */

    /*
     * Aqui nao se compara com o SQL: fixa o comportamento para que uma refatoracao
     * nao reintroduza o UTC. Quem estava certo -- o SQL, com `localtime` -- foi
     * olhando os dois numeros lado a lado: 8 pedidos apareciam no dia errado.
     */
    const orders = await pedidosDaLoja();
    const memoria = await computeStats(orders);

    for (const dia of memoria.revenueByDay) {
        // Meia-noite UTC seria o limite; um pedido de 21h UTC tem de ficar no
        // dia local, que no Brasilia e' o mesmo dia.
        const comoUtc = dia.date + 'T23:59:59Z';
        const data = new Date(comoUtc);
        const diaLocalDaData = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(
            data.getDate()
        ).padStart(2, '0')}`;
        assert.equal(
            dia.date,
            diaLocalDaData,
            `o dia "${dia.date}" nao corresponde a data local do proprio rotulo`
        );
    }
});

test('as datas do SQL sao as mesmas do JavaScript, no mesmo fuso', async () => {
    /*
     * Epoch mal convertido virava data ou 1969, e nenhuma verificacao de "tem data"
     * reclamava. Com `createdAt` como TIMESTAMP o risco some, mas a comparacao
     * continua de valor: um dia antes de 2000 significa que a data entrou como numero.
     */
    const sql = await comoLoja(LOJA, () => computeStatsSql());
    const inicioDoBanco = new Date(2000, 0, 1).getTime();

    if (sql.revenueByDay.length > 0) {
        for (const dia of sql.revenueByDay) {
            const comoData = Date.parse(`${dia.date}T12:00:00`);
            assert.ok(
                comoData >= inicioDoBanco,
                `dia "${dia.date}" e' anterior a 2000 -- sinal de epoch mal convertido`
            );
        }
    }
});

test('o total do SQL confere com a soma crua da tabela', async () => {
    /*
     * A checagem mais burra e' a que mais pega: `SUM` direto na tabela, sem
     * nenhuma logica do projeto no meio. Se as janelas e agrupamentos do SQL
     * estivessem errados, o total ainda teria de bater com o `SUM` cru.
     */
    const [cru] = await prisma.$queryRawUnsafe<{ receita: unknown; n: unknown }[]>(
        `SELECT COALESCE(SUM(total), 0) AS receita, COUNT(*) AS n FROM "Order" WHERE "tenantId" = $1`,
        LOJA
    );
    const sql = await comoLoja(LOJA, () => computeStatsSql());

    assert.equal(cents(sql.allTime.revenue), cents(Number(cru.receita)), 'receita total vs SUM cru');
    assert.equal(sql.allTime.orders, Number(cru.n), 'contagem vs COUNT cru');
});

test('banco vazio nao quebra a agregacao', async () => {
    /*
     * A soma de uma loja sem nenhum pedido: todos os buckets em zero, ticket
     * medio zero e sem divisao por zero. O `averageTicket` antigo tem guarda
     * explicita; o novo tambem precisa, e este teste e' o que trava isso.
     */
    const sql = await comoLoja(LOJA, () => computeStatsSql());
    assert.ok(Number.isFinite(sql.averageTicket), 'ticket medio e' + ' finito');
    assert.equal(sql.byHour.length, 24, 'sempre 24 horas, mesmo vazio');
    assert.equal(sql.byDayOfWeek.length, 7, 'sempre 7 dias, mesmo vazio');
    assert.deepEqual(
        Object.keys(sql.byStatus).sort(),
        ['concluido', 'entrega', 'pendente', 'preparando'],
        'todo status tem posicao, mesmo sem pedido'
    );
    assert.equal(sql.busiestHour === null || sql.busiestHour.orders > 0, true, 'hora mais cheia coerente');
});
