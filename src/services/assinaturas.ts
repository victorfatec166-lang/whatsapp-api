/*
 * O que um pagamento do Asaas significa para uma loja.
 *
 * Tabelas globais: quem administra assinaturas e' quem vende, e uma loja nao
 * enxerga a assinatura de outra. Da' o Prisma CRU, e nao o cliente com loja.
 */
import crypto from 'node:crypto';
import { prisma } from '../database/prisma';
import {
    criaAssinatura as criaAssinaturaAsaas,
    criaCliente,
    leAssinatura,
    urlDePagamento,
} from './asaas';
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

    /*
     * Vale a senha que o DONO escolheu no cadastro. Dar outra, que ficaria so no
     * log que ele nunca abre, seria um sistema que parece nao funcionar.
     */
    const escolhida = await prisma.credencialProvisional.findUnique({ where: { tenantId } });
    const senha = escolhida?.senha || senhaAleatoria();
    const { hash, sal } = await derivaSenha(senha);

    await prisma.user.create({
        data: {
            tenantId,
            email: emailDono,
            nome: nome || 'Administrador',
            senhaHash: hash,
            senhaSalt: sal,
            papel: 'admin',
            // A senha escolhida no cadastro ja e' definitiva: pedir troca na
            // primeira entrada seria exigir que ele digite duas vezes a mesma.
            precisaTrocarSenha: !escolhida,
        },
    });

    log.info('='.repeat(64));
    log.info('CONTA DO ADMINISTRADOR CRIADA (assinatura paga)');
    log.info(`  e-mail .... ${emailDono}`);
    log.info(`  loja ...... ${tenantId}`);
    log.info(`  senha ..... ${escolhida ? '(a escolhida no cadastro)' : senha}`);
    log.info(escolhida ? '  Entra direto, sem troca obrigatoria.' : '  Troca obrigatoria no primeiro acesso.');
    log.info('='.repeat(64));
}

/**
 * A senha de entrada do dono, guardada no cadastro para ele buscar. `User` nao
 * serve: ela some quando ele troca, e ele pagou e vai entrar agora. Some na troca.
 */
export async function senhaDoDonoPendente(tenantId: string): Promise<{ email: string; senha: string } | null> {
    const linha = await prisma.credencialProvisional.findUnique({ where: { tenantId } });
    if (!linha) return null;
    return { email: linha.email, senha: linha.senha };
}

/** A senha que o dono digitou no cadastro, esperando o pagamento chegar. */
export async function guardaSenhaEscolhida(tenantId: string, senha: string): Promise<void> {
    const assinatura = await prisma.assinatura.findUnique({
        where: { tenantId },
        select: { emailDono: true },
    });
    await prisma.credencialProvisional.upsert({
        where: { tenantId },
        create: { tenantId, email: assinatura?.emailDono ?? '', senha, criadoEm: new Date() },
        update: { senha, criadoEm: new Date() },
    });
}

/**
 * Onde o dono paga, e quantos dias de teste faltam. `pagina` e' null enquanto nao
 * existe cobranca, e a tela diz para aguardar em vez de mostrar link quebrado.
 */
export async function statusDoDono(tenantId: string): Promise<{
    pagina: string | null;
    testeAte: Date | null;
    testeRestante: number;
    ativo: boolean;
} | null> {
    const assinatura = await prisma.assinatura.findUnique({ where: { tenantId } });
    if (!assinatura) return null;

    /*
     * A assinatura pode ter nascido antes desta coluna existir, e o dono precisa
     * pagar do mesmo jeito: sem id guardado, uma leitura no Asaas devolve a cobranca
     * e a tela volta a ter link.
     */
    let cobranca = assinatura.asaasCobranca;
    if (!cobranca && assinatura.asaasSubscription) {
        try {
            const la = await leAssinatura(assinatura.asaasSubscription);
            cobranca = la.latestInvoice ?? null;
            if (cobranca) {
                await prisma.assinatura.update({
                    where: { tenantId },
                    data: { asaasCobranca: cobranca },
                });
            }
        } catch (erro) {
            log.warn('Nao consegui buscar a cobranca da assinatura:', String(erro));
        }
    }

    const testeAte = assinatura.testeAte;
    const testeRestante = testeAte ? Math.max(0, Math.ceil((testeAte.getTime() - Date.now()) / 86_400_000)) : 0;

    return {
        pagina: cobranca ? urlDePagamento(cobranca) : null,
        testeAte,
        testeRestante,
        ativo: assinatura.status === 'ativa',
    };
}

