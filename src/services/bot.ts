import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import { prismaComLoja as prisma } from '../database/prisma-com-loja';
// DEFAULT_BOT_MESSAGES nao vem por aqui: quem precisa dos textos padrao importa
// direto do botDefaults. Aqui ele nunca foi usado, e mascarava a origem.
import { loadBotMessages, getBotMessage } from './botMessages';
import { createOrderWithStock } from './orders';
import { loadProductFull, priceCart, linesToItemsField, type ProductFull } from './modifiers';
import { buildBotMenu, renderBotMenuText } from './dailyMenu';
import { confereAmarracao } from './maquina';
import { comoLoja, lojaDoBoot } from './loja';
import {
    botPodeResponder,
    guardaFoto,
    registrarMensagem,
    vincularPedido,
    assumirConversa,
} from './chat';
import { interpreta, type ItemCatalogo } from './entender';
import {
    juntaItem,
    textoDoCarrinho as textoCarrinho,
    ehComandoFechar,
    ehComandoLimpar,
    ehComandoVerCarrinho,
    type LinhaCarrinho,
} from './carrinho';
import { notifyChat } from './sse';
import { logDoModulo } from './logger';
import { DIR_SESSAO_WHATSAPP } from './paths';
const log = logDoModulo('bot');

let botOnline = false;

export { loadBotMessages, getBotMessage };

export function isBotOnline(): boolean {
  return botOnline;
}
let sock: any = null;

type Session = {
    step: string;
    productId?: string;
    groupIndex?: number;
    picked?: Record<string, string[]>;
    /**
     * Retrato da lista enviada ao cliente, na ordem em que ele a viu: o menu do
     * dia muda enquanto ele escolhe, e sem o retrato o numero digitado apontaria
     * para outro prato depois de uma edicao na hora.
     */
    offered?: Array<{ id: string; name: string; price: number }>;
    /**
     * O que a pessoa ja pediu, juntando -- e' o que faz "2 coxinhas e 1
     * refrigerante" virar um pedido so. Vive na sessao, em memoria: o preco
     * continua sendo recalculado no servidor quando o pedido fecha.
     */
    carrinho?: LinhaCarrinho[];
};

const userSession: { [key: string]: Session } = {};

/**
 * AssumeConversa do chat.ts trabalha por id e o bot so tem o telefone -- ele
 * atende antes de a tela existir. Buscar o id e chamar a funcao de verdade
 * mantem bot e painel no mesmo caminho: os dois leem o mesmo campo.
 */
async function assumirConversaPorTelefone(telefone: string): Promise<{ id: string } | null> {
    const chat = await prisma.chat.findFirst({ where: { phone: telefone }, select: { id: true } });
    if (!chat) return null;
    return assumirConversa(chat.id);
}

/**
 * Caminho do pedido natural, sem numero e sem lista: transforma "quero 3 coxinhas"
 * em item. Cartao que precisa de modificador pergunta em vez de entrar errado, e o
 * que nao foi entendido volta para a pessoa em vez de sumir no balcao.
 */
async function interpretaEAdiciona(jid: string, texto: string): Promise<void> {
    const catalogo = await catalogoParaInterpretar(jid);
    if (catalogo.length === 0) {
        await sock?.sendMessage(jid, { text: '⚠️ O cardápio está vazio no momento.' });
        return;
    }

    const intencao = interpreta(texto, catalogo);

    if (intencao.itens.length === 0) {
        const naoEntendidos = intencao.naoEntendidos.length > 0 ? intencao.naoEntendidos.join(', ') : null;
        await sock?.sendMessage(jid, {
            text:
                (naoEntendidos
                    ? `🤖 Não encontrei ${naoEntendidos} no cardápio.`
                    : '🤖 Não entendi o que você pediu.') +
                '\n\nEscreva o **nome do produto** (com ou sem quantidade) ou mande *1* para ver a lista.'
        });
        return;
    }

    const carrinho = carrinhoDe(jid);
    let precisaEscolher = false;

    for (const item of intencao.itens) {
        const full = await loadProductFull(item.id);
        if (!full) continue;

        /*
         * Pergunta agora, e nao inventa: priceCart recusaria na hora de fechar, e o
         * "faltou escolher" chegaria depois de o cliente escrever o pedido inteiro.
         */
        const faltando = full.modifierGroups.find(
            (g) => g.required && (item.modificadores[g.id] ?? []).length < Math.max(1, g.minSelect)
        );

        if (faltando) {
            userSession[jid].step = 'ESCOLHENDO_MOD';
            userSession[jid].productId = item.id;
            userSession[jid].groupIndex = 0;
            userSession[jid].picked = { ...item.modificadores };
            precisaEscolher = true;
            await sendModifierQuestion(jid, full, 0);
            break;
        }

        juntaItem(carrinho, {
            id: item.id,
            nome: full.name,
            qtd: item.qtd,
            modificadores: item.modificadores,
        });
    }

    if (precisaEscolher) return;

    // Avisa o que entrou com confianca baixa: nome aproximado merece revisao da
    // propria pessoa, e ela e' a unica que sabe se quis dizer aquele prato.
    const aproximados = intencao.itens.filter((i) => i.origem === 'nome-aproximado');
    if (aproximados.length > 0) {
        const lista = aproximados.map((i) => `${i.qtd}x ${i.nome}`).join(', ');
        await sock?.sendMessage(jid, { text: `🤔 Entendi como: ${lista}. Serve? Se não, mande *limpar* e tente de novo.` });
        return;
    }

    const extras = intencao.naoEntendidos;
    await sock?.sendMessage(jid, {
        text: textoCarrinho(carrinho) + (extras.length > 0 ? `\n\n_Não entendi: ${extras.join(', ')}._` : '')
    });
}

