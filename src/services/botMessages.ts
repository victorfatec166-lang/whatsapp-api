import { prisma } from '../database/prisma';
import { DEFAULT_BOT_MESSAGES } from './botDefaults';
import { logDoModulo } from './logger';
const log = logDoModulo('botMessages');

/**
 * Cache dos textos do bot.
 *
 * Vive num modulo proprio (e nao em bot.ts) para que services sem ligacao
 * com a conexao do WhatsApp -- como o renderizador do cardapio em
 * dailyMenu.ts -- possam ler os textos sem importar o bot e criar ciclo.
 */

let cache: Record<string, string> = { ...DEFAULT_BOT_MESSAGES };

export async function loadBotMessages(): Promise<void> {
    try {
        const messages = await prisma.botMessage.findMany();
        cache = { ...DEFAULT_BOT_MESSAGES, ...Object.fromEntries(messages.map((m) => [m.key, m.value])) };
    } catch (error) {
        log.error('Erro ao carregar mensagens do bot, usando padroes:', error);
        cache = { ...DEFAULT_BOT_MESSAGES };
    }
}

export function getBotMessage(key: string, fallback?: string): string {
    return cache[key] || fallback || DEFAULT_BOT_MESSAGES[key] || '';
}

/**
 * O padrao de uma mensagem, direto do codigo.
 *
 * Existe para a tela de mensagens poder responder duas perguntas que o formulario
 * nao respondia: "qual e' o texto padrao?" e "este campo esta editado?". Sem
 * isso a tela mostrava 15 campos em branco para mensagens que estavam indo ao
 * cliente cheias de texto -- a pessoa nao conseguia editar uma sem reescrever
 * as outras, e nao tinha como saber o que o bot realmente manda.
 *
 * Le o codigo, nao o cache. O cache ja pode ter sido substituido por um texto
 * editado, e ai nao seria o padrao.
 */
export function padraoDe(key: string): string {
    return DEFAULT_BOT_MESSAGES[key] ?? '';
}

/**
 * Todas as mensagens com o padrao e a situacao de edicao, para a tela.
 *
 * `editado` compara com o padrao em vez de perguntar se existe linha no banco.
 * A diferenca importa: uma linha com exatamente o texto padrao nao e' uma
 * edicao, e mostrar "editado" nela faria a pessoa procurar uma diferenca que nao
 * existe. E o contrario tambem -- uma edicao que devolveu o texto ao padrao
 * deve ser marcada como padrao, porque nao muda o que o cliente recebe.
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
 * Apaga a edicao de uma mensagem, devolvendo o texto ao padrao do codigo.
 *
 * Apaga a linha, e nao grava o texto padrao por cima. A diferenca e' o
 * significado inteiro do botao: gravar o padrao no banco CONGELA o valor de
 * hoje, e uma mudanca no codigo nunca mais chegaria naquele campo. Apagando a
 * linha, o padrao volta a valer de verdade -- e continua valendo depois de uma
 * atualizacao.
 */
export async function restaurarMensagem(key: string): Promise<void> {
    await prisma.botMessage.deleteMany({ where: { key } });
    await loadBotMessages();
}

/** Apaga todas as edicoes. Usado pelo "voltar tudo ao padrao" da tela. */
export async function restaurarTodasMensagens(): Promise<number> {
    const r = await prisma.botMessage.deleteMany({});
    await loadBotMessages();
    return r.count;
}

/**
 * Guarda um texto editado. Vazio apaga a edicao: campo vazio e' usar padrao.
 *
 * A regra "vazio apaga" e' explicita aqui, e nao um efeito colateral do `||` do
 * `getBotMessage`. Depender do `||` significava que a edicao ficava gravada como
 * string vazia no banco, invisivel para a tela -- que comparava texto com
 * padrao e via "padrao", enquanto o registro continuava ali marcando o campo
 * como editado para a proxima consulta.
 */
export async function salvarMensagem(key: string, texto: string): Promise<void> {
    const limpo = texto.slice(0, 4000);
    if (limpo.trim() === '') {
        await restaurarMensagem(key);
        return;
    }
    await prisma.botMessage.upsert({
        where: { key },
        update: { value: limpo },
        create: { key, value: limpo },
    });
    await loadBotMessages();
}
