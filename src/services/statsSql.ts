/*
 * As mesmas metricas de `computeStats`, calculadas pelo banco.
 *
 * POR QUE ISTO EXISTE
 *
 * O painel carregava TODOS os pedidos em memoria em cada visita, e depois
 * somava em JavaScript. Isso cresce sem limite: 300 pedidos por mes, ~250 bytes
 * cada, sao 900 KB por pagina em um ano. A solucao "-- truncar a lista -- e'
 * ERRADA de um jeito especifico: `computeStats` soma a receita de todos os
 * pedidos para o "total" e o "mais vendidos", entao cortar a lista faria o
 * Faturamento mostrar menos dinheiro que o real, sem ninguem perceber. Tela que
 * mostra menos receita e' o tipo de coisa que a propria tela de Configuracoes
 * servia de exemplo do que nao se faz aqui.
 *
 * Entao a divisao e':
 *
 *   - Somas, contagens, agrupamentos: no banco, com GROUP BY e SUM. O banco
 *     devolve 4 linhas para "receita por dia" em vez de 4000 pedidos.
 *   - "Mais vendidos": continua em JavaScript, porque `items` e' TEXTO
 *     ("2x Coxinha [Bacon]") e nao JSON. Nao ha como extrair quantidade e nome
 *     com SQL sem um parser. Este le so as DUAS colunas de que precisa
 *     (items, total) em vez da linha inteira, e roda uma vez por visita em vez
 *     de a cada render.
 *
 * NADA E TRUNCADO. A receita total e a mesma, calculada de outro jeito.
 *
 * O CUIDADO DO `createdAt` -- e ele mudou de ideia durante o desenvolvimento
 *
 * `createdAt` e' INTEGER no SQLite: epoch em MILISSEGUNDOS (verificado com
 * `typeof` na propria tabela, que devolve `integer`, e nao `text`). Entao o
 * `strftime` precisa de `createdAt/1000, 'unixepoch'`, e sem o `localtime` o
 * "pedidos por hora" mostraria 21h de brasilia como 00h do dia seguinte.
 *
 * Cheguei a escrever o contrario -- "e' texto ISO, o `/1000` daria 1969" -- e o
 * proprio banco desmentiu: com o `/1000` removido, a data virou 1999-12-31,
 * porque o SQLite le o numero 1790371396464 como um Julian day e o formata
 * como se fosse um dia do calendario. Duas datas erradas, plausiveis demais
 * para o olho pegar, e nenhuma delas visivel na tela.
 *
 * Por isso o teste de paridade compara os dois calculos campo a campo, e nao
 * so "a query rodou sem erro". Uma data plausivel e' o modo de falha mais
 * caro deste arquivo: agrupar o mes inteiro em 1969 deixa o grafico vazio e o
 * Faturamento do dia em zero, sem nenhuma mensagem de erro.
 */

import { prisma } from '../database/prisma';
import { parseItems } from './items';
import { ORDER_STATUSES, type DashboardStats } from './stats';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function addDays(d: Date, days: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
}

/** SQLite devolve inteiro como BigInt; o resto do codigo trabalha com number. */
function n(v: unknown): number {
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'number') return v;
    return Number(v ?? 0);
}

function arredonda(v: number): number {
    return Math.round(v * 100) / 100;
}

/*
 * A coluna de data, no formato que o SQLite entende e que casa com o fuso do
 * dono. Este trecho e' o unico lugar do arquivo que fala de data em SQL.
 */
const DIA_LOCAL = `strftime('%Y-%m-%d', "createdAt"/1000, 'unixepoch', 'localtime')`;
const HORA_LOCAL = `strftime('%H', "createdAt"/1000, 'unixepoch', 'localtime')`;
const DOW_LOCAL = `strftime('%w', "createdAt"/1000, 'unixepoch', 'localtime')`;

