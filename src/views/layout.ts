import { escapeHtml, semComentarios } from './html';
import { iconeDaAba, tileDaMarca } from './marca';
import { logDoModulo } from '../services/logger';
import { barraCliente } from './barraCliente';
const log = logDoModulo('layout');

// O union so lista o que existe hoje em TABS: isTabId() so aceita o que esta em TABS, entao
// manter Caixa, Clientes, Bot, Stats, Reports e System aqui dava a impressao de que ainda
// dava para abrir ?tab=caixa, e nao dava. LEGACY_TABS e' que resolve o link antigo.
export type TabId = 'home' | 'kanban' | 'pdv' | 'estoque' | 'calendario' | 'faturamento' | 'whatsapp' | 'marketplace' | 'config' | 'usuarios';

/**
 * O grupo "Apps e conexoes" nasceu porque Marketplace vivia dentro de Ajustes: quem procurava o
 * iFood passava por "Configuracoes" e concluia que o canal nao existia. Os dois canais vem
 * depois do catalogo, e Faturamento no fim -- e' a unica aba que mostra dinheiro.
 */
export const TAB_GROUPS = [
    { id: 'dia', label: 'Dia a dia' },
    { id: 'catalogo', label: 'Catalogo' },
    { id: 'apps', label: 'Apps e conexoes' },
    { id: 'ajustes', label: 'Ajustes' },
    { id: 'dinheiro', label: 'Dinheiro' },
] as const;

export type TabGroupId = (typeof TAB_GROUPS)[number]['id'];

export const TABS: Array<{ id: TabId; group: TabGroupId; label: string; icon: string; hint: string }> = [
    /*
     * A ordem e' o caminho do expediente, nao o alfabetico: acorda no Inicio, cai nos Pedidos,
     * vende no balcao, e so entao olha o Calendario.
     */
    { id: 'home', group: 'dia', label: 'Inicio', icon: 'fa-solid fa-house', hint: 'Resumo do dia e atalhos' },
    { id: 'kanban', group: 'dia', label: 'Pedidos', icon: 'fa-solid fa-chart-pie', hint: 'Gestao de pedidos em tempo real' },
    { id: 'pdv', group: 'dia', label: 'PDV', icon: 'fa-solid fa-cash-register', hint: 'Vender no balcao' },
    { id: 'calendario', group: 'dia', label: 'Calendario', icon: 'fa-solid fa-calendar-day', hint: 'Pedidos por dia' },

    /*
     * Grupo proprio porque quem monta o cardapio nao esta vendendo, e misturar as duas coisas
     * faz a lista do dia ter nove itens em vez de cinco. O rotulo e' "Estoque" porque o grupo
     * acima ja diz Catalogo: duas palavras para a mesma coisa nao.
     */
    { id: 'estoque', group: 'catalogo', label: 'Estoque', icon: 'fa-solid fa-boxes-stacked', hint: 'Catalogo, saldos e reposicao' },

    /*
     * Marketplace saiu de Ajustes: e' onde se credencia os canais e se confere se os pedidos
     * estao entrando, nao um ajuste do negocio. Fica depois do catalogo porque quem vai la
     * costuma estar resolvendo "esse item sumiu do iFood".
     */
    { id: 'marketplace', group: 'apps', label: 'iFood e 99Food', icon: 'fa-solid fa-store', hint: 'Marketplace: credenciar e conferir pedidos' },

    { id: 'config', group: 'ajustes', label: 'Configuracoes', icon: 'fa-solid fa-gear', hint: 'Entrega e negocio' },

    /*
     * Saiu de "Apps e conexoes" e virou "Bot": o pareamento ja e' do cliente de
     * desktop, entao o que sobra aqui sao os textos do cliente -- e isso e' ajuste
     * do negocio, nao conexao.
     */
    { id: 'whatsapp', group: 'ajustes', label: 'Bot', icon: 'fa-solid fa-comment-dots', hint: 'Textos que o cliente recebe' },

    /*
     * A conta e' configuracao do negocio, nao aba de uso diario: quem gerencia e' o dono, uma
     * vez por trimestre. Ficar no fim do grupo, logo antes do dinheiro, e' o que a mantem longe
     * do caminho de quem so esta vendendo.
     */
    { id: 'usuarios', group: 'ajustes', label: 'Usuarios', icon: 'fa-solid fa-user-shield', hint: 'Quem pode entrar no painel' },

    // Um item so: resumo, caixa, clientes e pedidos vivem em sub-abas aqui.
    { id: 'faturamento', group: 'dinheiro', label: 'Faturamento', icon: 'fa-solid fa-chart-column', hint: 'Receita, caixa, clientes e pedidos' },
];

/**
 * IsTabId() so aceita o que esta em TABS, entao um ?tab=antigo deixaria de funcionar em
 * silencio: mapeamos para o destino real. O caminho ja vem pronto, e nao como "aba + subaba" --
 * dois jeitos de escolher a mesma sub-aba, e o proximo bug seria um deles parar de ser lido.
 */
