import { Router } from 'express';
import type { Response } from 'express';
import QRCode from 'qrcode';

import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { montarPainel } from '../services/notificacoes';
import { isBotOnline, getConnectionState } from '../services/bot';
import { getClientCount } from '../services/sse';
import { exigeCsrf, exigeSessaoApi } from '../services/auth';
import { logDoModulo } from '../services/logger';
import type { StockRow } from '../services/stock';

/*
 * Estas rotas estavam em `/api/*`, fora do `/api/admin` que o `exigeSessaoApi()`
 * protege, e respondiam 200 sem cookie: vazavam os lembretes e se o WhatsApp do
 * dono estava pareado. O caminho nao muda porque o polling mora no template.
 */

const log = logDoModulo('sistemaRoutes');
const router = Router();

/*
 * Guarda por rota, e nao em `router.use(...)`: montado na raiz, um `use` sem
 * caminho exigiria sessao de TODA rota registrada depois -- inclusive
 * `POST /api/servico/desligar`, que parou de desligar. Ver `calendarioRoutes.ts`.
 */
const sessao = exigeSessaoApi();
const csrf = exigeCsrf();

/**
 * Duplicacao de proposito: a mesma normalizacao existe como closure da aba de
 * Estoque, la no `server.ts`. Extrair o utilitario e' mexer em cinco chamadas de
 * uma vez, e nao cabe junto desta mexida.
 */
function toStockRow(p: {
    id: string;
    name: string;
    price: number;
    costPrice: number;
    category: string | null;
    stock: number;
    minStock: number;
    trackStock: boolean;
    isAvailable: boolean;
}): StockRow {
    return {
        id: p.id,
        name: p.name,
        price: p.price,
        costPrice: p.costPrice,
        category: p.category || 'Geral',
        stock: p.stock,
        minStock: p.minStock,
        trackStock: p.trackStock,
        isAvailable: p.isAvailable,
    };
}

/** O painel do sino: tudo que pede uma acao, em uma lista so. */
router.get('/api/notificacoes', sessao, csrf, async (_req, res: Response) => {
    try {
        const produtos = await prisma.product.findMany();
        res.json(await montarPainel(isBotOnline(), produtos.map(toStockRow)));
    } catch (error) {
        log.error('Falha ao montar painel de notificacoes:', error);
        /*
         * Devolve um painel vazio, e nao 500: o sino que falha ao abrir esconde o
         * resto da tela, e perder o aviso e' melhor que perder o acesso ao painel
         * inteiro.
         */
        res.json({ itens: [], urgentes: 0, total: 0 });
    }
});

/** O WhatsApp esta conectado? E quantas telas estao abertas ao vivo. */
router.get('/api/bot-status', sessao, csrf, (_req, res: Response) => {
    res.json({ online: isBotOnline(), sseClients: getClientCount() });
});

/*
 * O estado do pareamento, com o QR dentro. Viviam no `server.ts` e respondiam 200
 * sem cookie. O QR do WhatsApp nao expira -- vale ate ser lido -- entao quem pegasse
 * o endereco entrava no WhatsApp da loja em outra conta.
 */
router.get('/api/bot/connection', sessao, csrf, (_req, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getConnectionState());
});

/** QR renderizado como SVG no servidor. O texto do QR nunca sai do alem do painel. */
router.get('/api/bot/qr.svg', sessao, csrf, async (_req, res: Response) => {
    try {
        const state = getConnectionState();
        if (!state.qr) {
            res.status(404).type('text/plain').send('sem QR disponivel');
            return;
        }
        const svg = await QRCode.toString(state.qr, {
            type: 'svg',
            margin: 1,
            width: 260,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000ff', light: '#ffffffff' },
        });
        res.setHeader('Cache-Control', 'no-store');
        res.type('image/svg+xml').send(svg);
    } catch (error) {
        log.error('Erro ao gerar QR:', error);
        res.status(500).type('text/plain').send('erro ao gerar QR');
    }
});

export default router;
