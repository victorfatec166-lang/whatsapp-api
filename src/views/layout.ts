import { escapeHtml } from './html';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('layout');

// O union so lista o que existe hoje em TABS. Caixa, Clientes, Bot, Stats,
// Reports e System saíram da barra, e isTabId() so aceita o que esta em TABS,
//entao mantê-los aqui dava a impressao de que ainda dava para abrir ?tab=caixa
// e nao dava: LEGACY_TABS e' que resolve o link antigo, com redirecionamento.
export type TabId = 'home' | 'kanban' | 'pdv' | 'estoque' | 'calendario' | 'chat' | 'faturamento' | 'whatsapp' | 'marketplace' | 'config' | 'usuarios';

/**
 * Ordem da sidebar: o dia primeiro, o catalogo, os canais de terceiro, os
 * ajustes, e o dinheiro por ultimo.
 *
 * A mudanca maior aqui e' o grupo "Apps e conexoes". Marketplace vivia dentro de
 * Ajustes, ao lado de Configuracoes: sao coisas de naturezas diferentes. Uma e'
 * onde se credencia iFood e 99Food e se confere se os pedidos estao entrando; a
 * outra e' entrega, taxa e nome do negocio. Quem procurava o iFood passava por
 * "Configuracoes" e concluia que o canal nao existia.
 *
 * WhatsApp e Marketplace juntos fazem sentido por uma razao pratica: sao os
 * dois lugares onde este painel conversa com um sistema de fora. Vem depois do
 * catalogo e antes dos ajustes porque e' o que se configura uma vez e depois
 * esquece -- e e' tambem onde a pessoa precisa ir quando o pedido de fora nao
 * aparece, entao tem de ser facil de achar.
 *
 * Faturamento continua no fim: e' a unica aba que mostra dinheiro, e a ultima
 * por decisao, nao por ordem alfabetica.
 *
 * Os rotulos sao o que a pessoa le na tela, entao valem uma palavra a mais que
 * o nome interno do grupo: "Dia a dia" diz o que tem la dentro, "Operacao" so
 * nomeia a categoria.
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
     * A ordem dentro de "Dia a dia" e' o caminho do expediente, nao o alphabetico.
     *
     * Acorda no Inicio, cai nos Pedidos que chegaram, atende no WhatsApp, vende
     * no balcao, e so entao olha o Calendario para o dia seguinte. Quem procura
     * "Conversas" na posicao em que ela estava, depois de Calendario, passava
     * pelo Calendario inteiro sem ver -- e a tela que se usa o dia inteiro ficava
     * embaixo da que se abre uma vez por semana.
     */
    { id: 'home', group: 'dia', label: 'Inicio', icon: 'fa-solid fa-house', hint: 'Resumo do dia e atalhos' },
    { id: 'kanban', group: 'dia', label: 'Pedidos', icon: 'fa-solid fa-chart-pie', hint: 'Gestao de pedidos em tempo real' },
    { id: 'chat', group: 'dia', label: 'Conversas', icon: 'fa-solid fa-comments', hint: 'Atender pelo WhatsApp' },
    { id: 'pdv', group: 'dia', label: 'PDV', icon: 'fa-solid fa-cash-register', hint: 'Vender no balcao' },
    { id: 'calendario', group: 'dia', label: 'Calendario', icon: 'fa-solid fa-calendar-days', hint: 'Pedidos por dia' },

    /*
     * Catalogo tem grupo proprio porque e' um trabalho diferente do dia a dia:
     * quem monta o cardapio nao esta vendendo, e misturar as duas coisas faz a
     * lista do dia ter nove itens em vez de cinco.
     *
     * O rotulo e' "Estoque" e nao "Produtos e Estoque" porque o grupo acima ja
     * diz Catalogo. E' o mesmo nome que a aba ja usava na tela, entao nao cria
     * duas palavras para a mesma coisa.
     */
    { id: 'estoque', group: 'catalogo', label: 'Estoque', icon: 'fa-solid fa-boxes-stacked', hint: 'Catalogo, saldos e reposicao' },

    /*
     * Os dois canais de fora, juntos e no mesmo grupo.
     *
     * Marketplace saiu de Ajustes: e' onde se credencia iFood e 99Food e se
     * confere se os pedidos estao entrando, nao um ajuste do negocio. Fica
     * depois do catalogo porque o canal vende exatamente o que esta no catalogo
     * -- quem vai la costuma estar resolvendo "esse item sumiu do iFood", e as
     * duas abas precisam estar perto uma da outra.
     */
    { id: 'whatsapp', group: 'apps', label: 'WhatsApp', icon: 'fa-brands fa-whatsapp', hint: 'Conexao e textos do bot' },
    { id: 'marketplace', group: 'apps', label: 'iFood e 99Food', icon: 'fa-solid fa-store', hint: 'Marketplace: credenciar e conferir pedidos' },

    { id: 'config', group: 'ajustes', label: 'Configuracoes', icon: 'fa-solid fa-gear', hint: 'Entrega e negocio' },

    /*
     * Quem entra no painel, no mesmo grupo das configuracoes.
     *
     * A conta e' uma configuracao do negocio, nao uma aba de uso diario: quem
     * gerencia e' o dono, e uma vez por trimestre. Ficar no fim do grupo, logo
     * antes do dinheiro, e' o que a mantem longe do caminho de quem so esta
     * vendendo.
     */
    { id: 'usuarios', group: 'ajustes', label: 'Usuarios', icon: 'fa-solid fa-user-shield', hint: 'Quem pode entrar no painel' },

    // Um item so: resumo, caixa, clientes e pedidos vivem em sub-abas aqui.
    { id: 'faturamento', group: 'dinheiro', label: 'Faturamento', icon: 'fa-solid fa-chart-column', hint: 'Receita, caixa, clientes e pedidos' },
];

