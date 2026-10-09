/*
 * A assinatura vista pelo PC da loja.
 *
 * A nuvem responde o que a loja tem direito de saber (e nada do Asaas), e o aviso vem
 * antes do corte. O corte de verdade chega com o gateway; ate la, aviso e' aviso.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import { licencaDaLoja } from '../src/services/assinaturas';
import { avisoDeLicenca, avisoDaLicencaLocal } from '../src/services/licenca';
import type { LicencaDaLoja } from '../src/services/assinaturas';
import { garanteLojaDoTeste } from './lib/garante-loja';

const LOJA = process.env.DELIVERYADMIN_TENANT?.trim() || 'local';

function emDias(dias: number): Date {
    return new Date(Date.now() + dias * 86_400_000);
}

/** Deixa a assinatura da loja no estado pedido, e devolve como desfazer. */
async function comAssinatura(dados: {
    status: string;
    testeAte: Date | null;
}): Promise<() => Promise<void>> {
    const antes = await prisma.assinatura.findUnique({ where: { tenantId: LOJA } });
    const ativoAntes = await prisma.tenant.findUnique({ where: { id: LOJA }, select: { ativo: true } });
    await prisma.assinatura.upsert({
        where: { tenantId: LOJA },
        create: {
            tenantId: LOJA,
            asaasCustomer: 'cus_teste',
            emailDono: 'dono@teste',
            plano: 'Teste',
            valor: 0,
            status: dados.status,
            testeAte: dados.testeAte,
        },
        update: { status: dados.status, testeAte: dados.testeAte },
    });
    return async () => {
        if (antes) {
            await prisma.assinatura.update({
                where: { tenantId: LOJA },
                data: { status: antes.status, testeAte: antes.testeAte },
            });
        } else {
            await prisma.assinatura.deleteMany({ where: { tenantId: LOJA } });
        }
        if (ativoAntes) await prisma.tenant.update({ where: { id: LOJA }, data: { ativo: ativoAntes.ativo } });
    };
}

function licenca(parte: Partial<LicencaDaLoja>): LicencaDaLoja {
    return { nome: 'Loja do teste', ativo: true, status: 'pendente', testeAte: null, diasRestantes: 0, ...parte };
}

test.before(async () => {
    await garanteLojaDoTeste();
});

test.after(async () => {
    await prisma.$disconnect();
});

/* ------------------------------------------------- o que a nuvem responde */

test('a nuvem conta quantos dias faltam, e nao entrega a fatura', async (t) => {
    const desfaz = await comAssinatura({ status: 'pendente', testeAte: emDias(3) });
    t.after(desfaz);

    const resposta = await licencaDaLoja(LOJA);
    assert.ok(resposta, 'a loja existe');
    assert.equal(resposta!.diasRestantes, 3, 'faltam 3 dias');
    assert.equal(resposta!.status, 'pendente');
    assert.ok(resposta!.testeAte, 'o fim do teste viaja como data');

    const json = JSON.stringify(resposta);
    for (const proibido of ['asaas', 'valor', 'cobranca', 'pagina']) {
        assert.ok(!json.toLowerCase().includes(proibido), `a resposta nao pode falar de ${proibido}`);
    }
});

test('prazo vencido vira zero, e loja que nao existe vira null', async (t) => {
    const desfaz = await comAssinatura({ status: 'pendente', testeAte: emDias(-1) });
    t.after(desfaz);

    const vencida = await licencaDaLoja(LOJA);
    assert.equal(vencida!.diasRestantes, 0, 'prazo-passado e' + ' zero dias, e nao numero negativo');
    assert.equal(await licencaDaLoja('loja-que-nao-existe'), null);
});

/* ------------------------------------------------------------ o aviso na tela */

test('loja que paga nao ve aviso nenhum', () => {
    assert.equal(avisoDeLicenca(licenca({ status: 'ativa' })), null);
    assert.equal(avisoDeLicenca(null), null);
});

test('teste acabando avisa antes, com o dia certo', () => {
    const aviso = avisoDeLicenca(licenca({ status: 'pendente', diasRestantes: 1 }));
    assert.equal(aviso!.tom, 'atencao');
    assert.match(aviso!.titulo, /termina em 1 dia\b/);

    const varios = avisoDeLicenca(licenca({ status: 'pendente', diasRestantes: 3 }));
    assert.match(varios!.titulo, /termina em 3 dias\b/);
});

test('teste ainda longe do fim nao enche a tela de aviso todo dia', () => {
    assert.equal(avisoDeLicenca(licenca({ status: 'pendente', diasRestantes: 4 })), null);
    assert.equal(avisoDeLicenca(licenca({ status: 'pendente', diasRestantes: 30 })), null);
});

test('acesso cortado e' + ' o unico tom de erro, e vem antes da contagem', () => {
    const cortado = avisoDeLicenca(licenca({ ativo: false, status: 'atrasada', diasRestantes: 12 }));
    assert.equal(cortado!.tom, 'erro');
    assert.match(cortado!.titulo, /cortado/);
});

test('conta interna (sem assinatura, ligada) nao recebe aviso', () => {
    assert.equal(avisoDeLicenca(licenca({ status: 'sem-assinatura', ativo: true })), null);
});

test('o PC que nao tem chave de loja nao tem aviso nenhum', () => {
    assert.equal(avisoDaLicencaLocal(), null, 'sem chave colada, a nuvem nunca respondeu');
});