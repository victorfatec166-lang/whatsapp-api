import { escapeHtml } from './html';
import { renderModal } from './ui/modal';
import { statusLabel } from '../services/stats';
import type { ResumoConversa } from '../services/chat';

/**
 * Tela de conversas do WhatsApp.
 *
 * Lista e historico lado a lado, porque a pergunta do atendente e' sempre a
 * mesma: "o que este cliente esta querendo?". Responder olhando a lista e
 * abrindo outra tela nao funciona -- o contexto do atendimento e' a sequencia,
 * nao a ultima mensagem.
 *
 * A tela assume a conversa quando o campo de resposta recebe foco, e devolve ao
 * botao na barra. O motivo do automatico esta em chatRoutes: quem atende ja
 * escreveu meia resposta e so percebe depois que o bot respondeu por cima.
 */

export type MensagemView = {
    id: string;
    from: string;
    text: string;
    sentAt: string;
    falhou: boolean;
};

export type ChatData = {
    conversas: ResumoConversa[];
    /** Total de nao lidas, para o aviso no topo. */
    naoLidas: number;
    botOnline: boolean;
};

/*
 * Aceita Date e string porque os dois aparecem na tela: a lista vem do servidor
 * com Date, e o historico chega por JSON com texto ISO. Converter no lugar de
 * usar, em vez de `new Date` em todo lugar, evita a data invalida silenciosa
 * quando algum dos dois muda.
 */