export const LEGACY_TABS: Record<string, string> = {
    bot: '/admin?tab=whatsapp#textos-bot',
    stats: '/admin?tab=faturamento&aba=resumo',
    reports: '/admin?tab=faturamento&aba=pedidos',
    caixa: '/admin?tab=faturamento&aba=caixa',
    clientes: '/admin?tab=faturamento&aba=clientes',
    // O catalogo saiu do PDV e virou aba de Produtos e Estoque.
    products: '/admin?tab=estoque',
    system: '/admin?tab=config',
};

export function isTabId(v: unknown): v is TabId {
    return typeof v === 'string' && TABS.some((t) => t.id === v);
}

export function tabHint(id: TabId): string {
    return TABS.find((t) => t.id === id)?.hint ?? '';
}

const HEAD_SCRIPTS = `
                    // Aplica o tema salvo antes da primeira pintura para nao piscar o
                    // tema errado. darkMode: 'class' e' definida em tailwind.config.js,
                    // no build: a sobra da versao com CDN lancava ReferenceError aqui.
                    (function () {
                        try {
                            var saved = localStorage.getItem('theme');
                            var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                            if (saved === 'dark' || (!saved && prefersDark)) {
                                document.documentElement.classList.add('dark');
                            }
                        } catch (e) {}
                    })();

                    /*
                     * O mesmo para a barra de abas, e pelo mesmo motivo.
                     *
                     * Marcar a classe aqui e' o que tira o tremor na troca de aba: o
                     * HTML nasce com a barra escondida e so abria no DOMContentLoaded,
                     * entao quem tinha a barra recolhida via 0 -> 240px DEPOIS da
                     * primeira pintura. Toda troca de aba sacudia a tela.
                     */
                    (function () {
                        try {
                            if (localStorage.getItem('sidebarAberta') === '0') {
                                document.documentElement.classList.add('rail-fechada');
                            }
                        } catch (e) {}
                    })();
`;

