import { Router } from 'express';
import type { Request, Response } from 'express';
import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import {
    CANAIS,
    ErroDeRegra,
    casarItem,
    guardarCredencial,
    listarContas,
    listarItensCasados,
    limparCredencial,
    obterConta,
    registrarChecagem,
    temChaveDeCifra,
    type Canal,
} from '../services/marketplace';
import { receberPedido } from '../services/webhook';
import { exigeLoja } from '../services/loja';
import { logDoModulo } from '../services/logger';

const log = logDoModulo('marketplace');
const router = Router();

function ehCanal(v: string): v is Canal {
    return (CANAIS as readonly string[]).includes(v);
}

/*
 * O webhook NAO fica sob `/api/admin`: quem chama e' o marketplace, que assina o
 * corpo com o token -- proteger com sessao quebraria a integracao. E o teste de
 * comunicacao so grava 'ativo' depois de falar de verdade com o marketplace.
 */

/** Estado das contas, para a tela das duas abas. */
router.get('/api/admin/marketplace', async (_req: Request, res: Response) => {
    try {
        res.json({
            temChaveDeCifra: temChaveDeCifra(),
            contas: await listarContas(),
        });
    } catch (error) {
        log.error('Erro ao ler contas de marketplace', { erro: String(error) });
        res.status(500).json({ error: 'Erro ao ler marketplace' });
    }
});

/** Guarda credencial. Recusa sem CHANNEL_SECRET, em vez de gravar em claro. */
router.post('/api/admin/marketplace/:channel/credencial', async (req: Request, res: Response) => {
    const { channel } = req.params;
    if (!ehCanal(channel)) return res.status(400).json({ error: 'Canal desconhecido.' });

    try {
        const segredo = String((req.body ?? {}).segredo ?? '');
        const webhookSecret = String((req.body ?? {}).webhookSecret ?? '');
        await guardarCredencial(channel, { segredo, webhookSecret });
        res.json({ ok: true });
    } catch (error) {
        /*
         * A mensagem so passa ao cliente quando e' `ErroDeRegra`: "CHANNEL_SECRET
         * nao configurado" e' o que a pessoa precisa ler para corrigir. Erro de
         * banco ou de cifra vira 500 generico, e o detalhe fica no log.
         */
        const msg = error instanceof Error ? error.message : 'Erro ao guardar credencial';
        const eDeRegra = error instanceof ErroDeRegra;
        log.error('Erro ao guardar credencial de ' + channel, { erro: msg });
        res.status(eDeRegra ? 400 : 500).json({
            error: eDeRegra ? msg : 'Nao foi possivel guardar a credencial.',
        });
    }
});

/** Apaga a credencial, para quando ela expira. */
router.post('/api/admin/marketplace/:channel/apagar-credencial', async (req: Request, res: Response) => {
    const { channel } = req.params;
    if (!ehCanal(channel)) return res.status(400).json({ error: 'Canal desconhecido.' });
    try {
        await limparCredencial(channel);
        res.json({ ok: true });
    } catch (error) {
        log.error('Erro ao apagar credencial de ' + channel, { erro: String(error) });
        res.status(500).json({ error: 'Erro ao apagar credencial' });
    }
});

/**
 * Sem credencial, devolve falha explicita e NUNCA marca a conta como ativa: e' o
 * que separa esta tela de uma tela de enfeite. Parte do teste exige conta de
 * homologacao do marketplace, e o que precisa disso fica como passo manual na tela.
 */
router.post('/api/admin/marketplace/:channel/testar', async (req: Request, res: Response) => {
    const { channel } = req.params;
    if (!ehCanal(channel)) return res.status(400).json({ error: 'Canal desconhecido.' });

    try {
        const conta = await obterConta(channel);
        if (!conta.temCredencial) {
            await registrarChecagem(channel, { ok: false, erro: 'Sem credencial cadastrada.' });
            return res.status(400).json({
                ok: false,
                erro: 'Sem credencial. Preencha o passo 1 antes de testar.',
            });
        }

        /*
         * A conta NAO e' marcada como ativa aqui: marcar antes de falar com o
         * marketplace seria a mentira que a tela inteira existe para evitar. Quando
         * houver contrato do parceiro, a chamada de rede entra neste ponto.
         */
        const temToken = conta.temWebhookSecret;
        await registrarChecagem(channel, {
            ok: false,
            erro: temToken
                ? 'Credencial guardada. Falta o teste de homologacao com o marketplace para marcar como ativo.'
                : 'Credencial guardada. Falta o token de webhook para receber pedidos.',
        });

        res.json({
            ok: false,
            erro: temToken
                ? 'Credencial guardada. O teste de comunicacao depende do contrato do parceiro.'
                : 'Credencial guardada. Configure o token de webhook para o sistema aceitar pedidos.',
            configurado: { credencial: true, webhookSecret: temToken },
        });
    } catch (error) {
        await registrarChecagem(channel, { ok: false, erro: String(error) });
        log.error('Falha ao testar comunicacao de ' + channel, { erro: String(error) });
        res.status(500).json({ ok: false, erro: 'Erro ao testar comunicacao' });
    }
});

