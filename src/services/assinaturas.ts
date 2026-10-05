/*
 * O que um pagamento do Asaas significa para uma loja.
 *
 * Tabelas globais: quem administra assinaturas e' quem vende, e uma loja nao
 * enxerga a assinatura de outra. Da' o Prisma CRU, e nao o cliente com loja.
 */
import crypto from 'node:crypto';
import { prisma } from '../database/prisma';
import { criaAssinatura as criaAssinaturaAsaas, criaCliente } from './asaas';
import { derivaSenha, senhaAleatoria } from './auth';
import { logDoModulo } from './logger';
const log = logDoModulo('assinaturas');

/** `data de vencimento` do Asaas e' `AAAA-MM-DD`; o resto do projeto usa Date. */
function comoData(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Cabecalho fixo do webhook. `timingSafeEqual` exige o mesmo tamanho nos dois lados. */
function mesmoToken(recebido: string, esperado: string): boolean {
    const a = Buffer.from(recebido);
    const b = Buffer.from(esperado);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export function webhookAutorizado(recebido: string | undefined): boolean {
    const esperado = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
    // Recusa por padrao: sem token configurado nada passa, e nao ha modo teste.
    if (!esperado || !recebido) return false;
    return mesmoToken(recebido, esperado);
}

/**
 * O Asaas reenvia o evento quando nao recebe o retorno, entao gravar o id e' o que
 * impede a segunda conta de administrador da mesma loja. Devolve `false` quando o
 * evento ja tinha passado por aqui.
 */
async function marcaProcessado(id: string, evento: string): Promise<boolean> {
    try {
        await prisma.eventoAssinatura.create({ data: { id, evento } });
        return true;
    } catch {
        return false;
    }
}

function assinaturaDo(idDaAssinatura: string) {
    return prisma.assinatura.findFirst({ where: { asaasSubscription: idDaAssinatura } });
}

/**
 * Liga a loja e cria a conta do dono. A senha aparece UMA vez, no log: nao ha
 * e-mail configurado, e e' o mesmo caminho que a conta de sempre usa.
 */
async function ligaLoja(tenantId: string, emailDono: string, nome: string): Promise<void> {
    await prisma.tenant.update({ where: { id: tenantId }, data: { ativo: true } });

    const jaTem = await prisma.user.findFirst({ where: { tenantId } });
    if (jaTem) return;

    const senha = senhaAleatoria();
    const { hash, sal } = await derivaSenha(senha);

    await prisma.user.create({
        data: {
            tenantId,
            email: emailDono,
            nome: nome || 'Administrador',
            senhaHash: hash,
            senhaSalt: sal,
            papel: 'admin',
            precisaTrocarSenha: true,
        },
    });

    log.info('='.repeat(64));
    log.info('CONTA DO ADMINISTRADOR CRIADA (assinatura paga)');
    log.info(`  e-mail .... ${emailDono}`);
    log.info(`  loja ...... ${tenantId}`);
    log.info(`  senha ..... ${senha}`);
    log.info('  Troca obrigatoria no primeiro acesso.');
    log.info('='.repeat(64));
}

/** Desliga a loja sem apagar nada: o historico de pedidos e' do dono. */
async function desligaLoja(tenantId: string, motivo: string): Promise<void> {
    const loja = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ativo: true, name: true } });
    if (!loja || !loja.ativo) return;
    await prisma.tenant.update({ where: { id: tenantId }, data: { ativo: false } });
    log.warn('Loja desligada: ' + motivo, { loja: tenantId, nome: loja.name });
}

/** Cobranca paga. No Pix o Asaas pula `CONFIRMED` e vem direto em `RECEIVED`. */
export async function pagamentoRecebido(
    idEvento: string,
    idDaAssinatura: string,
    quando: Date
): Promise<'ativada' | 'renovada' | 'duplicado' | 'desconhecida'> {
    if (!(await marcaProcessado(idEvento, 'pagamento'))) return 'duplicado';

    const assinatura = await assinaturaDo(idDaAssinatura);
    if (!assinatura) {
        log.warn('Pagamento de assinatura que nao existe aqui', { assinatura: idDaAssinatura });
        return 'desconhecida';
    }

    const primeiraVez = assinatura.ultimoPagamento === null;
    await prisma.assinatura.update({
        where: { id: assinatura.id },
        data: { status: 'ativa', ultimoPagamento: quando },
    });

    if (primeiraVez) {
        const loja = await prisma.tenant.findUnique({
            where: { id: assinatura.tenantId },
            select: { name: true },
        });
        await ligaLoja(assinatura.tenantId, assinatura.emailDono, loja?.name ?? '');
        return 'ativada';
    }
    return 'renovada';
}

