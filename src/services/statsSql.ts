/*
 * As mesmas metricas de `computeStats`, calculadas pelo banco. NADA E TRUNCADO:
 * truncar a lista faria o Faturamento mostrar menos dinheiro que o real. E
 * `createdAt` e' epoch em MILISSEGUNDOS: o strftime pede createdAt/1000, 'unixepoch'.
 */

import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { exigeLoja } from './loja';
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

/**
 * A loja entra em TODA consulta deste arquivo, e na mao.
 *
 * SQL cru nao passa pelo interceptor do Prisma: a extensao de `prisma-com-loja.ts`
 * so alcança `$allModels`, e `$queryRawUnsafe` nao tem model. As oito consultas
 * daqui eram o unico lugar do sistema que somava dinheiro sem filtro de loja --
 * o Faturamento mostrava a receita de todas as lojas juntas, com a cara de "sua",
 * e sem erro em lugar nenhum. E' o pior defeito que um SaaS pode ter.
 *
 * Por isso a loja e' lida uma vez, na entrada, e nao interpolada em oito
 * templates: `exigeLoja()` estoura quando a chamada veio sem requisicao, e um
 * parametro `?` impede que a string de SQL algum fique sem o filtro.
 */
export async function computeStatsSql(): Promise<DashboardStats> {
    const LOJA = exigeLoja();
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
         * A data vai como OBJETO Date, nunca como texto: `toISOString()` devolve UTC
         * e o limite do dia e' local, e comparar epoch em ms com essa string e'
         * comparar milissegundos com texto -- o sintoma era receita de hoje em R$ 0,00.
         */
        prisma.$queryRawUnsafe<{ periodo: string; receita: unknown; n: unknown }[]>(
            `SELECT periodo, COALESCE(SUM(total), 0) AS receita, COUNT(*) AS n FROM (
                 SELECT total, 'hoje'   AS periodo FROM "Order" WHERE "tenantId" = ? AND "createdAt" >= ?
                 UNION ALL
                 SELECT total, 'semana' AS periodo FROM "Order" WHERE "tenantId" = ? AND "createdAt" >= ?
                 UNION ALL
                 SELECT total, 'mes'    AS periodo FROM "Order" WHERE "tenantId" = ? AND "createdAt" >= ?
                 UNION ALL
                 SELECT total, 'tudo'   AS periodo FROM "Order" WHERE "tenantId" = ?
             ) GROUP BY periodo`,
            LOJA,
            inicioHoje,
            LOJA,
            inicioSemana,
            LOJA,
            inicioMes,
            LOJA
        ),
        prisma.$queryRawUnsafe<{ status: string; n: unknown }[]>(
            `SELECT status, COUNT(*) AS n FROM "Order" WHERE "tenantId" = ? GROUP BY status`,
            LOJA
        ),
        prisma.$queryRawUnsafe<{ canal: string; n: unknown; receita: unknown }[]>(
            `SELECT channel AS canal, COUNT(*) AS n, COALESCE(SUM(total), 0) AS receita
             FROM "Order" WHERE "tenantId" = ? GROUP BY channel`,
            LOJA
        ),
        prisma.$queryRawUnsafe<{ hora: string; n: unknown }[]>(
            `SELECT ${HORA_LOCAL} AS hora, COUNT(*) AS n FROM "Order" WHERE "tenantId" = ? GROUP BY hora`,
            LOJA
        ),
        prisma.$queryRawUnsafe<{ dow: string; n: unknown; receita: unknown }[]>(
            `SELECT ${DOW_LOCAL} AS dow, COUNT(*) AS n, COALESCE(SUM(total), 0) AS receita
             FROM "Order" WHERE "tenantId" = ? GROUP BY dow`,
            LOJA
        ),
        prisma.$queryRawUnsafe<{ dia: string; receita: unknown; n: unknown }[]>(
            `SELECT ${DIA_LOCAL} AS dia, COALESCE(SUM(total), 0) AS receita, COUNT(*) AS n
             FROM "Order" WHERE "tenantId" = ? GROUP BY dia ORDER BY dia DESC LIMIT 14`,
            LOJA
        ),
        prisma.$queryRawUnsafe<{ descontos: unknown; gorjetas: unknown }[]>(
            `SELECT COALESCE(SUM(discount), 0) AS descontos, COALESCE(SUM(tip), 0) AS gorjetas
             FROM "Order" WHERE "tenantId" = ? AND "createdAt" >= ?`,
            LOJA,
            inicioHoje
        ),
        /*
         * As DUAS colunas de que o "mais vendidos" precisa, e nada mais.
         * `json_each` nao serve: `items` e' texto "2x Coxinha [Bacon]", nao JSON, e
         * extrair quantidade e nome em SQL seria uma segunda regra de preco.
         */
        prisma.$queryRawUnsafe<{ items: string; total: unknown }[]>(
            `SELECT items, total FROM "Order" WHERE "tenantId" = ?`,
            LOJA
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
     * O rotulo vem de `Date`, e nao de fatiar a string do SQL, que daria o dia
     * errado na borda. `new Date(dia + 'T12:00:00')` ao meio-dia e' o que segura.
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
