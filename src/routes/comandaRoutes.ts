import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { montarComanda } from '../services/comanda';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('comandaRoutes');

/**
 * Rotas da comanda da cozinha.
 *
 * Ficam em arquivo proprio porque a impressora e' uma saida da casa, com
 *vida propria: um dia ela ganha fila, re-impressao e painel de impressoras.
 * Deixar a rota solta no monólito seria a unica coisa comendo a organizacao
 * que o resto do sistema ganhou.
 *
 * O destino da impressao NAO esta aqui, e' uma decisao consciente:
 *
 * - Nao mandamos direto para a impressora. O caminho real e' um agente local
 *   (ou a porta RAW da impressora), e nenhuma das duas e' responsabilidade de
 *   um servidor web. Mandar direto exigiria descobrir porta e driver em
 *   runtime, o que quebra em qualquer maquina diferente.
 * - Por isso a comanda e' GERADA aqui e entregue a quem sabe imprimir. A tela
 *   da cozinha tem um botao que mostra a comanda e um que entrega a impressora
 *   do SO, e qualquer agente local pode chamar esta rota e imprimir sozinho.
 *
 * O que ja fica resolvido: o formato ESC/POS, que e' o trabalho chato, sai
 * pronto e sem dependencia.
 */

// O router e' montado em /api/admin, entao os caminhos aqui comecam em /.
const router = Router();

/** Nome do negocio, para o cabecalho da comanda. */
async function nomeDoNegocio(): Promise<string> {
    const config = await prisma.config.findUnique({ where: { id: 'default' } });
    return config?.businessName?.trim() || 'Marmitaria';
}

/**
 * Numero curto do pedido, sequencial no dia.
 *
 * Nao serve o UUID do banco: ele tem 36 caracteres e nao cabe na boca de
 * ninguem que esteja gritando "numero 47" para a cozinha. A contagem e' do
 * dia, porque e' assim que o balcao se organiza: misturar o numero 1 de hoje
 * com o numero 1 de ontem gera pedido errado na hora do montagem.
 */
async function numeroDoDia(orderId: string, createdAt: Date): Promise<number> {
    const inicio = new Date(createdAt);
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + 1);

    const quantosNoDia = await prisma.order.count({
        where: {
            createdAt: { gte: inicio, lt: fim },
            // <= o id desta ordem: conta os anteriores, e a propria entra.
            OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lte: orderId } }],
        },
    });
    return quantosNoDia;
}

/** Comanda em texto, para conferir na tela ou mandar no WhatsApp. */
router.get('/comandas/:id', async (req: Request, res: Response) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) return res.status(404).json({ error: 'Pedido nao encontrado.' });

        const comanda = montarComanda({
            order,
            businessName: await nomeDoNegocio(),
            numero: await numeroDoDia(order.id, order.createdAt),
        });

        res.json({ numero: comanda.linhas, texto: comanda.texto });
    } catch (error) {
        log.error('Erro ao montar comanda:', error);
        res.status(500).json({ error: 'Erro ao montar comanda' });
    }
});

/**
 * Comanda em ESC/POS, pronta para a impressora.
 *
 * Enviada como octet-stream porque nao e' texto: tem comando de controle no
 * comeco (reset) e no fim (corte do papel). Se viesse como JSON, o agente
 * local teria que desescapar e remontar os bytes, e qualquer erro de
 * interpretacao viraria papel em branco.
 *
 * A resposta traz tambem o numero do pedido em cabecalho proprio, para o
 * agente poder logar qual papel saiu sem precisar abrir o corpo.
 */
router.get('/comandas/:id/escpos', async (req: Request, res: Response) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) return res.status(404).json({ error: 'Pedido nao encontrado.' });

        const numero = await numeroDoDia(order.id, order.createdAt);
        const comanda = montarComanda({
            order,
            businessName: await nomeDoNegocio(),
            numero,
        });

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-Pedido-Numero', String(numero));
        res.setHeader('Content-Disposition', `attachment; filename="pedido-${numero}.txt"`);
        res.send(Buffer.from(comanda.escpos, 'binary'));
    } catch (error) {
        log.error('Erro ao montar comanda ESC/POS:', error);
        res.status(500).json({ error: 'Erro ao montar comanda' });
    }
});

export default router;