/**
 * Itens que sairam da sidebar e para onde vao.
 *
 * IsTabId() so aceita o que esta em TABS, entao um ?tab=antigo deixaria de
 * funcionar silenciosamente. Mapeamos para o destino real em vez disso.
 * O "#" aponta a sub-aba que a tela antiga virava.
 */
/**
 * Itens que sairam da sidebar e para onde vao.
 *
 * IsTabId() so aceita o que esta em TABS, entao um ?tab=antigo deixaria de
 * funcionar silenciosamente. Mapeamos para o destino real em vez disso.
 *
 * O destino ja vem como caminho pronto, e nao como "aba + subaba": as
 * sub-abas do Faturamento se escolhem por ?aba=, que e' o mesmo mecanismo que
 * o servidor usa para desenhar a tela certa ja no HTML. Um #caixa tambem
 * funcionaria, mas entao teriamos dois jeitos de escolher a mesma sub-aba e o
 * proximo bug seria um deles deixar de ser lido.
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
                    // Aplica o tema salvo antes da primeira pintura para evitar
                    // "flash" do tema errado ao carregar a pagina.
                    //
                    // A estrategia darkMode: 'class' e definida em tailwind.config.js,
                    // na hora do build -- nao aqui. Uma atribuicao a "tailwind.config"
                    // neste ponto (sobra da versao que usava o CDN) lancava
                    // ReferenceError e abortava o script antes de ler o localStorage,
                    // o que fazia o tema escuro voltar ao claro a cada troca de aba.
                    (function () {
                        try {
                            var saved = localStorage.getItem('theme');
                            var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                            if (saved === 'dark' || (!saved && prefersDark)) {
                                document.documentElement.classList.add('dark');
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
                    var barra = document.getElementById('sidebar');
                    var guardar = document.getElementById('sidebarToggle');
                    var abrir = document.getElementById('sidebarAbrir');
                    if (!barra || !guardar || !abrir) return;

                    if (aberta) {
                        barra.classList.remove('hidden');
                        guardar.classList.remove('hidden');
                        abrir.classList.add('hidden');
                        guardar.setAttribute('aria-expanded', 'true');
                    } else {
                        barra.classList.add('hidden');
                        guardar.classList.add('hidden');
                        abrir.classList.remove('hidden');
                        guardar.setAttribute('aria-expanded', 'false');
                    }
                    try { localStorage.setItem('sidebarAberta', aberta ? '1' : '0'); } catch (e) {}
                }
                function alternaSidebar() {
                    var barra = document.getElementById('sidebar');
                    if (!barra) return;
                    aplicaSidebar(barra.classList.contains('hidden'));
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

                // Aplica assim que o corpo existe. Este script fica no <head>, e
                // o id da barra so aparece depois do corpo -- sem o guard, a
                // preferencia era perdida a cada recarga, que e' pior do que
                // nao ter preferencia nenhuma.
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

                    // O foco volta para o botao que abriu a janela quando ela
                    // fechar. Guardar aqui, e nao em modalHide, porque o
                    // activeElement no momento de fechar ja' e' o botao da
                    // propria janela. Sem isso, quem opera o teclado perde o
                    // lugar e precisa pegar o mouse de novo.
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
                // Fica aqui, e' nao no corpo da pagina: modalBind depende de
                // postJSON e flash, que sao daqui. Se a janela declarasse o
                // proprio bloco de script no corpo, a ordem entre os dois
                // seria o que decide se o botao funciona -- e ja foi uma
                // janela que nao abria por causa disso.
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
     * A barra lateral recolhivel, e o botao circular na borda dela.
     *
     * A barra vive dentro de um container de largura ZERO, com o painel
     * absoluto dentro dele. Quando ela recolhe, o container continua medindo
     * zero e a coluna de conteudo ocupa a tela inteira -- que e' o motivo de
     * recolher em tela grande: no balcao, a area util e' o catalogo e o
     * carrinho, nao a lista de abas.
     *
     * O botao e' circular e fica na VERTICAL, na borda da barra. Circular
     * porque ele precisa parecer um controle flutuante e nao uma coluna: a
     * versao anterior era uma faixa de altura inteira com o rotulo escrito
     * dentro, e o resultado era uma segunda coluna estreita disputando espaco
     * com a primeira -- mais uma coisa para olhar, do lado esquerdo, onde
     * comeca o conteudo.
     *
     * Sao dois botoes, e nao um que muda de estado. O que fecha fica sobre a
     * borda da barra aberta; o que abre fica na borda esquerda do conteudo,
     * no lugar onde a barra estava. Um botao so esconderia o rotulo e o icone
     * no espaco vazio, e um espaco vazio nao sugere que a barra pode voltar.
     *
     * As classes `rail*` sao do CSS, e nao do Tailwind: ver o comentario de
     * `.rail-btn` em `styles/app.css` para o porque de o `hidden` precisar
     * ser uma regra nossa.
     */
    return `                    <div class="rail hidden md:block">
                        <aside id="sidebar" class="rail-painel bg-surface border-r line">
                            <a href="/admin" title="Ir para o inicio" class="h-16 px-4 flex items-center gap-2.5 border-b line text-body font-bold tracking-tight hover:bg-surface-2 transition">
                                <i class="fa-solid fa-burger text-accent"></i>
                                <span class="truncate">${escapeHtml(businessName)}</span>
                            </a>
                            <nav class="flex-1 px-3 pb-3 overflow-y-auto">
${blocks}
                            </nav>
                            <div class="px-3 py-3 border-t line">
                                <span class="badge ${botOnline ? 'badge-success' : 'badge-danger'}">
                                    <span class="w-1 h-1 rounded-full bg-current"></span>
                                    Bot ${botOnline ? 'online' : 'offline'}
                                </span>
                            </div>
                        </aside>

                        <button type="button" id="sidebarToggle" onclick="alternaSidebar()"
                            class="rail-btn rail-btn--fechar"
                            aria-controls="sidebar" aria-expanded="true" title="Recolher a barra de abas"
                            aria-label="Recolher a barra de abas">
                            <i id="sidebarToggleIcon" class="fa-solid fa-angles-left text-xs"></i>
                        </button>

                        <button type="button" id="sidebarAbrir" onclick="abreSidebar()"
                            class="rail-btn rail-btn--abrir hidden"
                            aria-controls="sidebar" aria-expanded="false" title="Mostrar a barra de abas"
                            aria-label="Mostrar a barra de abas">
                            <i class="fa-solid fa-bars text-xs"></i>
                        </button>
                    </div>

                    <!-- Navegacao mobile -->
                    <div class="md:hidden bg-surface border-b border-line px-4 py-3 flex items-center justify-between gap-3">
                        <a href="/admin" class="font-bold flex items-center gap-2 shrink-0">
                            <i class="fa-solid fa-burger text-accent"></i>
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
    return `<!DOCTYPE html>
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
    <!--
        O CSRF da sessao, para o JavaScript do painel.

        Vai em meta e nao em variavel global de propósito: um script solto no
        corpo colocaria o token num lugar que o "ver fonte" mostra e que entra em
        print de tela. Com a meta, ele continua no HTML -- o que muda e' o tanto
        que aparece: so o valor, e so no cabecalho que a tela precisa ler.

        O cookie sozinho resolveria o caso comum (SameSite Lax barra o site de
        terceiro). A meta cobre o que o cookie nao cobre: a mesma origem em outra
        aba, e um subdominio sob controle de alguem. Os dois juntos fecham.
    -->
    <meta name="csrf" content="${escapeHtml(opts.csrf ?? '')}">