/**
 * Montado do MESMO retrato que o cliente recebeu, e nao do banco: se o dono editar o
 * cardapio no meio da conversa, o cliente pediria algo que nem estava na lista mostrada.
 * Os grupos de modificador entram junto, senao "ao ponto" e "bacon" nao tem onde casar.
 */
async function catalogoParaInterpretar(jid: string): Promise<ItemCatalogo[]> {
    const offered = userSession[jid]?.offered;
    const base = offered ?? (await buildBotMenu()).map((p) => ({ id: p.id, name: p.name, price: p.price }));

    const catalogo: ItemCatalogo[] = [];
    for (const p of base) {
        const full = await loadProductFull(p.id);
        catalogo.push({
            id: p.id,
            nome: p.name,
            grupos: (full?.modifierGroups ?? []).map((g) => ({
                id: g.id,
                nome: g.name,
                maxSelect: g.maxSelect,
                opcoes: g.options.map((o) => ({ id: o.id, nome: o.name, prefixo: o.prefix })),
            })),
        });
    }
    return catalogo;
}

/** Envia a pergunta de um grupo de modificadores. */
async function sendModifierQuestion(
    jid: string,
    full: ProductFull,
    index: number
): Promise<void> {
    const group = full.modifierGroups[index];
    if (!group) return;

    let text = `*${full.name}*\n`;
    text += `Escolha ${group.name}${group.required ? ' (obrigatório)' : ''}:\n\n`;
    group.options.forEach((o, i) => {
        const price = o.price > 0 ? ` + R$ ${o.price.toFixed(2)}` : '';
        text += `*[${i + 1}]* ${o.prefix ? `${o.prefix} ` : ''}${o.name}${price}\n`;
    });
    if (group.maxSelect > 1) text += `\n(até ${group.maxSelect} opções)`;
    text += `\n\n👉 Responda com o número${group.required ? '' : ' ou *pular*'}.`;

    if (sock) await sock.sendMessage(jid, { text });
}

/**
 * Funcao e nao campo acessado solto: carrinho.length em carrinho indefinido derruba
 * a conversa no meio do pedido, e o erro e' silencioso.
 * A regra (juntar, agrupar, montar o texto) esta em carrinho.ts, sem WhatsApp e sem banco.
 */
function carrinhoDe(jid: string): LinhaCarrinho[] {
    if (!userSession[jid]) userSession[jid] = { step: 'MENU' };
    if (!userSession[jid].carrinho) userSession[jid].carrinho = [];
    return userSession[jid].carrinho;
}

/**
 * Regra mais antiga: o cliente manda ids e quantidades, nunca preco -- a frase livre
 * descobre QUAL produto, nunca QUANTO custa. O total e' a soma das LINHAS, nao o
 * subtotal devolvido: com modificador de acrescimo, pagar o subtotal seria cobrar menos.
 */
async function fechaCarrinho(jid: string, onOrderCreated?: () => void): Promise<void> {
    const carrinho = carrinhoDe(jid);

    if (carrinho.length === 0) {
        await sock?.sendMessage(jid, { text: '🧾 Nao ha nada no pedido ainda. Manda *1* para ver o cardapio.' });
        return;
    }

    const pedido = carrinho.map((l) => ({ id: l.id, qty: l.qtd, groups: l.modificadores ?? {} }));
    const priced = await priceCart(pedido);

    if (priced.ok === false) {
        // Volta para o pedido em aberto: e' a unica saida honesta quando falta um
        // modificador obrigatorio. Dizer "pedido criado" seria o que a cozinha
        // receberia errado.
        await sock?.sendMessage(jid, { text: `⚠️ ${priced.error}` });
        userSession[jid].step = 'PEDINDO';
        return;
    }

    const total = priced.result.lines.reduce((s, l) => s + l.total, 0);
    const itemsField = linesToItemsField(priced.result.lines);

    /*
     * Mesmo commit: nao pode existir o estado em que o pedido esta gravado e o
     * estoque nao foi mexido -- com o bot e o balcao vendendo o mesmo item ao
     * mesmo tempo, o estoque contaria coisa que nao saiu.
     */
    const { order: newOrder, shortfalls } = await createOrderWithStock(
        {
            clientPhone: jid,
            clientName: 'Cliente WhatsApp',
            items: itemsField,
            subtotal: priced.result.subtotal,
            total,
            status: 'pendente',
        },
        // Em combo, o abate e' nos componentes, nunca no combo.
        priced.result.stockDeductions,
        'whatsapp'
    );

    log.info(`✅ Pedido criado com sucesso ID: ${newOrder.id}`);

    /*
     * Sem saldo ainda recebe o pedido: recusar por contador velho no meio do pico
     * joga a venda fora, e quem sofre e' a cozinha, que ja produziu. O dono ve a
     * lista no log e reponde.
     */
    if (shortfalls.length > 0) {
        log.warn(
            `[estoque] Pedido ${newOrder.id.slice(0, 8)} vendeu sem saldo: ` +
                shortfalls.map((s) => `${s.nome} (pediu ${s.pediu}, tinha ${s.tinha})`).join(', ')
        );
    }

    // Liga o pedido a conversa. Sem isso o atendente que abre o chat nao tem
    // como saber que aquele cliente acabou de pedir, e 'o que ele quer' fica
    // espalhado entre a conversa e o Kanban.
    try {
        await vincularPedido(jid, newOrder.id);
    } catch (error) {
        log.error(`Falha ao vincular pedido ${newOrder.id} a conversa ${jid}:`, error);
    }

    if (onOrderCreated) onOrderCreated();

    // Esvazia o carrinho ANTES de responder. Se a resposta falhar e a pessoa
    // mandar "finalizar" de novo, ela nao receberia dois pedidos iguais.
    userSession[jid].carrinho = [];
    userSession[jid].step = 'MENU';
    userSession[jid].productId = undefined;
    userSession[jid].picked = undefined;
    userSession[jid].groupIndex = 0;
    userSession[jid].offered = undefined;

    /*
     * replaceAll e nao replace: replace com string troca SO A PRIMEIRA ocorrencia,
     * e "Total {total}, e o PIX e' para {total}" mandava o segundo literal para o
     * cliente. E' a razao de a tela oferecer as variaveis como botao.
     */
    const orderReceivedMsg = getBotMessage('orderReceived',
        '🎉 *Pedido Recebido com Sucesso!* \n\n' +
        '📦 *Itens:* {items}\n' +
        '💵 *Total:* R$ {total}\n\n' +
        'O seu pedido já foi registado na cozinha! Digite *2* para consultar os seus pedidos.'
    )
        .replaceAll('{items}', itemsField.replace(/\n/g, ' | '))
        .replaceAll('{total}', total.toFixed(2));

    await sock?.sendMessage(jid, { text: orderReceivedMsg });
}