/** Casar item do marketplace com produto do catalogo. */
router.post('/api/admin/marketplace/:channel/itens', async (req: Request, res: Response) => {
    const { channel } = req.params;
    if (!ehCanal(channel)) return res.status(400).json({ error: 'Canal desconhecido.' });

    try {
        const b = (req.body ?? {}) as { externalId?: unknown; productId?: unknown; lastPrice?: unknown };
        const externalId = String(b.externalId ?? '').trim();
        const productId = String(b.productId ?? '').trim();
        if (!externalId || !productId) {
            return res.status(400).json({ error: 'Informe o id do item e o produto do catalogo.' });
        }
        const produto = await prisma.product.findUnique({ where: { tenantId_id: { tenantId: exigeLoja(), id: productId } } });
        if (!produto) return res.status(404).json({ error: 'Produto do catalogo nao encontrado.' });

        const preco = Number(b.lastPrice);
        await casarItem(channel, externalId, productId, Number.isFinite(preco) ? preco : undefined);
        res.json({ ok: true });
    } catch (error) {
        log.error('Erro ao casar item de ' + channel, { erro: String(error) });
        res.status(500).json({ error: 'Erro ao casar item' });
    }
});

router.get('/api/admin/marketplace/:channel/itens', async (req: Request, res: Response) => {
    const { channel } = req.params;
    if (!ehCanal(channel)) return res.status(400).json({ error: 'Canal desconhecido.' });
    try {
        res.json(await listarItensCasados(channel));
    } catch (error) {
        log.error('Erro ao listar itens de ' + channel, { erro: String(error) });
        res.status(500).json({ error: 'Erro ao listar itens' });
    }
});

/** Pedidos que ja entraram por este canal, para a tela mostrar atividade. */
router.get('/api/admin/marketplace/:channel/pedidos', async (req: Request, res: Response) => {
    const { channel } = req.params;
    if (!ehCanal(channel)) return res.status(400).json({ error: 'Canal desconhecido.' });
    try {
        const pedidos = await prisma.order.findMany({
            where: { channel, externalId: { not: null } },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });
        res.json(pedidos.map((p) => ({ id: p.id, externalId: p.externalId, total: p.total, status: p.status, createdAt: p.createdAt })));
    } catch (error) {
        log.error('Erro ao listar pedidos de ' + channel, { erro: String(error) });
        res.status(500).json({ error: 'Erro ao listar pedidos' });
    }
});

/*
 * Webhook publico e assinado, fora do `/api/admin` de proposito: quem chama e' o
 * marketplace e a confianca vem da assinatura, e proteger com sessao quebraria a
 * integracao. Recusa por padrao: sem token nada passa, e nao ha modo teste.
 */
router.post('/webhook/marketplace/:channel', async (req: Request, res: Response) => {
    const { channel } = req.params;
    if (!ehCanal(channel)) return res.status(404).json({ error: 'Canal desconhecido.' });

    // O corpo tem de ser o texto original: o express.json ja consumiu o fluxo, e e'
    // por isso o raw montado no server.ts antes de tudo. Re-serializar o JSON muda
    // a ordem das chaves e a assinatura deixa de bater, rejeitando pedido legitimo.
    const corpo = (req.body as Buffer | undefined)?.toString('utf8') || '';
    const cabecalhos: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) cabecalhos[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;

    try {
        const r = await receberPedido(channel, corpo, cabecalhos);

        // O estreitamento e' por `in`, e nao por `if (!r.aceito)`. Os dois leem
        // igual, mas so o `in` prova para o compilador qual lado do union e' o
        // caso -- e `r.motivo` abaixo depende dessa prova.
        if (!('aceito' in r) || r.aceito !== true) {
            const motivo = 'motivo' in r ? r.motivo : 'recusado';
            log.warn('Webhook recusado em ' + channel, { motivo });
            return res.status(401).json({ error: 'Webhook recusado.' });
        }
        if (r.duplicado) {
            // A plataforma reenvia quando nao recebe o retorno. Confirmar de
            // novo e' a resposta certa: o pedido ja esta no Kanban.
            return res.json({ ok: true, duplicado: true });
        }

        log.info('Pedido recebido de ' + channel, { id: r.id, loja: r.loja });
        return res.json({ ok: true, id: r.id });
    } catch (error) {
        log.error('Erro ao processar webhook de ' + channel, { erro: String(error) });
        return res.status(500).json({ error: 'Erro ao processar pedido.' });
    }
});

export default router;