/**
 * O teste acabou: a loja perde o acesso ate a mensalidade cair. Roda no mesmo
 * tique da virada do dia -- sem isto, "14 dias" seria teste eterno, e a loja que
 * mais usaria o sistema seria a que menos pagou.
 */
export async function venceTestes(): Promise<number> {
    const vencidas = await prisma.assinatura.findMany({
        where: {
            testeAte: { lte: new Date() },
            status: { not: 'ativa' },
        },
        select: { tenantId: true },
    });

    for (const { tenantId } of vencidas) {
        await desligaLoja(tenantId, 'teste de 14 dias encerrado sem pagamento');
    }
    return vencidas.length;
}

/** Chamado quando o dono troca a senha: o acesso provisorio cumpriu o papel. */
export async function apagaSenhaDoDono(tenantId: string): Promise<void> {
    await prisma.credencialProvisional.deleteMany({ where: { tenantId } }).catch(() => 0);
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
 * Venda nova: cria a loja, a assinatura no Asaas e a conta do dono. A loja nasce
 * LIGADA quando ha teste, desligada quando nao ha: o acesso sem pago e' um PRAZO
 * no banco, e nao uma exemptao no login.
 */
export async function registraVenda(dados: {
    nomeLoja: string;
    emailDono: string;
    nome: string;
    senha: string;
    valor: number;
    plano: string;
    primeiroVencimento: string;
    testeDias: number;
    cpfCnpj?: string;
    telefone?: string;
    formaPagamento?: 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX';
}): Promise<{ loja: string; assinatura: string; testeAte: Date | null }> {
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

    const testeAte = dados.testeDias > 0 ? new Date(Date.now() + dados.testeDias * 24 * 60 * 60 * 1000) : null;

    try {
        await prisma.tenant.create({ data: { id: lojaId, name: dados.nomeLoja, ativo: testeAte !== null } });
        await prisma.assinatura.create({
            data: {
                tenantId: lojaId,
                asaasCustomer: cliente.id,
                asaasSubscription: assinatura.id,
                asaasCobranca: assinatura.latestInvoice ?? null,
                emailDono: dados.emailDono.toLowerCase(),
                plano: dados.plano,
                valor: dados.valor,
                status: 'pendente',
                testeAte,
                proximoVencimento: comoData(assinatura.nextDueDate),
            },
        });

        /*
         * A conta nasce junto com a loja, e nao no webhook: com teste, o dono entra
         * HOJE e a senha e' a que ele digitou. Esperar o pagamento entregaria um
         * produto que so funciona depois de pagar -- e o teste justamente nao espera.
         */
        const { hash, sal } = await derivaSenha(dados.senha);
        await prisma.user.create({
            data: {
                tenantId: lojaId,
                email: dados.emailDono.toLowerCase(),
                nome: dados.nome,
                senhaHash: hash,
                senhaSalt: sal,
                papel: 'admin',
                precisaTrocarSenha: false,
            },
        });
    } catch (erro) {
        const { removeAssinatura } = await import('./asaas');
        await removeAssinatura(assinatura.id).catch(() => {});
        throw erro;
    }

    log.info('Venda registrada', {
        loja: lojaId,
        assinatura: assinatura.id,
        testeAte: testeAte ? testeAte.toISOString() : 'sem teste',
    });
    return { loja: lojaId, assinatura: assinatura.id, testeAte };
}