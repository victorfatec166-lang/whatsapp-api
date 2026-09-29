import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import { prisma } from '../database/prisma';
// DEFAULT_BOT_MESSAGES nao vem mais por aqui. Quem precisa dos textos padrao
// (o servidor, para montar a lista de campos editaveis, e o botMessages, para
// o cache) importa direto do botDefaults. Aqui ele nunca foi usado, e o
// import mascarava de onde os textos realmente saem.
import { loadBotMessages, getBotMessage } from './botMessages';
import { createOrderWithStock } from './orders';
import { loadProductFull, priceCart, linesToItemsField, type ProductFull } from './modifiers';
import { buildBotMenu, renderBotMenuText } from './dailyMenu';
import { confereAmarracao } from './maquina';
import {
    botPodeResponder,
    guardaFoto,
    registrarMensagem,
    vincularPedido,
} from './chat';
import { notifyChat } from './sse';
import { logDoModulo } from './logger';
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
     * Retrato da lista enviada ao cliente, na ordem em que ele a viu.
     *
     * O menu do dia muda enquanto o cliente escolhe. Sem este retrato, o
     * numero que ele digitou passaria a apontar para outro prato depois de uma
     * edicao na hora -- ele veria o Coxinha na posicao 2 e acabaria pedindo
     * outra coisa.
     */
    offered?: Array<{ id: string; name: string; price: number }>;
};

const userSession: { [key: string]: Session } = {};

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

