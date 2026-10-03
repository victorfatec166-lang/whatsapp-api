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

/** A barra. `compacto` e' a versao de uma linha, para o rodape da barra de abas. */
export function barraCliente(url: string, opts: { compacto?: boolean } = {}): string {
    const texto = opts.compacto
        ? `<span class="min-w-0 flex-1">Cliente de desktop: iFood, 99Food e WhatsApp na mesma janela</span>`
        : `<span class="min-w-0"><span class="font-semibold text-ink">Cliente de desktop</span>
             <span class="hidden sm:inline text-ink-2"> &mdash; iFood, 99Food e WhatsApp na mesma janela, com sessao guardada</span></span>`;

    const dispensar = `<button type="button" onclick="dispensarBarraCliente()" aria-label="Dispensar aviso do cliente de desktop"
            class="shrink-0 p-1 rounded-control text-ink-3 hover:bg-surface-2 hover:text-ink transition">
        <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
    </button>`;

    return `<div data-barra-cliente class="hidden ${opts.compacto ? 'px-3 py-2' : 'px-3 py-2.5'} rounded-control bg-accent-soft border border-line items-center gap-2.5">
            <i class="fa-solid fa-desktop shrink-0 text-accent" aria-hidden="true"></i>
            ${texto}
            <a href="${escapeHtml(url)}" class="btn btn-primary btn-sm shrink-0">
                <i class="fa-solid fa-download text-xs" aria-hidden="true"></i>
                Baixar
            </a>
            ${dispensar}
        </div>`;
}

/** Script da barra, para as telas que ja tem bloco proprio de script. */
export const SCRIPT_BARRA_CLIENTE = REGRA_OCULTA;