export async function pagamentoVencido(idEvento: string, idDaAssinatura: string): Promise<void> {
    if (!(await marcaProcessado(idEvento, 'vencido'))) return;
    const assinatura = await assinaturaDo(idDaAssinatura);
    if (!assinatura) return;
    await prisma.assinatura.update({ where: { id: assinatura.id }, data: { status: 'atrasada' } });
    await desligaLoja(assinatura.tenantId, 'mensalidade vencida');
}

/** Estorno e' o dinheiro voltando, e vale como o atraso: a loja para de entrar. */
export async function pagamentoEstornado(idEvento: string, idDaAssinatura: string): Promise<void> {
    if (!(await marcaProcessado(idEvento, 'estorno'))) return;
    const assinatura = await assinaturaDo(idDaAssinatura);
    if (!assinatura) return;
    await prisma.assinatura.update({ where: { id: assinatura.id }, data: { status: 'cancelada' } });
    await desligaLoja(assinatura.tenantId, 'pagamento estornado');
}

/** Assinatura criada, alterada ou removida la no Asaas. */
export async function assinaturaAlterada(
    idEvento: string,
    dados: { id: string; valor?: number; status?: string; proximoVencimento?: string | null }
): Promise<void> {
    if (!(await marcaProcessado(idEvento, 'assinatura'))) return;

    const nossa = await assinaturaDo(dados.id);
    if (!nossa) {
        log.warn('Assinatura do Asaas sem linha aqui', { assinatura: dados.id });
        return;
    }

    await prisma.assinatura.update({
        where: { id: nossa.id },
        data: {
            valor: dados.valor ?? nossa.valor,
            status: dados.status === 'ACTIVE' ? 'ativa' : 'cancelada',
            proximoVencimento: comoData(dados.proximoVencimento) ?? nossa.proximoVencimento,
        },
    });

    if (dados.status && dados.status !== 'ACTIVE') {
        await desligaLoja(nossa.tenantId, 'assinatura cancelada no Asaas');
    }
}

/**
 * Venda nova: cria a loja desligada e a assinatura la no Asaas. A conta do dono
 * nasce no pagamento, e' por isso que a loja comeca com `ativo: false`.
 */
export async function registraVenda(dados: {
    nomeLoja: string;
    emailDono: string;
    valor: number;
    plano: string;
    primeiroVencimento: string;
    cpfCnpj?: string;
    telefone?: string;
    formaPagamento?: 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX';
}): Promise<{ loja: string; assinatura: string }> {
    const cliente = await criaCliente({
        nome: dados.nomeLoja,
        email: dados.emailDono,
        cpfCnpj: dados.cpfCnpj,
        telefone: dados.telefone,
    });

    /*
     * O id da loja vem antes porque viaja como `externalReference`, e e' por ele
     * que o webhook acha a loja. Se o banco recusar depois, a assinatura de la e'
     * cancelada: metade criada daria loja que nunca existiu cobrando.
     */
    const lojaId = `loja-${crypto.randomUUID().slice(0, 8)}`;
    const assinatura = await criaAssinaturaAsaas({
        customer: cliente.id,
        valor: dados.valor,
        primeiroVencimento: dados.primeiroVencimento,
        descricao: `${dados.plano} - DeliveryAdmin`,
        formaPagamento: dados.formaPagamento,
        referencia: lojaId,
    });

    try {
        await prisma.tenant.create({ data: { id: lojaId, name: dados.nomeLoja, ativo: false } });
        await prisma.assinatura.create({
            data: {
                tenantId: lojaId,
                asaasCustomer: cliente.id,
                asaasSubscription: assinatura.id,
                emailDono: dados.emailDono.toLowerCase(),
                plano: dados.plano,
                valor: dados.valor,
                status: 'pendente',
                proximoVencimento: comoData(assinatura.nextDueDate),
            },
        });
    } catch (erro) {
        const { removeAssinatura } = await import('./asaas');
        await removeAssinatura(assinatura.id).catch(() => {});
        throw erro;
    }

    log.info('Venda registrada, aguardando pagamento', { loja: lojaId, assinatura: assinatura.id });
    return { loja: lojaId, assinatura: assinatura.id };
}