/** Cria o pedido com os modificadoresJa escolhidos, aplicando preco do banco. */
async function createBotOrder(
    jid: string,
    product: { id: string; name: string; price: number; isCombo: boolean },
    picked: Record<string, string[]>,
    onOrderCreated?: () => void
): Promise<void> {
    const priced = await priceCart([{ id: product.id, qty: 1, groups: picked }]);
    if (priced.ok === false) {
        await sock?.sendMessage(jid, { text: `⚠️ ${priced.error}` });
        userSession[jid].step = 'MENU';
        return;
    }

    const line = priced.result.lines[0];
    const itemsField = linesToItemsField(priced.result.lines);

    /*
     * Pedido e baixa de estoque no mesmo commit.
     *
     * Se a gravacao falhar, a excecao sobe e o catch de quem chamou avisara o
     * cliente. O importante e' que nao exista o estado em que o pedido esta
     * gravado e o estoque nao foi mexido: com o bot e o balcao vendendo o
     * mesmo item ao mesmo tempo, esse estado fazia o estoque contar coisa que
     * nao saiu.
     */
    const { order: newOrder, shortfalls } = await createOrderWithStock(
        {
            clientPhone: jid,
            clientName: 'Cliente WhatsApp',
            items: itemsField,
            subtotal: priced.result.subtotal,
            total: line.total,
            status: 'pendente',
        },
        // Em combo, o abate e' nos componentes, nunca no combo.
        priced.result.stockDeductions,
        'whatsapp'
    );

    log.info(`✅ Pedido criado com sucesso ID: ${newOrder.id}`);

    /*
     * Cliente que pediu item sem saldo ainda recebe o pedido. Recusar por causa
     * de um contador velho, no meio do pico, joga a venda fora -- e quem sofre
     * e' a cozinha, que ja produziu. O dono recebe a lista no log e reponde.
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

    userSession[jid].step = 'MENU';
    userSession[jid].productId = undefined;
    userSession[jid].picked = undefined;
    userSession[jid].groupIndex = 0;
    userSession[jid].offered = undefined;

    const label = line.modLabels.length ? `${line.name} (${line.modLabels.join(', ')})` : line.name;
    /*
     * `replaceAll`, e nao `replace`.
     *
     * `String.replace` com string troca SO A PRIMEIRA ocorrencia. Escrever
     * "{total}" duas vezes -- o que e' natural em "Total {total}, e o PIX e'
     * para {total}" -- mandava o segundo "{total}" literal para o cliente. O
     * mesmo para {items} em um texto que lista e depois resume.
     *
     * E' a razao de a tela de mensagens oferecer as variaveis como botao: a
     * pessoa nao deveria ter que lembrar de um detalhe de substituicao para
     * escrever uma frase natural.
     */
    const orderReceivedMsg = getBotMessage('orderReceived',
        '🎉 *Pedido Recebido com Sucesso!* \n\n' +
        '📦 *Item:* {items}\n' +
        '💵 *Total:* R$ {total}\n\n' +
        'O seu pedido já foi registado na cozinha! Digite *2* para consultar os seus pedidos.'
    )
        .replaceAll('{items}', label)
        .replaceAll('{total}', line.total.toFixed(2));

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
     * Preenchido quando a sessao em disco veio de outra maquina.
     *
     * E' o que a tela mostra em cima do QR, com o texto do que aconteceu. A
     * alternativa -- ligar do mesmo jeito e avisar depois -- deixaria dois
     * aparelhos com a mesma identidade ativa, e o desfecho possivel e' o
     * WhatsApp derrubar um deles.
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
    // O aviso de sessao estranha e' reemitido em toda mudanca de estado, e nao
    // so no boot. Sem isso, um reconnect -- que reseta a fase para
    // "aguardando-qr" -- faria o aviso sumir da tela bem no momento em que a
    // pessoa precisa dele para entender por que tem um QR na frente.
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
 * Pasta da sessao do WhatsApp.
 *
 * Mora aqui, e nao em cada arquivo que precisa, por causa da amarracao de
 * maquina: `confereAmarracao` grava a marcacao AO LADO das chaves, entao quem
 * define a pasta precisa ser o mesmo que confere. Duas constantes iguais em
 * arquivos diferentes e' como os dois paths divergem sem ninguem notar -- e o
 * sintoma seria a marcacao sumir sozinha.
 */
export const AUTH_DIR = 'auth_info_baileys';

// Adicionamos um parâmetro 'onOrderCreated' para receber a função de aviso do servidor
export async function startWhatsAppBot(onOrderCreated?: () => void) {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    /*
     * Confere se esta sessao e' desta maquina, ANTES de abrir o socket.
     *
     * A ordem importa: se a sessao for de outro aparelho, o certo e' nao
     * conectar e pedir o QR. Conectar primeiro e avisar depois deixaria dois
     * aparelhos com a mesma identidade ativa por alguns segundos -- que e'
     * exatamente a janela em que o WhatsApp pode derrubar um dos dois.
     *
     * Nao trava o app. A sessao pode ter vindo de outra maquina por um motivo
     * legitimo -- reinstalacao do Windows, HD trocado -- e quem resolve e'
     * escaneando o QR, em um minuto. Um bloqueio obrigaria a pessoa a apagar
     * arquivo as maos sem nenhuma pista de por que.
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

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const senderPhone = msg.key.remoteJid || '';
            const messageText =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text;

            if (!messageText) continue;

            const textLower = messageText.toLowerCase().trim();
            log.info(`📩 Mensagem de ${senderPhone}: ${textLower}`);

            /*
             * Grava a mensagem ANTES de qualquer decisao do bot.
             *
             * A ordem importa e nao e' estetica: se o bot responder e a gravacao
             * viesse depois, uma falha de escrita deixaria a resposta enviada
             * sem rastro nenhum -- o cliente recebeu, e o painel nao mostra o
             * que aconteceu. Gravando primeiro, o historico existe mesmo se o
             * resto do caminho falhar.
             *
             * Quem decide se a loja responde e' quem esta com a conversa aberta
             * no painel. Ver `botPodeResponder` e o bloco logo abaixo.
             *
             * `senderPhone` e' o ENDERECO, e pode ser um "192...@lid": o
             * WhatsApp passou a entregar mensagens por um identificador de
             * privacidade, que nao contem telefone. Enviar por ele funciona, e e'
             * ele que fica guardado. O numero que o dono le vai em `telefone`,
             * resolvido logo abaixo.
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
             * Foto do perfil, uma vez por semana por cliente.
             *
             * Busca depois de gravar, e nao antes: se a busca falhar, a
             * conversa ja esta salva e o cliente continua sendo atendido. E o
             * `guardaFoto` respeita a data, entao este bloco nao vira uma
             * chamada de rede por mensagem.
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

            if (!userSession[senderPhone]) {
                userSession[senderPhone] = { step: 'MENU' };
            }

            const currentStep = userSession[senderPhone].step;

            /*
             * Alguem assumiu a conversa? Entao o bot cala.
             *
             * Sem este corte, o cliente que pediu para falar com uma pessoa
             * receberia o cardapio inteiro do bot e a resposta da pessoa, uma
             * por cima da outra. A opcao 3 do menu -- "falar com atendente" --
             * hoje responde "um atendente vai chamar", e nao havia quem chamasse.
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

                if (currentStep === 'MENU') {
                    if (textLower === '1') {
                        const products = await buildBotMenu();

                        if (products.length === 0) {
                            await sock.sendMessage(senderPhone, {
                                text: getBotMessage('menuEmpty', '⚠️ O cardápio está vazio no momento. Cadastre produtos no painel web!')
                            });
                            continue;
                        }

                        userSession[senderPhone].step = 'AGUARDANDO_PRODUTO';
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
                        await sock.sendMessage(senderPhone, { text: getBotMessage('attendantMessage', '👨‍💻 A sua solicitação foi registada. Um atendente humano irá chamá-lo em breve! Digite *menu* a qualquer momento para voltar.') });
                    } 
                    else {
                        await sock.sendMessage(senderPhone, { text: getBotMessage('invalidOption', '🤖 Opção inválida. Digite *1* para ver o cardápio ou *menu* para ver as opções.') });
                    }
                } 
                else if (currentStep === 'AGUARDANDO_PRODUTO') {
                    if (!isNaN(Number(textLower))) {
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
                                text: 'ℹ️ O cardápio mudou. Escolha novamente pelo número.',
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
                                await createBotOrder(
                                    senderPhone,
                                    { id: selected.id, name: selected.name, price: selected.price, isCombo: false },
                                    {},
                                    onOrderCreated
                                );
                            }
                        } else {
                            await sock.sendMessage(senderPhone, {
                                text: '⚠️ Esse item saiu do cardápio. Peça *1* para ver a lista atualizada.',
                            });
                            userSession[senderPhone].step = 'MENU';
                        }
                    } else {
                        await sock.sendMessage(senderPhone, { text: getBotMessage('invalidProduct', '❌ Por favor, digite apenas o *número* correspondente ao produto desejado ou digite *menu*.') });
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
                        await createBotOrder(senderPhone, product, session.picked ?? {}, onOrderCreated);
                    }
                }
            } catch (err) {
                log.error('❌ Erro crítico ao processar mensagem do bot:', err);
                userSession[senderPhone].step = 'MENU';
                await sock.sendMessage(senderPhone, { text: '⚠️ Ocorreu um erro ao processar o seu pedido. Digite *menu* para reiniciar.' });
            }
        }
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
 * Envia uma mensagem que veio do painel, e devolve se saiu.
 *
 * Existe separada de sendWhatsAppMessage por causa do retorno. A outra engole
 * o erro e so loga, o que e' o certo para notificacao de status -- ali ninguem
 * esta esperando resposta. Aqui quem envia esta com o cursor no campo, e precisa
 * saber se pode limpar a caixa de texto ou se a frase ficou por conta propria.
 *
 * A gravacao no historico acontece em chat.ts, que marca `falhou` quando o envio
 * falha. Aqui nao grava: gravar duas vezes deixaria a mensagem duplicada na
 * conversa.
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
 * O WhatsApp nao entrega mais o telefone, e sim um identificador de privacidade.
 *
 * A mensagem chega com `remoteJid` no formato "192479311741143@lid". Esse
 * numero nao e' telefone de ninguem: e' um indice local do aplicativo, e ele
 * muda de um lado para o outro conforme a conta. Enviar por ele funciona, e por
 * isso ele continua sendo o endereco guardado. O que ele NAO serve e' para
 * mostrar na tela: o dono precisa ler o numero do cliente, nao o indice dele.
 *
 * A correspondencia real vem de tres lugares, nesta ordem de confianca:
 *
 * 1. `remoteJidAlt` / `remoteJidUsername`, que o Baileys preenche na propria
 *    chave da mensagem quando o servidor mandou junto.
 * 2. `signalRepository.lidMapping`, o mapa que o WhatsApp sincroniza entre
 *    dispositivos. E' a fonte que sobrevive a reinicio.
 * 3. O proprio contato salvo no celular, via `phoneNumber` da store.
 *
 * Quando nenhum dos tres entrega o numero, o retorno e' vazio e a tela diz que
 * o cliente nao esta identificado. Preencher com o lid seria pior que nada: um
 * telefone falso no meio de um atendimento custa mais caro que um telefone
 * faltando.
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
 * Juros do jid ate o numero.
 *
 * O jid do mapa lid->telefone vem como "5519971158843:0@s.whatsapp.net": o que
 * vem depois dos dois-pontes e' o DEVICE, nao parte do numero. Tirar so o
 * nao-digito -- que e' o que esta funcao fazia antes -- colava o `0` do device
 * no fim do telefone e produzia 55199711588430, com um digito a mais.
 *
 * Um telefone com um digito sobrando e' pior que nenhum: a pessoa liga, o numero
 * pertence a outra pessoa, e o erro se apresenta como erro do cliente, nao do
 * sistema. Por isso a ordem e' cortar o dominio, cortar o device, e so entao
 * exigir digitos.
 */
function soDigitos(jid: string): string {
    const semDominio = jid.split('@')[0];
    const semDevice = semDominio.split(':')[0];
    return semDevice.replace(/\D/g, '');
}

/**
 * Nome do cliente, na ordem em que a pessoa reconhece.
 *
 * 1. O nome que o dono salvou no contato do WhatsApp. E' o que a tela mostra
 *    primeiro, porque e' como ele chama essa pessoa -- e o mesmo nome que ele
 *    usaria se telefonasse. Uma conversa de cliente recorrente vira "Dona
 *    Maria" em vez de um numero.
 * 2. O nome que o proprio cliente gravou no WhatsApp (`pushName`), que vem em
 *    cada mensagem mesmo de quem nunca foi salvo. Serve para cliente novo.
 * 3. Nada. A tela mostra o telefone, e para contato nao salvo nao ha nome
 *    nenhum para inventar.
 *
 * A ordem importa porque as duas fontes discordam com frequencia: o dono
 * salva como "Maria da Silva (pão)" e o cliente se chama "Marina". Quem opera
 * o painel e' o dono, entao o nome dele ganha.
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
 * Foto do perfil, ou string vazia para quem nao tem.
 *
 * `preview` e' a variante pequena: a lista mostra 36px, e a imagem cheia pesa
 * alguns hundreds de KB que seriam baixados por elemento para virar um circulo.
 *
 * Devolve string vazia em vez de null porque a tela decide o que fazer com a
 * ausencia, e uma URL vazia nao quebra o atributo `src`.
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
 * Resolve o telefone de um endereco ja guardado e grava na conversa.
 *
 * Mesma logica de `telefoneDoContato`, mas sem a mensagem em mao: quem chama
 * tem apenas o `phone`. Serve para recuperar conversas que ja estavam no banco
 * antes de o numero passar a ser guardado, que e' o caso de toda conversa
 * anterior a esta mudanca.
 *
 * Devolve o numero, ou string vazia. Grava sozinho: quem chamou so precisa
 * saber se veio algo.
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