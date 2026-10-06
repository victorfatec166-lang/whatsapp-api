import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { logDoModulo } from './logger';
import { notifyChat } from './sse';
import { exigeLoja } from './loja';

const log = logDoModulo('chat');

/**
 * Regra do modulo: bot e humano nunca respondem o mesmo cliente ao mesmo tempo, e
 * Chat.atendente decide quem responde. A conversa nasce na primeira mensagem do
 * cliente, nunca na leitura da tela.
 */

export type ResumoConversa = {
    id: string;
    /** Endereco de envio, o jid do Baileys. Serve para mandar mensagem. */
    phone: string;
    /**
     * Numero de verdade, em "5511999999999". Vazio quando o WhatsApp ainda nao
     * entregou a correspondencia -- ver `telefoneDoContato` em bot.ts.
     */
    telefone: string;
    /** Como mostrar na tela: o telefone se existe, o endereco se nao. */
    rotulo: string;
    /** Verdadeiro quando o cliente ainda nao foi identificado. */
    semTelefone: boolean;
    name: string | null;
    avatarUrl: string | null;
    /** 'bot' ou 'humano'. */
    atendente: string;
    assumido: boolean;
    ultimaMensagem: string;
    naoLidas: number;
    lastMessageAt: Date;
    orderId: string | null;
};

function toResumo(c: {
    id: string;
    phone: string;
    telefone: string | null;
    name: string | null;
    avatarUrl: string | null;
    atendente: string;
    ultimaMensagem: string;
    naoLidas: number;
    lastMessageAt: Date;
    orderId: string | null;
}): ResumoConversa {
    const telefone = c.telefone ?? '';
    return {
        id: c.id,
        phone: c.phone,
        telefone,
        // Sem numero identificado, o rotulo cai para o endereco, que pelo menos
        // permite a pessoa saber de qual conversa se trata se precisar.
        rotulo: telefone || c.phone,
        semTelefone: telefone.length === 0,
        name: c.name,
        avatarUrl: c.avatarUrl,
        atendente: c.atendente,
        assumido: c.atendente === 'humano',
        ultimaMensagem: c.ultimaMensagem,
        naoLidas: c.naoLidas,
        lastMessageAt: c.lastMessageAt,
        orderId: c.orderId,
    };
}

/** Uma linha na lista: sem o corte, um paragrafo empurra as outras conversas da tela. */
function previa(texto: string): string {
    const limpo = texto.replace(/\s+/g, ' ').trim();
    if (limpo.length <= 90) return limpo;
    return limpo.slice(0, 89) + '…';
}

/** O bot pode responder? Nao enquanto alguem assumiu a conversa. */
export async function botPodeResponder(phone: string): Promise<boolean> {
    const chat = await prisma.chat.findFirst({
        where: { phone },
        select: { atendente: true },
    });
    // Conversa inexistente e' cliente novo: nao ter conversa e' o mesmo que estar
    // com o bot, entao o bot pode responder.
    if (!chat) return true;
    return chat.atendente === 'bot';
}

/**
 * naoLidas sobe so quando a mensagem vem do cliente e quem atende e' o bot: se
 * um humano esta na conversa ele esta olhando, e o numero seria ruido.
 */
