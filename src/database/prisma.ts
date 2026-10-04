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

export const prisma = new PrismaClient({ datasourceUrl: urlComTeto(process.env.DATABASE_URL) });