import { z } from 'zod';
import { ORDER_STATUSES } from './stats';

/**
 * Validacao do que chega da rua.
 *
 * A ideia e' validar a FORMA antes de a rota mexer em qualquer coisa, e deixar
 * a REGRA com quem ja tem a regra. Isso e' a divisao que importa aqui:
 *
 *   - Zod diz: items e' lista? cada item tem id? qty e' numero?
 *   - priceCart diz: esse produto existe, esta disponivel, o grupo de
 *     modificador esta ligado a ele, o preco e' esse.
 *
 * Nao vamos duplicar a regra de preco num schema, e nao vamos usar o schema
 * para "proteger" o preco. O preco nunca veio do navegador: ele e' lido do
 * banco e recalculado. Validar a forma do pedido e' outra conversa.
 *
 * Por que Zod e nao validacao a mao
 *
 * As rotas tinham 19 `typeof` escritos a mao, e cada um e' um ponto onde o
 * proximo campo novo pode ser esquecido. Com schema, o tipo do dado que a rota
 * usa sai da definicao, e o que o TypeScript aceitar e' o que passou.
 *
 * Migracao e gradual
 *
 * So as rotas que temem dinheiro ou estoque entram primeiro. O resto continua
 * como esta, e vai entrar quando for mexido nelas. Trocar tudo de uma vez seria
 * trocar bug velho por bug novo sem ninguem ver.
 */

/**
 * Item do carrinho.
 *
 * `groups` fica como objeto livre porque o conteudo depende de quais grupos o
 * produto tem. O priceCart e' quem sabe o que e' um id de opcao valido; aqui
 * so interessa que seja um objeto e nao, digamos, uma string.
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
 *
 * O enum vem de ORDER_STATUSES, que ja era a fonte unica do sistema. Se eu
 * reescrevesse a lista aqui, teriamos dois lugares onde o status existe, e o
 * primeiro a ser atualizado seria o errado.
 *
 * A mensagem continua listando os valores aceitos, porque e' o que o painel
 * mostra quando o status nao bate -- e foi assim que ja funcionava.
 */
export const STATUS_PEDIDO = z.enum(ORDER_STATUSES, {
    error: `Status invalido. Valores aceitos: ${ORDER_STATUSES.join(', ')}.`,
});

export const mudancaStatus = z.object({
    status: STATUS_PEDIDO,
});

/**
 * Resultado da validacao, no formato que a rota ja usa.
 *
 * Devolver o objeto pronto, e nao o ZodError cru, mantem a resposta da API
 * igual a que o cliente ja espera: { error: string } com status 400. Mudar o
 * formato seria trocar bug por bug.
 */
export type Validacao<T> = { ok: true; dados: T } | { ok: false; error: string };

/** Lado do erro, para o TypeScript estreitar sem depender de `strict`. */
export type Falhou = { ok: false; error: string };

/**
 * O projeto roda com `strict: false`, e sem `strictNullChecks` o TypeScript
 * nao estreita uniao por discriminante booleano: `if (!checado.ok)` deixa de
 * descartar o ramo do sucesso, e o compilador passa a dizer que `.error` nao
 * existe no tipo inteiro.
 *
 * Um type guard resolve sem depender do modo do compilador e sem fingir que o
 * problema nao existe. Ligar `strict` de verdade e' o conserto de raiz, e
 * medido: sao doze erros, todos concentrados no bot, que e' justamente o
 * caminho que nao se pode arriscar em plena operacao. Fica para uma janela de
 * manutencao.
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
 * O QUE NAO ESTA AQUI, E POR QUE
 *
 * Vale registrar, porque a proxima pessoa vai perguntar.
 *
 * Turno e movimento de caixa ja validam dentro dos servicos, em cash.ts, com
 * mensagens escritas para quem vai ler: "Valor contado invalido.", "Valor deve
 * ser maior que zero." Sao checagens de dinheiro, e dinheiro nao deve passar
 * por duas camadas de validacao com textos diferentes: ou os numeros divergem
 * entre as camadas, ou a segunda recusa um valor que a primeira aceitou.
 * Deixar a regra onde ela ja esta e' mais seguro do que duplicar.
 *
 * Cadastro de produto tambem fica como esta. A rota em adminController tem
 * validacao com mensagem especifica ("Preco invalido ou ausente.") e regras
 * que nao sao de forma, e sim de negocio: preco de custo nao pode passar do
 * preco de venda, e o saldo inicial e inteiro e nunca negativo. Trocar isso por
 * schema agora seria trocar codigo testado por codigo novo, sem ganho de
 * seguranca, e mudando o texto que o usuario ve.
 *
 * O bot do WhatsApp nao tem o que validar com schema: o que chega e' texto
 * livre de uma conversa, e quem interpreta e' o fluxo de menus e o priceCart.
 * O que precisa de protecao ali ja tem: preco recalculado no servidor, sessao
 * por telefone, e agora a baixa de estoque no mesmo commit do pedido.
 *
 * Entao o Zod entra onde ele substitui trabalho braçal de verdade: payload
 * aninhado e nao validado, que era o carrinho do PDV. O resto entra quando for
 * mexido, uma rota por vez.
 */