export async function computeStatsSql(): Promise<DashboardStats> {
    const agora = new Date();
    const inicioHoje = startOfDay(agora);
    const inicioSemana = addDays(inicioHoje, -6);
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);

    const [
        totais,
        porStatus,
        porCanal,
        porHora,
        porDow,
        porDia,
        ajustesHoje,
        itens,
    ] = await Promise.all([
        // Uma linha so, com as tres janelas e o total, em vez de uma varredura
        // em JavaScript sobre tudo.
        /*
         * A data vai como OBJETO Date, nunca como texto.
         *
         * Passar `toISOString()` e' o caminho obvio e esta errado, e o erro nao e'
         * de formato: e' de FUSO. `toISOString()` devolve UTC, e o limite do dia
         * e' local. Meia-noite de 28/09 em Brasilia (-03:00) e'
         * "2026-09-28T03:00:00.000Z" -- e comparar o `createdAt` (epoch em ms)
         * com essa string e' comparar milissegundos com texto, o que o SQLite
         * resolve jogando um dos lados para 0. O sintoma era a receita de hoje
         * em R$ 0,00 mesmo com pedido feito hoje. `julianday()` nao resolve
         * porque so o lado do SQL voltaria a ser data -- e o outro segue epoch.
         *
         * Passando o objeto Date, o Prisma o converte com o mesmo cuidado que
         * usa em `findMany`, e a janela bate com a do calculo em memoria.
         */
        prisma.$queryRawUnsafe<{ periodo: string; receita: unknown; n: unknown }[]>(
            `SELECT periodo, COALESCE(SUM(total), 0) AS receita, COUNT(*) AS n FROM (
                 SELECT total, 'hoje'   AS periodo FROM "Order" WHERE "createdAt" >= ?
                 UNION ALL
                 SELECT total, 'semana' AS periodo FROM "Order" WHERE "createdAt" >= ?
                 UNION ALL
                 SELECT total, 'mes'    AS periodo FROM "Order" WHERE "createdAt" >= ?
                 UNION ALL
                 SELECT total, 'tudo'   AS periodo FROM "Order"
             ) GROUP BY periodo`,
            inicioHoje,
            inicioSemana,
            inicioMes
        ),
        prisma.$queryRawUnsafe<{ status: string; n: unknown }[]>(
            `SELECT status, COUNT(*) AS n FROM "Order" GROUP BY status`
        ),
        prisma.$queryRawUnsafe<{ canal: string; n: unknown; receita: unknown }[]>(
            `SELECT channel AS canal, COUNT(*) AS n, COALESCE(SUM(total), 0) AS receita
             FROM "Order" GROUP BY channel`
        ),
        prisma.$queryRawUnsafe<{ hora: string; n: unknown }[]>(
            `SELECT ${HORA_LOCAL} AS hora, COUNT(*) AS n FROM "Order" GROUP BY hora`
        ),
        prisma.$queryRawUnsafe<{ dow: string; n: unknown; receita: unknown }[]>(
            `SELECT ${DOW_LOCAL} AS dow, COUNT(*) AS n, COALESCE(SUM(total), 0) AS receita
             FROM "Order" GROUP BY dow`
        ),
        prisma.$queryRawUnsafe<{ dia: string; receita: unknown; n: unknown }[]>(
            `SELECT ${DIA_LOCAL} AS dia, COALESCE(SUM(total), 0) AS receita, COUNT(*) AS n
             FROM "Order" GROUP BY dia ORDER BY dia DESC LIMIT 14`
        ),
        prisma.$queryRawUnsafe<{ descontos: unknown; gorjetas: unknown }[]>(
            `SELECT COALESCE(SUM(discount), 0) AS descontos, COALESCE(SUM(tip), 0) AS gorjetas
             FROM "Order" WHERE "createdAt" >= ?`,
            inicioHoje
        ),
        /*
         * As DUAS colunas de que o "mais vendidos" precisa, e nada mais.
         *
         * `json_each` foi a primeira tentativa e nao serve: `items` e' texto
         * "2x Coxinha [Bacon]", nao JSON. A quantidade e o nome estao
         * embaralhados com modificadores, e extrair isso em SQL daria um parser
         * em SQL -- uma segunda regra de preco, que e' exatamente o que o
         * `computeStats` em memoria existe para evitar.
         *
         * Ler so `items` e `total` corta o trafego em uma ordem de grandeza
         * (o resto da linha tem telefone, nome, observacao) sem truncar nada.
         */
        prisma.$queryRawUnsafe<{ items: string; total: unknown }[]>(
            `SELECT items, total FROM "Order"`
        ),
    ]);

    // ---- janelas ----
    const janela = new Map(totais.map((t) => [t.periodo, { revenue: n(t.receita), orders: n(t.n) }]));
    const totalGeral = janela.get('tudo') ?? { revenue: 0, orders: 0 };
    const de = (p: string) => janela.get(p) ?? { revenue: 0, orders: 0 };

    // ---- status ----
    const byStatus: Record<string, number> = {};
    for (const s of ORDER_STATUSES) byStatus[s] = 0;
    for (const linha of porStatus) byStatus[linha.status] = n(linha.n);

    // ---- mais vendidos (unico trecho em JS, e' o que os itens sao texto) ----
    const productMap = new Map<string, { qty: number; revenue: number }>();
    for (const linha of itens) {
        const parsed = parseItems(linha.items);
        const totalQty = parsed.reduce((a, p) => a + p.qty, 0) || 1;
        const unitShare = n(linha.total) / totalQty;
        for (const p of parsed) {
            const cur = productMap.get(p.name) ?? { qty: 0, revenue: 0 };
            cur.qty += p.qty;
            cur.revenue += unitShare * p.qty;
            productMap.set(p.name, cur);
        }
    }
    const topProducts = [...productMap.entries()]
        .map(([name, v]) => ({ name, ...v, revenue: arredonda(v.revenue) }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 8);

    // ---- hora: 24 posicoes sempre, mesmo as horas sem pedido ----
    const horaMap = new Map(porHora.map((h) => [h.hora, n(h.n)]));
    const byHour = new Array(24).fill(0).map((_, hora) => ({ hour: hora, orders: horaMap.get(String(hora).padStart(2, '0')) ?? 0 }));
    const busiest = [...byHour].sort((a, b) => b.orders - a.orders)[0];

    // ---- dia da semana: a ordem e' Seg..Dom na tela, o SQL devolve 0..6 ----
    const dowMap = new Map(porDow.map((d) => [n(d.dow), { orders: n(d.n), revenue: n(d.receita) }]));
    const byDayOfWeek = WEEKDAYS.map((label, i) => ({
        label,
        orders: dowMap.get(i)?.orders ?? 0,
        revenue: arredonda(dowMap.get(i)?.revenue ?? 0),
    }));

    /*
     * Receita por dia: os 14 mais recentes, em ordem crescente.
     *
     * O rotulo vem de `Date`, nao de `split('-')` na string do SQL. Fatiar a
     * string daria o dia errado na borda: um `createdAt` as 21:23 UTC e' o dia
     * seguinte as 18:23 em brasilia, e o SQL -- que ja aplicou `localtime` --
     * devolve "2026-09-26" para um pedido que o dono do cardapio lancou em
     * 25/09. Compara-la com o calculo antigo, que usa `toLocaleDateString`,
     * acusava tres dias errados num total de quatro.
     *
     * `new Date(dia + 'T12:00:00')` no meio-dia e' o que segura a borda: meio-dia
     * local nunca vira o dia anterior nem o seguinte, qualquer que seja o fuso.
     */
    const revenueByDay = porDia
        .slice()
        .reverse()
        .map((d) => {
            const data = new Date(`${d.dia}T12:00:00`);
            return {
                date: d.dia,
                label: data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                revenue: arredonda(n(d.receita)),
                orders: n(d.n),
            };
        });

    // ---- canais ----
    const byChannel = porCanal
        .map((c) => ({
            channel: c.canal,
            label: c.canal === 'pdv' ? 'PDV / Balcão' : 'WhatsApp',
            orders: n(c.n),
            revenue: arredonda(n(c.receita)),
        }))
        .sort((a, b) => b.orders - a.orders);

    const ajuste = ajustesHoje[0];

    return {
        today: de('hoje'),
        week: de('semana'),
        month: de('mes'),
        allTime: totalGeral,
        byStatus,
        averageTicket: totalGeral.orders ? totalGeral.revenue / totalGeral.orders : 0,
        topProducts,
        byHour,
        byDayOfWeek,
        revenueByDay,
        busiestHour: busiest && busiest.orders > 0 ? busiest : null,
        todayAdjustments: {
            discounts: arredonda(n(ajuste?.descontos)),
            tips: arredonda(n(ajuste?.gorjetas)),
        },
        byChannel,
    };
}
