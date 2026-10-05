import { escapeHtml, semComentarios } from './html';
import { iconeDaAba, lockupDaMarca } from './marca';

/*
 * 404 e 500 viram tela com a mesma linguagem do resto (marca, tema, botao): um "Cannot
 * GET /" em texto puro faz parecer quebrado. Status e texto vem do SERVIDOR e nunca do
 * pedido: um `?erro=` na URL injetaria HTML na tela em que ninguem desconfia.
 */

const HEAD_TEMA = `
                (function () {
                    try {
                        var saved = localStorage.getItem('theme');
                        var prefereEscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
                        if (saved === 'dark' || (!saved && prefereEscuro)) {
                            document.documentElement.classList.add('dark');
                        }
                    } catch (e) {
                    }
                })();
`;

/** O que a pessoa ve, por codigo. O texto e' o mesmo para qualquer pedido. */
const CASOS: Record<number, { titulo: string; texto: string; icone: string }> = {
    404: {
        titulo: 'Nao achamos esta pagina',
        texto: 'O endereco pode ter mudado de nome, ou o link veio cortado. O painel abre pela tela de entrada.',
        icone: 'fa-compass',
    },
    403: {
        titulo: 'Voce nao tem acesso a isso',
        texto: "Esta area e' restrita a quem administra a loja. Se voce devia estar aqui, entre com outra conta.",
        icone: 'fa-lock',
    },
    500: {
        titulo: 'Algo quebrou do nosso lado',
        texto: 'Nao foi culpa do que voce fez. Tente de novo em instantes -- se voltar, o registro do servidor tem o detalhe.',
        icone: 'fa-triangle-exclamation',
    },
};

export function paginaDeErro(status: number, destino = '/entrar'): string {
    const caso = CASOS[status] ?? CASOS[500];
    const numero = CASOS[status] ? status : 500;

    return semComentarios(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${escapeHtml(caso.titulo)}</title>
    <script>${HEAD_TEMA}</script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="/styles/app.css">
    ${iconeDaAba()}
</head>
<body>
    <div class="min-h-screen flex items-center justify-center px-5 py-12 bg-bg">
        <div class="w-full max-w-md text-center">
            <div class="flex justify-center mb-8">${lockupDaMarca()}</div>

            <div class="card card-pad">
                <span class="inline-flex items-center justify-center w-14 h-14 rounded-control bg-accent-soft text-accent">
                    <i class="fa-solid ${caso.icone} text-xl" aria-hidden="true"></i>
                </span>
                <p class="text-micro text-ink-3 mt-5">Erro ${numero}</p>
                <h1 class="text-title text-ink mt-1">${escapeHtml(caso.titulo)}</h1>
                <p class="text-body text-ink-2 mt-2">${escapeHtml(caso.texto)}</p>
                <div class="flex flex-wrap justify-center gap-2 mt-6">
                    <a href="${escapeHtml(destino)}" class="btn btn-primary">
                        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                        Voltar
                    </a>
                    <a href="/" class="btn">
                        <i class="fa-solid fa-house" aria-hidden="true"></i>
                        Inicio
                    </a>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`);
}