export async function registrarMensagem(opts: {
    phone: string;
    from: 'cliente' | 'atendente';
    text: string;
    sentAt?: Date;
    nome?: string | null;
    telefone?: string | null;
    falhou?: boolean;
    /** Devolve o id da conversa, para quem precisar buscar a foto em seguida. */
}): Promise<string> {
    const quando = opts.sentAt ?? new Date();
    const previa_ = previa(opts.text);

    /*
     * Duas consultas porque o update do Prisma nao le a linha que ele altera: o
     * atendimento mora em outra coluna da mesma linha. Aceita o custo para o
     * nao lidas nao ficar parado, nem mostrar "3 nao lidas" para quem atende.
     */
    const atual = await prisma.chat.findFirst({
        where: { phone: opts.phone },
        select: { id: true, atendente: true },
    });

    // Mensagem do cliente com o bot atendendo conta como nao lida. Mensagem do
    // humano nao conta: e' ele que esta digitando.
    const contaNaoLida = opts.from === 'cliente' && (atual?.atendente ?? 'bot') === 'bot';

    // So quando chegaram cheios: mensagem seguinte sem o numero nao pode apagar
    // o que a anterior descobriu.
    const dados = {
        ultimaMensagem: previa_,
        lastMessageAt: quando,
        naoLidas: contaNaoLida ? { increment: 1 } : undefined,
        ...(opts.nome ? { name: opts.nome } : {}),
        ...(opts.telefone ? { telefone: opts.telefone } : {}),
    };

    const chat = atual
        ? await prisma.chat.update({ where: { id: atual.id }, data: dados })
        : await prisma.chat.create({
              data: {
                  tenantId: exigeLoja(),
                  phone: opts.phone,
                  name: opts.nome ?? null,
                  telefone: opts.telefone ?? null,
                  ultimaMensagem: previa_,
                  lastMessageAt: quando,
                  naoLidas: contaNaoLida ? 1 : 0,
              },
          });

    await prisma.message.create({
        data: {
            tenantId: exigeLoja(),
            chatId: chat.id,
            from: opts.from,
            text: opts.text,
            sentAt: quando,
            falhou: opts.falhou ?? false,
        },
    });

    notifyChat(chat.id);
    return chat.id;
}

/**
 * Validade por DATA, nao por mensagem: a busca vai ao servidor do WhatsApp, e
 * um cliente que manda "Ok" de dez em dez minutos geraria uma chamada de rede a
 * cada "Ok" -- app lento sem motivo visivel.
 */
const FOTO_VALIDA_POR_MS = 7 * 24 * 60 * 60 * 1000;

export async function guardaFoto(
    chatId: string,
    buscar: () => Promise<string>,
    agora: Date = new Date(),
    forcar = false
): Promise<boolean> {
    const chat = await prisma.chat.findFirst({
        where: { id: chatId },
        select: { avatarUrl: true, avatarAt: true },
    });
    if (!chat) return false;

    if (!forcar && chat.avatarUrl && chat.avatarAt && agora.getTime() - chat.avatarAt.getTime() < FOTO_VALIDA_POR_MS) {
        return false;
    }

    let url = '';
    try {
        url = await buscar();
    } catch {
        return false;
    }

    // Sem foto e' resultado legitimo, mas gravar "nao tem" com a data de hoje evita
    // refazer a chamada a cada mensagem.
    await prisma.chat.update({
        where: { id: chatId },
        data: { avatarUrl: url || null, avatarAt: agora },
    });
    return true;
}

/**
 * Fica assumida mesmo apos reiniciar, porque o estado esta no banco e nao em
 * memoria: um cliente com o bot calado sem ninguem saber e' o pior desfecho de
 * um restart.
 */
export async function assumirConversa(chatId: string): Promise<ResumoConversa | null> {
    const c = await prisma.chat.update({
        where: { id: chatId },
        data: { atendente: 'humano', assumidoAt: new Date() },
    });
    notifyChat(chatId);
    return toResumo(c);
}

/**
 * Devolve a conversa ao bot. Sem isto o botao "falar com atendente" e' um beco
 * sem volta: o cliente pedia secours e nunca mais recebia resposta automatica,
 * mesmo escrevendo "menu", que era o que o proprio bot tinha prometido.
 */
export async function devolverAoBot(telefone: string): Promise<void> {
    await prisma.chat.updateMany({ where: { phone: telefone }, data: { atendente: 'bot', assumidoAt: null } });
}

/** Total de nao lidas, para a barra lateral sinalizar conversa nova. */
export async function totalNaoLidas(): Promise<number> {
    const r = await prisma.chat.aggregate({ _sum: { naoLidas: true } });
    return r._sum.naoLidas ?? 0;
}

/** Liga um pedido a uma conversa, para a tela mostrar o pedido junto do chat. */
export async function vincularPedido(phone: string, orderId: string): Promise<void> {
    await prisma.chat.updateMany({ where: { phone }, data: { orderId } });
}
