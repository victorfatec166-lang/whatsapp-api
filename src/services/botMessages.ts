import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { DEFAULT_BOT_MESSAGES } from './botDefaults';
import { logDoModulo } from './logger';
import { comoLoja, exigeLoja, lojaAtual } from './loja';
const log = logDoModulo('botMessages');

/**
 * Cache dos textos do bot.
 *
 * Vive em modulo proprio para que servico sem ligacao com a conexao do WhatsApp
 * (o renderizador do cardapio, em dailyMenu.ts) leia os textos sem criar ciclo.
 *
 * UM CACHE POR LOJA, e nao um so. O texto que o cliente recebe e' o da loja que o
 * editou: num cache unico, a loja B responderia ao cliente com a saudacao escrita
 * pela loja A -- e o dono nem teria como ver isso, porque a tela dele esta certa.
 * Por isso a chave do mapa e' a loja, e o `getBotMessage` le a loja do contexto em
 * vez de receber parametro.
 */

const cachePorLoja = new Map<string, Record<string, string>>();

/**
 * Carrega os textos de UMA loja. A loja entra por parametro e nao e' deduzida
 * porque quem chama no boot nao tem contexto -- e sem o parametro o cache ficaria
 * no texto do codigo para todo mundo.
 */
export async function loadBotMessages(tenantId: string): Promise<void> {
    try {
        const messages = await comoLoja(tenantId, () => prisma.botMessage.findMany());
        cachePorLoja.set(tenantId, {
            ...DEFAULT_BOT_MESSAGES,
            ...Object.fromEntries(messages.map((m) => [m.key, m.value])),
        });
    } catch (error) {
        log.error('Erro ao carregar mensagens do bot, usando padroes:', {
            tenantId,
            erro: String(error),
        });
        cachePorLoja.set(tenantId, { ...DEFAULT_BOT_MESSAGES });
    }
}

export function getBotMessage(key: string, fallback?: string): string {
    const loja = lojaAtual();
    const cache = loja ? cachePorLoja.get(loja) : undefined;
    if (!cache) return fallback || DEFAULT_BOT_MESSAGES[key] || '';
    return cache[key] || fallback || DEFAULT_BOT_MESSAGES[key] || '';
}

/**
 * O padrao de uma mensagem, direto do codigo -- e nao do cache, que ja pode ter
 * sido substituido por texto editado. E' o que responde "qual e' o texto padrao?"
 * na tela, que antes mostrava 15 campos em branco.
 */
export function padraoDe(key: string): string {
    return DEFAULT_BOT_MESSAGES[key] ?? '';
}

/**
 * Todas as mensagens com o padrao e a situacao de edicao, para a tela.
 * `editado` compara com o padrao, e nao pergunta se existe linha: linha com o
 * texto padrao nao e' edicao, e edicao que voltou ao padrao nao muda o cliente.
 */
export function mapaParaTela(): Record<string, { texto: string; padrao: string; editado: boolean }> {
    const out: Record<string, { texto: string; padrao: string; editado: boolean }> = {};
    for (const key of Object.keys(DEFAULT_BOT_MESSAGES)) {
        const padrao = padraoDe(key);
        const texto = getBotMessage(key);
        out[key] = { texto, padrao, editado: texto.trim() !== padrao.trim() };
    }
    return out;
}

/**
 * Apaga a edicao, devolvendo o texto ao padrao do codigo.
 * Apaga a linha em vez de gravar o padrao por cima: gravar congelaria o valor de
 * hoje, e nenhuma mudanca no codigo mais chegaria naquele campo.
 */
export async function restaurarMensagem(key: string): Promise<void> {
    await prisma.botMessage.deleteMany({ where: { key } });
    await loadBotMessages(exigeLoja());
}

/** Apaga todas as edicoes. Usado pelo "voltar tudo ao padrao" da tela. */
export async function restaurarTodasMensagens(): Promise<number> {
    const r = await prisma.botMessage.deleteMany({});
    await loadBotMessages(exigeLoja());
    return r.count;
}

/**
 * Guarda um texto editado. Vazio apaga a edicao: campo vazio e' usar padrao.
 * A regra e' explicita, e nao efeito colateral do `||` do `getBotMessage`: senao a
 * edicao fica gravada como string vazia, invisivel para a tela.
 */
export async function salvarMensagem(key: string, texto: string): Promise<void> {
    const limpo = texto.slice(0, 4000);
    if (limpo.trim() === '') {
        await restaurarMensagem(key);
        return;
    }
    /*
     * O `id` do BotMessage E' a loja, entao ele aparece nos dois lados do upsert.
     * Sem isso no `create`, a linha nasceria sem dono e a chave estrangeira
     * recusaria -- e a recusao viria do banco, com a mensagem que o Prisma
     * escreve sobre FK, que nao diz nada sobre loja.
     */
    await prisma.botMessage.upsert({
        where: { id_key: { id: exigeLoja(), key } },
        update: { value: limpo },
        create: { id: exigeLoja(), key, value: limpo },
    });
    await loadBotMessages(exigeLoja());
}