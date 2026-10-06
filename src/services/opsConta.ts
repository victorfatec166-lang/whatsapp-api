/*
 * Criar conta sem pagar, para uso do dono do sistema. A beta precisa de um caminho
 * fora do Asaas: quem cadastra loja nova paga. Sem guarda aqui -- so' a rota
 * `/ops` chama isto, e ela ja' conferiu a origem e a variavel que liga o painel.
 */
import crypto from 'node:crypto';

import { prisma } from '../database/prisma';
import { derivaSenha } from './auth';
import { problemaDaSenha } from './regras';
import { logDoModulo } from './logger';
const log = logDoModulo('ops-conta');

/**
 * Dias de acesso sem cobranca para conta de teste. Longo de proposito: e' uma
 * conta de trabalho, e `TESTE_DIAS` (14) cortaria o dono no meio do trabalho.
 */
const DIAS = 3650;

/**
 * Cria loja, assinatura em teste e conta de administrador. Devolve o id da loja.
 *
 * O teste e' de verdade: `testeAte` recebe a data, e a virada do dia respeita --
 * uma conta que "nao paga" e' uma conta de teste, e nao uma conta sem prazo.
 */
export async function criaContaDeTeste(dados: {
    nome: string;
    nomeLoja: string;
    email: string;
    senha: string;
}): Promise<{ loja: string }> {
    const erro = problemaDaSenha(dados.senha);
    if (erro) throw new Error(erro);

    const lojaId = `ops-${crypto.randomUUID().slice(0, 8)}`;
    const testeAte = new Date(Date.now() + DIAS * 24 * 60 * 60 * 1000);

    const { hash, sal } = await derivaSenha(dados.senha);

    await prisma.tenant.create({ data: { id: lojaId, name: dados.nomeLoja, ativo: true } });
    await prisma.assinatura.create({
        data: {
            tenantId: lojaId,
            asaasCustomer: `cus_ops_${crypto.randomUUID().slice(0, 8)}`,
            emailDono: dados.email.toLowerCase(),
            plano: 'Operacao interna',
            valor: 0,
            // 'ativa' e nao 'pendente': a conta entra direto, e um teste de dez anos
            // nao termina -- que e' o que separa isto de uma conta de cliente.
            status: 'ativa',
            testeAte,
        },
    });
    await prisma.user.create({
        data: {
            tenantId: lojaId,
            email: dados.email.toLowerCase(),
            nome: dados.nome,
            senhaHash: hash,
            senhaSalt: sal,
            papel: 'admin',
            precisaTrocarSenha: false,
        },
    });

    log.info('Loja de operacao criada', { loja: lojaId, email: dados.email });
    return { loja: lojaId };
}