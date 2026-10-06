/*
 * O passo da conversa e o carrinho, no banco. Em memoria e' rapido e morre no
 * deploy -- e e' no meio de um pedido que isso acontece. Isto NAO e' lock: uma
 * so instancia responde pelo numero, e quem garante isso e' o pareamento.
 */
import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { exigeLoja } from './loja';
import { sessoes, type Session } from './botLojas';
import type { LinhaCarrinho } from './carrinho';
import { logDoModulo } from './logger';

const log = logDoModulo('bot-pedido');

/**
 * JSON estragado vale o padrao, e nao excecao: um cliente no meio do pedido e'
 * mais importante do que o carrinho dele, e um `throw` aqui voltaria a pessoa
 * para o menu -- que e' justamente o defeito que este modulo veio consertar.
 */
function le<T>(texto: string | null, padrao: T): T {
    if (!texto) return padrao;
    try {
        const valor = JSON.parse(texto) as T;
        return valor ?? padrao;
    } catch (erro) {
        log.warn(`Estado do bot ilegivel no banco, recomecando: ${String(erro)}`);
        return padrao;
    }
}

/** Traz o estado gravado para a sessao em memoria, sempre na mao do bot. */
export async function carregaPedidoAberto(phone: string): Promise<Session> {
    const existente = sessoes()[phone];
    let linha: Awaited<ReturnType<typeof prisma.pedidoAberto.findUnique>> = null;
    try {
        linha = await prisma.pedidoAberto.findUnique({
            where: { tenantId_phone: { tenantId: exigeLoja(), phone } },
        });
    } catch (erro) {
        log.warn(`Nao consegui ler o pedido em aberto de ${phone}: ${String(erro)}`);
    }

    if (!linha) {
        const zerada: Session = existente ?? { step: 'MENU' };
        sessoes()[phone] = zerada;
        return zerada;
    }

    const sessao: Session = {
        step: linha.step,
        productId: linha.productId ?? undefined,
        groupIndex: linha.groupIndex,
        picked: le<Record<string, string[]>>(linha.picked, {}),
        offered: le<Session['offered']>(linha.offered, undefined),
        carrinho: le<LinhaCarrinho[]>(linha.carrinho, []),
    };
    sessoes()[phone] = sessao;
    return sessao;
}

/**
 * Grava o estado da sessao. Chamado no `finally` do atendimento: uma saida de
 * erro no meio do caminho nao pode deixar o banco com o passo de antes, que e'
 * como o cliente voltaria a receber a pergunta que ja respondeu.
 */
export async function salvaPedidoAberto(phone: string): Promise<void> {
    const sessao = sessoes()[phone];
    if (!sessao) return;

    try {
        await prisma.pedidoAberto.upsert({
            where: { tenantId_phone: { tenantId: exigeLoja(), phone } },
            create: {
                tenantId: exigeLoja(),
                phone,
                step: sessao.step,
                productId: sessao.productId ?? null,
                groupIndex: sessao.groupIndex ?? 0,
                picked: JSON.stringify(sessao.picked ?? {}),
                offered: JSON.stringify(sessao.offered ?? null),
                carrinho: JSON.stringify(sessao.carrinho ?? []),
            },
            update: {
                step: sessao.step,
                productId: sessao.productId ?? null,
                groupIndex: sessao.groupIndex ?? 0,
                picked: JSON.stringify(sessao.picked ?? {}),
                offered: JSON.stringify(sessao.offered ?? null),
                carrinho: JSON.stringify(sessao.carrinho ?? []),
            },
        });
    } catch (erro) {
        // Sem gravar, a conversa segue em memoria: e' o jeito antigo, que funciona
        // dentro do processo e so quebra no proximo deploy.
        log.warn(`Nao consegui gravar o pedido em aberto de ${phone}: ${String(erro)}`);
    }
}