const APP_SCRIPTS = `
                // ---- Status do bot (polling) ----
                async function fetchBotStatus() {
                    try {
                        const res = await fetch('/api/bot-status');
                        const data = await res.json();
                        const dot = document.getElementById('botStatusDot');
                        const text = document.getElementById('botStatusText');
                        const box = document.getElementById('botStatus');
                        if (!dot || !text || !box) return;
                        if (data.online) {
                            dot.className = 'w-2 h-2 rounded-full bg-success animate-pulse';
                            text.textContent = 'Bot online';
                            box.className = 'badge badge-success';
                        } else {
                            dot.className = 'w-2 h-2 rounded-full bg-danger';
                            text.textContent = 'Bot offline';
                            box.className = 'badge badge-danger';
                        }
                    } catch (e) {
                        log.error('Erro ao buscar status do bot:', e);
                    }
                }
                setInterval(fetchBotStatus, 5000);
                fetchBotStatus();

                // ---- Tema claro/escuro ----
                function applyTheme(isDark) {
                    document.documentElement.classList.toggle('dark', isDark);
                    var icon = document.getElementById('themeIcon');
                    if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
                    var btn = document.getElementById('themeToggle');
                    if (btn) btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
                }
                function toggleTheme() {
                    var isDark = !document.documentElement.classList.contains('dark');
                    applyTheme(isDark);
                    try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch (e) {}
                }
                applyTheme(document.documentElement.classList.contains('dark'));

                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
                    var saved = null;
                    try { saved = localStorage.getItem('theme'); } catch (err) {}
                    if (!saved) applyTheme(e.matches);
                });
                window.addEventListener('storage', function (e) {
                    if (e.key === 'theme') applyTheme(e.newValue === 'dark');
                });

                // ---- Utilitarios compartilhados ----
                /*
                 * Recolher e trazer de volta a barra de abas.
                 *
                 * Duas pecas em vez de uma, e o motivo esta no comentario do
                 * HTML: o botao que guarda fica na cola da barra, e o que traz
                 * de volta fica no lugar onde ela estava. Um botao so, que
                 * muda de estado, esconderia o rotulo e o icone no lugar
                 * vazio -- e no lugar vazio nao ha nada que sugira que a barra
                 * pode voltar.
                 *
                 * O estado vai para o localStorage pelo mesmo motivo do tema e
                 * da aba de estoque: preferencia que se perde a cada F5 faz o
                 * botao parar de servir para o que foi criado.
                 */
                function aplicaSidebar(aberta) {
                    var rail = document.getElementById('rail');
                    var guardar = document.getElementById('sidebarToggle');
                    var abrir = document.getElementById('sidebarAbrir');
                    if (!rail || !guardar || !abrir) return;

                    /*
                     * Quem manda na largura e' a classe do elemento html, decidida no
                     * head. O hidden do rail fica de fora de proposito: mexer nele
                     * aqui seria o salto de pixels que a classe do head evita.
                     */
                    if (aberta) {
                        guardar.classList.remove('hidden');
                        abrir.classList.add('hidden');
                        guardar.setAttribute('aria-expanded', 'true');
                        document.documentElement.classList.remove('rail-fechada');
                    } else {
                        guardar.classList.add('hidden');
                        abrir.classList.remove('hidden');
                        guardar.setAttribute('aria-expanded', 'false');
                        document.documentElement.classList.add('rail-fechada');
                    }
                    try { localStorage.setItem('sidebarAberta', aberta ? '1' : '0'); } catch (e) {}
                }
                function alternaSidebar() {
                    aplicaSidebar(document.documentElement.classList.contains('rail-fechada'));
                }

                function abreSidebar() {
                    aplicaSidebar(true);
                }

                // ---- Sino de avisos ----
                /*
                 * Carrega, mostra e esconde. Sem framework, sem estado global:
                 * o painel inteiro cabe em tres funcoes, e o que importa aqui e'
                 * que uma delas NAO exista -- ver o comentario do SSE.
                 */
                var TOM_COR = { vermelho: 'badge-danger', ambar: 'badge-warn', verde: 'badge-success', info: 'badge-slate' };
                var TOM_LINHA = { vermelho: 'border-accent-red', ambar: 'border-accent-orange', verde: 'border-accent-emerald', info: 'border-line' };

                /*
                 * O texto do aviso vem do servidor e pode ser o nome de qualquer
                 * cliente, produto ou lembrete -- ou seja, texto que o usuario
                 * digitado. Por isso entra por textContent e nunca por
                 * innerHTML: um lembrete com "<img onerror=...>" no meio
                 * executaria no painel de quem clicasse no sino.
                 */
                function desenhaAviso(item) {
                    var li = document.createElement('a');
                    li.href = item.href;
                    li.className = 'flex items-start gap-3 px-5 py-3 border-b border-line border-l-2 ' + (TOM_LINHA[item.tom] || TOM_LINHA.info) + ' row-hover';

                    var corpo = document.createElement('div');
                    corpo.className = 'min-w-0 flex-1';

                    var titulo = document.createElement('p');
                    titulo.className = 'text-body font-medium text-ink';
                    titulo.textContent = item.titulo;
                    corpo.appendChild(titulo);

                    var detalhe = document.createElement('p');
                    detalhe.className = 'text-caption text-ink-3';
                    detalhe.textContent = item.detalhe;
                    corpo.appendChild(detalhe);

                    li.appendChild(corpo);

                    var cta = document.createElement('span');
                    cta.className = 'badge shrink-0 ' + (TOM_COR[item.tom] || TOM_COR.info);
                    cta.textContent = item.cta;
                    li.appendChild(cta);

                    return li;
                }

                function aplicaPainel(dados) {
                    var lista = document.getElementById('painelLista');
                    var contador = document.getElementById('sinoContador');
                    if (!lista) return;

                    lista.textContent = '';
                    if (!dados.itens || dados.itens.length === 0) {
                        var vazio = document.createElement('p');
                        vazio.className = 'text-body text-ink-3 card-pad flex items-center gap-2';
                        vazio.textContent = 'Nada precisando de atencao.';
                        lista.appendChild(vazio);
                    } else {
                        // DocumentFragment: 20 anexos seguidos, em vez de 20
                        // repinturas da lista inteira.
                        var frag = document.createDocumentFragment();
                        for (var i = 0; i < dados.itens.length; i++) frag.appendChild(desenhaAviso(dados.itens[i]));
                        lista.appendChild(frag);
                    }

                    if (contador) {
                        if (dados.total > 0) {
                            contador.textContent = dados.total > 9 ? '9+' : String(dados.total);
                            contador.classList.remove('hidden');
                        } else {
                            contador.classList.add('hidden');
                        }
                    }
                }

                function carregaPainel() {
                    fetch('/api/notificacoes')
                        .then(function (r) { return r.ok ? r.json() : null; })
                        .then(aplicaPainel)
                        .catch(function () {});
                }

                function alternaPainel() {
                    var p = document.getElementById('painelAvisos');
                    var b = document.getElementById('sinoBtn');
                    if (!p) return;
                    var abrindo = p.classList.contains('hidden');
                    p.classList.toggle('hidden', !abrindo);
                    if (b) b.setAttribute('aria-expanded', String(abrindo));
                    if (abrindo) carregaPainel();
                }

                function fechaPainel(event) {
                    var p = document.getElementById('painelAvisos');
                    if (!p || p.classList.contains('hidden')) return;
                    // So fecha no clique fora. O evento chega em todos os
                    // cliques, e um "closest" no sino deixaria o painel sem
                    // de fechar por ele mesmo.
                    var dentro = p.contains(event.target) || (event.target.closest && event.target.closest('#sinoBtn'));
                    if (!dentro) {
                        p.classList.add('hidden');
                        var b = document.getElementById('sinoBtn');
                        if (b) b.setAttribute('aria-expanded', 'false');
                    }
                }

                // Sincroniza os botoes e o aria-expanded. A largura ja foi decidida no head
                // (classe rail-fechada), entao aqui nao ha mais salto de pixels --
                // o que sobra e' o estado acessivel dos dois botoes.
                document.addEventListener('DOMContentLoaded', function () {
                    var aberta = true;
                    try {
                        aberta = localStorage.getItem('sidebarAberta') !== '0';
                    } catch (e) {}
                    aplicaSidebar(aberta);
                });

                /*
                 * Confirmacao dentro do painel, e nao o confirm() do navegador.
                 *
                 * O dialogo do navegador era o unico lugar do sistema que nao
                 * parecia com o resto: fundo cinza do sistema operacional, botao
                 * "OK" sem nome, e o titulo "localhost:3000 diz" -- o nome do
                 * endereco no lugar de uma frase que diz o que vai acontecer. A
                 * acao mais destrutiva do sistema aparecia com a aparencia de um
                 * aviso de antivirus.
                 *
                 * A janela e' criada na hora, e nao declarada na tela, porque
                 * confirmThen e' chamado de paginas diferentes. Um esqueleto
                 * reaproveitado em vez de um por tela: e' o mesmo caminho que o
                 * renderModal faz do outro lado, so que em tempo de execucao.
                 *
                 * Tres detalhes que o dialogo do navegador nao tem e que aqui
                 * importam:
                 *
                 * 1. O foco vai para CANCELAR, nao para confirmar. No dialogo do
                 *    sistema, quem aperta Enter sem olhar apaga a sessao do
                 *    WhatsApp. Aqui o Enter nao faz nada, e quem quiser apagar
                 *    precisa clicar em "Apagar" -- um movimento deliberado.
                 * 2. Esc e o clique fora cancelam SEM rodar a acao. Sao os
                 *    mesmos ouvintes das outras janelas, e o modalHide abaixo
                 *    cuida de limpar o que ficou pendente.
                 * 3. O texto entra por textContent, nunca por innerHTML. A
                 *    frase costuma trazer nome de produto e nome de cliente, que
                 *    vem do banco -- e a tela do WhatsApp ja morreu uma vez
                 *    inteira por causa de um apostrofo interpolado em JS.
                 */
                var confirmarPendente = null;
                /** Botao que abriu a janela, para devolver o foco no fim. */
                var confirmarOrigem = null;

                function confirmarMonta() {
                    var existente = document.getElementById('confirmarJanela');
                    if (existente) return existente;

                    var div = document.createElement('div');
                    div.id = 'confirmarJanela';
                    div.className = 'modal-backdrop hidden';
                    div.setAttribute('role', 'dialog');
                    div.setAttribute('aria-modal', 'true');
                    div.setAttribute('aria-labelledby', 'confirmarJanela-titulo');
                    div.setAttribute('aria-describedby', 'confirmarJanela-texto');
                    div.innerHTML =
                        '<div class="modal-panel">' +
                        '  <div class="flex items-start justify-between gap-3 mb-1">' +
                        '    <h3 id="confirmarJanela-titulo" class="text-title flex items-center gap-2">' +
                        '      <i class="fa-solid fa-triangle-exclamation text-accent-orange"></i>' +
                        '      <span id="confirmarJanela-tituloTexto"></span>' +
                        '    </h3>' +
                        '    <button type="button" data-modal-cancel onclick="confirmarCancelar()" ' +
                        '      class="btn btn-ghost px-2 -mt-1 -mr-1 shrink-0" aria-label="Fechar">' +
                        '      <i class="fa-solid fa-xmark"></i>' +
                        '    </button>' +
                        '  </div>' +
                        '  <p id="confirmarJanela-texto" class="text-body text-ink-2 mb-5"></p>' +
                        '  <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">' +
                        '    <button type="button" data-modal-cancel onclick="confirmarCancelar()" ' +
                        '      id="confirmarJanela-cancelar" class="btn btn-ghost sm:min-w-[8rem]" autofocus>Cancelar</button>' +
                        '    <button type="button" onclick="confirmarAceitar()" ' +
                        '      id="confirmarJanela-aceitar" class="btn btn-danger sm:min-w-[9rem]">Confirmar</button>' +
                        '  </div>' +
                        '</div>';
                    document.body.appendChild(div);
                    return div;
                }

                /**
                 * opcoes aceita titulo e os rotulos dos botoes. O padrao e'
                 * "Tem certeza?" e um botao chamado "Confirmar": quando a acao
                 * e' destrutiva, quem chama passa um verbo -- "Apagar", "Descartar"
                 * -- porque o botao e' a ultima leitura antes do clique, e
                 * "Confirmar" nao diz o que esta sendo confirmado.
                 */
                function confirmThen(texto, fn, opcoes) {
                    var o = opcoes || {};
                    var janela = confirmarMonta();

                    // Confirmar duas vezes em linha nao empilha duas janelas: a
                    // segunda substitui a mensagem e a acao da primeira.
                    confirmarPendente = fn;

                    // O foco volta para o botao que abriu a janela. Guardar aqui, e
                    // nao em modalHide, porque o activeElement no momento de fechar ja
                    // e' o botao da propria janela.
                    var ativo = document.activeElement;
                    confirmarOrigem = ativo && ativo !== document.body ? ativo : null;

                    document.getElementById('confirmarJanela-tituloTexto').textContent = o.titulo || 'Tem certeza?';
                    document.getElementById('confirmarJanela-texto').textContent = texto;
                    document.getElementById('confirmarJanela-aceitar').textContent = o.confirmar || 'Confirmar';
                    document.getElementById('confirmarJanela-cancelar').textContent = o.cancelar || 'Cancelar';
                    modalShow('confirmarJanela');
                }

                /** Cancelar e' o caminho que NUNCA roda a acao. */
                function confirmarCancelar() {
                    confirmarPendente = null;
                    modalHide('confirmarJanela');
                    devolverFocoConfirmar();
                }

                function confirmarAceitar() {
                    var fn = confirmarPendente;
                    confirmarPendente = null;
                    modalHide('confirmarJanela');
                    devolverFocoConfirmar();
                    if (fn) fn();
                }

                function devolverFocoConfirmar() {
                    if (confirmarOrigem && document.contains(confirmarOrigem)) {
                        try { confirmarOrigem.focus(); } catch (e) {}
                    }
                    confirmarOrigem = null;
                }

                /*
                 * Toda escrita leva o token do CSRF.
                 *
                 * Esta e' a UNICA funcao que faz POST no painel inteiro, e o
                 * token entra aqui e nao em cada chamada. Se entrasse em cada
                 * uma, bastaria uma rota nova esquecer e ficar aceitando
                 * formulario de fora -- que e' a falha classica de CSRF, e ela
                 * nao aparece em teste nenhum, porque o teste tambem manda o
                 * token.
                 *
                 * O token vem da meta csrf do <head>. O cookie sozinho seria
                 * quase suficiente (SameSite Lax barra o caso comum), mas a meta
                 * cobre o que o cookie nao cobre: mesma origem em outra aba, e
                 * subdominio sob controle de alguem.
                 */
                function csrfDoPainel() {
                    var meta = document.querySelector('meta[name="csrf"]');
                    return meta ? meta.content : '';
                }

                /*
                 * Pagina velha: o token do CSRF nao bate com o cookie.
                 *
                 * O token viaja no HTML. Se o navegador mostrar uma copia antiga
                 * desse HTML -- guardada de quando o painel ainda nao tinha senha,
                 * ou de antes de uma troca de sessao em outra aba -- a meta leva
                 * um token velho e TODA gravacao volta 403, com a tela dizendo
                 * "Recarregue a pagina". A pessoa recarrega, funciona, e a proxima
                 * aba velha falha igual: o defeito fica na mao dela, sem solucao.
                 *
                 * Por que repetir depois de recarregar e' seguro: o exigeCsrf
                 * e' middleware e roda ANTES do handler, entao o 403 garante que
                 * aquele pedido NAO aconteceu no servidor. Nao ha metade de
                 * gravacao para duplicar -- o que havia era recusar a tela e
                 * perder o clique de quem apertou "Assumir" ou "Salvar".
                 */
                var CHAVE_RETRY = 'da_pendente';
                var CHAVE_TENTATIVAS = 'da_csrf_tentativas';

                async function postJSON(url, body, aviso) {
                    const dados = body === undefined || body === null ? body : Object.assign({}, body, { csrf: csrfDoPainel() });
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: dados === undefined ? undefined : JSON.stringify(dados)
                    });
                    let parsed = {};
                    try { parsed = await res.json(); } catch (e) {}

                    // Recarga bem-sucedida: o contador volta a zero, porque a
                    // pagina nova esta com o token certo de novo.
                    if (res.ok) {
                        try { sessionStorage.removeItem(CHAVE_TENTATIVAS); } catch (e) {}
                    } else if (res.status === 403 && parsed && parsed.error) {
                        var tentativas = 0;
                        try { tentativas = Number(sessionStorage.getItem(CHAVE_TENTATIVAS) || 0); } catch (e) {}
                        // Duas tentativas e' o limite. A terceira seria a
                        // recarregar a tela para sempre, que e' a versão
                        // irritante do mesmo problema.
                        if (tentativas < 2) {
                            try {
                                sessionStorage.setItem(CHAVE_TENTATIVAS, String(tentativas + 1));
                                sessionStorage.setItem(CHAVE_RETRY, JSON.stringify({ url: url, body: body, aviso: aviso }));
                            } catch (e) {}
                            location.reload();
                            return { ok: false, status: 403, data: parsed };
                        }
                    }

                    /*
                     * Sessao vencida no meio do uso.
                     *
                     * A tela fica aberta o dia inteiro, e a sessao dura 12 horas.
                     * Apos isso, a proxima acao leva 401 e a pessoa ve "Nao foi
                     * possivel salvar" -- que e' mentira: salvou, so que em outra
                     * sessao. Levar para o login, levando o caminho de onde a
                     * pessoa estava, e' a saida honesta.
                     */
                    if (res.status === 401 && parsed && parsed.sessaoExpirada) {
                        location.href = '/entrar?destino=' + encodeURIComponent(location.pathname + location.search);
                        return { ok: false, status: 401, data: parsed };
                    }

                    return { ok: res.ok, status: res.status, data: parsed };
                }

                /**
                 * Repete o que sobrou da pagina velha, depois do recarregamento.
                 *
                 * A pendencia e lida e APAGADA antes da repeticao: se o
                 * servidor recusar de novo, o postJSON desta pagina ve o
                 * contador e nao entra em recarga infinita.
                 *
                 * O que repetir pode ter mudado de pagina -- quem salvou estava
                 * no Calendario e pode ter aberto outra aba. Por isso a repeticao
                 * avisa em um evento, e nao desenha nada: quem quiser atualizar a
                 * tela escuta painel:replay e recarrega a parte dele.
                 */
                function csrfRepetePendente() {
                    var bruto;
                    try { bruto = sessionStorage.getItem(CHAVE_RETRY); } catch (e) { return; }
                    if (!bruto) return;
                    try { sessionStorage.removeItem(CHAVE_RETRY); } catch (e) {}

                    var p;
                    try { p = JSON.parse(bruto); } catch (e) { return; }
                    if (!p || !p.url) return;

                    postJSON(p.url, p.body, p.aviso).then(function (r) {
                        if (r.ok && p.aviso) flash('ok', p.aviso);
                        document.dispatchEvent(new CustomEvent('painel:replay', { detail: { url: p.url, ok: r.ok, data: r.data } }));
                    });
                }

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', csrfRepetePendente);
                } else {
                    csrfRepetePendente();
                }
                function flash(kind, message) {
                    var box = document.getElementById('flash');
                    if (!box) return;
                    box.className = 'mb-4 px-4 py-3 rounded-card text-small font-medium border ' +
                        (kind === 'ok' ? 'badge-success' : 'badge-danger');
                    box.textContent = message;
                    box.classList.remove('hidden');
                }

                // ---- Janelas pop-up ----
                // Fica aqui, e' nao no corpo: modalBind depende de postJSON e flash,
                // que sao daqui. No corpo, a ordem entre os scripts decide o botao.
                function modalShow(id) {
                    var m = document.getElementById(id);
                    if (!m) return;
                    m.classList.remove('hidden');
                    m.classList.add('flex');
                    var foco = m.querySelector('[autofocus]');
                    if (foco) foco.focus();
                }

                function modalHide(id) {
                    var m = document.getElementById(id);
                    if (!m) return;
                    m.classList.add('hidden');
                    m.classList.remove('flex');
                    /*
                     * Fechar a confirmacao por Esc ou clique fora e' cancelar.
                     *
                     * Esses dois caminhos vem pelo modalHide, e nao por
                     * confirmarCancelar -- entao sem esta linha a acao ficaria
                     * pendente na memoria depois de uma janela que a pessoa ja
                     * fechou. Nao chegaria a rodar, porque o botao esta escondido,
                     * mas "esconder o botao" e' seguranca por acaso, e nao e' o
                     * que a pessoa quis dizer quando apertou Esc.
                     */
                    if (id === 'confirmarJanela') {
                        confirmarPendente = null;
                        devolverFocoConfirmar();
                    }
                }

                // Clique fora do painel tambem fecha.
                document.addEventListener('click', function (ev) {
                    var alvo = ev.target;
                    if (!alvo || !alvo.classList) return;
                    if (!alvo.classList.contains('modal-backdrop')) return;
                    var painel = alvo.querySelector('.modal-panel');
                    if (painel && painel.contains(ev.target)) return;
                    modalHide(alvo.id);
                });

                // Esc fecha a janela do topo.
                document.addEventListener('keydown', function (ev) {
                    if (ev.key !== 'Escape') return;

                    // O sino antes das janelas: ele e' um menu, nao uma janela, e
                    // Esc num menu fecha o menu -- nao a janela que estava aberta
                    // atras dele.
                    var avisos = document.getElementById('painelAvisos');
                    if (avisos && !avisos.classList.contains('hidden')) {
                        avisos.classList.add('hidden');
                        var sino = document.getElementById('sinoBtn');
                        if (sino) sino.setAttribute('aria-expanded', 'false');
                        return;
                    }

                    var abertas = [].slice.call(document.querySelectorAll('.modal-backdrop.flex'));
                    var topo = abertas[abertas.length - 1];
                    if (topo) modalHide(topo.id);
                });

                /*
                 * O sino recarrega sozinho.
                 *
                 * O painel ja tem SSE, e a tentacao e' empurrar cada evento pelo
                 * mesmo canal. Nao fiz: os eventos nao dizem o QUE mudou, entao o
                 * painel teria que remontar as cinco fontes a cada pedido, tres
                 * vezes por hora, para dar o mesmo numero. E o custo e' invisivel
                 * ate virar o motivo de o servidor ficar lento.
                 *
                 * A solucao e' simples: consultar na abertura e de tempos em
                 * tempos, e nao a cada evento. O numero do sino passa a estar
                 * certo em um minuto -- tempo humano irrelevante para "chegou
                 * pedido novo" -- e o painel fica com o custo de uma consulta a
                 * cada sessenta segundos.
                 *
                 * O intervalo nao roda com a aba escondida: quem deixa a aba
                 * aberta no fundo nao precisa de numero atualizado, e o
                 * visibilitychange devolve o sino em dia quando a pessoa volta.
                 */
                (function sinoPeriodico() {
                    var Minutos = 60000;
                    carregaPainel();
                    setInterval(function () {
                        if (!document.hidden) carregaPainel();
                    }, Minutos);

                    document.addEventListener('visibilitychange', function () {
                        if (!document.hidden) carregaPainel();
                    });
                })();

                // Clique fora fecha o sino. Delegado no documento, e nao no sino,
                // porque o clique fora do botao e' justamente o que fecha.
                document.addEventListener('click', fechaPainel);

                /**
                 * Liga uma janela gerada por renderModal() ao comportamento
                 * acima. Deriva os nomes de id, entao duas janelas nao conflitam
                 * e nenhuma delas precisa de Javascript proprio.
                 */
                function modalBind(id, endpoint, pendingLabel, successMessage, after) {
                    window[id + 'Open'] = function () { modalShow(id); };
                    window[id + 'Close'] = function () { modalHide(id); };
                    window[id + 'Send'] = async function (ev) {
                        if (ev) ev.preventDefault();
                        var form = document.getElementById(id + '-form');
                        var btn = document.getElementById(id + '-submit');
                        if (!form || !btn) return false;

                        // Campo numerico volta como texto no value; converte.
                        var payload = {};
                        [].slice.call(form.elements).forEach(function (el) {
                            if (!el.name) return;
                            var v = el.value;
                            if (el.type === 'number') v = v === '' ? 0 : parseFloat(v);
                            payload[el.name] = v;
                        });

                        btn.disabled = true;
                        var original = btn.innerHTML;
                        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (pendingLabel || 'Salvando...');

                        var r = await postJSON(endpoint, payload);
                        btn.disabled = false;
                        btn.innerHTML = original;

                        if (!r.ok) {
                            flash('err', (r.data && r.data.error) || 'Nao foi possivel salvar.');
                            return false;
                        }

                        form.reset();
                        modalHide(id);
                        flash('ok', successMessage);
                        if (after && typeof window[after] === 'function') window[after](r, id);
                        return false;
                    };
                }
`;

