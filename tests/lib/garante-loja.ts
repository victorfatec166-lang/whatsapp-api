/*
 * A loja do teste tem que existir antes da primeira gravacao: Chat, Message e
 * Reminder tem chave estrangeira para `Tenant`, e um banco recem-criado nao tem
 * linha nenhuma. O servidor cria a loja no boot, mas o teste nao sobe o servidor.
 */
import { prisma } from '../../src/database/prisma';

/** A loja do teste: a mesma do ambiente, que e' quem tem a linha em `Tenant`. */
export const LOJA = process.env.DELIVERYADMIN_TENANT?.trim() || 'local';

export async function garanteLojaDoTeste(): Promise<string> {
    await prisma.tenant.upsert({
        where: { id: LOJA },
        update: {},
        create: { id: LOJA, name: 'Loja de teste', ativo: true },
    });
    return LOJA;
}