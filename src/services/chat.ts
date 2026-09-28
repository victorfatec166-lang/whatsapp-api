import { prisma } from '../database/prisma';
import { logDoModulo } from './logger';
import { notifyChat } from './sse';

const log = logDoModulo('chat');

/**
 * Conversas de WhatsApp.
 *
 * A regra que atravessa o modulo e' uma so: **o bot e o humano nunca respondem
 * o mesmo cliente ao mesmo tempo.** Sem isso, o cliente pergunta "o que voces
 * tem de vegetariano", o bot responde o cardapio inteiro, e em seguida a
 * pessoa digita a resposta -- e o cliente recebe as duas, uma por cima da
 * outra. Por isso `Chat.atendente` decide quem responde, e o bot consulta
 * antes de cada resposta.
 *
 * A conversa e' criada na primeira mensagem do cliente, nunca na leitura da
 * tela. Criar ao abrir a lista inflaria a tela com conversas que nao
 * aconteceram, e a lista mais cheia e' a lista menos confiavel.
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

export type MensagemView = {
    id: string;
    from: string;
    text: string;
    sentAt: Date;
    falhou: boolean;
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

/**
 * Recorta a previa da lista.
 *
 * A mensagem e' uma linha na lista de conversas. Sem o corte, um cliente que
 * mandou um paragrafo empurra as outras conversas para fora da tela, e o que
 * aconteceu naquele chat so aparece abrindo o chat.
 */
function previa(texto: string): string {
    const limpo = texto.replace(/\s+/g, ' ').trim();
    if (limpo.length <= 90) return limpo;
    return limpo.slice(0, 89) + '…';
}

/**
 * Acha a conversa do endereco, criando se ainda nao existir.
 *
 * `upsert` e' o que faz a chamada ser segura para os dois lados: o bot grava a
 * mensagem do cliente sem precisar perguntar antes se a conversa existe, e a
 * tela envia sem precisar criar nada.
 *
 * Aceita tambem o telefone e o nome ja resolvidos, para quem chama tem o dado na
 * mao e gravar e' mais barato do que descobrir depois.
 */
export async function conversaDe(
    phone: string,
    extras?: { nome?: string | null; telefone?: string | null }
): Promise<{ id: string; atendente: string }> {
    const chat = await prisma.chat.upsert({
        where: { phone },
        update: {
            ...(extras?.nome ? { name: extras.nome } : {}),
            ...(extras?.telefone ? { telefone: extras.telefone } : {}),
        },
        create: {
            phone,
            name: extras?.nome ?? null,
            telefone: extras?.telefone ?? null,
        },
        select: { id: true, atendente: true },
    });
    return chat;
}

/** O bot pode responder? Nao enquanto alguem assumiu a conversa. */
export async function botPodeResponder(phone: string): Promise<boolean> {
    const chat = await prisma.chat.findUnique({
        where: { phone },
        select: { atendente: true },
    });
    // Conversa inexistente e' o caso comum: cliente novo, antes da primeira
    // gravacao. Nao ter conversa e' o mesmo que estar com o bot, entao o bot
    // pode responder.
    if (!chat) return true;
    return chat.atendente === 'bot';
}

/**
 * Grava uma mensagem e atualiza a previa da conversa.
 *
 * `naoLidas` sobe quando a mensagem vem do cliente e o atendimento e' do bot.
 * Se um humano esta na conversa, ele esta olhando: contar como nao lida seria
 * mostrar um numero que ninguem precisa ler.
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
     * O `naoLidas` precisa do atendimento atual, e o atendimento mora em outra
     * coluna da mesma linha -- o `update` do Prisma nao le a linha que ele mesmo
     * esta alterando. Entao a conversa e' lida antes, e o `upsert` abaixo usa
     * esse valor. Sao duas consultas em vez de uma, e o motivo de aceitá-las:
     * o erro de perguntar errado seria o cliente esperar resposta com o numero
     * de nao lidas parado, ou o humano ver "3 nao lidas" de uma conversa que
     * ele mesmo esta atendendo.
     */
    const atual = await prisma.chat.findUnique({
        where: { phone: opts.phone },
        select: { id: true, atendente: true },
    });

    // Mensagem do cliente com o bot atendendo conta como nao lida. Mensagem do
    // humano nao conta: e' ele que esta digitando.
    const contaNaoLida = opts.from === 'cliente' && (atual?.atendente ?? 'bot') === 'bot';

    // Telefone e nome sao atualizados so quando chegaram cheios. Uma mensagem
    // seguinte sem o numero nao pode apagar o que a anterior descobriu.
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
 * Guarda a foto do perfil, se ainda nao houver uma valida.
 *
 * A busca vai ao servidor do WhatsApp, entao e' limitada por data: uma foto
 * valida por uma semana, e nao por mensagem. Sem essa trava, um cliente que
 * manda "Ok" de dez em dez minutos geraria uma chamada de rede a cada "Ok", e
 * o dono nao perceberia nada -- o app pareceria lento sem motivo visivel.
 *
 * O que a tela mostra quando a foto nao existe: as iniciais. Um circulo com as
 * iniciais do cliente e' reconhecivel; um espaco vazio nao e'.
 */
const FOTO_VALIDA_POR_MS = 7 * 24 * 60 * 60 * 1000;