/* ------------------------------------------------- Estado da conexao (UI) */

export type ConnectionPhase =
    | 'desconectado'
    | 'aguardando-qr'
    | 'escaneado'
    | 'sincronizando'
    | 'conectado'
    | 'deslogado';

export type ConnectionState = {
    phase: ConnectionPhase;
    online: boolean;
    /** QR atual em base64 ou string crua; null quando nao ha QR valido. */
    qr: string | null;
    /** epoch ms de emissao do QR, para a UI detectar expiracao (validade ~30s). */
    qrIssuedAt: number | null;
    phone: string | null;
    name: string | null;
    platform: string | null;
    since: number | null;
    lastError: string | null;
    /**
     * Sessao em disco veio de outra maquina. A tela mostra em cima do QR, porque
     * ligar do mesmo jeito e avisar depois deixaria dois aparelhos com a mesma
     * identidade ativa -- e o WhatsApp pode derrubar um deles.
     */
    sessaoDeOutraMaquina: string | null;
};

const connection: ConnectionState = {
    phase: 'desconectado',
    online: false,
    qr: null,
    qrIssuedAt: null,
    phone: null,
    name: null,
    platform: null,
    since: null,
    lastError: null,
    sessaoDeOutraMaquina: null,
};

/** Guardado por fora do estado para sobreviver ao reconnect, que reseta o estado. */
let sessaoDeOutraMaquina: { motivo: string; podeAparear: boolean } | null = null;

type ConnectionListener = (state: ConnectionState) => void;
const connectionListeners = new Set<ConnectionListener>();

/** QR expira em ~30s; depois disso a UI deve pedir um novo. */
export const QR_TTL_MS = 30_000;

export function onConnectionChange(listener: ConnectionListener): () => void {
    connectionListeners.add(listener);
    listener(getConnectionState());
    return () => connectionListeners.delete(listener);
}

export function getConnectionState(): ConnectionState {
    // Mascara o QR expirado para a UI nunca renderizar um codigo morto.
    const qrValid = connection.qr !== null && connection.qrIssuedAt !== null && Date.now() - connection.qrIssuedAt < QR_TTL_MS;
    return { ...connection, qr: qrValid ? connection.qr : null };
}

function setConnection(patch: Partial<ConnectionState>): void {
    Object.assign(connection, patch);
    // Reemitido em toda mudanca de estado, e nao so no boot: um reconnect reseta a
    // fase para aguardando-qr e o aviso sumiria bem quando a pessoa precisa dele
    // para entender por que tem um QR na frente.
    connection.sessaoDeOutraMaquina = sessaoDeOutraMaquina?.motivo ?? null;
    const snapshot = getConnectionState();
    for (const listener of connectionListeners) {
        try {
            listener(snapshot);
        } catch (error) {
            log.error('Erro em listener de conexao:', error);
        }
    }
}

// Evita pilha de listeners quando o socket reconecta em loop.
function bindSocket(target: any, handler: (payload: any) => void) {
    target.ev.removeAllListeners('connection.update');
    target.ev.on('connection.update', handler);
}

/*
 * Mora aqui e nao em cada arquivo que precisa: confereAmarracao grava a marcacao
 * AO LADO das chaves, entao quem define a pasta precisa ser o mesmo que confere.
 * Duas constantes iguais em arquivos diferentes divergem sem ninguem notar.
 */
export const AUTH_DIR = process.env.BAILEYS_AUTH_DIR?.trim() || DIR_SESSAO_WHATSAPP;

