import makeWASocket, {
    BufferJSON,
    initAuthCreds,
    proto,
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
import {
    registroDeLojas,
    conexaoAtual,
    exigeConexao,
    garantirConexao,
    getConnectionState,
    isBotOnline,
    lojaDoChamador,
    setConnection,
    socket,
    sessoes,
    type Conexao,
} from './botLojas';
import { confereAmarracao } from './maquina';
import { carregaPedidoAberto, salvaPedidoAberto } from './botPedido';
import {
    apagaSessao,
    estadoDaSessao,
    lojasComSessao,
    outraInstalacaoComSessao,
    type CodecsDaSessao,
} from './whatsappSessao';
import { comoLoja, exigeLoja, lojaAtual, lojaDoBoot } from './loja';
import {
    botPodeResponder,
    devolverAoBot,
    guardaFoto,
    registrarMensagem,
    vincularPedido,
    assumirConversa,
} from './chat';
import { interpreta, maisProximos, type ItemCatalogo } from './entender';
import { extraiComIa, respondeComIa } from './ia';
import {
    juntaItem,
    textoDoCarrinho as textoCarrinho,
    ehComandoFechar,
    ehComandoLimpar,
    ehComandoMenu,
    ehComandoVerCarrinho,
    ehSaudacao,
    type LinhaCarrinho,
} from './carrinho';
import { notifyChat } from './sse';
import { logDoModulo } from './logger';
import { DIR_SESSAO_WHATSAPP } from './paths';
const log = logDoModulo('bot');

export { loadBotMessages, getBotMessage };



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

/** As tres opcoes do balcao automatico. */
function textoDoMenu(): string {
    return getBotMessage('mainMenu',
        '🍔 *BEM-VINDO* 🍕\n' +
        '━━━━━━━━━━━━━━━━━━━━━\n' +
        'Escolha uma opção:\n\n' +
        '1️⃣ *Ver Cardápio e Pedir*\n' +
        '2️⃣ *Consultar Meus Pedidos*\n' +
        '3️⃣ *Falar com Atendente*\n\n' +
        '👉 *Responda com o número* da opção desejada:');
}

/**
 * Recomeco limpo do balcao. O carrinho NAO e' apagado: quem pede o menu esta
 * olhando as opcoes, nao desistindo do pedido, e apagar as linhas que ele ja
 * tinha feito seria o jeito mais facil de a cozinha perder comida.
 */
function recomecaSessao(jid: string): void {
    const sessao = sessoes()[jid];
    sessao.step = 'MENU';
    sessao.offered = undefined;
    sessao.productId = undefined;
    sessao.picked = undefined;
    sessao.groupIndex = 0;
}

/**
 * Saudeacao no meio de um pedido nao recomeca nada: ela so mostra em que ponto a
 * pessoa esta. Era aqui que o "oi" mais comum do portugues apagava o item com
 * modificador pendente e devolvia o cliente ao menu sem ele ter pedido nada.
 */
async function reancora(jid: string): Promise<void> {
    const emObra = carrinhoDe(jid).length > 0 || sessoes()[jid].step !== 'MENU';
    const texto = emObra
        ? 'Oi! 👋\n\n' + textoCarrinho(carrinhoDe(jid))
        : 'Oi! 👋 ' + textoDoMenu();
    await socket()?.sendMessage(jid, { text: texto });
}

/**
 * Recovery que devolve a PESSOA para a lista de produtos, e nao para o menu de
 * tres opcoes. A lista e' o que ela veio buscar; o menu era o obrigo de passar
 * por um degrau que nao levava a lugar nenhum.
 */
async function retomaNoCardapio(jid: string, aviso: string): Promise<void> {
    const sessao = sessoes()[jid];
    sessao.productId = undefined;
    sessao.picked = undefined;
    sessao.groupIndex = 0;

    const produtos = await buildBotMenu();
    if (produtos.length === 0) {
        sessao.step = 'MENU';
        await socket()?.sendMessage(jid, {
            text: aviso + '\n\n' + getBotMessage('menuEmpty', '⚠️ O cardápio está vazio no momento. Cadastre produtos no painel web!'),
        });
        return;
    }

    sessao.step = 'PEDINDO';
    sessao.offered = produtos.map((p) => ({ id: p.id, name: p.name, price: p.price }));
    await socket()?.sendMessage(jid, { text: renderBotMenuText(produtos) });
    await socket()?.sendMessage(jid, { text: aviso });
}

/**
 * Caminho do pedido natural, sem numero e sem lista: transforma "quero 3 coxinhas"
 * em item. Cartao que precisa de modificador pergunta em vez de entrar errado, e o
 * que nao foi entendido volta para a pessoa em vez de sumir no balcao.
 */
async function interpretaEAdiciona(jid: string, texto: string): Promise<void> {
    const catalogo = await catalogoParaInterpretar(jid);
    if (catalogo.length === 0) {
        await socket()?.sendMessage(jid, { text: '⚠️ O cardápio está vazio no momento.' });
        return;
    }

    /*
     * As regras primeiro: "coxinha de frango 3" casa por string e sai sem rede.
     * A IA so entra no que sobrou -- a frase que o dono nao antecipou ao
     * escrever o cardapio -- e devolve null se falhar.
     */
    let intencao = interpreta(texto, catalogo);
    if (intencao.itens.length === 0) {
        const pelaIa = await extraiComIa(texto, catalogo);
        if (pelaIa) intencao = pelaIa;
    }

    if (intencao.itens.length === 0) {
        await respondeSemPedido(jid, texto, catalogo, intencao.naoEntendidos);
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
            sessoes()[jid].step = 'ESCOLHENDO_MOD';
            sessoes()[jid].productId = item.id;
            sessoes()[jid].groupIndex = 0;
            sessoes()[jid].picked = { ...item.modificadores };
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
        await socket()?.sendMessage(jid, { text: `🤔 Entendi como: ${lista}. Serve? Se não, mande *limpar* e tente de novo.` });
        return;
    }

    const extras = intencao.naoEntendidos;
    await socket()?.sendMessage(jid, {
        text: textoCarrinho(carrinho) + (extras.length > 0 ? `\n\n_Não entendi: ${extras.join(', ')}._` : '')
    });
}

/**
 * A frase nao virou pedido. O bot dizia "nao entendi" para TUDO, inclusive para
 * "tudo bem?" -- a primeira frase que a pessoa manda. E' aqui que ele virava robo.
 * Tres saidas: a IA responde, uma frase pronta, e so entao o "nao encontrei".
 */
async function respondeSemPedido(
    jid: string,
    texto: string,
    catalogo: ItemCatalogo[],
    naoEntendidos: string[]
): Promise<void> {
    const nomeDaLoja = (await prisma.config.findUnique({ where: { id: exigeLoja() }, select: { businessName: true } }))
        ?.businessName;

    const daIa = await respondeComIa(texto, catalogo, nomeDaLoja ?? '');
    if (daIa) {
        await socket()?.sendMessage(jid, { text: daIa });
        return;
    }

    /*
     * A IA nao respondeu. O texto ainda diz o que ela tentou ler -- e, quando ela
     * leu, sugere o que era. Sugerir e' melhor do que repetir: o cliente confirma
     * com um "s" em vez de reescrever a frase que o bot acabou de recusar.
     */
    if (naoEntendidos.length > 0) {
        const tentou = naoEntendidos.join(', ');
        const sugestoes = maisProximos(tentou, catalogo);
        const comSugestao =
            sugestoes.length > 0
                ? `\n\nVocê quis dizer ${sugestoes.map((s) => `*${s.nome}*`).join(' ou ')}?`
                : '';
        await socket()?.sendMessage(jid, {
            text:
                `🤖 Não encontrei ${tentou} no cardápio.${comSugestao}` +
                '\n\nEscreva o **nome do produto** (com ou sem quantidade) ou mande *cardápio* para ver a lista.'
        });
        return;
    }

    await socket()?.sendMessage(jid, {
        text:
            '🤖 Não entendi o que você pediu.' +
            '\n\nEscreva o **nome do produto** (com ou sem quantidade) ou mande *cardápio* para ver a lista.'
    });
}

/**
 * Montado do MESMO retrato que o cliente recebeu, e nao do banco: se o dono editar o
 * cardapio no meio da conversa, o cliente pediria algo que nem estava na lista mostrada.
 * Os grupos de modificador entram junto, senao "ao ponto" e "bacon" nao tem onde casar.
 */
async function catalogoParaInterpretar(jid: string): Promise<ItemCatalogo[]> {
    const offered = sessoes()[jid]?.offered;
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

    const alvo = socket();
    if (alvo) await alvo.sendMessage(jid, { text });
}

/**
 * Funcao e nao campo acessado solto: carrinho.length em carrinho indefinido derruba
 * a conversa no meio do pedido, e o erro e' silencioso.
 * A regra (juntar, agrupar, montar o texto) esta em carrinho.ts, sem WhatsApp e sem banco.
 */
function carrinhoDe(jid: string): LinhaCarrinho[] {
    if (!sessoes()[jid]) sessoes()[jid] = { step: 'MENU' };
    if (!sessoes()[jid].carrinho) sessoes()[jid].carrinho = [];
    return sessoes()[jid].carrinho;
}

/**
 * Regra mais antiga: o cliente manda ids e quantidades, nunca preco -- a frase livre
 * descobre QUAL produto, nunca QUANTO custa. O total e' a soma das LINHAS, nao o
 * subtotal devolvido: com modificador de acrescimo, pagar o subtotal seria cobrar menos.
 */
async function fechaCarrinho(jid: string, onOrderCreated?: () => void): Promise<void> {
    const carrinho = carrinhoDe(jid);

    if (carrinho.length === 0) {
        await socket()?.sendMessage(jid, { text: '🧾 Nao ha nada no pedido ainda. Manda *cardápio* para ver a lista.' });
        return;
    }

    const pedido = carrinho.map((l) => ({ id: l.id, qty: l.qtd, groups: l.modificadores ?? {} }));
    const priced = await priceCart(pedido);

    if (priced.ok === false) {
        // Volta para o pedido em aberto: e' a unica saida honesta quando falta um
        // modificador obrigatorio. Dizer "pedido criado" seria o que a cozinha
        // receberia errado.
        await socket()?.sendMessage(jid, { text: `⚠️ ${priced.error}` });
        sessoes()[jid].step = 'PEDINDO';
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
    sessoes()[jid].carrinho = [];
    sessoes()[jid].step = 'MENU';
    sessoes()[jid].productId = undefined;
    sessoes()[jid].picked = undefined;
    sessoes()[jid].groupIndex = 0;
    sessoes()[jid].offered = undefined;

    /*
     * replaceAll e nao replace: replace com string troca SO A PRIMEIRA ocorrencia,
     * e "Total {total}, e o PIX e' para {total}" mandava o segundo literal para o
     * cliente. E' a razao de a tela oferecer as variaveis como botao.
     */
    const orderReceivedMsg = getBotMessage('orderReceived',
        '🎉 *Pedido Recebido com Sucesso!* \n\n' +
        '📦 *Itens:* {items}\n' +
        '💵 *Total:* R$ {total}\n\n' +
        'O seu pedido já foi registado na cozinha! Para pedir de novo, mande *cardápio*.'
    )
        .replaceAll('{items}', itemsField.replace(/\n/g, ' | '))
        .replaceAll('{total}', total.toFixed(2));

    await socket()?.sendMessage(jid, { text: orderReceivedMsg });
}

// Evita pilha de listeners quando o socket reconecta em loop.
function bindSocket(target: any, handler: (payload: any) => void) {
    target.ev.removeAllListeners('connection.update');
    target.ev.on('connection.update', handler);
}

/*
 * Mora aqui e nao em cada arquivo que precisa: confereAmarracao grava a marcacao
 * AO LADO das chaves, entao quem define a pasta precisa ser o mesmo que confere.
 * A pasta virou origem de importacao: a sessao que vale esta no banco.
 */
export const AUTH_DIR = process.env.BAILEYS_AUTH_DIR?.trim() || DIR_SESSAO_WHATSAPP;

/*
 * O store do banco nao importa o Baileys (ele e' ESM sem `require`, e isso
 * quebraria o runner de teste), entao o formato dos bytes entra por aqui: o
 * `BufferJSON` do proprio Baileys, que e' o mesmo dos arquivos de sessao.
 */
const codecsDaSessao: CodecsDaSessao = {
    credsVazios: initAuthCreds,
    serializa: (valor) => JSON.stringify(valor, BufferJSON.replacer),
    desserializa: (texto) => JSON.parse(texto, BufferJSON.reviver),
    preparar: (tipo, valor) =>
        tipo === 'app-state-sync-key' && valor ? proto.Message.AppStateSyncKeyData.fromObject(valor) : valor,
};

/**
 * A sessao vive no banco por maquina, entao o aviso de "outra instalacao" sai de
 * la: dois lugares com o mesmo numero e' o que o WhatsApp derruba, e a versao em
 * arquivo so enxergava a pasta desta maquina.
 */
async function avisaSeOutraInstalacaoPareou(loja: string): Promise<{ motivo: string; podeAparear: boolean } | null> {
    const outras = await outraInstalacaoComSessao(loja).catch((erro) => {
        log.error('Nao deu para conferir as outras instalacoes:', erro);
        return [];
    });
    if (!outras.length) return null;

    const quando = outras[0].atualizadoEm.toLocaleString('pt-BR');
    log.warn(`A loja ${loja} tem sessao do WhatsApp tambem em outra instalacao (${outras[0].maquinaId}).`);
    return {
        motivo:
            `Esta loja tambem tem sessao pareada em outra instalacao (${outras[0].maquinaId}, ` +
            `conectada em ${quando}). O WhatsApp derruba uma das duas, e a que some e' a que ` +
            'aqui nao aparece. Pare o bot na outra maquina, ou desconecte e paree o numero de novo aqui.',
        podeAparear: true,
    };
}

/**
 * Liga o bot de cada loja que ja pareou um numero, e o da loja do boot. Sem isto, o
 * deploy derrubaria todos os WhatsApp. Uma por vez: abrir N sockets juntos sao N
 * conexoes no pool ao mesmo tempo, que e' o recurso mais apertado da nuvem.
 */
export async function startBots(onOrderCreated?: () => void): Promise<number> {
    const pareadas = await lojasComSessao().catch((erro) => {
        log.error('Nao deu para listar as lojas com sessao de WhatsApp:', erro);
        return [] as string[];
    });
    const lojas = [...new Set([lojaDoBoot(), ...pareadas])];
    for (const loja of lojas) {
        try {
            await startWhatsAppBot(loja, onOrderCreated);
        } catch (erro) {
            log.error(`Bot da loja ${loja} nao subiu:`, erro);
        }
    }
    return lojas.length;
}

/**
 * Abre o bot da loja se ele nao estiver aberto. E' o que faz o QR aparecer para
 * quem entra na tela do WhatsApp de uma loja que ainda nunca pareou: o boot so
 * liga as lojas que ja tem numero, e essa e' a primeira visita dela.
 */
export function asseguraBot(loja: string): void {
    if (registroDeLojas().get(loja)?.sock) return;
    startWhatsAppBot(loja).catch((erro) => {
        log.error(`Bot da loja ${loja} nao pode abrir agora:`, erro);
    });
}

/**
 * Liga o WhatsApp de UMA loja: um socket, e tudo o que gira em volta dele. A loja entra
 * no contexto antes de tudo, porque envio, carrinho e gravacao leem a loja de la. E a
 * trava: duas chamadas seguidas abririam dois sockets com a mesma identidade.
 */
export async function startWhatsAppBot(
    loja = lojaDoBoot(),
    onOrderCreated?: () => void
): Promise<void> {
    const conexao = garantirConexao(loja);
    conexao.onOrderCreated = onOrderCreated ?? conexao.onOrderCreated;
    if (conexao.abrindo) return conexao.abrindo;

    conexao.abrindo = (async () => {
        const { saveCreds, ...state } = await estadoDaSessao(loja, codecsDaSessao);

        /*
         * Antes de abrir o socket: conectar primeiro deixaria dois aparelhos com a mesma
         * identidade ativa por instantes, e e' a janela em que o WhatsApp derruba um deles.
         * Nao trava o app: sessao de outra maquina pode ser HD trocado, e quem resolve e' o QR.
         */
        const sessao = confereAmarracao(AUTH_DIR);
        conexao.estranha = sessao ?? (await avisaSeOutraInstalacaoPareou(loja));
        if (conexao.estranha) {
            log.warn(`Sessao de outra maquina na loja ${loja}. Avisando o painel.`);
        }

        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }) as any,
            browser: Browsers.macOS('Chrome'),
        });
        conexao.sock = sock;

        sock.ev.on('creds.update', () => {
            saveCreds().catch((erro) => log.error('Falha ao gravar a sessao do WhatsApp:', erro));
        });

    bindSocket(sock, async (update) => {
        const { connection: conn, lastDisconnect, qr } = update;

        if (qr) {
            setConnection(loja, { phase: 'aguardando-qr', qr, qrIssuedAt: Date.now(), lastError: null });
            log.info('\n[QR] Codigo de pareamento gerado. Abra o painel em /admin?tab=whatsapp');
            qrcode.generate(qr, { small: true });
        }

        if (conn === 'close') {
                        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const loggedOut = statusCode === DisconnectReason.loggedOut;

            if (loggedOut) {
                setConnection(loja, {
                    phase: 'deslogado',
                    online: false,
                    qr: null,
                    qrIssuedAt: null,
                    since: null,
                    lastError: 'Sessao encerrada no celular. Paree um numero novamente.',
                });
                /*
                 * A sessao ja morreu, entao sai do banco e da pasta. Deixando-a, o
                 * boot seguinte tentaria de novo com a mesma credencial e cairia em
                 * logout outra vez -- e o dono leria como "o sistema nao para".
                 */
                await apagaSessao(loja).catch((erro) => {
                    log.error(`Erro ao limpar a sessao encerrada da loja ${loja}:`, erro);
                });
                log.info(`Sessao encerrada (logout) na loja ${loja}. Pareamento necessario.`);
                return;
            }

            setConnection(loja, {
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
                    await startWhatsAppBot(loja, onOrderCreated);
                } catch (e) {
                    log.error('Erro ao reconectar bot:', e);
                    setConnection(loja, { phase: 'desconectado', online: false, lastError: 'Falha ao reconectar' });
                }
            }, 3000);
        } else if (conn === 'connecting') {
            setConnection(loja, { phase: 'sincronizando', lastError: null });
        } else if (conn === 'open') {
                        const me = sock?.user?.id || null;
            setConnection(loja, {
                phase: 'conectado',
                online: true,
                qr: null,
                qrIssuedAt: null,
                phone: me ? String(me).split(':')[0] ?? null : null,
                name: sock?.user?.name ?? null,
                platform: (sock as any)?.user?.platform ?? null,
                since: Date.now(),
                lastError: null,
            });
            log.info('Bot do WhatsApp conectado com sucesso!');
        }
    });

    // Baileys sinaliza QR escaneado emantes da conexao abrir.
    sock.ev.on('creds.update', () => {
        if (conexao.estado.phase === 'aguardando-qr') {
            setConnection(loja, { phase: 'escaneado' });
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        /*
         * Mensagens do WhatsApp rodam fora de requisicao HTTP;
         * `comoLoja` injeta o tenant do ambiente para persistir no banco.
         */
        await comoLoja(loja, async () => {
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

                const sessaoDoCliente = await carregaPedidoAberto(senderPhone);
                const currentStep = sessaoDoCliente.step;

                /*
                 * Fica ACIMA do corte do humano: e' a unica saida que o cliente
                 * tem depois de pedir atendente, e o texto que o bot mandou dizia
                 * que digitar "menu" trazia o automatico de volta.
                 */
                if (ehComandoMenu(textLower, currentStep)) {
                    await devolverAoBot(senderPhone);
                    recomecaSessao(senderPhone);
                    await socket().sendMessage(senderPhone, { text: textoDoMenu() });
                    await salvaPedidoAberto(senderPhone);
                    continue;
                }

                /*
                 * Sem este corte, quem pediu para falar com uma pessoa receberia o
                 * cardapio do bot e a resposta dela, uma por cima da outra.
                 */
                if (!(await botPodeResponder(senderPhone))) {
                    log.info(`Conversa com ${senderPhone} esta com humano; bot em silencio.`);
                    continue;
                }

                try {
                    if (ehSaudacao(textLower)) {
                        await reancora(senderPhone);
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
                        recomecaSessao(senderPhone);
                        await socket().sendMessage(senderPhone, {
                            text: '🧾 Pedido apagado. Comece de novo quando quiser.'
                        });
                        continue;
                    }

                    if (ehComandoVerCarrinho(textLower)) {
                        await socket().sendMessage(senderPhone, { text: textoCarrinho(carrinhoDe(senderPhone)) });
                        continue;
                    }

                    if (currentStep === 'MENU') {
                        if (textLower === '1') {
                            const products = await buildBotMenu();

                            if (products.length === 0) {
                                await socket().sendMessage(senderPhone, {
                                    text: getBotMessage('menuEmpty', '⚠️ O cardápio está vazio no momento. Cadastre produtos no painel web!')
                                });
                                continue;
                            }

                            sessoes()[senderPhone].step = 'PEDINDO';
                            // Guarda o retrato da lista: e contra ela que o numero
                            // digitado vai ser lido, mesmo que o dono edite o menu
                            // antes da resposta.
                            sessoes()[senderPhone].offered = products.map((p) => ({
                                id: p.id,
                                name: p.name,
                                price: p.price,
                            }));

                            await socket().sendMessage(senderPhone, { text: renderBotMenuText(products) });
                        }
                        else if (textLower === '2') {
                            const orders = await prisma.order.findMany({
                                where: { clientPhone: senderPhone },
                                orderBy: { createdAt: 'desc' }
                            });

                            if (orders.length === 0) {
                                await socket().sendMessage(senderPhone, { text: getBotMessage('noOrders', '📦 Não encontrámos pedidos recentes. Mande *1* para ver o cardápio.') });
                            } else {
                                let text = '📦 *OS SEUS PEDIDOS RECENTES:*\n\n';
                                orders.forEach(o => {
                                    text += `- *${o.items}* (R$ ${o.total.toFixed(2)}) ➡️ Status: *${o.status.toUpperCase()}*\n`;
                                });
                                /*
                                 * O rodape apontava para "menu", o atalho do cardapio:
                                 * seguir a instrucao do bot levava a pessoa de volta ao menu
                                 * de tres opcoes. A proxima acao util e' pedir de novo.
                                 */
                                text += '\nPara pedir de novo, mande *1*.';
                                await socket().sendMessage(senderPhone, { text });
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
                                await socket().sendMessage(senderPhone, {
                                    text: getBotMessage('attendantMessage',
                                        '👨‍💻 Chamei um atendente para si. Ele vai responder aqui mesmo a partir de agora — o automático fica em silêncio nesta conversa.')
                                });
                            } else {
                                await socket().sendMessage(senderPhone, {
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
                            const session = sessoes()[senderPhone];
                            const offered = session.offered;
                            const index = Number(textLower) - 1;

                            if (!offered || !offered[index]) {
                                // Retrato perdido (reinicio do servidor, ou o dono
                                // editou o cardapio): manda a lista de novo em vez
                                // de adivinhar o prato.
                                session.step = 'PEDINDO';
                                await retomaNoCardapio(senderPhone,
                                    'ℹ️ O cardápio mudou. Escolha novamente pelo número — ou escreva o nome do produto.');
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
                                    sessoes()[senderPhone].step = 'ESCOLHENDO_MOD';
                                    sessoes()[senderPhone].productId = selected.id;
                                    sessoes()[senderPhone].groupIndex = 0;
                                    sessoes()[senderPhone].picked = {};
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
                                    await socket().sendMessage(senderPhone, { text: textoCarrinho(carrinhoDe(senderPhone)) });
                                }
                            } else {
                                await retomaNoCardapio(senderPhone, '⚠️ Esse item saiu do cardápio. Escolha outro na lista.');
                            }
                        } else {
                            // Nao e' numero: e' frase. E o caminho que a pessoa
                            // realmente usa -- "quero 3 coxinhas", "coxinha e
                            // refrigerante", "xburguer ao ponto com bacon".
                            await interpretaEAdiciona(senderPhone, textLower);
                        }
                    }
                    else if (currentStep === 'ESCOLHANDO_MOD') {
                        const session = sessoes()[senderPhone];
                        const full = await loadProductFull(session.productId);
                        if (!full) {
                            await retomaNoCardapio(senderPhone, '⚠️ Esse produto não está mais disponível.');
                            continue;
                        }

                        const group = full.modifierGroups[session.groupIndex];
                        if (textLower === 'pular' || textLower === 'nenhum' || textLower === '0') {
                            session.groupIndex += 1;
                        } else if (group) {
                            const choice = Number(textLower) - 1;
                            if (isNaN(choice) || choice < 0 || choice >= group.options.length) {
                                await socket().sendMessage(senderPhone, { text: '❌ Opção inválida. Responda com o número ou *pular*.' });
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
                                        await socket().sendMessage(senderPhone, { text: `❌ Máximo de ${group.maxSelect} opções em ${group.name}.` });
                                        continue;
                                    }
                                    session.picked[group.id] = [...current, group.options[choice].id];
                                }
                                /*
                                 * A conta vem da lista ja gravada: "current + 1" dizia
                                 * "2/2 escolhida" no momento em que a pessoa tirava
                                 * uma opcao, e ela achava que o limite naoava.
                                 */
                                const agora = session.picked[group.id].length;
                                await socket().sendMessage(senderPhone, {
                                    text: `✅ *${group.name}*: ${agora}/${group.maxSelect} escolhida(s). Digite *pular* para seguir.`
                                });
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
                            await retomaNoCardapio(senderPhone,
                                `❌ Faltou escolher em *${missing.name}*. Escolha o item de novo e siga as perguntas.`);
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
                            recomecaSessao(senderPhone);
                            sessoes()[senderPhone].step = 'PEDINDO';
                            await socket().sendMessage(senderPhone, { text: textoCarrinho(carrinhoDe(senderPhone)) });
                        }
                    }
                } catch (err) {
                    log.error('❌ Erro crítico ao processar mensagem do bot:', err);
                    /*
                     * Recomecar no menu de tres opcoes jogava o cliente no degrau que
                     * ele nao queria, e ainda falava com ele como se nada tivesse
                     * acontecido. Volta para a lista e diz que foi um erro nosso.
                     */
                    await retomaNoCardapio(senderPhone,
                        '⚠️ Deu um erro aqui do nosso lado e não consegui ler a sua mensagem. Tente de novo.');
                } finally {
                    /*
                     * Todo `continue` acima passa por aqui. Sem isso, o caminho que
                     * respondia e voltava sem gravar deixaria o passo antigo no
                     * banco -- e o proximo deploy repetiria a pergunta ja respondida.
                     */
                    await salvaPedidoAberto(senderPhone);
                }
            }
        });
    });
    })();
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
    const alvo = socket();
    if (alvo && remoteJid) {
        try {
            await alvo.sendMessage(remoteJid, { text });
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
    const alvo = socket();
    if (!alvo) {
        log.warn('Socket do WhatsApp indisponivel: mensagem do painel nao saiu.');
        return false;
    }
    try {
        await alvo.sendMessage(remoteJid, { text });
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
        const pn = await socket()?.signalRepository?.lidMapping?.getPNForLID(jid);
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
        const store = (socket() as any)?.signalRepository?.contact;
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
    const sock = socket();
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
    return isBotOnline();
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
        const pn = await socket()?.signalRepository?.lidMapping?.getPNForLID(jid);
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
    const loja = lojaDoChamador();
    const conexao = registroDeLojas().get(loja);
    if (conexao?.sock) {
        try {
            conexao.sock.ev.removeAllListeners('connection.update');
            await conexao.sock.end(undefined);
        } catch (error) {
            log.error('Erro ao encerrar socket anterior:', error);
        }
        conexao.sock = null;
    }
    // A trava e' solta aqui: sem isto o reconnect cairia na promessa do start anterior
    // e nao abriria socket nenhum, e o painel ficaria em "sincronizando" para sempre.
    if (conexao) conexao.abrindo = undefined;
    setConnection(loja, { phase: 'sincronizando', qr: null, qrIssuedAt: null, lastError: null });
    await startWhatsAppBot(loja);
}

/**
 * Desconecta de verdade e apaga os credenciais salvos, forcando um novo
 * pareamento do zero. Usado em "desconectar e parear outro numero".
 */
export async function logoutBot(): Promise<void> {
    const loja = lojaDoChamador();
    const conexao = registroDeLojas().get(loja);
    if (conexao?.sock) {
        try {
            await conexao.sock.ev.removeAllListeners('connection.update');
            await conexao.sock.logout();
        } catch (error) {
            log.error('Erro ao fazer logout do socket:', error);
        }
        conexao.sock = null;
    }
    // O socket vazia o creds, mas as chaves de sinal continuam no banco: sem isso a
    // proxima pareamentorases com o estado do numero que acabou de sair.
    await apagaSessao(loja).catch((error) => {
        log.error('Erro ao apagar a sessao do WhatsApp:', error);
    });
    setConnection(loja, {
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
 * apagaria a sessão e o proximo boot cairia no QR -- reinstalar o Windows e' legitimo.
 * `reconnectBot` seguraria o event loop. Devolve se havia socket.
 */
export async function desconectaBot(): Promise<boolean> {
    const conexao = registroDeLojas().get(lojaDoChamador());
    if (!conexao?.sock) return false;
    try {
        conexao.sock.ev.removeAllListeners('connection.update');
        await conexao.sock.end(undefined);
    } catch (error) {
        log.error('Erro ao fechar o socket do WhatsApp:', error);
    }
    conexao.sock = null;
    conexao.abrindo = undefined;
    return true;
}

/**
 * Fecha todos os sockets, um por loja. E' o desligamento: fechar so o da loja do
 * boot deixaria os demais Baileys abertos atoa, e o Baileys aberto no fim do
 * processo e' o que grava credencial pela metade.
 */
export async function desconectaTodosOsBots(): Promise<number> {
    let fechados = 0;
    for (const loja of registroDeLojas().keys()) {
        if (await comoLoja(loja, () => desconectaBot()).catch(() => false)) fechados++;
    }
    return fechados;
}
