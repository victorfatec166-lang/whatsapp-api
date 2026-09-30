import { escapeHtml } from './html';
import { campoSenha, campoTexto, botaoEntrar, erroGeral } from './ui/field';
import { REGRA_EMAIL_JS } from '../services/regras';
import { ADMIN_PADRAO } from '../services/auth';

/**
 * A tela de entrada.
 *
 * Layout dividido, e o motivo do corte esta na largura util. Uma caixa de login
 * no meio de uma tela vazia e' o desenho padrao -- e e' o que faz uma tela de
 * entrada parecer uma tela de demonstracao em vez de um produto. A metade
 * esquerda carrega o nome, a promessa e o que o sistema faz; a direita e' so o
 * formulario. Quem chega no celular nao ve nenhuma das duas: a area de
 * identidade some abaixo de lg e sobra o formulario, que e' o que interessa.
 *
 * E' a unica tela do painel que NAO usa o renderLayout. Ela nao tem barra
 * lateral nem cabecalho com o sino, e'ao que a pessoa nao entrou: mostrar o
 * menu de abas para quem nao tem sessao e' convidar a pessoa a descobrir o que
 * ela nao pode acessar.
 */

/** Frases da metade esquerda. */
const PROMESSA: Array<{ icone: string; titulo: string; texto: string }> = [
    {
        icone: 'fa-comment-dots',
        titulo: 'Pedidos pelo WhatsApp',
        texto: 'O cliente pede no WhatsApp, sem instalar aplicativo e sem esperar.',
    },
    {
        icone: 'fa-boxes-stacked',
        titulo: 'Estoque que se atualiza sozinho',
        texto: 'Cada venda baixa o item. Ninguem precisa conferir o saldo na mao.',
    },
    {
        icone: 'fa-chart-pie',
        titulo: 'Uma tela por vez',
        texto: 'Pedidos, cozinha e entrega no mesmo quadro, na ordem em que acontecem.',
    },
];

export type DadosTelaLogin = {
    nomeNegocio: string;
    /** Para onde ir depois de entrar. Vem do link que a pessoa clicou. */
    destino: string;
    /** Marcado no primeiro acesso: o cadastro ainda esta aberto. */
    primeiroAcesso?: boolean;
};

/**
 * Aceita so caminho interno que comece com `/` e nao seja `//`.
 *
 * O login redireciona depois de entrar, e o destino vem da URL. Sem esta
 * funcao, um `?destino=https://outro-site` transformaria a tela de entrada num
 * redirecionador: o login responderia "entrou" e levaria a pessoa para fora
 * com o endereco da sessao na barra de endereco.
 */
export function seguroInterno(valor: string): string {
    const v = (valor || '').trim();
    if (!v.startsWith('/')) return '/admin';
    if (v.startsWith('//')) return '/admin';
    return v;
}

/**
 * O tema antes da primeira pintura, igual ao painel.
 *
 * Sem isto, quem esta no escuro ve um clara piscando na hora de digitar a
 * senha -- e a tela de entrada e' a ultima coisa que pode piscar, porque e'
 * onde a pessoa esta mais atent ao que aparece.
 */
const HEAD_TEMA = `
                // Sem isto, quem esta no escuro ve um clara piscando na hora de
                // digitar a senha. E' a mesma logica do HEAD_SCRIPTS do painel.
                (function () {
                    try {
                        var saved = localStorage.getItem('theme');
                        var prefereEscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
                        if (saved === 'dark' || (!saved && prefereEscuro)) {
                            document.documentElement.classList.add('dark');
                        }
                    } catch (e) {}
                })();
`;

/**
 * O CSS das telas de entrada.
 *
 * Variavel, e nao tres copias: o login tem a metade de identidade, os fluxos
 * nao tem, e o que os dois compartilham e' o fundo e a caixa. Se a caixa
 * ganhasse uma regra so num dos arquivos, as telas de troca de senha e de
 * cadastro ficariam visualmente diferentes da de login -- e ninguem perceberia
 * a causa.
 *
 * O gradiente e' o que separa as metades sem precisar de borda, que em tela de
 * login parece divisoria de formulario. Sao tres camadas: um gradiente diagonal
 * ambar muito diluido, uma malha de pontos que da textura sem virar xadrez, e
 * dois circulos desfocados que suggestem movimento sem desenhar nada
 * reconhecivel.
 *
 * Tudo em color-mix com as Custom Properties do app.css -- entao acompanha o
 * tema escuro sem regra duplicada, e quem troca o acento no token ve a tela de
 * entrada mudar junto.
 */