// Adicionamos um parâmetro 'onOrderCreated' para receber a função de aviso do servidor
export async function startWhatsAppBot(onOrderCreated?: () => void) {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    /*
     * Antes de abrir o socket: conectar primeiro deixaria dois aparelhos com a mesma
     * identidade ativa por instantes, e e' a janela em que o WhatsApp derruba um deles.
     * Nao trava o app: sessao de outra maquina pode ser HD trocado, e quem resolve e' o QR.
     */
    const sessao = confereAmarracao(AUTH_DIR);
    sessaoDeOutraMaquina = sessao;
    if (sessao) {
        log.warn('Sessao de outra maquina detectada. Ignorando a sessao e pedindo um QR novo.');
    }

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }) as any,
        browser: Browsers.macOS('Chrome'),
    });

    sock.ev.on('creds.update', saveCreds);

    bindSocket(sock, async (update) => {
        const { connection: conn, lastDisconnect, qr } = update;

        if (qr) {
            setConnection({ phase: 'aguardando-qr', qr, qrIssuedAt: Date.now(), lastError: null });
            log.info('\n[QR] Codigo de pareamento gerado. Abra o painel em /admin?tab=whatsapp');
            qrcode.generate(qr, { small: true });
        }

        if (conn === 'close') {
            botOnline = false;
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const loggedOut = statusCode === DisconnectReason.loggedOut;

            if (loggedOut) {
                setConnection({
                    phase: 'deslogado',
                    online: false,
                    qr: null,
                    qrIssuedAt: null,
                    since: null,
                    lastError: 'Sessao encerrada no celular. Paree um numero novamente.',
                });
                log.info('Sessao encerrada (logout). Pareamento necessario.');
                return;
            }

            setConnection({
                phase: 'desconectado',
                online: false,
                qr: null,
                qrIssuedAt: null,
                since: null,
                lastError: lastDisconnect?.error ? String((lastDisconnect.error as Boom).message ?? 'Conexao perdida') : null,
            });
            log.info(`Conexao fechada. Reconectando em 3s (${statusCode ?? 'sem codigo'})`);

            setTimeout(async () => {
                try {
                    await startWhatsAppBot(onOrderCreated);
                } catch (e) {
                    log.error('Erro ao reconectar bot:', e);
                    setConnection({ phase: 'desconectado', online: false, lastError: 'Falha ao reconectar' });
                }
            }, 3000);
        } else if (conn === 'connecting') {
            setConnection({ phase: 'sincronizando', lastError: null });
        } else if (conn === 'open') {
            botOnline = true;
            const me = sock?.user?.id || null;
            setConnection({
                phase: 'conectado',
                online: true,
                qr: null,
                qrIssuedAt: null,
                phone: me ? String(me).split(':')[0] ?? null : null,
                name: sock?.user?.name ?? null,
                platform: sock?.user?.platform ?? null,
                since: Date.now(),
                lastError: null,
            });
            log.info('Bot do WhatsApp conectado com sucesso!');
        }
    });

    // Baileys sinaliza QR escaneado emantes da conexao abrir.
    sock.ev.on('creds.update', () => {
        if (connection.phase === 'aguardando-qr') {
            setConnection({ phase: 'escaneado' });
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        /*
         * Mensagens do WhatsApp rodam fora de requisicao HTTP;
         * `comoLoja` injeta o tenant do ambiente para persistir no banco.
         */
        await comoLoja(lojaDoBoot(), async () => {
            for (const msg of messages) {
                if (!msg.message || msg.key.fromMe) continue;

                const senderPhone = msg.key.remoteJid || '';
                const messageText =
                    msg.message.conversation ||
                    msg.message.extendedTextMessage?.text;

                if (!messageText) continue;

                const textLower = messageText.toLowerCase().trim();

                /*
                 * Quem escreveu, e nao o que: o texto ja esta gravado em Message. Em log
                 * plano virava segunda copia com outra retencao -- a mensagem some na
                 * virada do dia, a linha de log fica para sempre.
                 */
                log.info(`📩 Mensagem de ${senderPhone}`);

                /*
                 * Grava ANTES de qualquer decisao do bot: respondendo antes, uma falha de
                 * escrita deixaria a resposta enviada sem rastro. senderPhone e' o ENDERECO
                 * e pode ser um 192...@lid, que nao contem telefone: enviar por ele funciona.
                 */
                let telefone = '';
                let nome = '';
                let chatId = '';
                try {
                    // `telefoneDoContato` espera o socket, e `nomeDoContato` le a
                    // store de contatos: um depende de rede e o outro nao. Rodam
                    // juntos porque em mensagem de verdade o socket ja esta pronto.
                    const [achado, quem] = await Promise.all([
                        telefoneDoContato(msg),
                        Promise.resolve(nomeDoContato(msg)),
                    ]);
                    telefone = achado;
                    nome = quem;
                    chatId = await registrarMensagem({
                        phone: senderPhone,
                        from: 'cliente',
                        text: messageText,
                        // O instante do WhatsApp, e nao o do servidor: se a fila
                        // atrasar, o historico mostra a ordem em que aconteceu, e
                        // nao a ordem em que o app gravou.
                        sentAt: msg.messageTimestamp
                            ? new Date(Number(msg.messageTimestamp) * 1000)
                            : undefined,
                        nome,
                        telefone,
                    });
                } catch (error) {
                    // Falha em gravar o historico nao pode derrubar o atendimento:
                    // o cliente esperando resposta e' pior do que um chat sem
                    // registro. O log deixa o problema visivel.
                    log.error(`Falha ao gravar mensagem de ${senderPhone} no historico:`, error);
                }

                /*
                 * Foto depois de gravar, e nao antes: se a busca falhar, a conversa ja
                 * esta salva e o cliente continua sendo atendido. guardaFoto respeita
                 * a data, entao aqui nao vira chamada de rede por mensagem.
                 */
                if (chatId && podeBuscarFoto()) {
                    try {
                        const mudou = await guardaFoto(chatId, () => fotoDoContato(senderPhone));
                        if (mudou) notifyChat(chatId);
                    } catch (error) {
                        log.debug(`Foto de ${senderPhone} nao atualizada: ${String(error)}`);
                    }
                }

                if (!userSession[senderPhone]) {
                    userSession[senderPhone] = { step: 'MENU' };
                }

                const currentStep = userSession[senderPhone].step;

                /*
                 * Sem este corte, quem pediu para falar com uma pessoa receberia o
                 * cardapio do bot e a resposta dela, uma por cima da outra.
                 */
                if (!(await botPodeResponder(senderPhone))) {
                    log.info(`Conversa com ${senderPhone} esta com humano; bot em silencio.`);
                    continue;
                }

                try {
                    if (['menu', 'oi', 'ola', 'olá', '0', 'inicio', 'início'].includes(textLower)) {
                        userSession[senderPhone].step = 'MENU';
                        userSession[senderPhone].offered = undefined;

                        const mainMenu = getBotMessage('mainMenu',
                            '🍔 *BEM-VINDO* 🍕\n' +
                            '━━━━━━━━━━━━━━━━━━━━━\n' +
                            'Escolha uma opção:\n\n' +
                            '1️⃣ *Ver Cardápio e Pedir*\n' +
                            '2️⃣ *Consultar Meus Pedidos*\n' +
                            '3️⃣ *Falar com Atendente*\n\n' +
                            '👉 *Responda com o número* da opção desejada:');

                        await sock.sendMessage(senderPhone, { text: mainMenu });
                        continue;
                    }

                    /*
                     * Comandos valem em qualquer etapa: a pessoa nao sabe em que passo o
                     * bot esta, e nao tem por que saber. Se "3 coxinhas" exigisse o passo
                     * intermediario, ela ficaria presa num estado que nao consegue ver.
                     */
                    if (ehComandoFechar(textLower)) {
                        await fechaCarrinho(senderPhone, onOrderCreated);
                        continue;
                    }

                    if (ehComandoLimpar(textLower)) {
                        carrinhoDe(senderPhone).length = 0;
                        userSession[senderPhone].step = 'MENU';
                        userSession[senderPhone].offered = undefined;
                        userSession[senderPhone].productId = undefined;
                        userSession[senderPhone].picked = undefined;
                        userSession[senderPhone].groupIndex = 0;
                        await sock.sendMessage(senderPhone, {
                            text: '🧾 Pedido apagado. Comece de novo quando quiser.'
                        });
                        continue;
                    }

                    if (ehComandoVerCarrinho(textLower)) {
                        await sock.sendMessage(senderPhone, { text: textoCarrinho(carrinhoDe(senderPhone)) });
                        continue;
                    }

                    if (currentStep === 'MENU') {
                        if (textLower === '1') {
                            const products = await buildBotMenu();

                            if (products.length === 0) {
                                await sock.sendMessage(senderPhone, {
                                    text: getBotMessage('menuEmpty', '⚠️ O cardápio está vazio no momento. Cadastre produtos no painel web!')
                                });
                                continue;
                            }

                            userSession[senderPhone].step = 'PEDINDO';
                            // Guarda o retrato da lista: e contra ela que o numero
                            // digitado vai ser lido, mesmo que o dono edite o menu
                            // antes da resposta.
                            userSession[senderPhone].offered = products.map((p) => ({
                                id: p.id,
                                name: p.name,
                                price: p.price,
                            }));

                            await sock.sendMessage(senderPhone, { text: renderBotMenuText(products) });
                        }
                        else if (textLower === '2') {
                            const orders = await prisma.order.findMany({
                                where: { clientPhone: senderPhone },
                                orderBy: { createdAt: 'desc' }
                            });

                            if (orders.length === 0) {
                                await sock.sendMessage(senderPhone, { text: getBotMessage('noOrders', '📦 Não encontrámos pedidos recentes. Digite *1* para ver o cardápio ou *menu*.') });
                            } else {
                                let text = '📦 *OS SEUS PEDIDOS RECENTES:*\n\n';
                                orders.forEach(o => {
                                    text += `- *${o.items}* (R$ ${o.total.toFixed(2)}) ➡️ Status: *${o.status.toUpperCase()}*\n`;
                                });
                                text += '\nDigite *menu* para voltar ao início.';
                                await sock.sendMessage(senderPhone, { text });
                            }
                        } 
                        else if (textLower === '3') {
                            /*
                             * assumirConversa silencia o bot de verdade: botPodeResponder le
                             * o mesmo campo, e notifyChat traz a conversa para a lista de quem
                             * atende. Antes o botao prometia atendente e nao chamava ninguem.
                             */
                            const conversa = await assumirConversaPorTelefone(senderPhone);
                            if (conversa) {
                                await sock.sendMessage(senderPhone, {
                                    text: getBotMessage('attendantMessage',
                                        '👨‍💻 Chamei um atendente para si. Ele vai responder aqui mesmo a partir de agora — o automático fica em silêncio nesta conversa.')
                                });
                            } else {
                                await sock.sendMessage(senderPhone, {
                                    text: '⚠️ Não consegui abrir seu atendimento agora. Tente *3* de novo em um instante.'
                                });
                            }
                        }
                        else {
    /*
                             * Nem número, nem comando: tenta entender a frase. Antes
                              * isso recebia "Opcao invalida" -- a diferenca entre aceitar
                              * os doze comandos conhecidos e a forma como a pessoa fala.
                              */
                            await interpretaEAdiciona(senderPhone, textLower);
                        }
                    }
                    else if (currentStep === 'PEDINDO') {
                        if (!isNaN(Number(textLower)) && textLower !== '') {
                            // Resolve pelo retrato da lista que o cliente recebeu,
                            // nunca pelo menu atual: assim uma edicao no meio da
                            // escolha nao troca o prato debaixo do numero.
                            const session = userSession[senderPhone];
                            const offered = session.offered;
                            const index = Number(textLower) - 1;

                            if (!offered || !offered[index]) {
                                // Retrato perdido (reinicio do servidor): manda o
                                // cardapio de novo em vez de adivinhar o prato.
                                const fresh = await buildBotMenu();
                                if (fresh.length === 0) {
                                    await sock.sendMessage(senderPhone, {
                                        text: getBotMessage('menuEmpty', '⚠️ O cardápio está vazio no momento. Cadastre produtos no painel web!'),
                                    });
                                    session.step = 'MENU';
                                    continue;
                                }
                                session.offered = fresh.map((p) => ({ id: p.id, name: p.name, price: p.price }));
                                await sock.sendMessage(senderPhone, { text: renderBotMenuText(fresh) });
                                await sock.sendMessage(senderPhone, {
                                    text: 'ℹ️ O cardápio mudou. Escolha novamente pelo número — ou escreva o nome do produto.',
                                });
                                continue;
                            }

                            const selected = offered[index];
                            // O produto pode ter sido pausado depois de o cliente
                            // ver o menu; nesse caso o id resolve e o preco e
                            // recalculado no servidor.
                            const full = await loadProductFull(selected.id);

                            if (full) {
                                // Produto com modificadores abre um fluxo de escolha.
                                if (full.modifierGroups.length > 0) {
                                    userSession[senderPhone].step = 'ESCOLHENDO_MOD';
                                    userSession[senderPhone].productId = selected.id;
                                    userSession[senderPhone].groupIndex = 0;
                                    userSession[senderPhone].picked = {};
                                    await sendModifierQuestion(senderPhone, full, 0);
                                } else {
                                    /*
                                     * Entra no carrinho e NAO vira pedido: escolher o item ja
                                     * criava o pedido, e nao havia como pedir duas coisas nem
                                     * corrigir a primeira sem pedir tudo de novo.
                                     */
                                    juntaItem(carrinhoDe(senderPhone), {
                                        id: selected.id,
                                        nome: selected.name,
                                        qtd: 1,
                                        modificadores: {},
                                    });
                                    await sock.sendMessage(senderPhone, { text: textoCarrinho(carrinhoDe(senderPhone)) });
                                }
                            } else {
                                await sock.sendMessage(senderPhone, {
                                    text: '⚠️ Esse item saiu do cardápio. Peça *1* para ver a lista atualizada.',
                                });
                                userSession[senderPhone].step = 'MENU';
                            }
                        } else {
                            // Nao e' numero: e' frase. E o caminho que a pessoa
                            // realmente usa -- "quero 3 coxinhas", "coxinha e
                            // refrigerante", "xburguer ao ponto com bacon".
                            await interpretaEAdiciona(senderPhone, textLower);
                        }
                    }
                    else if (currentStep === 'ESCOLHANDO_MOD') {
                        const session = userSession[senderPhone];
                        const full = await loadProductFull(session.productId);
                        if (!full) {
                            session.step = 'MENU';
                            await sock.sendMessage(senderPhone, { text: '⚠️ Produto indisponível. Digite *menu*.' });
                            continue;
                        }

                        const group = full.modifierGroups[session.groupIndex];
                        if (textLower === 'pular' || textLower === 'nenhum') {
                            session.groupIndex += 1;
                        } else if (group) {
                            const choice = Number(textLower) - 1;
                            if (isNaN(choice) || choice < 0 || choice >= group.options.length) {
                                await sock.sendMessage(senderPhone, { text: '❌ Opção inválida. Responda com o número ou *pular*.' });
                                continue;
                            }
                            const current: string[] = session.picked[group.id] ?? [];
                            if (group.maxSelect <= 1) {
                                session.picked[group.id] = [group.options[choice].id];
                                session.groupIndex += 1;
                            } else {
                                if (current.includes(group.options[choice].id)) {
                                    session.picked[group.id] = current.filter((v) => v !== group.options[choice].id);
                                } else {
                                    if (current.length >= group.maxSelect) {
                                        await sock.sendMessage(senderPhone, { text: `❌ Máximo de ${group.maxSelect} opções em ${group.name}.` });
                                        continue;
                                    }
                                    session.picked[group.id] = [...current, group.options[choice].id];
                                }
                                await sock.sendMessage(senderPhone, { text: `✅ *${group.name}*: ${current.length + 1}/${group.maxSelect} escolhida(s). Digite *pular* para seguir.` });
                                continue;
                            }
                        }

                        if (session.groupIndex < full.modifierGroups.length) {
                            await sendModifierQuestion(senderPhone, full, session.groupIndex);
                            continue;
                        }

                        // Todos os grupos respondidos: valida obrigatorios e fecha o pedido.
                        const missing = full.modifierGroups.find(
                            (g) => g.required && (session.picked[g.id] ?? []).length < Math.max(1, g.minSelect)
                        );
                        if (missing) {
                            await sock.sendMessage(senderPhone, { text: `❌ Obrigatório escolher em *${missing.name}*. Digite *menu* para recomeçar.` });
                            userSession[senderPhone].step = 'MENU';
                            continue;
                        }

                        const product = await prisma.product.findUnique({ where: { id: session.productId } });
                        if (product) {
                            /*
                             * Entra no carrinho e a pessoa continua escolhendo: antes
                             * criava o pedido e voltava ao menu, e nao dava para pedir
                             * o refrigerante depois do X-Burguer.
                             */
                            juntaItem(carrinhoDe(senderPhone), {
                                id: product.id,
                                nome: product.name,
                                qtd: 1,
                                modificadores: session.picked ?? {},
                            });
                            userSession[senderPhone].step = 'PEDINDO';
                            userSession[senderPhone].productId = undefined;
                            userSession[senderPhone].picked = undefined;
                            userSession[senderPhone].groupIndex = 0;
                            await sock.sendMessage(senderPhone, { text: textoCarrinho(carrinhoDe(senderPhone)) });
                        }
                    }
                } catch (err) {
                    log.error('❌ Erro crítico ao processar mensagem do bot:', err);
                    userSession[senderPhone].step = 'MENU';
                    await sock.sendMessage(senderPhone, { text: '⚠️ Ocorreu um erro ao processar o seu pedido. Digite *menu* para reiniciar.' });
                }
            }
        });
    });
}