function hora(iso: Date | string): string {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hoje = new Date();
    const mesmoDia = d.toDateString() === hoje.toDateString();
    return mesmoDia
        ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Iniciais para o avatar de texto, quando nao ha foto do cliente. */
function iniciais(nome: string | null, telefone: string): string {
    const base = (nome ?? '').trim();
    if (!base) return telefone.slice(-2);
    const partes = base.split(/\s+/).filter(Boolean);
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Avatar: a foto do cliente, ou as iniciais.
 *
 * A foto vem do WhatsApp e esta guardada no banco. A URL tem validade curta e
 * pode expirar com a lista na tela, entao o <img> marcado com
 * `data-avatar-fallback` troca para as iniciais por um listener delegado, no
 * script da aba. Nao ha `onerror` aqui pelo mesmo motivo: atributo com aspas
 * aninhadas dentro de string dentro de template literal e' exatamente onde o
 * script da aba ja quebrou uma vez. Ver a nota do listener.
 *
 * O pior caso e' o circulo voltar para o texto -- que e' o que ja funcionava
 * antes de existir foto nenhuma.
 */
function avatar(c: { avatarUrl: string | null; name: string | null; telefone: string }, tamanho: string): string {
    /*
     * `base` sao as CLASSES, sem o `class="`.
     *
     * A primeira versao desta funcao tinha `class="` dentro da variavel e ainda
     * embrulhava o resultado em outro `class="`, o que produzia
     * `class="class=" w-9="" h-9=""...`. O HTML fica malformado, o navegador
     * descarta os atributos sobrando e reconstroi o <botao> de forma diferente
     * da esperada -- que e' como a lista de conversas deixou de responder ao
     * clique. Nao da para ver isso olhando a tela: o item continua pintado,
     * parece certo, e so o clique morre.
     */
    const base = `${tamanho} rounded-full object-cover shrink-0 bg-surface-2 border line text-ink-2 text-xs font-bold flex items-center justify-center`;
    const letras = escapeHtml(iniciais(c.name, c.telefone || '00'));

    if (c.avatarUrl) {
        return `<span class="${tamanho} rounded-full overflow-hidden shrink-0 border line">
                    <img src="${escapeHtml(c.avatarUrl)}" alt="" class="w-full h-full object-cover" data-avatar-fallback>
                    <span class="${base} hidden">${letras}</span>
                </span>`;
    }
    return `<span class="${base}">${letras}</span>`;
}

/**
 * Como o cliente aparece na lista e no cabecalho.
 *
 * A ordem e' nome, telefone, endereco -- e nao o contrario. Quem opera o painel
 * reconhece a pessoa pelo nome que salvou no contato do WhatsApp; o numero vem
 * para quem nunca foi salvo, onde nao existe nome nenhum. Mostrar o numero de
 * quem tem nome obrigaria a pessoa a traduzir o numero em nome a cada mensagem.
 *
 * O endereco do WhatsApp -- o "192...@lid" -- so aparece como ultimo recurso, e
 * marcado, porque nao e' telefone de ninguem e a pessoa precisa saber disso para
 * nao tentar ligar para ele.
 */
function rotulo(c: { name: string | null; telefone: string; rotulo: string; semTelefone: boolean }): string {
    if (c.name) return c.name;
    if (!c.semTelefone) return c.telefone;
    return c.rotulo;
}

function conversaItem(c: ResumoConversa): string {
    const naoLidas = c.naoLidas > 0;
    return `            <button type="button" data-chat="${escapeHtml(c.id)}"
                    class="w-full text-left px-4 py-3 border-b border-line row-hover ${naoLidas ? 'bg-surface-2' : ''}">
                <div class="flex items-start gap-3">
                    ${avatar(c, 'w-9 h-9')}
                    <div class="min-w-0 flex-1">
                        <div class="flex items-baseline gap-2">
                            <span class="text-body font-semibold text-ink truncate">${escapeHtml(rotulo(c))}</span>
                            <span class="text-caption text-ink-3 ml-auto shrink-0">${hora(c.lastMessageAt)}</span>
                        </div>
                        <p class="text-caption text-ink-3 truncate">${escapeHtml(c.ultimaMensagem || 'sem mensagens')}</p>
                        <div class="flex items-center gap-2 mt-1">
                            ${
                                c.assumido
                                    ? '<span class="badge badge-info badge-xs">Voce</span>'
                                    : '<span class="badge badge-neutral badge-xs">Bot</span>'
                            }
                            ${
                                c.semTelefone && !c.name
                                    ? '<span class="badge badge-warn badge-xs" title="O WhatsApp nao entregou o numero deste cliente">sem numero</span>'
                                    : ''
                            }
                            ${
                                naoLidas
                                    ? `<span class="badge badge-danger badge-xs font-bold ml-auto">${c.naoLidas}</span>`
                                    : ''
                            }
                        </div>
                    </div>
                </div>
            </button>`;
}

function mensagem(m: MensagemView): string {
    const doCliente = m.from === 'cliente';
    return `                    <div data-msg="${escapeHtml(m.sentAt)}" class="flex ${doCliente ? 'justify-start' : 'justify-end'}">
                        <div class="max-w-[80%] ${doCliente ? '' : 'items-end'}">
                            <div class="px-3 py-2 rounded-card text-sm border ${
                                doCliente
                                    ? 'bg-surface-2 border-line text-ink'
                                    : 'bg-accent text-white border-transparent'
                            }">
                                ${escapeHtml(m.text).replace(/\n/g, '<br>')}
                            </div>
                            <p class="text-[10px] text-ink-3 mt-0.5 ${doCliente ? '' : 'text-right'}">
                                ${hora(m.sentAt)}${
                                    !doCliente
                                        ? ` &middot; ${m.from === 'atendente' ? 'pelo painel' : 'bot'}`
                                        : ''
                                }${m.falhou ? ' &middot; <span class="accent-red">nao saiu</span>' : ''}
                            </p>
                        </div>
                    </div>`;
}

export function renderChat(d: ChatData): string {
    /*
     * Aviso do bot desconectado fica no topo da tela e nao e' detalhe de rodape.
     * Sem o socket, nada sai desta tela: a pessoa digita, o historico mostra
     * "nao saiu" em cada mensagem, e ela pode nao ligar as duas coisas.
     */
    const avisoOffline = d.botOnline
        ? ''
        : `        <div class="flex items-start gap-2 text-caption text-ink-2 bg-surface-2 border line rounded-card p-3 mb-4">
            <i class="fa-solid fa-triangle-exclamation text-accent-red mt-0.5 shrink-0"></i>
            <span>
                O WhatsApp esta <strong>desconectado</strong>. As mensagens desta tela nao serao entregues
                ate reconectar em <a href="/admin?tab=whatsapp" class="underline">WhatsApp</a>.
            </span>
        </div>`;

    return `${avisoOffline}
        <!--
            Conversas com altura de tela, e nao 34 rem fixos.

            A lista e' a coluna esquerda e a conversa aberta e' a direita, lado a
            lado. As duas tinham altura escrita no atributo style, 34 rem e 26
            rem, o que funciona na tela de desenvolvimento e estoura na de
            1366x768 -- que e' onde a pessoa atende cliente de pe, com o celular
            na mao e o tempo curto. A coluna da conversa ainda tinha de caber o
            cabecalho do contato, a lista de mensagens e a caixa de resposta.

            Agora a regiao que cresce e' so a lista de mensagens, e o limite vem
            da tela: o card inteiro ocupa o que sobra da altura visivel, e
            cabecalho e caixa de resposta ficam sempre visiveis. Quem esta
            escrevendo nao perde de vista o contato nem o botao de enviar.
        -->
        <div class="card overflow-hidden flex-1 min-h-0 flex flex-col max-h-[calc(100vh-9rem)]">
            <div class="grid grid-cols-1 md:grid-cols-[20rem_1fr] flex-1 min-h-0">
                <!-- Lista -->
                <div class="border-b md:border-b-0 md:border-r border-line flex flex-col min-h-0">
                    <div class="p-3 border-b border-line shrink-0">
                        <input type="search" id="chatBusca" placeholder="Buscar por nome ou telefone"
                               class="input" oninput="chatBuscar(this.value)" autocomplete="off">
                    </div>
                    <div id="chatLista" class="flex-1 min-h-0 overflow-y-auto">
${d.conversas.length === 0 ? '                        <p class="text-caption text-ink-3 p-4 text-center">Nenhuma conversa ainda. As mensagens do WhatsApp aparecem aqui.</p>' : d.conversas.map(conversaItem).join('\n')}
                    </div>
                </div>

                <!-- Conversa aberta -->
                <div id="chatPainel" class="flex flex-col min-h-0">
                    <div class="flex-1 flex items-center justify-center p-8 text-center">
                        <div>
                            <i class="fa-solid fa-comments text-3xl text-ink-3 mb-3"></i>
                            <p class="text-body text-ink-2">Escolha uma conversa</p>
                            <p class="text-caption text-ink-3 mt-1">
                                Ao abrir, o bot para de responder sozinho nesta conversa.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            /*
             * Estado da tela, tudo no navegador.
             *
             * A lista vem do servidor no HTML e as trocas de conversa vao por
             * fetch. Nao recarrega a pagina nunca: recarregar jogaria fora o que
             * a pessoa esta digitando no campo, que e' exatamente o que se
             * escreve nessa tela.
             */
            var CHAT_ABERTA = null;
            var CHAT_BUSCA = '';

            function esc(v) {
                return String(v === null || v === undefined ? '' : v)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            }

            function chatHora(iso) {
                var d = new Date(iso);
                var hoje = new Date();
                if (d.toDateString() === hoje.toDateString()) {
                    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                }
                return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            }

            function chatIniciais(c) {
                var base = (c.name || '').trim();
                var telefone = c.telefone || '00';
                if (!base) return telefone.slice(-2);
                var partes = base.split(/\\s+/).filter(Boolean);
                if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
                return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
            }

            /*
             * Avatar no navegador, com o mesmo desenho do servidor.
             *
             * O onerror cobre a URL expirada: sem ele, a foto quebrada deixa
             * um retangulo vazio. Como as iniciais estao por baixo, o pior caso
             * e' o circulo voltar a ser o texto.
             */
            function chatAvatar(c, tamanho) {
                // As CLASSES, sem o atributo class= -- embrulhar de novo produz
                // class="class=..." e o botao da lista deixa de responder ao
                // clique. Ver a mesma nota em avatar(), no servidor.
                var base = tamanho + ' rounded-full object-cover shrink-0 bg-surface-2 border line text-ink-2 text-xs font-bold flex items-center justify-center';
                var letras = esc(chatIniciais(c));
                if (c.avatarUrl) {
                    return '<span class="' + tamanho + ' rounded-full overflow-hidden shrink-0 border line">' +
                        '<img src="' + esc(c.avatarUrl) + '" alt="" class="w-full h-full object-cover" data-avatar-fallback>' +
                        '<span class="' + base + ' hidden">' + letras + '</span></span>';
                }
                return '<span class="' + base + '">' + letras + '</span>';
            }

            /** Nome, ou telefone de verdade, ou o endereco marcado. */
            function chatRotulo(c) {
                if (c.name) return c.name;
                if (!c.semTelefone) return c.telefone;
                return c.rotulo;
            }

            function chatItem(c) {
                var naoLidas = c.naoLidas > 0;
                return '<button type="button" data-chat="' + esc(c.id) + '"' +
                    ' class="w-full text-left px-4 py-3 border-b border-line row-hover ' + (naoLidas ? 'bg-surface-2' : '') +
                    (CHAT_ABERTA === c.id ? ' bg-surface-2' : '') + '">' +
                    '<div class="flex items-start gap-3">' +
                    chatAvatar(c, 'w-9 h-9') +
                    '<div class="min-w-0 flex-1">' +
                    '<div class="flex items-baseline gap-2">' +
                    '<span class="text-body font-semibold text-ink truncate">' + esc(chatRotulo(c)) + '</span>' +
                    '<span class="text-caption text-ink-3 ml-auto shrink-0">' + chatHora(c.lastMessageAt) + '</span></div>' +
                    '<p class="text-caption text-ink-3 truncate">' + esc(c.ultimaMensagem || 'sem mensagens') + '</p>' +
                    '<div class="flex items-center gap-2 mt-1">' +
                    (c.assumido
                        ? '<span class="badge badge-info badge-xs">Voce</span>'
                        : '<span class="badge badge-neutral badge-xs">Bot</span>') +
                    (c.semTelefone && !c.name
                        ? '<span class="badge badge-warn badge-xs" title="O WhatsApp nao entregou o numero deste cliente">sem numero</span>'
                        : '') +
                    (naoLidas ? '<span class="badge badge-danger badge-xs font-bold ml-auto">' + c.naoLidas + '</span>' : '') +
                    '</div></div></div></button>';
            }

            async function chatBuscar(termo) {
                CHAT_BUSCA = termo;
                var url = '/api/admin/chat' + (termo ? '?busca=' + encodeURIComponent(termo) : '');
                try {
                    var r = await fetch(url);
                    var dados = await r.json();
                    var lista = document.getElementById('chatLista');
                    if (!lista) return;
                    lista.innerHTML = dados.conversas.length === 0
                        ? '<p class="text-caption text-ink-3 p-4 text-center">Nenhuma conversa encontrada.</p>'
                        : dados.conversas.map(chatItem).join('');
                } catch (e) { log.error('Erro ao buscar conversas:', e); }
            }

            /** Recarrega so a lista: chamada quando chega mensagem nova. */
            async function chatAtualizaLista() {
                await chatBuscar(CHAT_BUSCA);
            }

            function chatMensagem(m) {
                var doCliente = m.from === 'cliente';
                // data-msg guarda o instante, e' o cursor da pagina anterior.
                return '<div data-msg="' + esc(m.sentAt) + '" class="flex ' + (doCliente ? 'justify-start' : 'justify-end') + '">' +
                    '<div class="max-w-[80%]">' +
                    '<div class="px-3 py-2 rounded-card text-sm border ' +
                    (doCliente ? 'bg-surface-2 border-line text-ink' : 'bg-accent text-white border-transparent') + '">' +
                    esc(m.text).replace(/\\n/g, '<br>') + '</div>' +
                    '<p class="text-[10px] text-ink-3 mt-0.5 ' + (doCliente ? '' : 'text-right') + '">' +
                    chatHora(m.sentAt) +
                    (!doCliente ? ' &middot; ' + (m.from === 'atendente' ? 'pelo painel' : 'bot') : '') +
                    (m.falhou ? ' &middot; <span class="accent-red">nao saiu</span>' : '') + '</p></div></div>';
            }

            async function chatAbrir(id) {
                CHAT_ABERTA = id;
                var painel = document.getElementById('chatPainel');
                painel.innerHTML = '<p class="text-caption text-ink-3 p-8 text-center">Abrindo...</p>';
                try {
                    var r = await fetch('/api/admin/chat/' + id);
                    var dados = await r.json();
                    if (!dados.conversa) { painel.innerHTML = '<p class="text-caption text-ink-3 p-8 text-center">Conversa nao encontrada.</p>'; return; }
                    chatDesenha(dados);
                    /*
                     * Abrir a conversa NAO e' assumir a conversa.
                     *
                     * Abrir e' olhar. Assumir e' dizer que um humano esta
                     * respondendo, e tem uma consequencia que nao aparece na
                     * tela: botPodeResponder cala o bot no WhatsApp ate
                     * alguem apertar "Devolver ao bot". Abrir e' o que a pessoa
                     * faz para LER -- e, no lado do cliente, o resultado era
                     * "oi" sem resposta nenhuma, com a tela mostrando "Bot
                     * atendendo" e ninguem entendendo o motivo.
                     *
                     * Quem assume e' quem escreve: o onfocus do campo faz
                     * isso, e essa parte continua igual, porque ai a intencao
                     * ja e' clara.
                     */
                    await postJSON('/api/admin/chat/' + id + '/lida');
                    await chatAtualizaLista();
                    // Conversa que chegou sem foto ou sem numero vem de antes de
                    // o app saber resolve-los, ou de um cliente que se mudou de
                    // conta. A busca e' em segundo plano: nao segura a abertura e
                    // so redesenha se trouxer algo.
                    if (!dados.conversa.avatarUrl || dados.conversa.semTelefone) {
                        setTimeout(function () { chatAtualizaContato(false); }, 400);
                    }
                } catch (e) {
                    log.error('Erro ao abrir conversa:', e);
                    painel.innerHTML = '<p class="text-caption text-ink-3 p-8 text-center">Erro ao carregar a conversa.</p>';
                }
            }

            function chatDesenha(dados) {
                var c = dados.conversa;
                var pedido = dados.pedido;

                /*
                 * Cabecalho: foto, nome e o telefone de verdade.
                 *
                 * O numero vem logo abaixo do nome e nao escondido em Tooltip,
                 * porque e' a primeira coisa que a pessoa procura quando o
                 * cliente diz o proprio nome: "qual o telefone dele?". E quando
                 * o WhatsApp nao entregou o numero, a tela diz isso em vez de
                 * mostrar o "192...@lid", que nao serve para ligar.
                 */
                var cabecalho =
                    '<div class="px-4 py-3 border-b border-line flex items-center gap-3 shrink-0">' +
                    chatAvatar(c, 'w-10 h-10') +
                    '<div class="min-w-0 flex-1">' +
                    '<p class="text-body font-semibold text-ink truncate">' + esc(chatRotulo(c)) + '</p>' +
                    (c.semTelefone
                        ? '<p class="text-caption text-ink-3" title="Identificador interno do WhatsApp, nao e um telefone">numero nao identificado &middot; ' + esc(c.rotulo) + '</p>'
                        : '<p class="text-caption text-ink-3">' + esc(c.telefone) + '</p>') +
                    /*
                     * A regra de retencao aparece no cabecalho, e nao em uma tela
                     * de ajuda. Quem abrir uma conversa e nao encontrar a de
                     * ontem precisa saber em um segundo se aquilo sumiu ou se a
                     * tela quebrou -- e a resposta esta aqui, sem precisar
                     * procurar.
                     */
                    '<p class="text-[11px] text-ink-3">Conversa guardada so para hoje</p>' +
                    '</div>' +
                    (c.assumido
                        ? '<button type="button" onclick="chatDevolver()" class="btn btn-ghost btn-sm">Devolver ao bot</button>'
                        : '<span class="badge badge-neutral">Bot atendendo</span>') +
                    '<button type="button" onclick="chatAtualizaContato()" class="btn btn-ghost btn-sm shrink-0" ' +
                    'title="Buscar a foto e o numero do cliente no WhatsApp">' +
                    '<i class="fa-solid fa-camera-retro"></i></button>' +
                    '</div>';

                var blocoPedido = pedido
                    ? '<div class="px-4 py-2 border-b border-line bg-surface-2 text-caption shrink-0">' +
                    '<span class="text-ink-3">Ultimo pedido:</span> ' +
                    '<span class="text-ink">' + esc(pedido.items) + '</span> &middot; ' +
                    '<span class="text-ink font-bold">R$ ' + Number(pedido.total).toFixed(2) + '</span> &middot; ' +
                    '<span class="text-ink-3">' + esc(statusLabel(pedido.status)) + '</span></div>'
                    : '';


                var corpo = '<div id="chatMensagens" class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">' +
                    (dados.temMais
                        ? '<div class="text-center pb-1"><button type="button" onclick="chatMaisAntigas()" ' +
                          'class="btn btn-ghost btn-sm"><i class="fa-solid fa-chevron-up"></i> Ver mais antigo</button></div>'
                        : '') +
                    (dados.mensagens.length === 0
                        ? chatSemMensagens()
                        : dados.mensagens.map(chatMensagem).join('')) +
                    '</div>';

                /*
                 * O campoassume a conversa no foco, nao num botao. Ver
                 * chatRoutes: quem ja escreveu meia resposta nao pode descobrir
                 * que o bot respondeu por cima.
                 */
                var composer =
                    '<div class="border-t border-line p-3 shrink-0">' +
                    '<div class="flex items-end gap-2">' +
                    '<textarea id="chatTexto" rows="2" class="input flex-1 resize-none" placeholder="Escreva a resposta..." ' +
                    'onfocus="chatAssume()" onkeydown="chatTecla(event)"></textarea>' +
                    '<button type="button" id="chatEnviar" class="btn btn-primary shrink-0" onclick="chatManda()">' +
                    '<i class="fa-solid fa-paper-plane"></i> Enviar</button>' +
                    '</div>' +
                    '<p class="text-caption text-ink-3 mt-1.5">Enter envia, Shift+Enter quebra linha. ' +
                    'O bot para de responder nesta conversa assim que o campo recebe foco.</p>' +
                    '</div>';

                var painel = document.getElementById('chatPainel');
                /*
                 * O cabecalho e o campo de resposta ganham shrink-0: sem isso o
                 * flex encolhe o cabecalho do contato quando a conversa e' longa,
                 * e o nome some -- que e' justamente o que a pessoa precisa ler
                 * para saber com quem esta falando. A lista e' a unica parte que
                 * cede espaco.
                 */
                painel.innerHTML = cabecalho + blocoPedido + corpo + composer;
                chatRola();
            }

            /** Assume a conversa sem redesenhar a tela. */
            async function chatAssume() {
                if (!CHAT_ABERTA) return;
                if (window.__chatAssumido === CHAT_ABERTA) return;
                window.__chatAssumido = CHAT_ABERTA;
                try { await postJSON('/api/admin/chat/' + CHAT_ABERTA + '/assumir'); } catch (e) {}
            }

            async function chatDevolver() {
                if (!CHAT_ABERTA) return;
                window.__chatAssumido = null;
                var r = await postJSON('/api/admin/chat/' + CHAT_ABERTA + '/devolver');
                if (!r.ok) { flash('err', r.data.error || 'Erro ao devolver ao bot'); return; }
                flash('ok', 'O bot volta a responder esta conversa.');
                await chatAbrir(CHAT_ABERTA);
            }

            function chatTecla(ev) {
                if (ev.key !== 'Enter' || ev.shiftKey) return;
                ev.preventDefault();
                chatManda();
            }

            async function chatManda() {
                var campo = document.getElementById('chatTexto');
                if (!campo) return;
                var texto = campo.value.trim();
                if (!texto) return;
                var btn = document.getElementById('chatEnviar');
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                try {
                    var r = await postJSON('/api/admin/chat/' + CHAT_ABERTA + '/enviar', { texto: texto });
                    // So limpa quando saiu. Mensagem que nao foi entregue fica
                    // na caixa para a pessoa reenviar, em vez de sumir e
                    // parecer entregue.
                    if (r.ok) campo.value = '';
                    flash(r.ok ? 'ok' : 'err', r.data.aviso || (r.ok ? 'Mensagem enviada.' : 'Nao foi possivel enviar.'));
                    await chatAbrir(CHAT_ABERTA);
                } catch (e) {
                    flash('err', 'Erro de conexao');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar';
                }
            }

            /**
             * Foto e numero, sob demanda.
             *
             * A tela nunca espera isso: quem abre uma conversa sem foto nao
             * deveria ver um retangulo carregando. A busca acontece em segundo
             * plano e so redesenha se trouxe alguma coisa nova.
             */
            async function chatAtualizaContato(forcar) {
                if (!CHAT_ABERTA) return;
                try {
                    var r = await postJSON('/api/admin/chat/' + CHAT_ABERTA + '/atualizar-contato', { forcar: forcar === true });
                    var d = await fetch('/api/admin/chat/' + CHAT_ABERTA);
                    var dados = await d.json();
                    chatDesenha(dados);
                    await chatAtualizaLista();
                } catch (e) { log.error('Erro ao buscar foto e telefone:', e); }
            }

            function chatRola() {
                var caixa = document.getElementById('chatMensagens');
                if (caixa) caixa.scrollTop = caixa.scrollHeight;
            }

            /**
             * Carrega as mensagens mais antigas e põe em cima.
             *
             * A tela abre com as ultimas 100, que e' onde a conversa esta. Uma
             * conversa de 400 mensagens nao cabe: desenhar tudo deixava a tela
             * lenta e empurrava o texto para longe da conversa atual. As
             * antigas entram por cima, e a rolagem sobe junto -- senao a
             * conversa "pula" e a pessoa perde o lugar.
             */
            async function chatMaisAntigas() {
                var caixa = document.getElementById('chatMensagens');
                var primeira = caixa ? caixa.querySelector('[data-msg]') : null;
                if (!primeira) return;
                try {
                    var r = await fetch('/api/admin/chat/' + CHAT_ABERTA + '?antes=' + encodeURIComponent(primeira.getAttribute('data-msg')));
                    var d = await r.json();
                    if (!d.mensagens || d.mensagens.length === 0) return;
                    var antes = caixa.scrollHeight - caixa.scrollTop;
                    var botao = caixa.querySelector('button');
                    if (botao) botao.parentNode.removeChild(botao);
                    caixa.insertAdjacentHTML('afterbegin', d.mensagens.map(chatMensagem).join(''));
                    if (!d.temMais) {
                        caixa.insertAdjacentHTML('afterbegin',
                            '<div class="text-center py-2"><p class="text-caption text-ink-3">Inicio da conversa</p></div>');
                    }
                    caixa.scrollTop = caixa.scrollHeight - antes;
                } catch (e) { log.error('Erro ao carregar mensagens antigas:', e); }
            }

            /**
             * O que a tela diz quando nao ha mensagem nenhuma.
             *
             * "Sem mensagens ainda" seria mentira depois da virada do dia: as
             * mensagens existem, e a pessoa vai abrir a conversa de um cliente
             * que escreveu ontem e nao vai encontrar nada. Dizer o que
             * aconteceu e' o mesmo cuidado que a tela de Faturamento tem com a
             * receita que some no corte do periodo -- o que a tela esconde, ela
             * conta.
             *
             * O caso "nunca teve mensagem" e o mesmo na pratica: a conversa
             * nasce na primeira mensagem do cliente, entao uma conversa sem
             * mensagem nenhuma e' a que foi virada ou a que o cliente mandou
             * audio e foto, que o bot nao guarda.
             */
            function chatSemMensagens() {
                return '<p class="text-caption text-ink-3 text-center px-4">' +
                    'As mensagens ficam guardadas so para o dia de hoje. A conversa de ontem ja foi apagada.</p>';
            }

            /** Mensagem chegou. So atualiza a conversa que esta aberta. */
            async function chatEvento(dados) {
                await chatAtualizaLista();
                if (!CHAT_ABERTA || dados.chatId !== CHAT_ABERTA) return;
                try {
                    var r = await fetch('/api/admin/chat/' + CHAT_ABERTA);
                    var d = await r.json();
                    // Redesenhar o painel inteiro perderia o cursor do campo de
                    // texto, entao so a lista de mensagens e' trocada. Ver chatRola.
                    var corpo = document.getElementById('chatMensagens');
                    if (corpo && d.mensagens) {
                        corpo.innerHTML = d.mensagens.length === 0
                            ? chatSemMensagens()
                            : d.mensagens.map(chatMensagem).join('');
                        chatRola();
                    }
                } catch (e) { log.error('Erro ao atualizar conversa:', e); }
            }

            // Clique na lista. Delegado no container porque a lista e' redesenhada
            // a cada busca e a cada mensagem nova: ligar o handler em cada botao
            // se perderia a cada redesenho.
            document.getElementById('chatLista').addEventListener('click', function (ev) {
                var alvo = ev.target.closest('[data-chat]');
                if (alvo) chatAbrir(alvo.getAttribute('data-chat'));
            });

            /*
             * Foto que falhou ao carregar.
             *
             * Fica aqui, com captura, em vez de um onerror dentro da <img>. Sao
             * dois motivos, e o segundo e' o que quebrou:
             *
             * 1. A lista e' redesenhada o tempo todo, entao um handler preso em
             *    cada <img> morre a cada redesenho.
             * 2. O atributo onerror precisa de aspas aninhadas dentro de uma
             *    string que ja esta' dentro de um template literal do TypeScript.
             *    O barra-aspas que parece resolver vira aspas simples no HTML
             *    gerado e fecha a string mais cedo -- o script inteiro deixa de
             *    fazer parse e o clique na lista morre sem erro na tela.
             *
             * O evento "error" nao faz bubbling, entao o listener e' de captura no
             * document. E' a forma padrao de pegar erro de <img>.
             */
            document.addEventListener('error', function (ev) {
                var img = ev.target;
                if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-avatar-fallback')) return;
                img.style.display = 'none';
                var reserva = img.nextElementSibling;
                if (reserva) reserva.style.display = 'flex';
            }, true);

            // Mensagem nova chegando pelo SSE. O evento 'chat' traz o id da
            // conversa, para nao redesenhar a tela inteira a cada mensagem.
            var fonte = new EventSource('/admin/events');
            fonte.addEventListener('chat', function (ev) {
                try { chatEvento(JSON.parse(ev.data)); } catch (e) {}
            });
        </script>

${renderModal({
    id: 'chatAjudaModal',
    title: 'Como o bot e o atendente dividem a conversa',
    icon: 'fa-circle-info',
    description: 'A regra que evita o cliente receber as duas respostas ao mesmo tempo.',
    bodyHtml: `                <div class="space-y-3 text-body text-ink-2">
                    <p><strong>Bot.</strong> Responde sozinho ate alguem assumir a conversa. Ele cuida do cardapio, do
                    pedido e da consulta de status.</p>
                    <p><strong>Voce.</strong> Clicar no campo de resposta assume para o cliente: o bot cala
                    naquela conversa e nao nas outras. So isso -- <em>abrir</em> a conversa nao assume, porque
                    olhar nao e' responder, e assumir sem querer calava o bot do cliente sem ninguem ver.</p>
                    <p><strong>Devolver ao bot.</strong> O botao na barra da conversa faz o bot voltar a responder.
                    Use quando o cliente nao precisar mais de uma pessoa.</p>
                    <p><strong>Sem resposta dupla.</strong> A conversa fica assumida mesmo se o servidor reiniciar,
                    porque quem responde esta gravado no banco, e nao em memoria.</p>
                    <p><strong>Uma noite, e o dia vira.</strong> Na virada da meia-noite as mensagens de ontem
                    saem do sistema, junto com a conversa na lista -- o painel guarda o dia, nao o historico.
                    A conversa que <em>voc&ecirc; assumiu</em> continua na lista com o bot calado, para ninguem
                    receber resposta a noite; abra e use "Devolver ao bot" quando voltar a atender.</p>
                </div>`,
    submitLabel: 'Entendi',
    submitIcon: 'fa-check',
    noSubmit: true,
    onSubmit: 'chatAjudaModalClose()',
    endpoint: '',
    successMessage: '',
})}

        <script>
            document.addEventListener('DOMContentLoaded', function () {
                modalBind('chatAjudaModal', '', '', '', null);
            });
        </script>`;
}
