import { escapeHtml } from '../html';

/**
 * As tres pecas que se repetem em toda tela: o bloco de numero do topo, o
 * cabecalho de cartao e o estado vazio.
 *
 * Por que um modulo so: cada uma delas ja foi reescrita a mao umas seis vezes
 * no projeto -- a Home tinha uma, o Faturamento tinha outra identica, o Estoque
 * tinha uma terceira que usava `surface` e `rounded-xl` no lugar de `.kpi`, e
 * o PDV, o Kanban e as Configuracoes inventavam um quarto formato em `p-4`. Sao
 * seis numeros com nomes diferentes para a mesma informacao, e a pessoa que
 * abriu o Estoque na segunda aba do dia viu um cartao outro, sem ser outra.
 *
 * A regra que vale para as tres: todo cartao tem titulo E subtitulo. O subtitulo
 * e' o que diz o que o numero significa -- "aguardando ou em preparo", "no
 * historico completo". Sem ele, a pessoa precisa adivinhar o que esta lendo, e
 * um cartao semlegenda e' o que faz um painel parecer mais cheio do que e'.
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
 * O bloco de numero do topo.
 *
 * `sub` e' a legenda, e nao um detalhe: sem ela o cartao vira numero solto.
 * `sub` aceita HTML ja pronto porque quem chama passa icone (`<i class=...>`)
 * junto com o texto -- e o unico lugar do modulo onde isso acontece.
 *
 * `borda` pinta a faixa de tres pixels na esquerda, e existe para os numeros
 * que pedem acao: "estoque baixo", "zerado", "aguardando conferencia". Sem
 * ela, um cartao de alerta e um cartao normal so se distinguem pela cor do
 * numero -- e a cor do numero some quando o valor e' zero, que e' justamente
 * o caso que precisa de atencao.
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
 * A faixa de KPIs do topo.
 *
 * `grid-cols-2 lg:grid-cols-4` e' o padrao da Home e o que faz o numero caber
 * na tela pequena. A classe de coluna entra como parametro porque a Home usa
 * 4 colunas e o Estoque 5 (sao cinco resumos, e forcar em 4 deixaria um
 * cardito estreito demais na linha de baixo).
 */
export function faixaKpi(itens: string[], colunas = 4): string {
    return `        <div class="grid grid-cols-2 lg:grid-cols-${colunas} gap-3 mb-4">
            ${itens.join('\n            ')}
        </div>`;
}

/**
 * Cabecalho de cartao: titulo e, embaixo, o que aquele cartao e'.
 *
 * `sub` e' opcional porque nem todo cartao cabe numa frase -- um quadro de
 * pedidos, por exemplo, se explica pelo conteudo. Onde cabe, ele vai: e' a
 * diferenca entre "Mais vendidos" e "Mais vendidos, no historico completo".
 */
export function tituloCard(titulo: string, sub?: string): string {
    if (!sub) return `<h3 class="text-title">${escapeHtml(titulo)}</h3>`;
    return `<h3 class="text-title">${escapeHtml(titulo)}</h3>
                    <p class="text-caption text-ink-3">${sub}</p>`;
}

/**
 * Estado vazio.
 *
 * Existe como funcao porque "nada aqui ainda" aparecia escrito de seis formas
 * diferentes, e a mais comum era texto solto no meio de um cartao -- que le como
 * se o cartao tivesse falhado em vez de estar esperando primeiro registro.
 */
export function cardVazio(texto: string, icone = 'fa-inbox'): string {
    return `<p class="text-body text-ink-3 py-6 text-center flex items-center justify-center gap-2">
                        <i class="fa-solid ${icone}"></i> ${escapeHtml(texto)}
                    </p>`;
}
