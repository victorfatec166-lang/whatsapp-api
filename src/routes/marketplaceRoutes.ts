import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../database/prisma';
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
import { logDoModulo } from '../services/logger';

const log = logDoModulo('marketplace');
const router = Router();

function ehCanal(v: string): v is Canal {
    return (CANAIS as readonly string[]).includes(v);
}

/*
 * Rotas de marketplace.
 *
 * Duas coisas deliberadamente separadas aqui:
 *
 * 1. O webhook NAO fica sob /api/admin. Ele e' chamado pela internet pelo
 *    marketplace, nao pelo painel, e nao leva sessao. Se ficasse junto das
 *    rotas do painel, seria tentador proteger com a mesma coisa -- e ai
 *    quebraria: o marketplace nao esta autenticado, ele assina o corpo com o
 *    token. Deixando separado, a confianca fica explicita: um endpoint publico
 *    que so aceita o que tem assinatura valida.
 *
 * 2. O teste de comunicacao grava 'ativo' apenas depois de falar de verdade
 *    com o marketplace. Nao existe caminho que marque a conta como conectada
 *    sem ter feito a chamada.
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
         * A mensagem de erro vai para o cliente porque aqui ela e' de negocio:
         * "CHANNEL_SECRET nao configurado" e "informe a credencial" sao coisas que
         * a pessoa precisa ler para corrigir, e esconder isso deixaria a tela
         * mudando de estado sem explicar por que.
         *
         * O que nao pode e' o inverso -- um erro de banco ou de cifra chegando
         * cru para quem esta na rede. A distincao e' feita pelo tipo: os erros
         * de regra que `guardarCredencial` levanta tem `nomeDoErro`, e so eles
         * passam. Qualquer outra coisa vira 500 com texto generico, e o
         * detalhe fica no log.
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
 * Testa a comunicacao de verdade.
 *
 * Sem credencial, devolve falha explicita e NUNCA marca a conta como ativa.
 * Esse e' o ponto que separa esta tela de uma tela de enfeite: o status so
 * vira 'ativo' depois de uma resposta de verdade do outro lado.
 *
 * O marketplace tem endpoints diferentes conforme a fase do credenciamento, e
 * um pedido de homologacao exige conta de teste. Por isso o teste aqui
 * verifica o que da para verificar sem pedido -- e o que precisa de conta de
 * homologacao fica como passo manual, escrito na tela.
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
         * Aqui mora a chamada real de rede, quando houver o contrato do
         * parceiro. Enquanto isso, o que o sistema pode afirmar de verdade e' o
         * que ele proprio controla: existe credencial e existe token de webhook.
         *
         * A conta NAO e' marcada como ativa aqui, e o motivo esta' escrito:
         * marcar antes de falar com o marketplace seria exatamente a mentira
         * que a tela inteira existe para evitar.
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
        const produto = await prisma.product.findUnique({ where: { id: productId } });
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
 * ---- Webhook: publico, assinado, e separado das rotas do painel ----
 *
 * Fora do /api/admin de proposito. Este endpoint nao usa sessao nenhuma: quem
 * chama e' o marketplace, e a confianca vem da assinatura do corpo. Se ele
 * estivesse junto das rotas do painel, a primeira tentacao seria proteger com a
 * mesma sessao, e isso quebraria a integracao inteira.
 *
 * Recusa por padrao: sem token configurado, nenhuma assinatura passa. Nao ha
 * "modo teste que aceita tudo", porque e' assim que pedido falso entra.
 */
router.post('/webhook/marketplace/:channel', async (req: Request, res: Response) => {
    const { channel } = req.params;
    if (!ehCanal(channel)) return res.status(404).json({ error: 'Canal desconhecido.' });

    // O corpo tem de ser o texto original. O express.json, montado antes, ja
    // consumiu o fluxo -- por isso o raw no server.ts, montado antes de tudo.
    // Re-serializar o JSON muda a ordem das chaves e a assinatura deixa de
    // bater, e um webhook que nunca valida rejeita pedido legitimo.
    const corpo = (req.body as Buffer | undefined)?.toString('utf8') || '';
    const cabecalhos: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) cabecalhos[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;

    try {
        const r = await receberPedido(channel, corpo, cabecalhos);

        if (!r.aceito) {
            log.warn('Webhook recusado em ' + channel, { motivo: r.motivo });
            return res.status(401).json({ error: 'Webhook recusado.' });
        }
        if ('duplicado' in r && r.duplicado) {
            // A plataforma reenvia quando nao recebe o retorno. Confirmar de
            // novo e' a resposta certa: o pedido ja esta no Kanban.
            return res.json({ ok: true, duplicado: true });
        }

        log.info('Pedido recebido de ' + channel, { id: r.id });
        return res.json({ ok: true, id: r.id });
    } catch (error) {
        log.error('Erro ao processar webhook de ' + channel, { erro: String(error) });
        return res.status(500).json({ error: 'Erro ao processar pedido.' });
    }
});

export default router;