const CSS_FLUXO = `
        .entrada-fundo {
            position: relative;
            overflow: hidden;
            background-color: var(--surface);
            background-image:
                radial-gradient(circle at 18% 22%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 46%),
                radial-gradient(circle at 88% 78%, color-mix(in srgb, var(--accent-strong) 16%, transparent), transparent 52%),
                linear-gradient(148deg, var(--surface) 0%, var(--surface-2) 100%);
        }

        /*
         * A malha de pontos: 22px de passo, um ponto de 1px, opacidade baixa.
         * O olho le como textura, nao como elemento. A mascara radial apaga as
         * bordas, para o padrao nao terminar em corte reto.
         */
        .entrada-malha {
            position: absolute;
            inset: 0;
            background-image: radial-gradient(circle, color-mix(in srgb, var(--text-1) 16%, transparent) 1px, transparent 1px);
            background-size: 22px 22px;
            -webkit-mask-image: radial-gradient(ellipse at 40% 40%, black 20%, transparent 78%);
            mask-image: radial-gradient(ellipse at 40% 40%, black 20%, transparent 78%);
            opacity: 0.5;
            pointer-events: none;
        }

        /* Anel fino: a unica forma geometrica da tela. */
        .entrada-anel {
            position: absolute;
            border: 1px solid color-mix(in srgb, var(--accent) 26%, transparent);
            border-radius: var(--r-full);
            pointer-events: none;
        }

        /*
         * A caixa do formulario usa a sombra de cima, a do que FLUTUA, e nao a
         * do cartao. A caixa de login e' exatamente isso em relacao ao fundo --
         * e dar a ela a sombra de cartao faz ela ler como mais um bloco da
         * pagina, que e' o problema que a tela de entrada tem por ser uma tela
         * de entrada.
         */
        .entrada-caixa { box-shadow: var(--shadow-lg); }

        /*
         * Animacao curta e discreta. Nada acima de 200 ms: quem trabalha em pe
         * usa esta tela muitas vezes por dia, e transicao longa vira tempo
         * perdido.
         *
         * O prefers-reduced-motion RESPEITA a preferencia, nao a silencia: e'
         * por isso que a animacao se declara em uma regra so e some inteira,
         * em vez de ficar uma transicao de 0,01ms.
         */
        .entrada-entra { animation: entradaSobe 180ms cubic-bezier(0.2, 0, 0.2, 1) both; }
        @keyframes entradaSobe {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
            .entrada-entra { animation: none; }
        }

        /*
         * O foco do botao de mostrar senha. Nao ha regra global de foco custom
         * para botao sem texto, e o padrao do navegador some no tema escuro --
         * sem esta linha, quem usa so o teclado nao acha o botao.
         */
        [data-ver-senha]:focus-visible {
            outline: 2px solid var(--focus);
            outline-offset: 1px;
        }
`;

