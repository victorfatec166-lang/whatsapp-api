/*
 * Remove loja de teste do banco compartilhado.
 *
 * Os testes criam loja de verdade no Supabase, que e' o mesmo da nuvem. Sobrando,
 * elas aparecem no `/ops` e, se tiverem sessao, o Render tenta subir o bot delas.
 * Nao ha `--force` aqui de proposito: sem parametro o script mostra o que
 * encontraria e nao apaga nada.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    datasourceUrl: (() => {
        const url = process.env.DATABASE_URL;
        if (!url || url.includes('connection_limit')) return url;
        return `${url}${url.includes('?') ? '&' : '?'}connection_limit=2`;
    })(),
});

const ALVO = process.argv[2];

/** Lojas que nunca sao apagadas: sao o trabalho do dono, nao lixo de teste. */
const PROTEGIDAS = new Set(
    ['local', process.env.DELIVERYADMIN_TENANT].filter(Boolean)
);

(async () => {
    // Teste cria nome com "teste" no id ou no nome. Loja de cliente nao entra aqui.
    const lojas = await prisma.tenant.findMany({ select: { id: true, name: true } });
    const soTeste = lojas.filter(
        (t) => /teste|dbg-/i.test(t.id) || /teste/i.test(t.name)
    );

    console.log('--- candidatas ---');
    for (const t of soTeste) {
        console.log(`${t.id}  ${t.name}${PROTEGIDAS.has(t.id) ? '   (protegida)' : ''}`);
    }

    if (ALVO === '--executar') {
        for (const t of soTeste) {
            if (PROTEGIDAS.has(t.id)) {
                console.log(`pula ${t.id}: loja de trabalho`);
                continue;
            }
            // `onDelete: Cascade` no schema leva sessao, chat, pedidos e produtos.
            await prisma.tenant.delete({ where: { id: t.id } });
            console.log(`apagada ${t.id}`);
        }
    } else {
        console.log('nada apagado. Para apagar mesmo: node scripts/limpaLojasDeTeste.cjs --executar');
    }

    await prisma.$disconnect();
})().catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
});