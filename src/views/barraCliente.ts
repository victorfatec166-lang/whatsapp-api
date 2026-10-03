import { escapeHtml } from './html';

/*
 * Onde o cliente de desktop esta publicado. Vem do ambiente, e nao do codigo: o binario
 * muda de lugar -- GitHub Releases, depois um storage -- e o endereco nos dois pontos onde
 * ele aparece muda junto, sem duas copias para editar. Vazio significa "ainda nao publicado".
 */
export function urlDoCliente(): string | null {
    const bruto = (process.env.CLIENTE_DOWNLOAD_URL ?? '').trim();
    return /^https:\/\//.test(bruto) ? bruto : null;
}

/*
 * A barra some em tres casos, e nos tres a omissao e' o certo: dentro do app (convidar
 * quem ja esta nele a instalar o app), no celular (que e' a tela de verdade do dono, e a
 * barra empurraria o campo de senha para baixo) e depois de dispensada.
 */
const REGRA_OCULTA = `
    (function () {
        var barra = document.querySelector('[data-barra-cliente]');
        if (!barra) return;
        try {
            // O user-agent do Electron se declara. E' ele que impede o convite
            // de aparecer para quem esta usando o app que o convite instala.
            if (/Electron/i.test(navigator.userAgent)) return;
            // No celular o espaco e' do formulario. Barra de download antes de
            // digitar a senha e' o que faz a tela de entrada encolher.
            if (window.matchMedia('(max-width: 1023px)').matches) return;
            if (localStorage.getItem('barraClienteDispensada') === '1') return;
            barra.classList.remove('hidden');
        } catch (e) {}
    })();

    window.dispensarBarraCliente = function () {
        var barra = document.querySelector('[data-barra-cliente]');
        if (barra) barra.classList.add('hidden');
        try { localStorage.setItem('barraClienteDispensada', '1'); } catch (e) {}
    };
`;

/*
 * A barra. `compacto` e' a versao de uma linha, para o rodape da barra de abas.
 *
 * O `flex` e' obrigatorio: sem ele o elemento nasce `display:block`, os filhos nao
 * ficam na mesma linha e a barra quebra em tres alturas conforme o texto enrola.
 */
export function barraCliente(url: string, opts: { compacto?: boolean } = {}): string {
    const texto = opts.compacto
        ? `<span class="min-w-0 flex-1 truncate text-caption">Cliente de desktop</span>`
        : `<span class="min-w-0 flex-1">
               <span class="block text-body font-semibold text-ink leading-tight">Cliente de desktop</span>
               <span class="block text-caption text-ink-3 leading-tight mt-0.5 truncate">iFood, 99Food e WhatsApp juntos</span>
           </span>`;

    const dispensar = `<button type="button" onclick="dispensarBarraCliente()" aria-label="Dispensar aviso do cliente de desktop"
            class="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-control text-ink-3 hover:bg-surface-2 hover:text-ink transition">
        <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
    </button>`;

    return `<div data-barra-cliente class="hidden flex ${opts.compacto ? 'items-center gap-2 px-3 py-2' : 'items-center gap-3 px-4 py-3'} rounded-card bg-accent-soft border border-line">
            <span class="inline-flex items-center justify-center w-9 h-9 rounded-control bg-accent text-white shrink-0">
                <i class="fa-solid fa-desktop text-sm" aria-hidden="true"></i>
            </span>
            ${texto}
            <a href="${escapeHtml(url)}" download class="btn btn-primary btn-sm shrink-0">
                <i class="fa-solid fa-download text-xs" aria-hidden="true"></i>
                Baixar
            </a>
            ${dispensar}
        </div>`;
}

/** Script da barra, para as telas que ja tem bloco proprio de script. */
export const SCRIPT_BARRA_CLIENTE = REGRA_OCULTA;