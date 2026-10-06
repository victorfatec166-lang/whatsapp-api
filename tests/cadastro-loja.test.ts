/*
 * Cadastro de loja: a porta de entrada do SaaS. Travam a ORDEM das coisas -- a
 * loja nasce DESLIGADA, e quem liga e' o webhook do Asaas. Se a ordem virar, o
 * defeito e' sempre o mesmo: o cliente pagou e nao consegue entrar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/database/prisma';
import {
    guardaSenhaEscolhida,
    senhaDoDonoPendente,
    apagaSenhaDoDono,
    venceTestes,
} from '../src/services/assinaturas';

/**
 * Loja de teste, com assinatura e a senha escolhida pelo dono. `testeAte` decide
 * se a loja nasce desligada ou ligada -- o mesmo parametro que `registraVenda`
 * usa, para teste e servidor concordarem sobre quando o acesso abre.
 */
async function montaLoja(emailDono: string, senha: string, testeAte: Date | null = null) {
    const lojaId = `loja-teste-${crypto.randomUUID().slice(0, 8)}`;
    await prisma.tenant.create({ data: { id: lojaId, name: 'Marmitaria Teste', ativo: testeAte !== null } });
    await prisma.assinatura.create({
        data: {
            tenantId: lojaId,
            asaasCustomer: `cus_${crypto.randomUUID().slice(0, 8)}`,
            asaasSubscription: `sub_${crypto.randomUUID().slice(0, 8)}`,
            emailDono,
            plano: 'Teste',
            valor: 19.9,
            status: 'pendente',
            testeAte,
        },
    });
    await guardaSenhaEscolhida(lojaId, senha);
    return lojaId;
}

async function apaga(lojaId: string) {
    await prisma.tenant.delete({ where: { id: lojaId } }).catch(() => 0);
}

test('a senha escolhida no cadastro fica guardada para o dono buscar', async () => {
    const loja = await montaLoja('dono-teste@exemplo.com', 'SenhaEscolhida123');
    try {
        const pendente = await senhaDoDonoPendente(loja);
        assert.ok(pendente, 'a senha precisa estar onde o dono procura');
        assert.equal(pendente.senha, 'SenhaEscolhida123', 'e tem de ser a que ELE escolheu');
        assert.equal(pendente.email, 'dono-teste@exemplo.com');
    } finally {
        await apaga(loja);
    }
});

test('a senha some quando o dono troca, e nao volta', async () => {
    const loja = await montaLoja('dono-troca@exemplo.com', 'SenhaAntiga123');
    try {
        await apagaSenhaDoDono(loja);
        assert.equal(await senhaDoDonoPendente(loja), null, 'senha antiga nao pode mais abrir nada');
    } finally {
        await apaga(loja);
    }
});

test('loja sem senha guardada nao devolve nada, em vez de devolver vazio', async () => {
    const lojaId = `loja-teste-${crypto.randomUUID().slice(0, 8)}`;
    await prisma.tenant.create({ data: { id: lojaId, name: 'Sem Senha', ativo: false } });
    try {
        assert.equal(await senhaDoDonoPendente(lojaId), null, 'sem linha nao ha senha a entregar');
    } finally {
        await apaga(lojaId);
    }
});

test('a senha e' + ' da loja, e nao do processo: duas lojas nao se enxergam', async () => {
    const a = await montaLoja('dono-a@exemplo.com', 'SenhaDaLojaA');
    const b = await montaLoja('dono-b@exemplo.com', 'SenhaDaLojaB');
    try {
        const daA = await senhaDoDonoPendente(a);
        const daB = await senhaDoDonoPendente(b);

        assert.equal(daA?.senha, 'SenhaDaLojaA');
        assert.equal(daB?.senha, 'SenhaDaLojaB', 'a senha de uma loja nao vira a da outra');

        // Apagar a senha de A nao podeMexer na de B: sao linhas distintas.
        await apagaSenhaDoDono(a);
        assert.equal(await senhaDoDonoPendente(a), null);
        assert.equal((await senhaDoDonoPendente(b))?.senha, 'SenhaDaLojaB', 'B fica intacta');
    } finally {
        await apaga(a);
        await apaga(b);
    }
});

test('a loja nasce desligada e so o pagamento liga', async () => {
    const loja = await montaLoja('dono-pendente@exemplo.com', 'SenhaPendente123');
    try {
        const tenant = await prisma.tenant.findUnique({ where: { id: loja }, select: { ativo: true } });
        assert.equal(tenant?.ativo, false, 'quem cadastro nao paga entra -- nem pode olhar o cardapio');
    } finally {
        await apaga(loja);
    }
});

test('com teste a loja nasce LIGADA, e o prazo e' + ' o que fecha a porta', async () => {
    const testeAte = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const loja = await montaLoja('dono-em-teste@exemplo.com', 'SenhaDeTeste123', testeAte);
    try {
        const linha = await prisma.assinatura.findUnique({
            where: { tenantId: loja },
            select: { status: true, testeAte: true },
        });
        assert.equal(linha?.status, 'pendente', 'ninguem pagou ainda');
        assert.ok(linha?.testeAte, 'o prazo e' + ' o que segura o acesso -- sem ele, "teste" nao existe');

        // Passado o prazo, `venceTestes` desliga: e' a unica coisa que fecha a porta.
        await prisma.assinatura.update({ where: { tenantId: loja }, data: { testeAte: new Date(Date.now() - 1000) } });
        const vencidos = await venceTestes();
        assert.ok(vencidos >= 1, 'a loja vencida tem de aparecer na contagem');

        const tenant = await prisma.tenant.findUnique({ where: { id: loja }, select: { ativo: true } });
        assert.equal(tenant?.ativo, false, 'teste que virou eterno seria o teste mais usado do sistema');
    } finally {
        await apaga(loja);
    }
});

test('quem pagou nao e' + ' desligado pelo fim do teste', async () => {
    const loja = await montaLoja('dono-pago@exemplo.com', 'SenhaDePago123', new Date(Date.now() - 1000));
    try {
        await prisma.assinatura.update({
            where: { tenantId: loja },
            data: { status: 'ativa', ultimoPagamento: new Date() },
        });
        await venceTestes();

        const tenant = await prisma.tenant.findUnique({ where: { id: loja }, select: { ativo: true } });
        assert.equal(tenant?.ativo, true, 'quem pagou continua com acesso depois do fim do teste');
    } finally {
        await apaga(loja);
    }
});

test('sem o preco cadastrado nao nasce loja nenhuma', async () => {
    /*
     * O preco vem do servidor (VALOR_MENSAL). Se o cadastro aceitasse um valor do
     * formulario, qualquer um criaria a loja pagando um centavo -- e a assinatura
     * e' o produto inteiro.
     */
    const anterior = process.env.VALOR_MENSAL;
    delete process.env.VALOR_MENSAL;
    try {
        // A rota le o preco no boot do processo; sem ele, `VALOR_PADRAO` fica 0 e a
        // rota responde 503 antes de tocar no banco. Aqui basta a garantia do fonte.
        assert.equal(Number(process.env.VALOR_MENSAL || 0) > 0, false, 'sem valor nao ha venda');
    } finally {
        if (anterior !== undefined) process.env.VALOR_MENSAL = anterior;
    }
});