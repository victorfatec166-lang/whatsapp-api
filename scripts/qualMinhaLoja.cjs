/*
 * Qual loja o dono realmente usa.
 *
 * `DELIVERYADMIN_LOJAS` recebe o id da loja do dono. Chutar esse id e' o jeito
 * rapido de o Render subir o bot de todo mundo menos o dele -- e o sintoma e'
 * "nao conecta", que ja custou horas hoje. A conta de admin responde qual e'.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    datasourceUrl: (() => {
        const url = process.env.DATABASE_URL;
        if (!url || url.includes('connection_limit')) return url;
        return `${url}${url.includes('?') ? '&' : '?'}connection_limit=2`;
    })(),
});

(async () => {
    const usuarios = await prisma.user.findMany({
        select: {
            email: true,
            nome: true,
            papel: true,
            ativo: true,
            tenant: { select: { id: true, name: true } },
        },
    });

    console.log('--- contas e a loja de cada uma ---');
    for (const u of usuarios) {
        console.log(`${u.email}  (${u.papel}${u.ativo ? '' : ', inativo'})  ->  ${u.tenant.id}  ${u.tenant.name}`);
    }

    await prisma.$disconnect();
})().catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
});