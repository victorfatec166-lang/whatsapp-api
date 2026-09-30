import { Router } from 'express';
import type { Response } from 'express';

import { prisma } from '../database/prisma';
import { montarPainel } from '../services/notificacoes';
import { isBotOnline } from '../services/bot';
import { getClientCount } from '../services/sse';
import { exigeCsrf, exigeSessaoApi } from '../services/auth';
import { logDoModulo } from '../services/logger';
import type { StockRow } from '../services/stock';

/*
 * Rotas de estado do sistema: o sino de avisos e a situacao do WhatsApp.
 *
 * Mesma historia do router do calendario, e pela mesma razao: estavam em
 * `/api/*`, fora do `/api/admin` que o `exigeSessaoApi()` protege, e respondiam
 * 200 sem cookie nenhum.
 *
 * Aqui o vazamento e' menor que no calendario -- nenhuma das duas apaga nada --
 * mas nao e' zero, e "menor" nao e' resposta para "nenhuma":
 *
 *   - `/api/notificacoes` devolve o texto dos lembretes, o nome dos produtos que
 *     estao zerados e o estado de cada canal. E' o estado do negocio de quem
 *     esta operando, entregue a qualquer aparelho da rede.
 *   - `/api/bot-status` diz se o WhatsApp do dono esta pareado. Menos grave, mas
 *     e' a mesma falha de fronteira, e corrigir uma e deixar a outra seria
 *     deixar o buraco pela metade.
 *
 * O caminho e' o mesmo, de proposito: quem chama e' o JavaScript embutido na
 * propria tela (`layout.ts` faz o polling do sino, `whatsapp.ts` o do bot), e
 * mexer em template literal e' mexer no codigo que o `tsc` nao ve. A sessao entra
 * pelo middleware, no `app.use` do `server.ts`.
 */

const log = logDoModulo('sistemaRoutes');
const router = Router();

/*
 * A guarda vai por rota, e nao em `router.use(...)`.
 *
 * Mesmo motivo do router do calendario: montado na raiz, um `router.use()` sem
 * caminho exigiria sessao em TODA rota registrada depois -- inclusive em
 * `POST /api/servico/desligar`, que parou de desligar. Ver a nota longa em
 * `calendarioRoutes.ts`.
 */
const sessao = exigeSessaoApi();
const csrf = exigeCsrf();

/**
 * Normaliza um produto do Prisma para a linha usada pelo painel de avisos.
 *
 * Mesma funcao que a aba de Estoque usa, e a duplicacao e' de proposito: ela
 * mora em `server.ts` como closure do monólito. Extrair o utilitario e' a
 * proxima etapa, e fazer agora seria mexer em cinco chamadas de uma vez.
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

export default router;