const DEFAULT_STATUS_MESSAGES: Record<string, string> = {
    preparando:
        `🔥 *O seu pedido foi confirmado e foi para a cozinha!* 👨‍🍳\n\n` +
        `A nossa equipa já começou a preparar o seu pedido:\n` +
        `• *Item:* {items}\n` +
        `• *Total:* R$ {total}\n\n` +
        `Em breve teremos novidades! ⏱️`,
    entrega:
        `🛵 *O seu pedido saiu para entrega!* 📦\n\n` +
        `Fique atento, o entregador está a caminho do seu endereço com o seu pedido:\n` +
        `• *Item:* {items}\n` +
        `• *Total:* R$ {total}\n\n` +
        `Bom apetite! 😋`,
    concluido:
        `✅ *Pedido Entregue / Concluído!* 🎉\n\n` +
        `Esperamos que goste da sua refeição! Muito obrigado pela preferência. Volte sempre! 🍔❤️`
};

function getStatusMessage(status: string): string {
    const key = status === 'preparando' ? 'statusPreparando' : status === 'entrega' ? 'statusEntrega' : 'statusConcluido';
    return getBotMessage(key, DEFAULT_STATUS_MESSAGES[status] || '');
}

/**
 * Envia ao cliente a mensagem correspondente à mudança de status do pedido.
 * Falhas de envio são registradas, mas nunca derrubam a requisição que originou a mudança.
 */
