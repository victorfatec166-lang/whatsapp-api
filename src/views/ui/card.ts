import { escapeHtml } from '../html';

/**
 * Pecas que se repetiam em cada tela com nomes diferentes. Regra das tres: todo
 * cartao tem titulo E subtitulo -- sem ele a pessoa adivinha o que o numero
 * significa, e o painel parece mais cheio do que e'.
 */

export type Tone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const TONE_CLASSE: Record<Tone, string> = {
    default: 'text-ink-2',
    accent: 'text-accent',
    success: 'text-accent-emerald',
    warning: 'text-accent-orange',
    danger: 'text-accent-red',
};

/**
 * borda pinta a faixa de tres pixels na esquerda: e' o aviso que sobrevive quando o
 * valor e' zero e a cor do numero some -- que e' justamente o caso que pede atencao.
 * sub aceita HTML pronto porque quem chama passa icone junto com o texto.
 */
export function kpi(label: string, value: string, sub: string, tone: Tone = 'default', borda?: Tone): string {
    const filete = borda ? ` border-l-4 border-l-${BORDA_CLASSE[borda]}` : '';
    return `                <div class="kpi${filete}">
                    <p class="kpi-label">${escapeHtml(label)}</p>
                    <p class="kpi-value ${TONE_CLASSE[tone]}">${value}</p>
                    <p class="kpi-sub">${sub}</p>
                </div>`;
}

const BORDA_CLASSE: Record<Tone, string> = {
    default: 'line',
    accent: 'accent',
    success: 'accent-emerald',
    warning: 'accent-orange',
    danger: 'accent-red',
};

/**
 * colunas entra como parametro porque a Home usa 4 e o Estoque 5: forcar em 4
 * deixaria um cartao estreito demais na linha de baixo. O grid-cols-2 do comeco
 * e' o que faz o numero caber na tela pequena.
 */
export function faixaKpi(itens: string[], colunas = 4): string {
    return `        <div class="grid grid-cols-2 lg:grid-cols-${colunas} gap-3 mb-4">
            ${itens.join('\n            ')}
        </div>`;
}

/**
 * Existe como funcao porque "nada aqui ainda" aparecia escrito de seis formas, e a mais
 * comum era texto solto no meio do cartao -- que le como se o cartao tivesse falhado.
 */
export function cardVazio(texto: string, icone = 'fa-inbox'): string {
    return `<p class="text-body text-ink-3 py-6 text-center flex items-center justify-center gap-2">
                        <i class="fa-solid ${icone}"></i> ${escapeHtml(texto)}
                    </p>`;
}
