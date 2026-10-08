import { escapeHtml, semComentarios } from './html';
import { iconeDaAba, tileDaMarca } from './marca';

/*
 * A tela de administracao. Nao usa o `renderLayout` porque ele e' feito em volta da
 * LOJA -- sidebar e `exigeLoja` em cada consulta -- e herdar aquilo vaziaria a lista
 * de clientes pelo painel de um deles.
 */

export type LojaParaTela = {
    id: string;
    nome: string;
    estado: 'ativa' | 'desligada';
    assinatura: 'ativa' | 'pendente' | 'atrasada' | 'cancelada' | 'sem-assinatura';
    plano: string;
    valor: number;
    emailDono: string;
    testeAte: Date | null;
    diasDeTeste: number;
    ultimoPagamento: Date | null;
    criadoEm: Date;
    produtos: number;
    pedidos: number;
    local: boolean;
    relayUltimoUso: Date | null;
    naFila: number;
};

export type ResumoParaTela = {
    lojas: number;
    ativas: number;
    emTeste: number;
    pagando: number;
    receitaMensal: number;
};

const ROTULO_ASSINATURA: Record<LojaParaTela['assinatura'], { badge: string; texto: string }> = {
    // Sem classe de "verde" adiante: o badge vem do token, e um token novo nao
    // entra por aqui -- ele nasce no CSS e e' aplicado pelas clases abaixo.
    ativa: { badge: 'badge-success', texto: 'Pagando' },
    pendente: { badge: 'badge-info', texto: 'Aguardando pagamento' },
    atrasada: { badge: 'badge-danger', texto: 'Em atraso' },
    cancelada: { badge: 'badge-neutral', texto: 'Cancelada' },
    'sem-assinatura': { badge: 'badge-neutral', texto: 'Sem assinatura' },
};