export async function guardaFoto(
    chatId: string,
    buscar: () => Promise<string>,
    agora: Date = new Date(),
    forcar = false
): Promise<boolean> {
    const chat = await prisma.chat.findUnique({
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

    // Sem foto e' um resultado legitimo -- o cliente nao tem -- mas gravar
    // "nao tem" com a data de hoje evita refazer a chamada a cada mensagem.
    await prisma.chat.update({
        where: { id: chatId },
        data: { avatarUrl: url || null, avatarAt: agora },
    });
    return true;
}

/**
 * Lista de conversas, mais recente primeiro.
 *
 * A ordem e' por recencia e nao por nome porque quem atende precisa ver
 * primeiro o que chegou por ultimo. Quem chegou de madrugada e' o que espera ha
 * mais tempo.
 */
export async function listarConversas(): Promise<ResumoConversa[]> {
    const conversas = await prisma.chat.findMany({
        orderBy: { lastMessageAt: 'desc' },
        take: 200,
    });
    return conversas.map(toResumo);
}

/**
 * Busca por nome, telefone ou endereco.
 * Os dois formatos sao procurados de proposito. O dono busca o que o cliente
 * digitou, e o cliente manda o telefone, entao o termo bate em `telefone`. Mas o
 * proprio painel exibe o endereco quando o numero nao foi identificado, e quem
 * le a tela pode copiar aquele texto de volta para a busca -- entao `phone`
 * tambem precisa casar.
 */
export async function buscarConversas(termo: string): Promise<ResumoConversa[]> {
    const limpo = termo.trim();
    if (!limpo) return listarConversas();
    const digitos = limpo.replace(/\D/g, '');
    const conversas = await prisma.chat.findMany({
        where: {
            OR: [
                { name: { contains: limpo } },
                // Os numeros estao no MEIO da string, porque `telefone` e' so
                // digitos e `phone` tem o "@..." no fim. `startsWith` nao
                // acharia o telefone de quem colou o numero inteiro.
                ...(digitos ? [{ telefone: { contains: digitos } }, { phone: { contains: digitos } }] : []),
            ],
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 50,
    });
    return conversas.map(toResumo);
}

/** Historico de uma conversa, em ordem cronologica. */
export async function historico(chatId: string, limite = 200): Promise<MensagemView[]> {
    const mensagens = await prisma.message.findMany({
        where: { chatId },
        orderBy: { sentAt: 'asc' },
        take: Math.min(500, Math.max(1, limite)),
    });
    return mensagens.map((m) => ({
        id: m.id,
        from: m.from,
        text: m.text,
        sentAt: m.sentAt,
        falhou: m.falhou,
    }));
}

/** Uma conversa pelo id, para a tela validar antes de escrever. */
export async function obterConversa(chatId: string): Promise<ResumoConversa | null> {
    const c = await prisma.chat.findUnique({ where: { id: chatId } });
    return c ? toResumo(c) : null;
}

/** Zera as nao lidas: a pessoa abriu a conversa e esta lendo. */
export async function marcarLida(chatId: string): Promise<void> {
    await prisma.chat.updateMany({ where: { id: chatId, naoLidas: { gt: 0 } }, data: { naoLidas: 0 } });
    notifyChat(chatId);
}

/**
 * Assume a conversa: o bot cala a partir de agora.
 *
 * E' a unica coisa que impede o atropelo described la em cima. A conversa fica
 * assumida mesmo se o servidor reiniciar, porque o estado esta no banco e nao
 * em memoria -- o `userSession` do bot some a cada restart, e um cliente com
 * o bot calado sem ninguem saber e' o pior desfecho de um reinicio.
 */
export async function assumirConversa(chatId: string): Promise<ResumoConversa | null> {
    const c = await prisma.chat.update({
        where: { id: chatId },
        data: { atendente: 'humano', assumidoAt: new Date() },
    });
    notifyChat(chatId);
    return toResumo(c);
}

/** Devolve ao bot, que volta a responder sozinho. */
export async function devolverAoBot(chatId: string): Promise<ResumoConversa | null> {
    const c = await prisma.chat.update({
        where: { id: chatId },
        data: { atendente: 'bot', assumidoAt: null },
    });
    notifyChat(chatId);
    return toResumo(c);
}

/** Grava uma mensagem enviada pelo painel e avisa o SSE. */
export async function registrarEnvioDoPainel(opts: {
    phone: string;
    text: string;
    falhou: boolean;
}): Promise<void> {
    await registrarMensagem({
        phone: opts.phone,
        from: 'atendente',
        text: opts.text,
        falhou: opts.falhou,
    });
    log.info(`Mensagem do painel para ${opts.phone}${opts.falhou ? ' (FALHOU)' : ''}`);
}

/** Total de nao lidas, para a sidebar sinalizar conversa nova. */
export async function totalNaoLidas(): Promise<number> {
    const r = await prisma.chat.aggregate({ _sum: { naoLidas: true } });
    return r._sum.naoLidas ?? 0;
}

/** Liga um pedido a uma conversa, para a tela mostrar o pedido junto do chat. */
export async function vincularPedido(phone: string, orderId: string): Promise<void> {
    await prisma.chat.updateMany({ where: { phone }, data: { orderId } });
}

/** Nome do cliente, quando ele ja mandou, para rotular a conversa. */
export async function nomeDoCliente(phone: string): Promise<string | null> {
    const c = await prisma.chat.findUnique({ where: { phone }, select: { name: true } });
    return c?.name ?? null;
}
