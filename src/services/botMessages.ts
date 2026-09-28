import { prisma } from '../database/prisma';
import { DEFAULT_BOT_MESSAGES } from './botDefaults';

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
        console.error('Erro ao carregar mensagens do bot, usando padroes:', error);
        cache = { ...DEFAULT_BOT_MESSAGES };
    }
}

export function getBotMessage(key: string, fallback?: string): string {
    return cache[key] || fallback || DEFAULT_BOT_MESSAGES[key] || '';
}
