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

/**
 * Lojas que esta maquina pode ligar no boot, ou `null` para todas.
 *
 * No PC subir tudo e' o que faz o dono ver o bot dele. Na nuvem e' o contrario: o
 * banco tem as lojas de todos, e todas subiriam com o QR delas no log do dono.
 */
export function lojasAutorizadasNoBoot(): Set<string> | null {
    const lista = (process.env.DELIVERYADMIN_LOJAS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    if (lista.length === 0) return null;
    return new Set([...lista, lojaDoBoot()]);
}

/**
 * Esta maquina pode abrir socket de WhatsApp? Ligado por padrao. A lista nunca diz
 * "nenhuma" -- ela sempre une a loja do boot --, e sem este interruptor o PC de
 * desenvolvimento briga com a nuvem pelo mesmo numero: um dos dois cai (408).
 */
export function botPodeSubir(): boolean {
    return !DESLIGA_BOT.has((process.env.BOT_BOOT ?? '').trim().toLowerCase());
}

/** O que quer dizer "nao". `0` e' o valor documentado; o resto e' por tolerancia. */
const DESLIGA_BOT = new Set(['0', 'off', 'nao', 'false']);

/** Esta loja pode ter o bot ligado nesta maquina? */
export function bootAutorizado(loja: string): boolean {
    if (!botPodeSubir()) return false;
    const permitidas = lojasAutorizadasNoBoot();
    return permitidas === null || permitidas.has(loja);
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