function sidebar(active: TabId, counters: Partial<Record<TabId, number>>, botOnline: boolean, businessName: string): string {
    const blocks = TAB_GROUPS.map((group) => {
        const items = TABS.filter((t) => t.group === group.id)
            .map((t) => {
                const isActive = t.id === active;
                const count = counters[t.id];
                const label = count === undefined ? t.label : `${t.label} (${count})`;

                // Sinaliza na propria sidebar quando o WhatsApp precisa de atencao.
                const alertDot =
                    t.id === 'whatsapp' && !botOnline
                        ? '<span class="ml-auto w-1.5 h-1.5 rounded-full bg-danger shrink-0" title="Bot desconectado"></span>'
                        : '';

                return `                            <a href="/admin?tab=${t.id}" title="${t.hint}" aria-current="${isActive ? 'page' : 'false'}"
                                class="nav-item ${isActive ? 'nav-item-active' : ''}">
                                <i class="${t.icon} nav-item-icon"></i>
                                <span class="truncate">${escapeHtml(label)}</span>
                                ${alertDot}
                            </a>`;
            })
            .join('\n');

        return `                            <p class="nav-group">${escapeHtml(group.label)}</p>
${items}`;
    }).join('\n');

    const mobileOptions = TAB_GROUPS.map((group) => {
        const options = TABS.filter((t) => t.group === group.id)
            .map((t) => `<option value="${t.id}"${t.id === active ? ' selected' : ''}>${escapeHtml(t.label)}</option>`)
            .join('');
        return `<optgroup label="${escapeHtml(group.label)}">${options}</optgroup>`;
    }).join('');

/*
 * O HTML nasce com a barra ABERTA, e quem esta recolhido e' marcado pela classe
 * rail-fechada no elemento html. Antes nascia com hidden e abria no
 * DOMContentLoaded: quem tinha a barra aberta tremia a cada troca de aba.
 */
    return `                    <div class="rail md:block" id="rail">
                        <aside id="sidebar" class="rail-painel bg-surface border-r line">
                            <a href="/admin" title="Ir para o inicio" class="h-16 px-4 flex items-center gap-2.5 border-b line text-body font-bold tracking-tight hover:bg-surface-2 transition">
                                ${tileDaMarca(32)}
                                <span class="truncate">${escapeHtml(businessName)}</span>
                            </a>
                            <nav class="flex-1 px-3 pb-3 overflow-y-auto">
${blocks}
                            </nav>
                            <div class="px-3 py-3 border-t line space-y-2.5">
                                <span class="badge ${botOnline ? 'badge-success' : 'badge-danger'}">
                                    <span class="w-1 h-1 rounded-full bg-current"></span>
                                    Bot ${botOnline ? 'online' : 'offline'}
                                </span>
                                ${barraCliente({ compacto: true })}
                            </div>
                        </aside>

                        <button type="button" id="sidebarToggle" onclick="alternaSidebar()"
                            class="rail-btn rail-btn--fechar"
                            aria-controls="sidebar" aria-expanded="true" title="Recolher a barra de abas"
                            aria-label="Recolher a barra de abas">
                            <i id="sidebarToggleIcon" class="fa-solid fa-angles-left text-xs"></i>
                        </button>
                    </div>

                    <button type="button" id="sidebarAbrir" onclick="abreSidebar()"
                        class="rail-btn rail-btn--abrir hidden"
                        aria-controls="sidebar" aria-expanded="false" title="Mostrar a barra de abas"
                        aria-label="Mostrar a barra de abas">
                        <i class="fa-solid fa-bars text-xs"></i>
                    </button>


                    <div class="md:hidden bg-surface border-b border-line px-4 py-3 flex items-center justify-between gap-3">
                        <a href="/admin" class="font-bold flex items-center gap-2 shrink-0">
                            ${tileDaMarca(28)}
                            <span class="truncate">${escapeHtml(businessName)}</span>
                        </a>
                        <select id="mobileNav" class="input py-1.5 max-w-[58%]" onchange="location.href='/admin?tab=' + this.value">
                            ${mobileOptions}
                        </select>
                    </div>`;
}