/** `dd/mm/aaaa`, e nao ISO: quem le e' o dono, nao um programa. */
function data(d: Date | null): string {
    if (!d) return '—';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function dinheiro(v: number): string {
    return v > 0 ? `R$ ${v.toFixed(2)}` : '—';
}

/**
 * "ha 3 min", e nao a hora: o que o dono precisa saber do PC da loja e' se ele esta
 * puxando AGORA. Data so faz sentido quando o problema ja e' antigo.
 */
function haQuantoTempo(d: Date | null): string {
    if (!d) return 'nunca conectou';
    const segundos = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (segundos < 90) return 'ha instantes';
    if (segundos < 5400) return `ha ${Math.floor(segundos / 60)} min`;
    if (segundos < 172800) return `ha ${Math.floor(segundos / 3600)} h`;
    return data(d);
}

/**
 * O estado do PC da loja numa etiqueta so. Fila nao zerada ganha a dianteira: e' o
 * unico caso em que a loja esta perdendo dinheiro agora, porque ninguem buscou.
 */
function seloDoPc(l: LojaParaTela): string {
    if (!l.local) return '<span class="text-ink-3">—</span>';
    if (l.naFila > 0) return `<span class="badge badge-warning">${l.naFila} na fila</span>`;
    if (!l.relayUltimoUso) return '<span class="badge badge-neutral">PC sem chave</span>';
    const minutos = Math.floor((Date.now() - l.relayUltimoUso.getTime()) / 60000);
    const badge = minutos > 5 ? 'badge-neutral' : 'badge-success';
    return `<span class="badge ${badge}">PC ${minutos > 5 ? 'parado' : 'ligado'}</span>`;
}

function linhaDaLoja(l: LojaParaTela): string {
    const assinatura = ROTULO_ASSINATURA[l.assinatura] ?? ROTULO_ASSINATURA['sem-assinatura'];
    const emTeste = l.diasDeTeste > 0 && l.assinatura !== 'ativa';
    const desligada = l.estado === 'desligada';

    return `                        <tr data-loja="${escapeHtml(l.id)}">
                            <td class="px-3 py-2.5 align-top">
                                <p class="text-body font-medium text-ink">${escapeHtml(l.nome)}</p>
                                <p class="text-caption text-ink-3">${escapeHtml(l.emailDono || 'sem e-mail')}</p>
                            </td>
                            <td class="px-3 py-2.5 align-top">
                                <span class="badge ${assinatura.badge}">${escapeHtml(assinatura.texto)}</span>
                                ${
                                    desligada
                                        ? '<span class="badge badge-danger ml-1">Acesso cortado</span>'
                                        : emTeste
                                          ? `<span class="badge badge-warning ml-1">Teste: ${l.diasDeTeste}d</span>`
                                          : ''
                                }
                            </td>
                            <td class="px-3 py-2.5 align-top text-caption text-ink-2">
                                ${escapeHtml(l.plano || '—')}<br />
                                <span class="text-ink-3">${escapeHtml(dinheiro(l.valor))}/mes</span>
                            </td>
                            <td class="px-3 py-2.5 align-top text-caption text-ink-2">
                                ${l.produtos} produto(s)<br />
                                <span class="text-ink-3">${l.pedidos} pedido(s)</span>
                            </td>
                            <td class="px-3 py-2.5 align-top text-caption text-ink-2">
                                ${data(l.ultimoPagamento)}<br />
                                <span class="text-ink-3">desde ${data(l.criadoEm)}</span>
                            </td>
                            <td class="px-3 py-2.5 align-top">
                                ${seloDoPc(l)}
                                <p class="text-caption text-ink-3 mt-0.5">${escapeHtml(haQuantoTempo(l.relayUltimoUso))}</p>
                            </td>
                            <td class="px-3 py-2.5 align-top">
                                <div class="flex gap-1">
                                    <button type="button" data-alternar="${escapeHtml(l.id)}"
                                        data-ligar="${desligada ? 'true' : 'false'}"
                                        class="btn ${desligada ? 'btn-primary' : 'btn-ghost'} py-1.5 text-caption">
                                        ${desligada ? 'Religar' : 'Desligar'}
                                    </button>
                                    <button type="button" data-chave="${escapeHtml(l.id)}"
                                        data-nome="${escapeHtml(l.nome)}"
                                        class="btn btn-ghost py-1.5 text-caption"
                                        aria-label="Chave do PC de ${escapeHtml(l.nome)}" title="Chave do PC">
                                        <i class="fa-solid fa-key" aria-hidden="true"></i>
                                    </button>
                                    <button type="button" data-apagar="${escapeHtml(l.id)}"
                                        data-nome="${escapeHtml(l.nome)}"
                                        class="btn btn-ghost py-1.5 text-caption text-accent-red"
                                        aria-label="Apagar ${escapeHtml(l.nome)}" title="Apagar ${escapeHtml(l.nome)}">
                                        <i class="fa-solid fa-trash" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>`;
}

function cartao(rotulo: string, valor: string, nota: string): string {
    return `                <div class="rounded-card border border-line bg-surface p-4">
                    <p class="text-caption text-ink-3">${escapeHtml(rotulo)}</p>
                    <p class="kpi-value text-ink mt-1">${escapeHtml(valor)}</p>
                    <p class="text-caption text-ink-3 mt-0.5">${escapeHtml(nota)}</p>
                </div>`;
}

export function renderOps(d: { resumo: ResumoParaTela; lojas: LojaParaTela[] }): string {
    const r = d.resumo;

    return semComentarios(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>Lojas | DeliveryAdmin</title>
    ${iconeDaAba()}
    <script>${TEMA}</script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="/styles/app.css">
</head>
<body class="bg-bg">
    <div class="max-w-7xl mx-auto px-5 py-8 sm:px-8">
        <div class="flex items-center gap-3 mb-6">
            ${tileDaMarca(36)}
            <div>
                <h1 class="text-title text-ink">Lojas</h1>
                <p class="text-caption text-ink-3">Quem assinou, quem esta em teste, quem pays.</p>
            </div>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
${cartao('Lojas', String(r.lojas), 'cadastradas no total')}
${cartao('Com acesso', String(r.ativas), 'clientes que conseguem entrar')}
${cartao('Em teste', String(r.emTeste), 'ainda podem virar clientes')}
${cartao('Pagando', String(r.pagando), 'assinatura ativa')}
${cartao('Receita/mes', dinheiro(r.receitaMensal), 'soma de quem esta pagando')}
        </div>

        <div class="rounded-card border border-line bg-surface overflow-hidden mb-6">
            <table class="w-full border-collapse">
                <thead>
                    <tr class="border-b border-line text-left">
                        <th class="px-3 py-2.5 text-caption font-semibold text-ink-2">Loja</th>
                        <th class="px-3 py-2.5 text-caption font-semibold text-ink-2">Situacao</th>
                        <th class="px-3 py-2.5 text-caption font-semibold text-ink-2">Plano</th>
                        <th class="px-3 py-2.5 text-caption font-semibold text-ink-2">Uso</th>
                        <th class="px-3 py-2.5 text-caption font-semibold text-ink-2">PC da loja</th>
                        <th class="px-3 py-2.5 text-caption font-semibold text-ink-2">Datas</th>
                        <th class="px-3 py-2.5 text-caption font-semibold text-ink-2">Acao</th>
                    </tr>
                </thead>
                <tbody id="corpo">
${d.lojas.length > 0 ? d.lojas.map(linhaDaLoja).join('\n') : '                        <tr><td colspan="7" class="px-3 py-6 text-center text-caption text-ink-3">Nenhuma loja cadastrada.</td></tr>'}
                </tbody>
            </table>
        </div>

        <details class="rounded-card border border-line bg-surface p-4">
            <summary class="text-body font-medium text-ink cursor-pointer">
                <i class="fa-solid fa-user-plus text-accent mr-2" aria-hidden="true"></i>
                Criar conta sem assinatura (uso interno)
            </summary>
            <p class="text-caption text-ink-2 mt-2 mb-4">
                Cria uma loja que entra direto, sem passar pelo pagamento. E' a porta
                que existe para o dono do sistema trabalhar; fica a um clique de quem
                estiver na sua rede.
            </p>
            <form id="formConta" class="grid sm:grid-cols-2 gap-3" novalidate>
                <div>
                    <label class="label" for="nome">Seu nome</label>
                    <input id="nome" name="nome" type="text" class="input" required maxlength="60" />
                </div>
                <div>
                    <label class="label" for="nomeLoja">Nome da loja</label>
                    <input id="nomeLoja" name="nomeLoja" type="text" class="input" required maxlength="60" />
                </div>
                <div>
                    <label class="label" for="email">E-mail</label>
                    <input id="email" name="email" type="email" class="input" required />
                </div>
                <div>
                    <label class="label" for="senha">Senha</label>
                    <div class="relative">
                        <input id="senha" name="senha" type="password" class="input pr-11" required minlength="8" />
                        <button type="button" data-ver-senha="senha"
                            class="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-control inline-flex items-center justify-center text-ink-3 hover:text-ink hover:bg-surface-2 transition"
                            aria-label="Mostrar a senha" aria-pressed="false" title="Mostrar a senha">
                            <i class="fa-solid fa-eye" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
                <div class="sm:col-span-2 flex items-center gap-3">
                    <button type="submit" class="btn btn-primary py-2.5 font-semibold">
                        <i class="fa-solid fa-user-plus" aria-hidden="true"></i>
                        <span>Criar conta</span>
                    </button>
                    <p id="aviso" class="text-caption text-ink-2"></p>
                </div>
            </form>
        </details>
    </div>

    <div id="janelaChave" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="janelaChave-title">
        <div class="modal-panel">
            <div class="flex items-start justify-between gap-3 mb-1">
                <h3 id="janelaChave-title" class="text-title flex items-center gap-2">
                    <i class="fa-solid fa-key text-accent" aria-hidden="true"></i>Chave do PC
                </h3>
                <button type="button" data-chave-fechar class="btn btn-ghost px-2 -mt-1 -mr-1 shrink-0" aria-label="Fechar">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
            <p id="janelaChave-texto" class="text-caption text-ink-3 mb-4"></p>
            <div class="flex items-center gap-2">
                <input id="janelaChave-campo" type="text" readonly class="input font-mono text-caption"
                    aria-label="Chave do PC da loja" />
                <button type="button" id="janelaChave-copiar" class="btn btn-primary shrink-0">
                    <i class="fa-solid fa-copy" aria-hidden="true"></i> Copiar
                </button>
            </div>
            <p class="text-caption text-ink-3 mt-3">
                <i class="fa-solid fa-triangle-exclamation text-accent-amber mr-1" aria-hidden="true"></i>
                Ela aparece so agora. Se gerar outra, a loja perde a fila ate colar a nova.
            </p>
        </div>
    </div>

    <script>${SCRIPT_OPS}</script>
</body>
</html>`);
}

/**
 * O tema antes da primeira pintura. O painel do cliente tem este mesmo bloco em
 * `layout.ts`; aqui e' copia em vez de importacao porque o `renderOps` nao usa o
 * `renderLayout`, e o arquivo de tema e' interno dele.
 */
const TEMA = `(function(){try{var s=localStorage.getItem('theme');if(s==='dark'||(!s&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

const SCRIPT_OPS = `
                (function ops() {
                    var aviso = document.getElementById('aviso');

                    function avisa(texto, ruim) {
                        aviso.textContent = texto;
                        aviso.className = 'text-caption ' + (ruim ? 'text-accent-red' : 'text-ink-2');
                    }

                    /*
                     * Apagar loja e' irreversivel: vai junto produto, pedido, conversa e
                     * o historico do caixa. Por isso a confirmacao diz o nome da loja e
                     * pede a palavra APAGAR -- um clique a mais e' mais barato que
                     * recriar tudo o que aquela loja tinha.
                     */
                    window.confirmaApagar = function (nome) {
                        return window.prompt(
                            'Apagar a loja "' + nome + '"?\\n\\nIsso apaga TUDO dela: produtos, pedidos, conversas e caixa.\\n\\nDigite APAGAR para confirmar.'
                        ) === 'APAGAR';
                    };

                    function post(url, corpo) {
                        return fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(corpo),
                        }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
                    }

                    /*
                     * Recarrega a pagina depois de mexer na loja: a linha muda de
                     * badge e de botao ao mesmo tempo, e refazer a tabela inteira no
                     * navegador seria duplicar o que o servidor ja sabe montar.
                     */
                    document.querySelectorAll('[data-alternar]').forEach(function (botao) {
                        botao.addEventListener('click', function () {
                            var ligar = botao.getAttribute('data-ligar') === 'true';
                            botao.disabled = true;
                            post('/api/ops/loja/' + encodeURIComponent(botao.getAttribute('data-alternar')) + '/alternar', { ligar: ligar })
                                .then(function (r) {
                                    if (!r.ok) { botao.disabled = false; avisa(r.d.error || 'Erro ao mudar a loja.', true); return; }
                                    location.reload();
                                })
                                .catch(function () { botao.disabled = false; avisa('Erro de rede.', true); });
                        });
                    });

                    /*
                     * Ver a senha: o mesmo atributo que o painel do cliente usa, e'
                     * o que faz o botao do olho funcionar sem script proprio.
                     */
                    document.querySelectorAll('[data-ver-senha]').forEach(function (botao) {
                        botao.addEventListener('click', function () {
                            var campo = document.getElementById(botao.getAttribute('data-ver-senha'));
                            var mostrando = campo.getAttribute('type') === 'text';
                            campo.setAttribute('type', mostrando ? 'password' : 'text');
                            botao.setAttribute('aria-pressed', String(!mostrando));
                            botao.setAttribute('aria-label', mostrando ? 'Mostrar a senha' : 'Esconder a senha');
                            botao.setAttribute('title', mostrando ? 'Mostrar a senha' : 'Esconder a senha');
                            botao.querySelector('i').className = mostrando ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
                        });
                    });

                    var janelaChave = document.getElementById('janelaChave');
                    var campoChave = document.getElementById('janelaChave-campo');

                    function fechaChave() {
                        janelaChave.classList.add('hidden');
                        // Limpar o campo e' o que garante que a chave saia da tela.
                        campoChave.value = '';
                    }

                    document.querySelectorAll('[data-chave-fechar]').forEach(function (b) {
                        b.addEventListener('click', fechaChave);
                    });

                    document.getElementById('janelaChave-copiar').addEventListener('click', function () {
                        campoChave.select();
                        navigator.clipboard.writeText(campoChave.value);
                    });

                    document.querySelectorAll('[data-chave]').forEach(function (botao) {
                        botao.addEventListener('click', function () {
                            var id = botao.getAttribute('data-chave');
                            var nome = botao.getAttribute('data-nome');
                            botao.disabled = true;
                            post('/api/ops/loja/' + encodeURIComponent(id) + '/relay', {})
                                .then(function (r) {
                                    botao.disabled = false;
                                    if (!r.ok) { avisa(r.d.error || 'Erro ao gerar a chave.', true); return; }
                                    document.getElementById('janelaChave-texto').textContent =
                                        'Cole no painel da loja, em iFood e 99Food. Esta e' + ' a chave do PC ' + nome + '.';
                                    campoChave.value = r.d.chave;
                                    janelaChave.classList.remove('hidden');
                                    campoChave.focus();
                                    campoChave.select();
                                })
                                .catch(function () { botao.disabled = false; avisa('Erro de rede.', true); });
                        });
                    });

                    document.querySelectorAll('[data-apagar]').forEach(function (botao) {
                        botao.addEventListener('click', function () {
                            var nome = botao.getAttribute('data-nome');
                            /*
                             * Confirmacao escrita, e nao o confirm() do navegador:
                             * esta tela apaga a loja E tudo que pertence a ela, e o
                             * texto precisa dizer isso antes do clique.
                             */
                            if (!window.confirmaApagar || !window.confirmaApagar(nome)) return;
                            botao.disabled = true;
                            post('/api/ops/loja/' + encodeURIComponent(botao.getAttribute('data-apagar')) + '/apagar', {})
                                .then(function (r) {
                                    if (!r.ok) { botao.disabled = false; avisa(r.d.error || 'Erro ao apagar.', true); return; }
                                    location.reload();
                                })
                                .catch(function () { botao.disabled = false; avisa('Erro de rede.', true); });
                        });
                    });

                    document.getElementById('formConta').addEventListener('submit', function (ev) {
                        ev.preventDefault();
                        var f = ev.target;
                        var dados = {
                            nome: f.nome.value.trim(),
                            nomeLoja: f.nomeLoja.value.trim(),
                            email: f.email.value.trim(),
                            senha: f.senha.value,
                        };
                        if (!dados.nome || !dados.nomeLoja || !dados.email || !dados.senha) {
                            avisa('Preencha os quatro campos.', true);
                            return;
                        }
                        post('/api/ops/conta', dados).then(function (r) {
                            if (!r.ok) { avisa(r.d.error || 'Erro ao criar a conta.', true); return; }
                            f.reset();
                            avisa('Conta criada. Entre em /entrar com esse e-mail.', false);
                        }).catch(function () { avisa('Erro de rede.', true); });
                    });
                })();
`;