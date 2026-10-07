/**
 * Fuso do dono. O Render roda em UTC, e `getHours()` ou `toLocaleTimeString` sem
 * `timeZone` leem o fuso da maquina que gerou a tela -- 3 horas atrasadas de Sao
 * Paulo. A loja nao tem fuso guardado e o produto e' brasileiro: FUSO_PADRAO cobre o resto.
 */
export const FUSO = process.env.FUSO_PADRAO?.trim() || 'America/Sao_Paulo';

/** Hora no fuso do dono. As opcoes sao as do `toLocaleTimeString`, sem o fuso. */
export function horaDoDono(
    d: Date,
    opcoes: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
    fuso = FUSO
): string {
    return d.toLocaleTimeString('pt-BR', { ...opcoes, timeZone: fuso });
}

/**
 * O fuso que o navegador pediu, ou o padrao. A comanda nasce no servidor, entao o relogio de
 * quem imprime so chega se o navegador mandar: header `X-Fuso`, ou `?fuso=` no download, que
 * nao leva header. Sem ele volta o padrao -- que e' o caso do agente de impressao.
 */
export function fusoDoRequisicao(pedido: { headers: Record<string, unknown>; query?: unknown }): string {
    const bruto = primeiroTexto(
        pedido.headers['x-fuso'],
        pedido.query && typeof pedido.query === 'object' ? (pedido.query as Record<string, unknown>).fuso : undefined
    );
    return fusoValido(bruto) ?? FUSO;
}

function primeiroTexto(...candidatos: unknown[]): string {
    for (const c of candidatos) {
        if (typeof c !== 'string') continue;
        const t = c.trim();
        if (t) return t;
    }
    return '';
}

/**
 * O texto vem do navegador, entao nao entra no `toLocaleTimeString` sem conferir: um
 * fuso invalido joga excecao e o painel inteiro cai em 500. A lista e' o que o
 * navegador aceita, e qualquer fuso fora dela vira o padrao.
 */
export function fusoValido(bruto: string): string | null {
    if (!bruto || bruto.length > 64) return null;
    try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: bruto }).format();
        return bruto;
    } catch {
        return null;
    }
}

/**
 * Meia-noite do dia de `d` no fuso, como instante. "Meia-noite de Sao Paulo" nao e' meia-noite
 * UTC: `setHours(0,0,0,0)` cortava o dia as 21h e o "#1" da cozinha voltava cedo demais. Mais
 * 24h fecha o dia -- o Brasil nao tem horario de verao, e FUSO_PADRAO e' o fuso de sempre.
 */
export function inicioDoDiaNoFuso(d: Date, fuso = FUSO): Date {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: fuso,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(d);
    const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
    const ano = n('year');
    const mes = n('month');
    const dia = n('day');
    // `hour12: false` pode entregar "24" na meia-noite em versoes antigas do ICU.
    const hora = n('hour') % 24;
    // Quanto o fuso anda em relacao a UTC, medido no proprio instante: menos isso a
    // meia-noite sai com o dia errado, e o "#1" da cozinha volta antes da hora.
    const deslocamento = Date.UTC(ano, mes - 1, dia, hora, n('minute'), n('second')) - d.getTime();
    return new Date(Date.UTC(ano, mes - 1, dia) - deslocamento);
}

/** Fim do dia de `d` no fuso: a meia-noite seguinte. */
export function fimDoDiaNoFuso(d: Date, fuso = FUSO): Date {
    return new Date(inicioDoDiaNoFuso(d, fuso).getTime() + 86_400_000);
}