export type LayoutOptions = {
    active: TabId;
    title: string;
    productCount: number;
    botOnline: boolean;
    /** Nome do negocio exibido no logo e no titulo da aba. */
    businessName: string;
    /** Contadores exibidos entre parenteses na sidebar. */
    counters?: Partial<Record<TabId, number>>;
    /** Quem esta comecando. Ausente so em paginas publicas, que nao usam o layout. */
    sessao?: { nome: string; email: string; papel: string };
    /** Token do CSRF, para o JavaScript do painel mandar nas rotas de escrita. */
    csrf?: string;
    body: string;
    /** Scripts extras de uma aba especifica. */
    scripts?: string;
};

export function renderLayout(opts: LayoutOptions): string {
    return semComentarios(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(opts.title)} | ${escapeHtml(opts.businessName)}</title>
    <script>${HEAD_SCRIPTS}    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="/styles/app.css">
    ${iconeDaAba()}

    <meta name="csrf" content="${escapeHtml(opts.csrf ?? '')}">
</head>
<body>

    <div class="flex h-screen overflow-hidden">
${sidebar(opts.active, opts.counters ?? { pdv: opts.productCount }, opts.botOnline, opts.businessName)}

        <div class="flex-1 flex flex-col min-w-0 min-h-0">
            <header class="bg-surface h-14 md:h-16 shrink-0 flex items-center justify-between gap-4 px-4 md:px-8 border-b border-line z-20">
                <h1 class="text-title truncate">${opts.title}</h1>
                <div class="flex items-center gap-2 shrink-0">
                    <span id="botStatus" class="badge hidden sm:inline-flex">
                        <span id="botStatusDot" class="w-2 h-2 rounded-full"></span>
                        <span id="botStatusText">Verificando...</span>
                    </span>


                    <div class="relative">
                        <button type="button" id="sinoBtn" onclick="alternaPainel()" class="btn btn-ghost px-2 relative"
                            aria-haspopup="true" aria-expanded="false" aria-controls="painelAvisos"
                            title="Avisos">
                            <i class="fa-solid fa-bell"></i>
                            <span id="sinoContador"
                                class="hidden absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-accent-red text-white text-[10px] font-bold leading-4 text-center"></span>
                        </button>


                        <div id="painelAvisos" class="hidden absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] panel z-30">
                            <div class="card-pad pb-2 flex items-center justify-between gap-2 border-b border-line">
                                <h2 class="text-title">Avisos</h2>
                                <button type="button" onclick="alternaPainel()" class="btn btn-ghost px-2" aria-label="Fechar avisos">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                            <div id="painelLista" class="max-h-96 overflow-y-auto">
                                <p class="text-body text-ink-3 card-pad">Carregando...</p>
                            </div>
                        </div>
                    </div>

                    <div class="flex items-center gap-2 shrink-0">
                    ${opts.sessao
                        ? `<a href="/sair" class="btn btn-ghost btn-sm" title="Encerrar a sessao neste navegador">
                            <i class="fa-solid fa-arrow-right-from-bracket"></i>
                            <span class="hidden sm:inline">Sair</span>
                        </a>`
                        : ''}
                    <a href="/admin" class="btn btn-ghost btn-sm" title="Atualizar">
                        <i class="fa-solid fa-rotate"></i>
                        <span class="hidden sm:inline">Atualizar</span>
                    </a>
                    <button
                        id="themeToggle"
                        type="button"
                        onclick="toggleTheme()"
                        class="btn btn-ghost px-2"
                        title="Alternar tema claro/escuro"
                        aria-label="Alternar tema claro/escuro"
                    >
                        <i id="themeIcon" class="fa-solid fa-moon"></i>
                    </button>
                </div>
            </header>


            <main class="flex-1 min-h-0 w-full max-w-content mx-auto px-4 md:px-8 py-5 md:py-8 overflow-y-auto">
                <div id="flash" class="hidden"></div>
${opts.body}
            </main>
        </div>
    </div>
${opts.scripts ? `<script>${opts.scripts}</script>` : ''}
    <script>${APP_SCRIPTS}    </script>
</body>
</html>`);;
}
