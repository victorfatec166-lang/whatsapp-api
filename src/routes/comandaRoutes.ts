import { Router } from 'express';
import type { Request, Response } from 'express';
import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { montarComanda } from '../services/comanda';
import { logDoModulo } from '../services/logger';
import { exigeLoja } from '../services/loja';
import { resolveTelefone } from '../services/bot';
const log = logDoModulo('comandaRoutes');

/**
 * A impressao NAO sai daqui: o caminho real e' um agente local (ou a porta RAW da
 * impressora), e nenhum dos dois e' responsabilidade de um servidor web -- mandar
 * direto exigiria descobrir porta e driver em runtime, o que quebra em outra maquina.
 */

// O router e' montado em /api/admin, entao os caminhos aqui comecam em /.
const router = Router();

/** Nome do negocio, para o cabecalho da comanda. */
async function nomeDoNegocio(): Promise<string> {
    const config = await prisma.config.findUnique({ where: { id: exigeLoja() } });
    return config?.businessName?.trim() || 'Marmitaria';
}

/**
 * Numero curto do dia, e nao o UUID do banco: 36 caracteres nao cabem na boca de
 * quem grita "numero 47" para a cozinha, e misturar o 1 de hoje com o 1 de ontem
 * monta pedido errado na hora.
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

/**
 * Telefone de verdade para a comanda. O pedido guarda o endereco do WhatsApp, e
 * ele pode ser "192...@lid": indice de privacidade, sem telefone. Primeiro o que a
 * conversa ja gravou, que nao depende do bot estar no ar; so entao o mapa do socket.
 */
async function telefoneDaComanda(clientPhone: string): Promise<string | undefined> {
    if (!clientPhone.endsWith('@lid')) return undefined;
    const conversa = await prisma.chat.findFirst({
        where: { phone: clientPhone },
        select: { telefone: true },
    });
    const guardado = conversa?.telefone?.trim();
    return guardado || (await resolveTelefone(clientPhone)) || undefined;
}

/** Comanda em texto, para conferir na tela ou mandar no WhatsApp. */
router.get('/comandas/:id', async (req: Request, res: Response) => {
    try {
        const order = await prisma.order.findUnique({ where: { tenantId_id: { tenantId: exigeLoja(), id: req.params.id } } });
        if (!order) return res.status(404).json({ error: 'Pedido nao encontrado.' });

        const comanda = montarComanda({
            order,
            businessName: await nomeDoNegocio(),
            numero: await numeroDoDia(order.id, order.createdAt),
            telefone: await telefoneDaComanda(order.clientPhone),
        });

        res.json({ numero: comanda.linhas, texto: comanda.texto });
    } catch (error) {
        log.error('Erro ao montar comanda:', error);
        res.status(500).json({ error: 'Erro ao montar comanda' });
    }
});

/**
 * Vai como `octet-stream` e nao JSON porque tem comando de controle no comeco e
 * no fim: remontar os bytes no agente local e' onde nasce o papel em branco. O
 * numero vai em cabecalho proprio, para logar qual papel saiu sem abrir o corpo.
 */
router.get('/comandas/:id/escpos', async (req: Request, res: Response) => {
    try {
        const order = await prisma.order.findUnique({ where: { tenantId_id: { tenantId: exigeLoja(), id: req.params.id } } });
        if (!order) return res.status(404).json({ error: 'Pedido nao encontrado.' });

        const numero = await numeroDoDia(order.id, order.createdAt);
        const comanda = montarComanda({
            order,
            businessName: await nomeDoNegocio(),
            numero,
            telefone: await telefoneDaComanda(order.clientPhone),
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