export async function sendOrderStatusNotification(
    remoteJid: string,
    status: string,
    items: string,
    total: number
) {
    const template = getStatusMessage(status);
    if (!template) return;

    // `replaceAll` e nao `replace`: ver a nota no pedido recebido. Aqui o
    // efeito era pior, porque a mensagem de status e' a que o cliente le com
    // mais atencao -- e um "{total}" no meio dela parece erro do sistema.
    const message = template
        .replaceAll('{items}', items)
        .replaceAll('{total}', total.toFixed(2));

    await sendWhatsAppMessage(remoteJid, message);
}

export async function sendWhatsAppMessage(remoteJid: string, text: string) {
    if (sock && remoteJid) {
        try {
            await sock.sendMessage(remoteJid, { text });
            log.info(`📤 Mensagem enviada com sucesso para ${remoteJid}`);
            // Toda saida do bot entra no historico, nao so a do cliente. Sem
            // isso o atendente le a conversa e ve so o que o cliente falou,
            // sem o que o sistema ja respondeu.
            await registrarMensagem({ phone: remoteJid, from: 'atendente', text });
        } catch (error) {
            log.error(`❌ Erro ao enviar mensagem para ${remoteJid}:`, error);
        }
    } else {
        log.warn('⚠️ Socket do WhatsApp indisponível para envio.');
    }
}

