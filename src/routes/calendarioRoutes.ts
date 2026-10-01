import { Router } from 'express';
import type { Request, Response } from 'express';

import { listarDoMes, anotar, alternarConcluido, apagar, falhouAnotar, falhouConcluir, falhouApagar } from '../services/lembretes';
import { exigeCsrf, exigeSessaoApi } from '../services/auth';
import { logDoModulo } from '../services/logger';
import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { ORDER_STATUSES, type OrderWithProductless } from '../services/stats';

/*
 * Vieram de `/api/calendar/*`, fora do `/api/admin`, e respondiam 200 sem cookie:
 * qualquer aparelho da mesma rede lia a agenda e apagava lembrete de quem esta na
 * loja. O caminho publico continua -- quem chama e' o JS de dentro do template.
 */

const log = logDoModulo('calendarioRoutes');
const router = Router();

/*
 * Guarda POR ROTA, e nao em `router.use(...)`: este router entra em todo caminho,
 * e um `use` sem caminho passaria a exigir sessao de toda rota montada depois --
 * inclusive `POST /api/servico/desligar`, que respondia 401 e nao desligava.
 */
const sessao = exigeSessaoApi();
const csrf = exigeCsrf();

/** Lista os lembretes de um mes. O `mes` e' "AAAA-MM"; a meia-noite e' do servico. */
router.get('/api/calendar/lembretes', sessao, csrf, async (req: Request, res: Response) => {
    const mes = typeof req.query.mes === 'string' ? req.query.mes : '';
    if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: 'Informe o mes no formato AAAA-MM.' });
    }
    try {
        res.json(await listarDoMes(mes));
    } catch (error) {
        log.error('Erro ao buscar lembretes:', error);
        res.status(500).json({ error: 'Erro ao buscar lembretes' });
    }
});

/** Anota um lembrete. Sem `dia`, vai para hoje. */
router.post('/api/calendar/lembretes', sessao, csrf, async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const r = await anotar(b.texto, typeof b.dia === 'string' ? b.dia : undefined);
    if (falhouAnotar(r)) return res.status(400).json({ error: r.error });
    res.status(201).json(r.lembrete);
});

/** Marca concluida ou desmarca. Concluir nao apaga: a ideia pode voltar. */
router.post('/api/calendar/lembretes/:id/concluir', sessao, csrf, async (req: Request, res: Response) => {
    const r = await alternarConcluido(req.params.id);
    if (falhouConcluir(r)) return res.status(404).json({ error: r.error });
    res.json({ feito: r.feito });
});

/** Apaga de vez. Quem apaga e' a pessoa na frente da tela, com confirmacao. */
router.post('/api/calendar/lembretes/:id/apagar', sessao, csrf, async (req: Request, res: Response) => {
    const r = await apagar(req.params.id);
    if (falhouApagar(r)) return res.status(404).json({ error: r.error });
    res.json({ ok: true });
});

/*
 * Uma linha por dia, so com o que a grade desenha: contagem e receita. A versao
 * anterior devolvia o pedido inteiro -- nome, telefone, itens de todo mundo -- e
 * usava o Prisma CRU, sem loja: qualquer aparelho da rede lia o faturamento todo.
 */
function diaDe(createdAt: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${createdAt.getFullYear()}-${p(createdAt.getMonth() + 1)}-${p(createdAt.getDate())}`;
}

router.get('/api/calendar/orders', sessao, csrf, async (_req: Request, res: Response) => {
    try {
        const pedidos = await prisma.order.findMany({
            select: { createdAt: true, total: true, status: true },
            orderBy: { createdAt: 'asc' },
        });

        const grouped: Record<string, { date: string; count: number; totalRevenue: number; byStatus: Record<string, number> }> = {};
        for (const p of pedidos) {
            const key = diaDe(p.createdAt);
            if (!grouped[key]) {
                grouped[key] = {
                    date: key,
                    count: 0,
                    totalRevenue: 0,
                    byStatus: Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])),
                };
            }
            grouped[key].count += 1;
            grouped[key].totalRevenue += p.total;
            grouped[key].byStatus[p.status] = (grouped[key].byStatus[p.status] ?? 0) + 1;
        }
        res.json(grouped);
    } catch (error) {
        log.error('Erro ao buscar pedidos para calendario:', error);
        res.status(500).json({ error: 'Erro ao buscar pedidos' });
    }
});

export default router;
