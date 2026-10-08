/**
 * Fuso do dono. O Render roda em UTC, e `getHours()` ou `toLocaleTimeString` sem
 * `timeZone` leem o fuso da maquina que gerou a tela -- 3 horas atrasadas de SP. Na
 * loja o fuso e' o da maquina: assim o dia do `localtime` e o dia do `FUSO` batem.
 */
import { ehBancoArquivo } from '../database/driver';

export const FUSO = process.env.FUSO_PADRAO?.trim() || fusoPadrao();

function fusoPadrao(): string {
    return ehBancoArquivo ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'America/Sao_Paulo';
}

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
export function inicioDoDiaNoFuso(d: Date = new Date(), fuso = FUSO): Date {
    const p = partesNoFuso(d, fuso);
    return instanteDoDia(p.ano, p.mes, p.dia, deslocamentoNoFuso(d, fuso));
}

/** Fim do dia de `d` no fuso: a meia-noite seguinte. */
export function fimDoDiaNoFuso(d: Date = new Date(), fuso = FUSO): Date {
    return new Date(inicioDoDiaNoFuso(d, fuso).getTime() + 86_400_000);
}

/** Instante da meia-noite do dia `ano/mes/dia` no fuso. */
export function instanteDoDiaNoFuso(ano: number, mes: number, dia: number, fuso = FUSO): Date {
    // Meio-dia do dia pedido ja tem o mesmo deslocamento da meia-noite, e nao depende
    // de ser a virada: assim a conversao usa uma medida so.
    return instanteDoDia(ano, mes, dia, deslocamentoNoFuso(instanteDoDia(ano, mes, dia, 0), fuso));
}

/** Primeiro instante do mes de `d` no fuso. O mes do dono, nao o mes do servidor. */
export function inicioDoMesNoFuso(d: Date = new Date(), fuso = FUSO): Date {
    const p = partesNoFuso(d, fuso);
    return instanteDoDia(p.ano, p.mes, 1, deslocamentoNoFuso(d, fuso));
}

/** Proximo mes, no fuso: exclusive, para a janela de "o mes inteiro". */
export function fimDoMesNoFuso(d: Date = new Date(), fuso = FUSO): Date {
    const p = partesNoFuso(d, fuso);
    const proximo = p.mes === 12 ? { ano: p.ano + 1, mes: 1 } : { ano: p.ano, mes: p.mes + 1 };
    return instanteDoDia(proximo.ano, proximo.mes, 1, deslocamentoNoFuso(d, fuso));
}

/** Ano, mes, dia, hora e minuto de `d` como o dono ve: o relogio, nao o servidor. */
export function partesNoFuso(d: Date = new Date(), fuso = FUSO): {
    ano: number;
    mes: number;
    dia: number;
    hora: number;
    minuto: number;
    segundo: number;
} {
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
    const hora = n('hour') % 24;
    return {
        ano: n('year'),
        mes: n('month'),
        dia: n('day'),
        hora,
        minuto: n('minute'),
        segundo: n('second'),
    };
}

/** Dia da semana (0=Dom..6=Sab) no fuso do dono. */
export function diaDaSemanaNoFuso(d: Date = new Date(), fuso = FUSO): number {
    const p = partesNoFuso(d, fuso);
    return new Date(Date.UTC(p.ano, p.mes - 1, p.dia, 12, 0, 0)).getUTCDay();
}

/**
 * O dia como texto, "2026-10-07". Serve para comparar e para agrupar: um `getDate()` na
 * tela le o fuso de quem gerou, entao o mesmo dado saia com dia 6 num servidor e 7 noutro.
 */
export function carimboDoDiaNoFuso(d: Date = new Date(), fuso = FUSO): string {
    const p = partesNoFuso(d, fuso);
    const dois = (n: number) => String(n).padStart(2, '0');
    return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}`;
}

function instanteDoDia(ano: number, mes: number, dia: number, deslocamentoMs: number): Date {
    return new Date(Date.UTC(ano, mes - 1, dia) - deslocamentoMs);
}

/**
 * Quanto o fuso anda em relacao a UTC, em milissegundos, medido no proprio instante.
 * Fuso atrasado (Sao Paulo) da positivo. Sem este sinal a meia-noite sai com o dia errado.
 */
function deslocamentoNoFuso(d: Date, fuso: string): number {
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
    // `hour12: false` pode entregar "24" na meia-noite em versoes antigas do ICU.
    const hora = n('hour') % 24;
    const comoUtc = Date.UTC(n('year'), n('month') - 1, n('day'), hora, n('minute'), n('second'));
    return comoUtc - d.getTime();
}