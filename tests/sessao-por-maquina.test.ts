/*
 * O boot so pode subir o WhatsApp que pertence a ESTA maquina.
 *
 * Banco e' o mesmo na nuvem e no PC. Sem o filtro, o local abria socket da loja
 * que a nuvem ja pareava e o WhatsApp recusava com "nao foi possivel conectar".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import { lojasComSessao } from '../src/services/whatsappSessao';

const NUVEM = 'sessao-maquina-nuvem-0001';
const LOCAL = 'sessao-maquina-local-0001';

/** Loja com sessao numa maquina especifica. `sessaoWhatsApp` e' `@@id([tenantId, maquinaId])`. */
async function pareia(tenantId: string, maquinaId: string) {
    await prisma.tenant.upsert({
        where: { id: tenantId },
        update: {},
        create: { id: tenantId, name: 'Loja ' + tenantId, ativo: true },
    });
    await prisma.sessaoWhatsApp.upsert({
        where: { tenantId_maquinaId: { tenantId, maquinaId } },
        update: { telefone: '5511900000000' },
        create: { tenantId, maquinaId, creds: '{}', telefone: '5511900000000' },
    });
}

const limpa = async () => {
    await prisma.sessaoWhatsApp.deleteMany({ where: { tenantId: { in: [NUVEM, LOCAL] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [NUVEM, LOCAL] } } });
};

test('cada maquina so religa o proprio WhatsApp', async () => {
    /* O teste que segura o conflito: a loja da nuvem nao entra na lista local, senao
     * os dois servidores abrem socket do mesmo numero. A limpeza vai em `finally`
     * para o banco nao ficar com sessao de teste e quebrar o teste seguinte. */
    await limpa();
    try {
        await pareia(NUVEM, 'nuvem');
        await pareia(LOCAL, 'local-dev');

        const naNuvem = await lojasComSessao('nuvem');
        const noLocal = await lojasComSessao('local-dev');

        assert.ok(naNuvem.includes(NUVEM), 'a nuvem tem de achar a propria loja');
        assert.ok(!naNuvem.includes(LOCAL), 'a nuvem subiu a loja do PC');
        assert.ok(noLocal.includes(LOCAL), 'o PC tem de achar a propria loja');
        assert.ok(!noLocal.includes(NUVEM), 'o PC subiu a loja da nuvem, e o conflito');
    } finally {
        await limpa();
    }
});

test('a mesma loja em duas maquinas: cada uma ve so a sua', async () => {
    /* Loja pareada nos dois lados e' o que o dono cria sem pensar: liga o bot no PC
     * para testar e esquece a nuvem rodando. Nao se compara o tamanho da lista, que
     * tem loja de verdade: interessa a de teste estar nas duas, uma vez so. */
    await limpa();
    try {
        await pareia(LOCAL, 'nuvem');
        await pareia(LOCAL, 'local-dev');

        const naNuvem = await lojasComSessao('nuvem');
        const noLocal = await lojasComSessao('local-dev');

        assert.ok(naNuvem.includes(LOCAL), 'a nuvem perdeu a loja');
        assert.ok(noLocal.includes(LOCAL), 'o PC perdeu a loja');

        // Cada lista so traz a loja de teste UMA vez, mesmo pareada nas duas maquinas.
        assert.equal(naNuvem.filter((l) => l === LOCAL).length, 1, 'a nuvem repetiu a loja');
        assert.equal(noLocal.filter((l) => l === LOCAL).length, 1, 'o PC repetiu a loja');
    } finally {
        await limpa();
    }
});

test('maquina sem sessao nenhuma nao traz loja nenhuma', async () => {
    const lista = await lojasComSessao('maquina-que-nunca-pareou-xyz');
    assert.equal(lista.length, 0);
});