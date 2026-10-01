/**
 * Gerencia o contexto multi-tenant via AsyncLocalStorage.
 * Impede vazamento entre requisicoes e lanca erro se executado sem loja ativa.
 */
import { AsyncLocalStorage } from 'async_hooks';

export type Contexto = { tenantId: string };

/** Regra do `prismaWithTenant` em `prisma-com-loja.ts`. */
export const SEM_LOJA = 'Tenant';

/**
 * A loja do boot, a unica que existe sem ninguem pedir: o login acontece antes de
 * existir sessao, e e' a sessao que carrega a loja. A leitura mora aqui e nao
 * repetida em dois arquivos -- duas leituras divergentes recusam o login sem erro.
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