/**
 * Separada de sendWhatsAppMessage pelo retorno: a outra engole o erro e so loga, o
 * que serve para notificacao de status. Aqui quem envia esta com o cursor no campo e
 * precisa saber se pode limpar a caixa. A gravacao no historico e' de chat.ts.
 */
export async function enviarMensagemDoPainel(remoteJid: string, text: string): Promise<boolean> {
    if (!sock) {
        log.warn('Socket do WhatsApp indisponivel: mensagem do painel nao saiu.');
        return false;
    }
    try {
        await sock.sendMessage(remoteJid, { text });
        log.info(`📤 Mensagem do painel enviada para ${remoteJid}`);
        return true;
    } catch (error) {
        log.error(`Erro ao enviar mensagem do painel para ${remoteJid}:`, error);
        return false;
    }
}

export const initBot = startWhatsAppBot;

/* ------------------------------------------------------- Identidade do cliente */

/**
 * O remoteJid pode ser "192479311741143@lid": indice local do app, nao telefone.
 * Enviar por ele funciona, e e' por isso que segue sendo o endereco guardado. O numero real
 * vem de remoteJidAlt/remoteJidUsername, do lidMapping ou do contato salvo; sem nenhum, vazio.
 */
export async function telefoneDoContato(msg: {
    key: { remoteJid?: string | null; remoteJidAlt?: string | null; remoteJidUsername?: string | null };
}): Promise<string> {
    const jid = msg.key.remoteJid || '';
    if (!jid) return '';
    if (!jid.endsWith('@lid')) return soDigitos(jid);

    const direto = msg.key.remoteJidAlt || msg.key.remoteJidUsername || '';
    if (direto && !direto.endsWith('@lid')) return soDigitos(direto);

    try {
        const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid);
        if (pn) return soDigitos(pn);
    } catch (error) {
        log.error(`Falha ao consultar o mapa lid->telefone de ${jid}:`, error);
    }

    return '';
}

/**
 * O jid do mapa vem como "5519971158843:0@s.whatsapp.net": o que vem depois dos
 * dois-pontes e' o DEVICE, e tirar so o nao-digito colava esse 0 no telefone --
 * erro que se apresenta como erro do cliente. Por isso a ordem e' dominio, device, digitos.
 */
function soDigitos(jid: string): string {
    const semDominio = jid.split('@')[0];
    const semDevice = semDominio.split(':')[0];
    return semDevice.replace(/\D/g, '');
}

/**
 * Contato salvo pelo dono primeiro, depois o pushName que o cliente gravou; nao ha
 * terceiro nome para inventar. A ordem importa porque as fontes discordam com
 * frequencia ("Maria da Silva (pao)" contra "Marina"), e quem opera e' o dono.
 */