export function renderLogin(d: DadosTelaLogin): string {
    /*
     * O destino entra no script como JSON, e nao concatenado.
     *
     * Ele vem da URL -- quem clicou num link de dentro do painel e caiu no login
     * precisa voltar para la. Concatenar cru transformaria um destino com
     * aspas em codigo executavel.
     *
     * A restricao e' a mesma do login: so caminho interno. Aceitar
     * https://site-do-cliente.com aqui faria a tela de entrada virar
     * redirecionador -- o login responderia "entrou" e levaria a pessoa para fora
     * com o endereco da sessao na barra de endereco.
     */
    const destino = seguroInterno(d.destino);
    const script = SCRIPT_LOGIN.replace('"__DESTINO__"', JSON.stringify(destino));

    return `<!DOCTYPE html>

<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- Sem indice: a tela de entrada nao e' para aparecer em busca. -->
    <meta name="robots" content="noindex, nofollow">
    <title>Entrar | ${escapeHtml(d.nomeNegocio)}</title>
    <script>${HEAD_TEMA}</script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="/styles/app.css">
    <style>${CSS_FLUXO}</style>
</head>
<body>
    <div class="min-h-screen lg:grid lg:grid-cols-2">

        <!--
            Metade esquerda: identidade.

            Sumiu abaixo de lg. A regra nao e' "esconda em tela pequena" por
           -si: e' que o formulario e' a unica coisa necessaria no celular, e uma
            imagem de marca empurrando o campo de senha para baixo obriga a pessoa
            a rolar antes de digitar. Abaixo de lg a tela vira so o formulario,
            com o logo pequeno no topo do proprio card.
        -->
        <section class="hidden lg:flex entrada-fundo flex-col justify-between p-10 xl:p-14 relative" aria-hidden="true">
            <div class="entrada-malha"></div>
            <div class="entrada-anel" style="width:26rem;height:26rem;top:-8rem;right:-7rem"></div>
            <div class="entrada-anel" style="width:15rem;height:15rem;bottom:-4rem;left:-3rem"></div>

            <div class="relative flex items-center gap-3">
                <span class="inline-flex items-center justify-center w-11 h-11 rounded-card bg-accent text-white shrink-0">
                    <i class="fa-solid fa-burger text-lg"></i>
                </span>
                <div class="min-w-0">
                    <p class="text-title truncate">${escapeHtml(d.nomeNegocio)}</p>
                    <p class="text-caption text-ink-3">Gestao de pedidos e deliveries</p>
                </div>
            </div>

            <div class="relative max-w-lg">
                <h2 class="text-display leading-tight text-ink">
                    Do WhatsApp do cliente<br>
                    ate a tela da cozinha.
                </h2>
                <p class="text-body text-ink-2 mt-4 max-w-md">
                    O pedido chega pelo WhatsApp, o estoque baixa sozinho e a equipe ve
                    tudo no mesmo quadro -- sem planilha e sem conference de saldo.
                </p>

                <ul class="mt-10 space-y-5">
                    ${PROMESSA.map(
                        (p) => `                    <li class="flex items-start gap-3.5">
                        <span class="inline-flex items-center justify-center w-9 h-9 rounded-control bg-accent-soft text-accent shrink-0 mt-0.5">
                            <i class="fa-solid ${p.icone} text-sm"></i>
                        </span>
                        <div>
                            <p class="text-body font-semibold text-ink">${escapeHtml(p.titulo)}</p>
                            <p class="text-caption text-ink-3 mt-0.5">${escapeHtml(p.texto)}</p>
                        </div>
                    </li>`
                    ).join('\n')}
                </ul>
            </div>

            <p class="relative text-micro text-ink-3">
                Feito para quem atende de pe, com a mao ocupada.
            </p>
        </section>

        <!--
            Metade direita: o formulario.

            O max-w-md com mx-auto e' o que segura a largura no desktop. Sem
            ele, o card esticaria na largura de meia tela e os campos ficariam
            com 600px de largura para se digitar um e-mail -- o oposto de
            confortavel.
        -->
        <section class="flex items-center justify-center px-5 py-10 sm:px-8 bg-bg">
            <div class="entrada-entra w-full max-w-md">

                <!-- Logo so no mobile: no desktop ele ja esta a esquerda. -->
                <div class="lg:hidden flex items-center gap-3 mb-8">
                    <span class="inline-flex items-center justify-center w-10 h-10 rounded-card bg-accent text-white shrink-0">
                        <i class="fa-solid fa-burger"></i>
                    </span>
                    <p class="text-title truncate">${escapeHtml(d.nomeNegocio)}</p>
                </div>

                <div class="entrada-caixa panel rounded-xl bg-surface border border-line p-6 sm:p-8">

                    <h1 class="text-display text-ink">Bem-vindo de volta</h1>
                    <p class="text-body text-ink-2 mt-1.5">Entre na sua conta para continuar.</p>

                    ${
                        d.primeiroAcesso
                            ? `                    <div role="status" class="mt-5 flex items-start gap-2.5 rounded-card border border-accent-orange bg-warning-bg p-3">
                        <i class="fa-solid fa-circle-info text-accent-orange mt-0.5 shrink-0" aria-hidden="true"></i>
                        <p class="text-caption text-ink-2">
                            Primeiro acesso. Use o e-mail
                            <strong class="font-mono text-ink">${escapeHtml(ADMIN_PADRAO)}</strong>
                            e a senha que aparece no log do servidor.
                        </p>
                    </div>`
                            : ''
                    }

                    <form id="formLogin" class="mt-6 space-y-4" novalidate>
                        ${campoTexto({
                            id: 'email',
                            rotulo: 'E-mail',
                            tipo: 'email',
                            placeholder: 'voce@email.com',
                            obrigatorio: true,
                            autofocus: true,
                            // No primeiro acesso o e-mail ja esta preenchido: ele
                            // e' o mesmo para toda instalacao nova, e pedir que a
                            // pessoa digite o que o sistema acabou de criar e'
                            // transformar um dado conhecido em trabalho.
                            valor: d.primeiroAcesso ? ADMIN_PADRAO : '',
                        })}

                        ${campoSenha({
                            id: 'senha',
                            rotulo: 'Senha',
                            tipo: 'senha',
                            placeholder: 'Digite sua senha',
                            obrigatorio: true,
                        })}

                        <div class="flex items-center justify-between gap-3 pt-1">
                            <label class="flex items-center gap-2 text-body text-ink-2 cursor-pointer select-none">
                                <input type="checkbox" id="lembrar" name="lembrar" checked
                                    class="w-4 h-4 accent-accent shrink-0">
                                Lembrar de mim
                            </label>
                            <a href="/recuperar-senha" class="text-body font-medium text-accent-strong hover:underline">
                                Esqueci minha senha
                            </a>
                        </div>

                        ${botaoEntrar()}
                    </form>

                    <div class="mt-6 pt-5 border-t border-line text-center">
                        <p class="text-body text-ink-2">
                            ${
                                d.primeiroAcesso
                                    ? `<span>Primeiro acesso? </span><a href="/criar-conta" class="font-semibold text-accent-strong hover:underline">Criar conta de administrador</a>`
                                    : `<span>Ainda nao tem uma conta? </span><a href="/criar-conta" class="font-semibold text-accent-strong hover:underline">Criar conta</a>`
                            }
                        </p>
                    </div>
                </div>

                <p class="text-caption text-ink-3 text-center mt-6">
                    <i class="fa-solid fa-lock"></i>
                    A conexao e' protegida. A senha nunca e' guardada em texto puro.
                </p>
            </div>
        </section>
    </div>

    <script>${script}</script>
</body>
</html>`;
}