</head>
<body>
    <!--
        O painel e' um app de altura fixa, nao um documento.

        h-screen overflow-hidden no container, e min-h-0 na coluna de conteudo.
        A diferenca nao e' estetica: e' o que garante que a barra de abas e o
        cabecalho fiquem parados enquanto a pessoa mexe na lista de pedidos. Com
        min-h-screen e overflow-y-auto na coluna, tudo que for mais alto que a
        tela empurra o cabecalho para fora -- e o cabecalho e' onde esta o sino,
        que e' justamente o aviso que chega enquanto a pessoa esta no meio da
        tela.

        E' por isso que cada aba precisa declarar onde a rolagem acontece: a
        regiao que cresce com os dados leva flex-1, min-h-0 e overflow-y-auto.
        Sem o min-h-0 no meio do caminho, o flex nao encolhe -- o item prefere a
        altura do conteudo, e a coluna volta a crescer.
    -->
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

                    <!--
                        O sino.

                        Antes o aviso de pedido novo era um numero em duas abas da
                        barra lateral, e nenhum aviso de estoque, canal ou
                        lembrete existia fora da Home. Um numero dentro de uma aba
                        que a pessoa nao esta olhando nao avisa de nada: e' uma
                        informacao escondida em um lugar que so e' visto quando a
                        pessoa ja esta pensando no assunto.

                        O sino fica no topo e em todas as telas, porque a coisa de
                        que ele avisa acontece em qualquer aba -- o pedido chega
                        pelo WhatsApp enquanto a pessoa esta no Faturamento.
                    -->
                    <div class="relative">
                        <button type="button" id="sinoBtn" onclick="alternaPainel()" class="btn btn-ghost px-2 relative"
                            aria-haspopup="true" aria-expanded="false" aria-controls="painelAvisos"
                            title="Avisos">
                            <i class="fa-solid fa-bell"></i>
                            <span id="sinoContador"
                                class="hidden absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-accent-red text-white text-[10px] font-bold leading-4 text-center"></span>
                        </button>

                        <!--
                            O painel.

                            absolute em vez de modal: quem le um aviso quer sair
                            de onde esta, e um fundo que escurece a tela inteira
                            transformaria a leitura em duas telas. Fechar e' o
                            botao de novo e o clique fora -- padrao de menu, e o
                            que a pessoa ja espera.

                            O hidden do pai controla o painel inteiro; o id
                            fica no container, e nao em cada linha, para o
                            aria-controls apontar para uma coisa so.
                        -->
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

            <!--
                A regiao de conteudo e' ela propria a rolar, e nao a pagina.

                A coluna de fora e' h-screen, entao o documento nao cresce e o
                cabecalho fica parado. Aqui dentro, o conteudo que for mais alto
                que a tela rola sozinho.

                Isso e' uma rede de seguranca, e nao o destino. O destino e' cada
                aba caber: e' por isso que as listas recebem teto em
                calc(100vh - ...) e nao em rem. Sem esta rede, uma aba que
                estourasse o limite esconderia o conteiroso de baixo em vez de
                mostrar -- que e' o que aconteceu quando o limite chegou antes da
                hora. Nada pode ficar inacessivel; o que ainda sobra e' o que a
                regiao interna absorve.
            -->
            <main class="flex-1 min-h-0 w-full max-w-content mx-auto px-4 md:px-8 py-5 md:py-8 overflow-y-auto">
                <div id="flash" class="hidden"></div>
${opts.body}
            </main>
        </div>
    </div>
${opts.scripts ? `<script>${opts.scripts}</script>` : ''}
    <script>${APP_SCRIPTS}    </script>
</body>
</html>`;
}
