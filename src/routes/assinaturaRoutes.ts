import { Router } from 'express';
import type { Request, Response } from 'express';
import {
    assinaturaAlterada,
    pagamentoEstornado,
    pagamentoRecebido,
    pagamentoVencido,
    webhookAutorizado,
} from '../services/assinaturas';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('assinaturaRoutes');

/*
 * Webhook publico e autenticado por token: quem chama e' o Asaas e ele nao tem
 * sessao nossa, e sem token configurado nada passa. Nao ha rota de consulta: a
 * assinatura e' de uma loja entre varias, e o dono de uma loja nao ve a de outra.
 */
const router = Router();

type EventoAsaas = {
    id?: string;
    event?: string;
    payment?: { id?: string; subscription?: string | null; value?: number };
    subscription?: { id?: string; value?: number; status?: string; nextDueDate?: string | null };
};

/**
 * O `id` do evento e' a chave da idempotencia: o Asaas reenvia quando nao recebe
 * o retorno, e um reenvio criaria a segunda conta de administrador da loja.
 */
export async function trataEventoAsaas(corpo: unknown): Promise<string> {
    const evento = (corpo ?? {}) as EventoAsaas;
    const nome = typeof evento.event === 'string' ? evento.event : '';
    const idEvento = typeof evento.id === 'string' ? evento.id : '';

    // Sem id nao da' para ser idempotente, e sem ele o reenvio repete o efeito.
    if (!nome || !idEvento) return 'incompleto';

    const pagamento = evento.payment ?? {};
    const assinatura = evento.subscription ?? {};
    const idDaAssinatura = pagamento.subscription || assinatura.id || '';
    if (!idDaAssinatura) return 'sem-assinatura';

    switch (nome) {
        case 'PAYMENT_CONFIRMED':
        case 'PAYMENT_RECEIVED': {
            const r = await pagamentoRecebido(idEvento, idDaAssinatura, new Date());
            log.info('Mensalidade recebida', { assinatura: idDaAssinatura, resultado: r });
            return r;
        }
        case 'PAYMENT_OVERDUE':
            await pagamentoVencido(idEvento, idDaAssinatura);
            log.warn('Mensalidade vencida', { assinatura: idDaAssinatura });
            return 'vencida';
        case 'PAYMENT_REFUNDED':
            await pagamentoEstornado(idEvento, idDaAssinatura);
            log.warn('Pagamento estornado', { assinatura: idDaAssinatura });
            return 'estornado';
        case 'SUBSCRIPTION_CREATED':
        case 'SUBSCRIPTION_UPDATED':
        case 'SUBSCRIPTION_INACTIVATED':
        case 'SUBSCRIPTION_DELETED': {
            await assinaturaAlterada(idEvento, {
                id: assinatura.id ?? idDaAssinatura,
                valor: assinatura.value,
                status: assinatura.status,
                proximoVencimento: assinatura.nextDueDate,
            });
            return 'assinatura';
        }
        default:
            // Evento que nao mapeamos: 200 para o Asaas parar de reenviar.
            return 'ignorado';
    }
}

router.post('/webhook/asaas', async (req: Request, res: Response) => {
    if (!webhookAutorizado(req.header('asaas-access-token'))) {
        log.warn('Webhook do Asaas recusado', { ip: req.ip });
        return res.status(401).json({ error: 'Webhook recusado.' });
    }

    try {
        const resultado = await trataEventoAsaas(req.body);
        return res.json({ ok: true, resultado });
    } catch (erro) {
        log.error('Erro ao processar webhook do Asaas', { erro: String(erro) });
        return res.status(500).json({ error: 'Erro ao processar evento.' });
    }
});

export default router;