/* ====================================================================
   As telas de fluxo: troca de senha, cadastro e recuperacao.

   Todas as tres reaproveitam a MESMA casca e os MESMOS componentes de campo.
   Nenhuma delas repete o `<head>`, o script anti-flash, oCSS de fundo nem o
   bloco de validacao: sao as mesmas linhas com outros campos, e reescrever
   isso em tres lugares e' como uma delas fica com o contraste errado sem ninguem
   notar.

   Diferenca do login: sem a metade de identidade. Sao telas de uma tarefa so, e
   a pessoa chega nelas porque JA esta no caminho -- mostrar a promessa do
   produto de novo ali seria.delay sem informacao.

   O CSS vive numa variavel e nao em tres copias pelo mesmo motivo. Ver o
   comentario de `--animado` na casca do login.
   ==================================================================== */

type DadosFluxo = {
    nomeNegocio: string;
    titulo: string;
    subtitulo: string;
    /** `atual` de dois campos, quando a tela pede a senha que ja existe. */
    conteudo: string;
    script: string;
    /** Link de volta, quando a tela nao tem botao proprio de saida. */
    voltar?: { href: string; texto: string };
};

function cascaFluxo(d: DadosFluxo): string {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${escapeHtml(d.titulo)} | ${escapeHtml(d.nomeNegocio)}</title>
    <script>${HEAD_TEMA}</script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="/styles/app.css">
    <style>${CSS_FLUXO}</style>
</head>
<body class="bg-bg">
    <div class="min-h-screen flex items-center justify-center px-5 py-10 sm:px-8">
        <div class="entrada-entra w-full max-w-md">
            <div class="flex items-center gap-3 mb-8">
                <span class="inline-flex items-center justify-center w-10 h-10 rounded-card bg-accent text-white shrink-0">
                    <i class="fa-solid fa-burger"></i>
                </span>
                <p class="text-title truncate">${escapeHtml(d.nomeNegocio)}</p>
            </div>

            <div class="panel rounded-xl bg-surface border border-line p-6 sm:p-8">
                <h1 class="text-display text-ink">${escapeHtml(d.titulo)}</h1>
                <p class="text-body text-ink-2 mt-1.5">${escapeHtml(d.subtitulo)}</p>
${d.conteudo}
            </div>

            ${
                d.voltar
                    ? `            <p class="text-center mt-6">
                <a href="${escapeHtml(d.voltar.href)}" class="text-body text-ink-2 hover:text-ink transition">
                    <i class="fa-solid fa-arrow-left"></i> ${escapeHtml(d.voltar.texto)}
                </a>
            </p>`
                    : ''
            }
        </div>
    </div>

    <script>${d.script}</script>
</body>
</html>`;
}

export type DadosTrocaSenha = {
    nomeNegocio: string;
    nome: string;
    email: string;
    /** Troca forcada: a senha gerada no primeiro acesso. O painel fica bloqueado. */
    obrigatoria: boolean;
};

export function renderTrocaSenha(d: DadosTrocaSenha): string {
    return cascaFluxo({
        nomeNegocio: d.nomeNegocio,
        titulo: 'Trocar a senha',
        subtitulo: d.obrigatoria
            ? 'Escolha uma senha sua antes de usar o painel.'
            : `Voce esta entrando como ${d.nome}.`,
        conteudo: `                ${
            d.obrigatoria
                ? `                <div role="status" class="mt-5 flex items-start gap-2.5 rounded-card border border-accent-orange bg-warning-bg p-3">
                    <i class="fa-solid fa-key text-accent-orange mt-0.5 shrink-0" aria-hidden="true"></i>
                    <p class="text-caption font-medium text-ink-2">
                        Esta e' a senha gerada na instalacao. Troque antes de continuar.
                    </p>
                </div>`
                : ''
        }

                <form id="formTroca" class="mt-6 space-y-4" novalidate>
                    <p class="text-caption text-ink-3">${escapeHtml(d.email)}</p>

                    ${campoSenha({
                        id: 'atual',
                        rotulo: 'Senha atual',
                        tipo: 'senha',
                        placeholder: d.obrigatoria ? 'Senha gerada na instalacao' : 'Digite a senha que voce usa hoje',
                        obrigatorio: true,
                        autofocus: true,
                    })}

                    ${campoSenha({
                        id: 'nova',
                        rotulo: 'Senha nova',
                        tipo: 'senha',
                        placeholder: 'Pelo menos 8 caracteres',
                        obrigatorio: true,
                        dica: 'Use maiuscula, minuscula, numero e simbolo.',
                        autocomplete: 'new-password',
                    })}

                    ${campoSenha({
                        id: 'repete',
                        rotulo: 'Repita a senha nova',
                        tipo: 'senha',
                        placeholder: 'Digite de novo',
                        obrigatorio: true,
                        autocomplete: 'new-password',
                    })}

                    ${botaoEntrar('Trocar senha')}
                </form>`,
        script: SCRIPT_TROCA,
    });
}

export function renderCriarConta(d: { nomeNegocio: string }): string {
    return cascaFluxo({
        nomeNegocio: d.nomeNegocio,
        titulo: 'Criar conta',
        subtitulo: 'A primeira conta do sistema administra tudo. As proximas sao de operador.',
        conteudo: `                <form id="formCadastro" class="mt-6 space-y-4" novalidate>
                    ${campoTexto({
                        id: 'nome',
                        rotulo: 'Como quer ser chamado',
                        tipo: 'texto',
                        placeholder: 'Seu nome',
                        obrigatorio: true,
                        autofocus: true,
                    })}

                    ${campoTexto({
                        id: 'email',
                        rotulo: 'E-mail',
                        tipo: 'email',
                        placeholder: 'voce@email.com',
                        obrigatorio: true,
                    })}

                    ${campoSenha({
                        id: 'senha',
                        rotulo: 'Senha',
                        tipo: 'senha',
                        placeholder: 'Pelo menos 8 caracteres',
                        obrigatorio: true,
                        dica: 'Use maiuscula, minuscula, numero e simbolo.',
                        autocomplete: 'new-password',
                    })}

                    ${botaoEntrar('Criar conta')}
                </form>`,
        script: SCRIPT_CADASTRO,
        voltar: { href: '/entrar', texto: 'Voltar para o login' },
    });
}

export function renderRecuperar(d: { nomeNegocio: string }): string {
    return cascaFluxo({
        nomeNegocio: d.nomeNegocio,
        titulo: 'Recuperar acesso',
        subtitulo: 'Este sistema nao envia e-mail. O codigo sai no log do servidor.',
        conteudo: `                <div role="note" class="mt-5 flex items-start gap-2.5 rounded-card border border-line bg-surface-2 p-3">
                    <i class="fa-solid fa-circle-info text-accent mt-0.5 shrink-0" aria-hidden="true"></i>
                    <p class="text-caption text-ink-2">
                        O codigo vale por uma hora e sai junto das mensagens do servidor. Quem
                        administer este painel pode ainda redefinir a sua senha pela tela de usuarios.
                    </p>
                </div>

                <form id="formRecuperar" class="mt-6 space-y-4" novalidate>
                    ${campoTexto({
                        id: 'email',
                        rotulo: 'E-mail da conta',
                        tipo: 'email',
                        placeholder: 'voce@email.com',
                        obrigatorio: true,
                        autofocus: true,
                    })}

                    ${botaoEntrar('Pedir codigo')}
                </form>

                <form id="formConfirmar" class="mt-6 space-y-4 hidden" novalidate>
                    <p class="text-body text-ink-2">
                        Se o e-mail existir, o codigo foi escrito no log do servidor.
                    </p>

                    ${campoSenha({
                        id: 'codigo',
                        rotulo: 'Codigo de recuperacao',
                        tipo: 'texto',
                        placeholder: '6 letras e numeros',
                        obrigatorio: true,
                    })}

                    ${campoSenha({
                        id: 'senha',
                        rotulo: 'Senha nova',
                        tipo: 'senha',
                        placeholder: 'Pelo menos 8 caracteres',
                        obrigatorio: true,
                        dica: 'Use maiuscula, minuscula, numero e simbolo.',
                        autocomplete: 'new-password',
                    })}

                    ${botaoEntrar('Trocar a senha')}
                </form>`,
        script: SCRIPT_RECUPERAR,
        voltar: { href: '/entrar', texto: 'Voltar para o login' },
    });
}

/* ====================================================================
   O JavaScript das telas de entrada.

   O que as quatro telas compartilham esta em COMUM; o que e' delas esta
   abaixo. Sem essa separacao, "mostrar senha" estaria escrito quatro vezes e
   valeria a pena em uma: a versao do cadastro, por exemplo, nao teria o foco
   devolvido -- e a pessoa descobre que o foco sumiu so depois de achar o campo.
   ==================================================================== */

/**
 * O bloco comum das quatro telas.
 *
 * As funcoes vao para `window` porque o script de cada tela as chama do escopo
 * global. Nao ha modulo nem closure aqui: e' HTML com script, o mesmo padrao do
 * painel (ver `APP_SCRIPTS` em views/layout.ts).
 */
const COMUM = `
                /*
                 * A regra de e-mail, da fonte unica em services/regras.ts.
                 *
                 * Entra como LITERAL de regex, e nao como string que vira
                 * "new RegExp" depois. A versao com string saiu daqui como
                 * texto cru -- a concatenacao estava dentro do template
                 * literal -- e a tela passou a recusar ate o e-mail valido.
                 * Regex literal nao tem esse segundo passo para dar errado.
                 */
                var RE_EMAIL = /${REGRA_EMAIL_JS}/;

                // ---- mostrar e esconder a senha ----
                document.addEventListener('click', function (ev) {
                    var alvo = ev.target;
                    if (!alvo || !alvo.closest) return;
                    var botao = alvo.closest('[data-ver-senha]');
                    if (!botao) return;

                    var campo = document.getElementById(botao.dataset.verSenha);
                    if (!campo) return;

                    var mostrando = campo.type === 'text';
                    campo.type = mostrando ? 'password' : 'text';
                    var icone = botao.querySelector('i');
                    if (icone) icone.className = mostrando ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
                    botao.setAttribute('aria-pressed', String(!mostrando));
                    var rotulo = mostrando ? 'Mostrar a senha' : 'Ocultar a senha';
                    botao.setAttribute('aria-label', rotulo);
                    botao.setAttribute('title', rotulo);
                });

                /*
                 * Mensagem de erro perto do campo.
                 *
                 * Sempre por textContent e createElement, nunca innerHTML. A
                 * frase vem da regra de validacao ou do servidor, e "erro de
                 * escape no painel" ja aconteceu uma vez, com um nome de produto
                 * dentro de um onclick. Aqui o caminho seria o mesmo e o dano
                 * igual: a tela de entrada para de funcionar inteira.
                 */
                window.marcaErro = function (id, texto) {
                    var campo = document.querySelector('[data-campo-erro="' + id + '"]');
                    if (!campo) return;

                    // aria-invalid e' o estado que o leitor de tela anuncia. Sem
                    // ele, a mensagem aparece e nao e' lida.
                    campo.setAttribute('aria-invalid', texto ? 'true' : 'false');

                    var alvo = document.getElementById(id + '-erro');
                    if (alvo) alvo.remove();
                    if (!texto) return;

                    var aviso = document.createElement('p');
                    aviso.id = id + '-erro';
                    aviso.className = 'flex items-start gap-1.5 text-caption font-medium text-accent-red mt-1.5';
                    var icone = document.createElement('i');
                    icone.className = 'fa-solid fa-circle-exclamation mt-px shrink-0';
                    icone.setAttribute('aria-hidden', 'true');
                    var span = document.createElement('span');
                    span.textContent = texto;
                    aviso.appendChild(icone);
                    aviso.appendChild(span);

                    // Depois do campo, e nao antes: o erro entra na posicao em que
                    // o olho ja esta.
                    var pai = campo.parentNode;
                    pai.parentNode.insertBefore(aviso, pai.nextSibling);
                };

                window.erroGeral = function (texto) {
                    var alvo = document.querySelector('[data-erro-geral]');
                    if (alvo) alvo.remove();
                    if (!texto) return;

                    var caixa = document.createElement('div');
                    caixa.setAttribute('role', 'alert');
                    caixa.setAttribute('data-erro-geral', '');
                    caixa.className = 'flex items-start gap-2.5 rounded-card border border-accent-red bg-danger-bg p-3';

                    var icone = document.createElement('i');
                    icone.className = 'fa-solid fa-triangle-exclamation text-accent-red mt-0.5 shrink-0';
                    icone.setAttribute('aria-hidden', 'true');
                    var p = document.createElement('p');
                    p.className = 'text-caption font-medium text-accent-red';
                    p.textContent = texto;

                    caixa.appendChild(icone);
                    caixa.appendChild(p);

                    // Acima do formulario: depois de apertar o botao, o olho esta
                    // no comeco dele.
                    var form = document.querySelector('form');
                    form.parentNode.insertBefore(caixa, form);
                };

                /*
                 * Estado de carregamento do botao.
                 *
                 * E' disabled de verdade, mais o texto trocado. Um botao que so
                 * muda de cor deixa a pessoa clicar de novo -- e clicar duas
                 * vezes em Entrar cria DUAS sessoes, das quais uma fica aberta
                 * sem ninguem saber que existe.
                 */
                window.estadoCarregando = function (ligado) {
                    var btn = document.querySelector('[data-botao-entrar]');
                    if (!btn) return;
                    btn.disabled = ligado;
                    btn.setAttribute('aria-busy', String(ligado));
                    btn.querySelectorAll('[data-icone-normal],[data-texto-normal]').forEach(function (el) {
                        el.classList.toggle('hidden', ligado);
                    });
                    btn.querySelectorAll('[data-icone-carregando],[data-texto-carregando]').forEach(function (el) {
                        el.classList.toggle('hidden', !ligado);
                    });
                };

                async function postJSON(url, body) {
                    var res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    var parsed = {};
                    try { parsed = await res.json(); } catch (e) {}
                    return { ok: res.ok, status: res.status, data: parsed };
                }

                /**
                 * Pede o token do formulario.
                 *
                 * Ele vai no corpo E fica num cookie HttpOnly, e sao os dois que
                 * precisam bater no envio. Nao ha segredo no valor: o que se
                 * protege e' a ORIGEM do pedido. Um site de terceiro nao tem nem
                 * o cookie nem o corpo -- e sem essa checagem ele manda o
                 * navegador da pessoa tentar entrar com uma conta que ele
                 * conhece, e o cookie de sessao que volta e' gravado na origem
                 * dele.
                 */
                async function comToken() {
                    var t = await postJSON('/api/auth/token', {});
                    if (!t.ok || !t.data.token) throw new Error('sem token');
                    return t.data.token;
                }

                /** Foca o primeiro campo marcado com erro, para quem usa teclado. */
                window.focaPrimeiroErro = function () {
                    var primeiro = document.querySelector('[aria-invalid="true"]');
                    if (primeiro) primeiro.focus();
                };
`;

const SCRIPT_LOGIN = COMUM + `
                /*
                 * Validacao do login, no navegador.
                 *
                 * O required e o type="email" bastam para o teclado do
                 * celular e para o aviso nativo -- mas o novalidate do form
                 * desliga o balao do navegador: ele diz "preencha este campo"
                 * em ingles, no canto errado, e sem a palavra do que esta errado.
                 */
                (function validacaoLogin() {
                    var form = document.getElementById('formLogin');

                    function checaEmail() {
                        var valor = form.email.value.trim();
                        if (!valor) { window.marcaErro('email', 'Informe o e-mail da sua conta.'); return false; }
                        if (!RE_EMAIL.test(valor)) {
                            window.marcaErro('email', 'Isso nao parece um e-mail. Confira o @ e o dominio.');
                            return false;
                        }
                        window.marcaErro('email', null);
                        return true;
                    }

                    function checaSenha() {
                        if (!form.senha.value) { window.marcaErro('senha', 'Informe a sua senha.'); return false; }
                        window.marcaErro('senha', null);
                        return true;
                    }

                    // O erro some quando a pessoa corrige: erro que fica depois
                    // de ela acertar faz a tela parecer quebrada.
                    form.email.addEventListener('input', function () {
                        if (form.email.getAttribute('aria-invalid') === 'true') checaEmail();
                    });
                    form.senha.addEventListener('input', function () {
                        if (form.senha.getAttribute('aria-invalid') === 'true') checaSenha();
                    });

                    form.addEventListener('submit', function (ev) {
                        ev.preventDefault();
                        if (!(checaEmail() & checaSenha())) { window.focaPrimeiroErro(); return; }
                        envia();
                    });

                    async function envia() {
                        window.estadoCarregando(true);
                        window.erroGeral(null);

                        try {
                            var t = await comToken();
                            var r = await postJSON('/api/auth/login', {
                                email: form.email.value.trim(),
                                senha: form.senha.value,
                                destino: ${JSON.stringify('__DESTINO__')},
                                csrf: t,
                            });

                            if (r.ok) {
                                // A sessao pode exigir troca antes de qualquer
                                // outra coisa: o servidor recusa o painel com
                                // essa flag, e sem ela a pessoa entraria com a
                                // senha temporaria.
                                location.href = r.data.trocarSenha ? '/trocar-senha' : r.data.destino;
                                return;
                            }

                            window.estadoCarregando(false);
                            window.erroGeral(r.data.error || 'Nao foi possivel entrar.');
                        } catch (e) {
                            window.estadoCarregando(false);
                            window.erroGeral('Nao foi possivel falar com o servidor. Confira se ele esta ligado.');
                        }
                    }
                })();
`;

const SCRIPT_TROCA = COMUM + `
                (function troca() {
                    var form = document.getElementById('formTroca');

                    function checa() {
                        var ok = true;
                        if (!form.atual.value) { window.marcaErro('atual', 'Informe a senha atual.'); ok = false; }
                        else window.marcaErro('atual', null);

                        if (!form.nova.value) { window.marcaErro('nova', 'Informe a senha nova.'); ok = false; }
                        else if (form.nova.value.length < 8) {
                            window.marcaErro('nova', 'A senha precisa de pelo menos 8 caracteres.');
                            ok = false;
                        } else window.marcaErro('nova', null);

                        if (!form.repete.value) { window.marcaErro('repete', 'Repita a senha nova.'); ok = false; }
                        else if (form.repete.value !== form.nova.value) {
                            window.marcaErro('repete', 'As duas senhas nao sao iguais.');
                            ok = false;
                        } else window.marcaErro('repete', null);

                        return ok;
                    }

                    ['atual', 'nova', 'repete'].forEach(function (id) {
                        form[id].addEventListener('input', function () {
                            if (form[id].getAttribute('aria-invalid') === 'true') checa();
                        });
                    });

                    form.addEventListener('submit', function (ev) {
                        ev.preventDefault();
                        if (!checa()) { window.focaPrimeiroErro(); return; }

                        window.estadoCarregando(true);
                        window.erroGeral(null);

                        // O CSRF desta rota vem do cookie de sessao, e nao do
                        // token da pagina: aqui ja existe sessao. Ver exigeCsrf.
                        var t = document.querySelector('meta[name="csrf"]');
                        postJSON('/api/auth/trocar-senha', {
                            atual: form.atual.value,
                            nova: form.nova.value,
                            csrf: t ? t.content : '',
                        })
                            .then(function (r) {
                                window.estadoCarregando(false);
                                if (r.ok) { location.href = r.data.destino; return; }
                                window.erroGeral(r.data.error || 'Nao foi possivel trocar a senha.');
                            })
                            .catch(function () {
                                window.estadoCarregando(false);
                                window.erroGeral('Nao foi possivel falar com o servidor.');
                            });
                    });
                })();
`;

const SCRIPT_CADASTRO = COMUM + `
                (function cadastro() {
                    var form = document.getElementById('formCadastro');

                    function checa() {
                        var ok = true;
                        var nome = form.nome.value.trim();
                        if (nome.length < 2) { window.marcaErro('nome', 'Informe o seu nome.'); ok = false; }
                        else window.marcaErro('nome', null);

                        var email = form.email.value.trim();
                        if (!email) { window.marcaErro('email', 'Informe o e-mail.'); ok = false; }
                        else if (!RE_EMAIL.test(email)) {
                            window.marcaErro('email', 'Isso nao parece um e-mail.');
                            ok = false;
                        } else window.marcaErro('email', null);

                        if (!form.senha.value) { window.marcaErro('senha', 'Informe uma senha.'); ok = false; }
                        else if (form.senha.value.length < 8) {
                            window.marcaErro('senha', 'A senha precisa de pelo menos 8 caracteres.');
                            ok = false;
                        } else window.marcaErro('senha', null);

                        return ok;
                    }

                    ['nome', 'email', 'senha'].forEach(function (id) {
                        form[id].addEventListener('input', function () {
                            if (form[id].getAttribute('aria-invalid') === 'true') checa();
                        });
                    });

                    form.addEventListener('submit', function (ev) {
                        ev.preventDefault();
                        if (!checa()) { window.focaPrimeiroErro(); return; }

                        window.estadoCarregando(true);
                        window.erroGeral(null);

                        comToken()
                            .then(function (t) {
                                return postJSON('/api/auth/criar-conta', {
                                    nome: form.nome.value.trim(),
                                    email: form.email.value.trim(),
                                    senha: form.senha.value,
                                    csrf: t,
                                });
                            })
                            .then(function (r) {
                                window.estadoCarregando(false);
                                if (r.ok) {
                                    window.erroGeral(null);
                                    alert('Conta criada. Agora entre com o e-mail e a senha.');
                                    location.href = '/entrar';
                                    return;
                                }
                                window.erroGeral(r.data.error || 'Nao foi possivel criar a conta.');
                            })
                            .catch(function () {
                                window.estadoCarregando(false);
                                window.erroGeral('Nao foi possivel falar com o servidor.');
                            });
                    });
                })();
`;

const SCRIPT_RECUPERAR = COMUM + `
                (function recuperar() {
                    var pedir = document.getElementById('formRecuperar');
                    var confirmar = document.getElementById('formConfirmar');

                    /*
                     * Sao dois formularios, e nao um com campos que aparecem.
                     *
                     * O codigo e' o que a pessoa le no log, e o log pode levar
                     * um minuto para ser lido. Com os campos aparecendo, ela
                     * ficaria olhando para um formulario vazio esperando o
                     * codigo chegar -- e o codigo nao chega: ela e' quem vai
                     * buscar. O segundo formulario so existe depois do primeiro
                     * ser enviado, e o texto acima dele diz o que fazer.
                     */
                    pedir.addEventListener('submit', function (ev) {
                        ev.preventDefault();
                        var email = pedir.email.value.trim();
                        if (!email) { window.marcaErro('email', 'Informe o e-mail da conta.'); return; }
                        if (!RE_EMAIL.test(email)) {
                            window.marcaErro('email', 'Isso nao parece um e-mail.');
                            return;
                        }
                        window.marcaErro('email', null);

                        window.estadoCarregando(true);
                        window.erroGeral(null);

                        comToken()
                            .then(function (t) {
                                return postJSON('/api/auth/recuperar', { email: email, csrf: t });
                            })
                            .then(function (r) {
                                window.estadoCarregando(false);
                                if (!r.ok) { window.erroGeral(r.data.error || 'Nao foi possivel pedir o codigo.'); return; }
                                pedir.classList.add('hidden');
                                confirmar.classList.remove('hidden');
                                confirmar.email.value = email;
                                confirmar.codigo.focus();
                            })
                            .catch(function () {
                                window.estadoCarregando(false);
                                window.erroGeral('Nao foi possivel falar com o servidor.');
                            });
                    });

                    confirmar.addEventListener('submit', function (ev) {
                        ev.preventDefault();
                        var ok = true;
                        if (!confirmar.codigo.value.trim()) { window.marcaErro('codigo', 'Informe o codigo.'); ok = false; }
                        else window.marcaErro('codigo', null);
                        if (!confirmar.senha.value) { window.marcaErro('senha', 'Informe a senha nova.'); ok = false; }
                        else if (confirmar.senha.value.length < 8) {
                            window.marcaErro('senha', 'A senha precisa de pelo menos 8 caracteres.');
                            ok = false;
                        } else window.marcaErro('senha', null);
                        if (!ok) { window.focaPrimeiroErro(); return; }

                        window.estadoCarregando(true);
                        window.erroGeral(null);

                        comToken()
                            .then(function (t) {
                                return postJSON('/api/auth/recuperar-confirmar', {
                                    email: confirmar.email.value,
                                    codigo: confirmar.codigo.value.trim(),
                                    senha: confirmar.senha.value,
                                    csrf: t,
                                });
                            })
                            .then(function (r) {
                                window.estadoCarregando(false);
                                if (r.ok) { location.href = '/entrar'; return; }
                                window.erroGeral(r.data.error || 'Nao foi possivel trocar a senha.');
                            })
                            .catch(function () {
                                window.estadoCarregando(false);
                                window.erroGeral('Nao foi possivel falar com o servidor.');
                            });
                    });
                })();
`;
