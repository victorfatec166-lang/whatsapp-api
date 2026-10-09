/*
 * As rotas que o PC da loja usa contra a nuvem: a fila de pedidos e a assinatura.
 * Sem sessao: quem vem aqui e' o sistema da loja, identificado pelo segredo no
 * cabecalho -- por isso ficam fora do `/api/admin` e nao passam por CSRF.
 */

import { Router } from 'express';

import { prismaComLoja } from '../database/prisma-com-loja';
import { CABECALHO_CHAVE, CABECALHO_LOJA, lojaDoSegredo } from '../services/relay';
import { licencaDaLoja } from '../services/assinaturas';
import { comoLoja } from '../services/loja';
import { logDoModulo } from '../services/logger';

const log = logDoModulo('relayRoutes');

const router = Router();

/**
 * O segredo sozinho nao basta: sem a loja declarada nao ha qual linha ler, e o
 * proprio nome da loja nao e' segredo -- ele esta' no endereco de tudo.
 */
async function lojaDoRequest(req: { headers: Record<string, unknown> }): Promise<string | null> {
    const loja = String(req.headers[CABECALHO_LOJA] ?? '').trim();
    const chave = String(req.headers[CABECALHO_CHAVE] ?? '');
    if (!loja || !chave) return null;
    const achada = await lojaDoSegredo(chave);
    if (achada !== loja) return null;
    return loja;
}

router.get('/api/loja/pedidos-pendentes', async (req, res) => {
    const loja = await lojaDoRequest(req);
    if (!loja) return res.status(401).json({ error: 'Chave invalida.' });

    try {
        /*
         * Cliente COM loja, dentro de `comoLoja`: e' a extensao que põe o `tenantId`
         * no filtro. Com o cliente cru a lista sairia sem loja nenhuma, e o `where`
         * esquecido viraria a leitura de pedido de outra loja.
         */
        const pedidos = await comoLoja(loja, () =>
            prismaComLoja.pedidoEntrante.findMany({
                where: { entregueEm: null, expiraEm: { gt: new Date() } },
                orderBy: { criadoEm: 'asc' },
                take: 50,
                select: { id: true, channel: true, externalId: true, corpo: true, tentativas: true },
            })
        );
        return res.json({ pedidos });
    } catch (error) {
        log.error('nao deu para ler a fila:', { erro: String(error).slice(0, 160) });
        return res.status(500).json({ error: 'Fila indisponivel.' });
    }
});

router.get('/api/loja/licenca', async (req, res) => {
    const loja = await lojaDoRequest(req);
    if (!loja) return res.status(401).json({ error: 'Chave invalida.' });

    try {
        // Cliente cru de proposito: quem pergunta e' a maquina da loja, e a assinatura
        // e' global -- a loja ja esta no `where`, e nao ha loja ativa para injetar.
        const licenca = await licencaDaLoja(loja);
        if (!licenca) return res.status(404).json({ error: 'Loja nao encontrada.' });
        return res.json(licenca);
    } catch (error) {
        log.error('nao deu para ler a assinatura da loja:', { erro: String(error).slice(0, 160) });
        return res.status(500).json({ error: 'Assinatura indisponivel.' });
    }
});

router.post('/api/loja/pedidos-pendentes/:id/entregue', async (req, res) => {
    const loja = await lojaDoRequest(req);
    if (!loja) return res.status(401).json({ error: 'Chave invalida.' });

    const id = String(req.params.id ?? '').trim();
    const erro = String((req.body ?? {}).erro ?? '').trim();

    try {
        // `count: 0` e' a loja confirmando duas vezes o mesmo pedido, nao um erro.
        const feito = await comoLoja(loja, () =>
            prismaComLoja.pedidoEntrante.updateMany({
                where: { id, entregueEm: null },
                data: { entregueEm: new Date(), tentativas: { increment: 1 }, ultimoErro: erro || null },
            })
        );
        return res.json({ ok: true, jaEntregue: feito.count === 0 });
    } catch (error) {
        log.error('nao deu para confirmar a entrega:', { erro: String(error).slice(0, 160) });
        return res.status(500).json({ error: 'Nao deu para confirmar.' });
    }
});

export default router;