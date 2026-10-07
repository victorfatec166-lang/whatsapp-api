/*
 * Quem esta com o numero pareado, e em qual maquina.
 *
 * O WhatsApp recusa o pareamento quando o mesmo numero ja esta linked em outro
 * lugar. Duas instalacoes disputando o mesmo numero produzem exatamente o erro que
 * o celular mostra, entao saber quem tem a sessao e' o primeiro passo do diagnostico.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    datasourceUrl: (() => {
        const url = process.env.DATABASE_URL;
        if (!url || url.includes('connection_limit')) return url;
        return `${url}${url.includes('?') ? '&' : '?'}connection_limit=2`;
    })(),
});

const conta = (linhas, chave) => {
    const m = new Map();
    for (const x of linhas) m.set(x[chave], (m.get(x[chave]) ?? 0) + 1);
    return m;
};

(async () => {
    const sessoes = await prisma.sessaoWhatsApp.findMany({
        select: { tenantId: true, maquinaId: true, telefone: true, atualizadoEm: true },
    });

    console.log('--- sessoes pareadas ---');
    if (sessoes.length === 0) console.log('(nenhuma)');
    for (const x of sessoes) {
        const quando = x.atualizadoEm.toISOString();
        const numero = x.telefone ?? '(sem numero)';
        console.log(`loja=${x.tenantId} maquina=${x.maquinaId} tel=${numero} ${quando}`);
    }

    const lojas = await prisma.tenant.findMany({ select: { id: true, name: true } });
    console.log('--- lojas ---');
    for (const x of lojas) console.log(`${x.id}  ${x.name}`);

    const porMaquina = conta(sessoes, 'maquinaId');
    console.log('--- maquinas ---');
    for (const [m, n] of porMaquina) console.log(`${m}: ${n} loja(s)`);

    // Mesma loja em duas maquinas e' o estado que derruba o numero: uma das duas
    // e' derrubada sem ninguem ver, e o dono so percebe que o bot "nao conecta".
    const porLoja = conta(sessoes, 'tenantId');
    const disputadas = [...porLoja].filter(([, n]) => n > 1);
    console.log('--- conflito ---');
    if (disputadas.length) {
        for (const [loja, n] of disputadas) console.log(`${loja}: ${n} maquinas`);
        console.log('CONFLITO: o mesmo numero em mais de um lugar');
    } else {
        console.log('sem conflito');
    }

    // Sessao sem numero e' tentativa que nunca fechou: so ocupa espaco e faz o
    // painel avisar "sessao de outra maquina" sem ninguem ter pareado nada.
    const pelaMetade = sessoes.filter((x) => !x.telefone);
    if (pelaMetade.length) {
        console.log('--- tentativa que nao fechou ---');
        for (const x of pelaMetade) console.log(`${x.tenantId} (maquina ${x.maquinaId})`);
    }

    await prisma.$disconnect();
})().catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
});