export function nomeDoContato(msg: { pushName?: string | null; key: { remoteJid?: string | null } }): string {
    const contato = lerContato(msg.key.remoteJid || '');
    const salvo = (contato?.name || '').trim();
    if (salvo) return salvo.slice(0, 80);

    const doPush = typeof msg.pushName === 'string' ? msg.pushName.trim() : '';
    if (doPush) return doPush.slice(0, 80);

    const doContato = (contato?.notify || '').trim();
    return doContato.slice(0, 80);
}

/**
 * Nome de um endereco ja guardado, sem a mensagem em mao.
 *
 * Serve para conversa que ja estava no banco antes de o nome passar a ser
 * guardado -- o mesmo caminho de `resolveTelefone`.
 */
export function nomeArmazenado(jid: string): string {
    if (!jid) return '';
    const contato = lerContato(jid);
    return ((contato?.name || contato?.notify || '').trim()).slice(0, 80);
}

/**
 * `nomeArmazenado` com a gravacao na conversa, para recuperar as que ja estavam
 * no banco. Ver `resolveTelefone`, que faz o mesmo pelo numero.
 */
export async function resolveNome(jid: string): Promise<string> {
    const nome = nomeArmazenado(jid);
    if (!nome) return '';
    try {
        await prisma.chat.updateMany({
            where: { phone: jid, OR: [{ name: null }, { name: '' }] },
            data: { name: nome },
        });
    } catch (error) {
        log.error(`Falha ao gravar nome de ${jid}:`, error);
    }
    return nome;
}

function lerContato(jid: string): { name?: string; notify?: string; phoneNumber?: string } | null {
    try {
        const store = (sock as any)?.signalRepository?.contact;
        return store ? (store.get(jid) ?? store.get(jid.split('@')[0]) ?? null) : null;
    } catch {
        return null;
    }
}

/**
 * Foto do perfil, ou string vazia para quem nao tem. preview e' a variante
 * pequena: a lista mostra 36px, e a imagem cheia seria baixada para virar circulo.
 */
export async function fotoDoContato(jid: string): Promise<string> {
    if (!sock || !jid) return '';
    try {
        const url = await sock.profilePictureUrl(jid, 'preview', 5_000);
        return typeof url === 'string' ? url : '';
    } catch (error) {
        // Cliente sem foto, conta sem permissao ou WhatsApp fora do ar: nenhum
        // dos tres e' erro do sistema, entao nao sobe.
        log.debug(`Sem foto para ${jid}: ${String(error)}`);
        return '';
    }
}

/** O socket esta pronto para buscar foto? Usado para nao tentar cedo demais. */
export function podeBuscarFoto(): boolean {
    return botOnline && !!sock;
}

/**
 * Mesma logica de `telefoneDoContato`, mas sem a mensagem em mao: quem chama so tem
 * o `phone`. Existe para recuperar as conversas que ja estavam no banco antes de o
 * numero passar a ser guardado. Devolve o numero, ou vazio.
 */
export async function resolveTelefone(jid: string): Promise<string> {
    if (!jid) return '';
    if (!jid.endsWith('@lid')) {
        const direto = soDigitos(jid);
        if (direto) await gravaTelefone(jid, direto);
        return direto;
    }
    try {
        const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid);
        if (!pn) return '';
        const digits = soDigitos(pn);
        if (digits) await gravaTelefone(jid, digits);
        return digits;
    } catch (error) {
        log.error(`Falha ao resolver telefone de ${jid}:`, error);
        return '';
    }
}

async function gravaTelefone(jid: string, telefone: string): Promise<void> {
    try {
        await prisma.chat.updateMany({
            where: { phone: jid, OR: [{ telefone: null }, { telefone: '' }] },
            data: { telefone },
        });
    } catch (error) {
        log.error(`Falha ao gravar telefone de ${jid}:`, error);
    }
}

/**
 * Força um novo ciclo de conexão sem apagar a sessão salva: o Baileys volta a
 * emitir o QR automaticamente quando o socket é reaberto.
 */
export async function reconnectBot(): Promise<void> {
    if (sock) {
        try {
            sock.ev.removeAllListeners('connection.update');
            await sock.end(undefined);
        } catch (error) {
            log.error('Erro ao encerrar socket anterior:', error);
        }
        sock = null;
    }
    botOnline = false;
    setConnection({ phase: 'sincronizando', qr: null, qrIssuedAt: null, lastError: null });
    await startWhatsAppBot();
}

/**
 * Desconecta de verdade e apaga os credenciais salvos, forcando um novo
 * pareamento do zero. Usado em "desconectar e parear outro numero".
 */
export async function logoutBot(): Promise<void> {
    if (sock) {
        try {
            await sock.ev.removeAllListeners('connection.update');
            await sock.logout();
        } catch (error) {
            log.error('Erro ao fazer logout do socket:', error);
        }
        sock = null;
    }
    botOnline = false;
    setConnection({
        phase: 'aguardando-qr',
        online: false,
        qr: null,
        qrIssuedAt: null,
        phone: null,
        name: null,
        platform: null,
        since: null,
        lastError: null,
    });
}

/**
 * Fecha o socket sem deslogar e sem reconectar. `logoutBot` no desligamento
 * apagaria `auth_info_baileys` e o proximo boot cairia no QR -- reinstalo comum
 * virava telefonema. `reconnectBot` seguraria o event loop. Devolve se havia socket.
 */
export async function desconectaBot(): Promise<boolean> {
    if (!sock) return false;
    try {
        sock.ev.removeAllListeners('connection.update');
        await sock.end(undefined);
    } catch (error) {
        log.error('Erro ao fechar o socket do WhatsApp:', error);
    }
    sock = null;
    botOnline = false;
    return true;
}
