/*
 * As mesmas metricas de `computeStats`, calculadas pelo banco. NADA E TRUNCADO:
 * truncar a lista faria o Faturamento mostrar menos dinheiro que o real. A data e'
 * formatada pelo `to_char`, ja convertida para o fuso da loja.
 */

import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { exigeLoja } from './loja';
import { parseItems } from './items';
import { ORDER_STATUSES, type DashboardStats } from './stats';
import { FUSO, inicioDoDiaNoFuso, inicioDoMesNoFuso } from './fuso';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function addDays(d: Date, days: number): Date {
    // Milissegundos, e nao `setDate`: a janela ja e' um instante de meia-noite no fuso
    // da loja, e trocar o dia no relogio do servidor anda um dia errado em meia fuso.
    return new Date(d.getTime() + days * 86_400_000);
}

/** COUNT e SUM no Postgres voltam como BigInt; o resto do codigo usa number. */
function n(v: unknown): number {
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'number') return v;
    return Number(v ?? 0);
}

function arredonda(v: unknown): number {
    return Math.round(Number(v) * 100) / 100;
}

/*
 * A data no fuso da loja: createdAt e' gravado em UTC. O AT TIME ZONE converte
 * para o fuso do dono antes de agrupar por dia, hora ou dia da semana.
 */
const DIA_LOCAL = `to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE $2, 'YYYY-MM-DD')`;
const HORA_LOCAL = `to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE $2, 'HH24')`;
const DOW_LOCAL = `EXTRACT(DOW FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE $2))::int`;

/**
 * Agregacoes em SQL cru para faturamento. ExigeLoja e' passado explicitamente
 * como parametro bind em cada query para manter isolamento multi-tenant.
 */
export async function computeStatsSql(): Promise<DashboardStats> {
    const LOJA = exigeLoja();
    const agora = new Date();
    const inicioHoje = inicioDoDiaNoFuso(agora);
    const inicioSemana = addDays(inicioHoje, -6);
    const inicioMes = inicioDoMesNoFuso(agora);

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
         * Placeholders `$1`, `$2`... e nao `?`: o `?` e' do SQLite, e no Postgres
         * ele nao vira bind. O `unsafe` fica porque o Prisma nao infere o tipo de
         * uma agregacao, mas a loja e' parametro, nunca texto na string.
         */
        prisma.$queryRawUnsafe<{ periodo: string; receita: unknown; n: unknown }[]>(
            `SELECT periodo, COALESCE(SUM(total), 0) AS receita, COUNT(*) AS n FROM (
                 SELECT total, 'hoje'   AS periodo FROM "Order" WHERE "tenantId" = $1 AND "createdAt" >= $2
                 UNION ALL
                 SELECT total, 'semana' AS periodo FROM "Order" WHERE "tenantId" = $3 AND "createdAt" >= $4
                 UNION ALL
                 SELECT total, 'mes'    AS periodo FROM "Order" WHERE "tenantId" = $5 AND "createdAt" >= $6
                 UNION ALL
                 SELECT total, 'tudo'   AS periodo FROM "Order" WHERE "tenantId" = $7
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
            `SELECT status, COUNT(*) AS n FROM "Order" WHERE "tenantId" = $1 GROUP BY status`,
            LOJA
        ),
        prisma.$queryRawUnsafe<{ canal: string; n: unknown; receita: unknown }[]>(
            `SELECT channel AS canal, COUNT(*) AS n, COALESCE(SUM(total), 0) AS receita
             FROM "Order" WHERE "tenantId" = $1 GROUP BY canal`,
            LOJA
        ),
        prisma.$queryRawUnsafe<{ hora: string; n: unknown }[]>(
            `SELECT ${HORA_LOCAL} AS hora, COUNT(*) AS n FROM "Order" WHERE "tenantId" = $1 GROUP BY hora`,
            LOJA,
            FUSO
        ),
        prisma.$queryRawUnsafe<{ dow: string; n: unknown; receita: unknown }[]>(
            `SELECT ${DOW_LOCAL} AS dow, COUNT(*) AS n, COALESCE(SUM(total), 0) AS receita
             FROM "Order" WHERE "tenantId" = $1 GROUP BY dow`,
            LOJA,
            FUSO
        ),
        prisma.$queryRawUnsafe<{ dia: string; receita: unknown; n: unknown }[]>(
            `SELECT ${DIA_LOCAL} AS dia, COALESCE(SUM(total), 0) AS receita, COUNT(*) AS n
             FROM "Order" WHERE "tenantId" = $1 GROUP BY dia ORDER BY dia DESC LIMIT 14`,
            LOJA,
            FUSO
        ),
        prisma.$queryRawUnsafe<{ descontos: unknown; gorjetas: unknown }[]>(
            `SELECT COALESCE(SUM(discount), 0) AS descontos, COALESCE(SUM(tip), 0) AS gorjetas
             FROM "Order" WHERE "tenantId" = $1 AND "createdAt" >= $2`,
            LOJA,
            inicioHoje
        ),
        /*
         * As DUAS colunas de que o "mais vendidos" precisa, e nada mais. O items
         * e' texto "2x Coxinha [Bacon]", nao JSON, entao extrair quantidade e nome
         * em SQL seria uma segunda regra de preco.
         */
        prisma.$queryRawUnsafe<{ items: string; total: unknown }[]>(
            `SELECT items, total FROM "Order" WHERE "tenantId" = $1`,
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
                label: data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO }),
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
