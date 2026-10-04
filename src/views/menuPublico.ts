import { escapeHtml } from './html';
import { linkDoCliente } from './barraCliente';

/*
 * O item de download do menu: a rota do proprio servidor, pelo mesmo motivo da
 * barra -- link de fora nao baixa, navega. Nao ha condicao: o item existe sempre,
 * porque e' a unica forma de a pessoa sair daqui com o app.
 */
function itemDownload(): string {
    return `<a href="${escapeHtml(linkDoCliente())}" role="menuitem"
                    class="flex items-center gap-3 px-3.5 py-2.5 text-body text-ink-2 hover:bg-surface-2 hover:text-ink transition">
                    <i class="fa-solid fa-download w-4 text-center text-ink-3" aria-hidden="true"></i>
                    Baixar cliente de desktop
                </a>`;
}

/*
 * O menu da tela publica, em tres pontinhos, e nao uma barra de navegacao: a tela de
 * entrada e' verticalmente cheia, e qualquer faixa no topo empurraria o formulario
 * para baixo. Tres pontinhos nao ocupam altura nenhuma.
 */
function markup(botaoTema: string): string {
    return `
                <div class="fixed top-4 right-4 z-30 flex items-center gap-1.5">
                    ${botaoTema}
                    <button type="button" id="menuPublicoBtn"
                        class="btn btn-ghost px-2.5 py-2"
                        title="Mais opcoes" aria-label="Mais opcoes"
                        aria-haspopup="true" aria-expanded="false" aria-controls="menuPublico">
                        <i class="fa-solid fa-ellipsis-vertical"></i>
                    </button>
                </div>

                <div id="menuPublico" role="menu" aria-labelledby="menuPublicoBtn"
                    class="hidden fixed top-16 right-4 z-30 w-56">
                    <div class="panel rounded-card bg-surface border border-line overflow-hidden py-1">
                        <a href="/sobre" role="menuitem" class="flex items-center gap-3 px-3.5 py-2.5 text-body text-ink-2 hover:bg-surface-2 hover:text-ink transition">
                            <i class="fa-solid fa-circle-info w-4 text-center text-ink-3" aria-hidden="true"></i>
                            Sobre
                        </a>
                        <a href="/ajuda" role="menuitem" class="flex items-center gap-3 px-3.5 py-2.5 text-body text-ink-2 hover:bg-surface-2 hover:text-ink transition">
                            <i class="fa-solid fa-life-ring w-4 text-center text-ink-3" aria-hidden="true"></i>
                            Ajuda
                        </a>
                        ${itemDownload()}
                    </div>
                </div>
`;
}

/*
 * Abre, fecha e devolve o foco. O `Escape` e' o que torna o menu usavel sem mouse:
 * sem ele quem navega pelo teclado abre o menu e nao tem como sair. O foco volta ao
 * botao porque, senao, ele some da navegacao e o teclado recomeca no topo da tela.
 */
const SCRIPT = `
                (function () {
                    var btn = document.getElementById('menuPublicoBtn');
                    var menu = document.getElementById('menuPublico');
                    if (!btn || !menu) return;

                    // Dentro do app nao ha sobre nem download: e' o mesmo motivo pelo
                    // qual a faixa de download some.
                    try {
                        if (/Electron/i.test(navigator.userAgent)) {
                            if (btn.parentElement) btn.parentElement.remove();
                            menu.remove();
                            return;
                        }
                    } catch (e) {}

                    function fecha(devolveFoco) {
                        menu.classList.add('hidden');
                        btn.setAttribute('aria-expanded', 'false');
                        if (devolveFoco) btn.focus();
                    }

                    btn.addEventListener('click', function () {
                        if (btn.getAttribute('aria-expanded') === 'true') return fecha(false);
                        menu.classList.remove('hidden');
                        btn.setAttribute('aria-expanded', 'true');
                    });

                    document.addEventListener('click', function (ev) {
                        if (btn.getAttribute('aria-expanded') !== 'true') return;
                        if (menu.contains(ev.target) || btn.contains(ev.target)) return;
                        fecha(false);
                    });

                    document.addEventListener('keydown', function (ev) {
                        if (ev.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') fecha(true);
                    });
                })();
`;

/**
 * Botao do menu ao lado do tema, o menu em si, e o comportamento.
 *
 * O `<script>` mora aqui e nao em quem chama: sem a tag o texto do JS aparecia
 * escrito no topo da tela de entrada, que e' a primeira coisa que a pessoa ve.
 */
export function menuPublico(botaoTema: string): string {
    return `${markup(botaoTema)}<script>${SCRIPT}</script>`;
}