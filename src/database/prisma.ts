import { PrismaClient } from '@prisma/client';

/**
 * O teto de conexoes mora no codigo: o Prisma dimensiona o pool pelos nucleos da maquina
 * e no Render isso dava 14 das 15 sessoes. Sao 5 porque o limite do pooler e' do PROJETO:
 * com a nuvem e o dev abertos juntos, 10 + 10 estoura as 15 e a Home responde 500.
 */
const LIMITE_PADRAO = 5;

/** A URL do ambiente com o teto, sem duplicar o que ja vier escrito. */
export function urlComTeto(url: string | undefined): string | undefined {
    if (!url || url.includes('connection_limit')) return url;
    return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${LIMITE_PADRAO}`;
}

/**
 * `prisma generate` sobrescreve o mesmo cliente na pasta, e ha dois alvos: Postgres
 * na nuvem, SQLite no cliente instalado. Gerar o errado nao da erro de compilacao:
 * so estoura no boot de um PC de cliente. Por isso a trava abaixo, e nao um aviso.
 */
const url = urlComTeto(process.env.DATABASE_URL);
const local = typeof url === 'string' && url.startsWith('file:');

if (local && !process.env.MODO_LOCAL) {
    console.warn(
        '[prisma] DATABASE_URL aponta para arquivo (SQLite) sem MODO_LOCAL=1. ' +
            'Se isso foi de proposito, o cliente precisa ter sido gerado com `npm run banco:local`.'
    );
}
if (!local && process.env.MODO_LOCAL) {
    throw new Error(
        'MODO_LOCAL=1 com DATABASE_URL de Postgres. O cliente do Prisma instalado foi gerado ' +
            'para outro banco: rode `npm run banco:local` antes de empacotar o instalador.'
    );
}

export const prisma = new PrismaClient({ datasourceUrl: url });