import { PrismaClient } from '@prisma/client';

/**
 * O teto de conexoes mora no codigo, e nao so na URL.
 *
 * O Prisma dimensiona o pool pelos nucleos que a maquina DIZ ter, e no Render isso
 * gave 14 das 15 conexoes do pooler do Supabase -- o resto do banco ficava fora.
 */
const LIMITE_PADRAO = 10;

/** A URL do ambiente com o teto, sem duplicar o que ja vier escrito. */
export function urlComTeto(url: string | undefined): string | undefined {
    if (!url || url.includes('connection_limit')) return url;
    return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${LIMITE_PADRAO}`;
}

export const prisma = new PrismaClient({ datasourceUrl: urlComTeto(process.env.DATABASE_URL) });