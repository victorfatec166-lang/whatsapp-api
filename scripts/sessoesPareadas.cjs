/*
 * Quem tem sessao de WhatsApp pareada, e em qual maquina.
 *
 * Dois lugares com o mesmo numero se derrubam: o WhatsApp derruba um dos dois, e
 * o dono ve "desconectado" sem entender que a causa e' o outro lugar rodando.
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
    const sessoes = await prisma.sessaoWhatsApp.findMany({
        select: { tenantId: true, maquinaId: true, atualizadoEm: true, telefone: true },
        orderBy: { atualizadoEm: 'desc' },
    });

    if (sessoes.length === 0) {
        console.log('Nenhuma sessao pareada no banco.');
    } else {
        console.log('--- sessoes pareadas ---');
        for (const s of sessoes) {
            console.log(`${s.tenantId}  maquina=${s.maquinaId}  tel=${s.telefone ?? '(sem numero)'}  ${s.atualizadoEm.toISOString()}`);
        }
        const porMaquina = new Map();
        for (const s of sessoes) porMaquina.set(s.maquinaId, (porMaquina.get(s.maquinaId) ?? 0) + 1);
        console.log('--- maquinas ---');
        for (const [m, n] of porMaquina) console.log(`${m}: ${n} loja(s)`);
        console.log('--- conflito ---');
        console.log(porMaquina.size > 1 ? 'SIM: o mesmo numero em maquinas diferentes' : 'nao');
    }

    const chats = await prisma.chat.count();
    console.log('conversas no banco:', chats);
    await prisma.$disconnect();
})().catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
});
