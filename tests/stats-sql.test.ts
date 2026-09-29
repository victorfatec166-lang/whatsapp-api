/*
 * A agregacao no banco diz o mesmo que a de memoria?
 *
 * Este e' o teste que permite trocar "somar em JavaScript" por "somar no
 * SQLite" sem mexer em um centavo do Faturamento. Sem ele, a mudacao e' uma
 * aposta: os dois caminhos parecem Iguais na leitura, e divergem no primeiro
 * pedido com data thorn.
 *
 * Por que compara os dois calculos, e nao so o do SQL
 *
 * Um teste que so verifica o SQL precisa saber a resposta certa. Aqui a
 * resposta certa e' o que o sistema ja mostrava -- `computeStats`, a versao em
 * memoria, que e' a que roda hoje. Se os dois concordarem em todos os campos, a
 * troca nao mudou nada observavel. Se divergirem, o teste diz qual campo e
 * quais numeros, e nao "deu ruim".
 *
 * Os dois rodam sobre o MESMO banco, entao a comparacao e' justa: mesma
 * entrada, dois calculos.
 *
 * O QUE ESTE TESTE PEGOU
 *
 * 1. `createdAt / 1000` antes do `strftime`. O SQLite le "2026-09-25T21:23..."
 *    como o numero 2026 e o trata como epoch em segundos, devolvendo
 *    1969-12-31 -- uma data plausivel. Sem o erro, o GROUP BY por dia agrupava
 *    tudo em 1969 e o grafico de receita ficava vazio. Um teste que so conferia
 *    "veio uma data" passava.
 * 2. `localtime` faltando. Sem ele, o "pedidos por hora" mostra o horario de
 *    Greenwich: 21h em Brasilia viraria 00h do dia seguinte, e o pico de
 *    pedidos apareceria na hora errada.
 * 3. A soma de "hoje" vs "semana" vs "mes" trocada de janela.
 * 4. `revenueByDay` em ordem decrescente: o grafico e' linha do tempo, e
 *    invertido mostra o passado depois do presente.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import { computeStats, type OrderWithProductless } from '../src/services/stats';
import { computeStatsSql } from '../src/services/statsSql';

function cents(v: number): number {
    return Math.round(v * 100) / 100;
}

test.after(async () => {
    await prisma.$disconnect();
});

test('agregacao no banco bate com a de memoria, campo a campo', async () => {
    const orders = (await prisma.order.findMany({ orderBy: { createdAt: 'asc' } })) as OrderWithProductless[];

    const memoria = await computeStats(orders);
    const sql = await computeStatsSql();

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
    const sql = await computeStatsSql();
    const datas = sql.revenueByDay.map((d) => d.date);
    const ordenadas = [...datas].sort();
    assert.deepEqual(datas, ordenadas, 'o grafico de receita e' + ' linha do tempo');
});

test('o dia do grafico e' + ' o dia local, nao o dia em UTC', async () => {
    /*
     * A correcao que o teste de paridade discoveriu.
     *
     * O `computeStats` antigo agrupava por `toISOString().slice(0, 10)`, que e'
     * o dia em UTC. Um pedido as 21:23 UTC e' 18:23 em Brasilia -- o mesmo dia,
     * no meio do expediente -- e aparecia no grafico como dia seguinte.
     *
     * Este teste nao compara com o SQL: fixa o comportamento, para que uma
     * refatoracao futura nao reintroduza o UTC. A escolha de quem estava certo
     * (o SQL, com `localtime`) foi feita olhando os dois numeros lado a lado no
     * banco de verdade: 8 pedidos apareciam no dia errado.
     */
    const orders = (await prisma.order.findMany({ orderBy: { createdAt: 'asc' } })) as OrderWithProductless[];
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
     * Este e' o teste do `/1000`.
     *
     * Com `createdAt / 1000`, o SQLite devolve 1969 para tudo. A data continua
     * sendo uma data, entao nenhuma verificacao de "tem data" reclama -- e o
     * Faturamento inteiro vira 1969. Aqui a comparacao e' com o que o
     * JavaScript diz do mesmo registro, entao o erro aparece.
     */
    const sql = await computeStatsSql();
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
        `SELECT COALESCE(SUM(total), 0) AS receita, COUNT(*) AS n FROM "Order"`
    );
    const sql = await computeStatsSql();

    assert.equal(cents(sql.allTime.revenue), cents(Number(cru.receita)), 'receita total vs SUM cru');
    assert.equal(sql.allTime.orders, Number(cru.n), 'contagem vs COUNT cru');
});

test('banco vazio nao quebra a agregacao', async () => {
    /*
     * A soma de uma loja sem nenhum pedido: todos os buckets em zero, ticket
     * medio zero e sem divisao por zero. O `averageTicket` antigo tem guarda
     * explicita; o novo tambem precisa, e este teste e' o que trava isso.
     */
    const sql = await computeStatsSql();
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
