/**
 * Quem e' o dono da operacao.
 *
 * NUM SaaS, o `tenantId` de uma consulta nao pode ser parametro: sao 197 pontos
 * de consulta hoje, e um esquecimento em um deles nao da erro -- da o resultado
 * errado. A loja A leria o pedido da loja B, e o painel mostraria dados de outro
 * negocio com a cara de "seu", sem mensagem de erro em lugar nenhum. E' o pior
 * defeito que um SaaS pode ter, e e' invisivel no teste.
 *
 * A solucao e' trocar parametro por AMBIENTE: o pedido entra, o middleware
 * guarda a loja numa variavel que atravessa `await`, e o cliente do Prisma
 * injeta o `tenantId` em toda consulta. Nenhuma das 197 chamadas muda. E o que
 * impede o esquecimento e' o `exigeLoja()`: uma consulta feita fora de uma
 * requisicao ESTOURA em vez de passar sem filtro.
 *
 * O contexto usa `AsyncLocalStorage` e nao uma variavel de modulo porque o
 * servidor atende varias requisicoes ao mesmo tempo. Numa variavel simples, duas
 * lojas simultaneas leriam a mesma loja -- e o `AsyncLocalStorage` mantem o valor
 * preso ao fluxo da requisicao, atravessando `await` sem se misturar com o do
 * vizinho. `server.ts` roda em uma thread, mas isso nao e' o que garante o
 * isolamento; o que garante e' o `AsyncLocalStorage`.
 */
import { AsyncLocalStorage } from 'async_hooks';

export type Contexto = { tenantId: string };

/** Regra do `prismaWithTenant` em `prisma-com-loja.ts`. */
export const SEM_LOJA = 'Tenant';

/**
 * A loja do boot, a unica que existe sem ninguem pedir.
 *
 * O login acontece ANTES de existir loja: e' a sessao que carrega a loja, e a
 * sessao ainda nao foi criada. Entao o cadastro de conta precisa saber a que loja
 * se ligar, e a resposta e' esta: a loja do ambiente. Em nuvem, quem cria a conta
 * traz a loja do subdominio -- por enquanto o sistema roda na maquina de um dono.
 *
 * A variavel fica aqui, e nao repetida em dois arquivos, porque duas leituras do
 * mesmo ambiente que divergem criam usuario na loja "local" enquanto o painel
 * abre na loja do `.env` -- e o login passa a recusar sem erro nenhum.
 */
export function lojaDoBoot(): string {
    return process.env.DELIVERYADMIN_TENANT?.trim() || 'local';
}

const armazenamento = new AsyncLocalStorage<Contexto>();

/** A loja da requisicao em andamento, ou `null` fora de uma. */
export function lojaAtual(): string | null {
    return armazenamento.getStore()?.tenantId ?? null;
}

/** A loja, ou erro. Para o codigo que so roda dentro de requisicao. */
export function exigeLoja(): string {
    const id = lojaAtual();
    if (!id) {
        throw new Error(
            'Consulta sem loja. Rodou fora de uma requisicao autenticada -- o `exigeLoja()` do servidor esta faltando, ou este codigo foi chamado de um job do boot (que usa `comoLoja`).'
        );
    }
    return id;
}

/** Roda `fn` como se estivesse na loja `id`. Para boot, jobs e testes. */
export function comoLoja<T>(tenantId: string, fn: () => T): T {
    return armazenamento.run({ tenantId }, fn);
}
