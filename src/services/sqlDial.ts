/*
 * O SQL cru em duas gramaticas: sao onze consultas no sistema inteiro, e o resto
 * do codigo nao sabe qual banco esta embaixo. A maquina e' OU nuvem OU loja -- o
 * mesmo cliente do Prisma, gerado por `banco:local` ou `banco:postgres`.
 */
import { ehBancoArquivo } from '../database/driver';
import { FUSO } from './fuso';

/** Fragmentos que diferem entre os dois bancos, escolhidos uma vez por processo. */
type Fragmentos = Record<'dia' | 'hora' | 'dow' | 'zeroOuMais', string>;

const POSTGRES: Fragmentos = {
    dia: `to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE $2, 'YYYY-MM-DD')`,
    hora: `to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE $2, 'HH24')`,
    dow: `EXTRACT(DOW FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE $2))::int`,
    zeroOuMais: 'GREATEST(0, %s)',
};

const SQLITE: Fragmentos = {
    /*
     * `localtime` e' o fuso da MAQUINA, e a maquina e' a loja. O `/ 1000` + `unixepoch`
     * vem do Prisma gravar `DateTime` como epoch em MILISSEGUNDOS: o cliente converte na
     * leitura, entao sem isso o SQL le o numero cru como dia e devolve `null`.
     */
    dia: `strftime('%Y-%m-%d', CAST("createdAt" AS INTEGER) / 1000, 'unixepoch', 'localtime')`,
    hora: `strftime('%H', CAST("createdAt" AS INTEGER) / 1000, 'unixepoch', 'localtime')`,
    dow: `CAST(strftime('%w', CAST("createdAt" AS INTEGER) / 1000, 'unixepoch', 'localtime') AS INTEGER)`,
    // `max` de varios argumentos e' a funcao escalar do SQLite, e nao a agregacao.
    zeroOuMais: 'MAX(0, %s)',
};

export const ehSqlite = ehBancoArquivo;

/** O fragmento de data que a consulta precisa. */
export function frag(qual: keyof Fragmentos): string {
    return (ehSqlite ? SQLITE : POSTGRES)[qual];
}

/** `$1` no Postgres, `?` no SQLite: o SQLite vincula por ordem e nao aceita `$`. */
export function p(n: number): string {
    return ehSqlite ? '?' : `$${n}`;
}

/**
 * O fuso entra como parametro no Postgres e nao entra no SQLite, onde o `localtime` ja
 * resolveu. Sem isto a consulta receberia um parametro que o SQL nao usa, e a ordem de
 * vinculacao do SQLite ficaria errada.
 */
export function fusoComoParametro(): string[] {
    return ehSqlite ? [] : [FUSO];
}

/** `GREATEST`/`MAX` para nunca deixar o saldo negativo, com o `%s` preenchido. */
export function zeroOuMais(expressao: string): string {
    return frag('zeroOuMais').replace('%s', expressao);
}