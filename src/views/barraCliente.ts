import { escapeHtml } from './html';

/*
 * O botao aponta para a rota do PROPRIO servidor (`/cliente/download`) e nunca para um
 * endereco externo: `download` so vale na mesma origem, entao o link de fora fazia o
 * navegador navegar para o site em vez de baixar -- e ele morre com o servico que o hospeda.
 */
const LINK_CLIENTE = '/cliente/download';

/** O link do botao, para quem quiser abrir em outra aba. */
export function linkDoCliente(): string {
    return LINK_CLIENTE;
}

/*
 * A barra. `compacto` e' a versao de uma linha, para o rodape da barra de abas.
 *
 * O `flex` e' obrigatorio: sem ele o elemento nasce `display:block`, os filhos nao
 * ficam na mesma linha e a barra quebra em tres alturas conforme o texto enrola.
 */
export function barraCliente(opts: { compacto?: boolean } = {}): string {
    const texto = opts.compacto
        ? `<span class="min-w-0 flex-1 truncate text-caption">Cliente de desktop</span>`
        : `<span class="min-w-0 flex-1">
               <span class="block text-body font-semibold text-ink leading-tight">Cliente de desktop</span>
               <span class="hidden sm:block text-caption text-ink-3 leading-tight mt-0.5 truncate">iFood, 99Food e WhatsApp juntos</span>
           </span>`;

    return `<div data-barra-cliente class="flex ${opts.compacto ? 'items-center gap-2 px-3 py-2' : 'items-center gap-3 px-4 py-3'} rounded-card bg-accent-soft border border-line">
            <span class="inline-flex items-center justify-center w-9 h-9 rounded-control bg-accent text-white shrink-0">
                <i class="fa-solid fa-desktop text-sm" aria-hidden="true"></i>
            </span>
            ${texto}
            <a href="${escapeHtml(LINK_CLIENTE)}" download class="btn btn-primary btn-sm shrink-0">
                <i class="fa-solid fa-download text-xs" aria-hidden="true"></i>
                Baixar
            </a>
        </div>`;
}
