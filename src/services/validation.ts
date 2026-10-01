import { z } from 'zod';
import { ORDER_STATUSES } from './stats';

/**
 * Validacao do que chega da rua: o Zod responde a FORMA, e a REGRA fica com quem
 * ja a tem (priceCart). Preco nunca veio do navegador -- e' lido do banco e
 * recalculado --, e por isso nao ganha schema aqui. A migracao e' por rota.
 */

/**
 * Item do carrinho. `groups` fica como objeto livre porque o conteudo depende de
 * quais grupos o produto tem; o priceCart e' quem sabe o que e' um id valido.
 */
export const itemCarrinho = z.object({
    id: z.string().min(1, 'Item sem id.'),
    qty: z.coerce.number().int().min(1).max(99),
    groups: z.record(z.string(), z.unknown()).optional().default({}),
});

/** Venda do PDV. */
export const vendaPdv = z.object({
    items: z.array(itemCarrinho).min(1, 'Carrinho vazio.').max(100),
    customer: z.string().max(200).optional(),
    paymentMethod: z.string().max(20).optional(),
    discount: z.coerce.number().min(0).max(100_000).optional(),
    tip: z.coerce.number().min(0).max(100_000).optional(),
    notes: z.string().max(500).optional(),
});

/**
 * Mudanca de status de pedido, o que move o card no Kanban.
 * O enum vem de ORDER_STATUSES, que ja era a fonte unica do sistema: reescrever
 * a lista aqui criaria dois lugares onde o status existe.
 */
export const STATUS_PEDIDO = z.enum(ORDER_STATUSES, {
    error: `Status invalido. Valores aceitos: ${ORDER_STATUSES.join(', ')}.`,
});

export const mudancaStatus = z.object({
    status: STATUS_PEDIDO,
});

/**
 * Resultado no formato que a rota ja usa: { error: string } com status 400.
 * Devolver o ZodError cru trocaria bug por bug na resposta da API.
 */
export type Validacao<T> = { ok: true; dados: T } | { ok: false; error: string };

/** Lado do erro, para o TypeScript estreitar sem depender de `strict`. */
export type Falhou = { ok: false; error: string };

/**
 * O projeto roda com `strict: false`: sem `strictNullChecks` o compilador nao
 * estreita uniao por discriminante booleano e `if (!v.ok)` deixa de descartar o
 * ramo do sucesso. O type guard resolve sem depender do modo do compilador.
 */
export function falhou<T>(v: Validacao<T>): v is Falhou {
    return !v.ok;
}

export function validar<S extends z.ZodType>(schema: S, entrada: unknown): Validacao<z.infer<S>> {
    const r = schema.safeParse(entrada ?? {});
    if (r.success) return { ok: true, dados: r.data as z.infer<S> };

    // A primeira mensagem e' a que o usuario precisa ver. Todas viram uma
    // linha so, porque um formulario de venda com seis erros nao ajuda ninguem.
    const msgs = r.error.issues.map((i) => i.message).filter(Boolean);
    return { ok: false, error: msgs.length > 0 ? msgs[0] : 'Dados invalidos.' };
}

/*
 * Por que estes schemas nao existem: turno e produto ja validam nos proprios
 * servicos, com mensagens escritas para quem le. Dinheiro nao pode passar por
 * duas camadas de validacao com textos diferentes.
 */
