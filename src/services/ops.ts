/*
 * O painel de administracao: as lojas de todos os clientes. Sao as unicas consultas
 * que atravessam loja de proposito -- o resto nunca sai da loja da sessao. Da' o
 * caminho `/ops` e a guarda por rede. Aqui so' le e desliga.
 */
import { prisma } from '../database/prisma';
import { logDoModulo } from './logger';
const log = logDoModulo('ops');

export type LinhaLoja = {
    id: string;
    nome: string;
    /** 'desligada' e' o que o cliente ve: um login recusado. */
    estado: 'ativa' | 'desligada';
    assinatura: 'ativa' | 'pendente' | 'atrasada' | 'cancelada' | 'sem-assinatura';
    plano: string;
    valor: number;
    emailDono: string;
    /** Data em que o teste acaba; null quando nao ha teste. */
    testeAte: Date | null;
    diasDeTeste: number;
    ultimoPagamento: Date | null;
    criadoEm: Date;
    /** Quantos produtos a loja tem: loja vazia e' loja que nao ativou. */
    produtos: number;
    pedidos: number;
};

/** Data local, nunca toISOString: em UTC o dia vira o seguinte depois das 21h. */
function diasAte(d: Date | null): number {
    if (!d) return 0;
    return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));
}

export async function listaDeLojas(): Promise<LinhaLoja[]> {
    /*
     * Uma consulta so. Trazer loja por loja era tres idas ao banco por linha, e
     * a tela e' curta -- mas "curta" e' justamente o que faz uma lista de clientes
     * demorar para aparecer quando chegam cinquenta.
     */
    const [lojas, assinaturas, produtos, pedidos] = await Promise.all([
        prisma.tenant.findMany({ orderBy: { criadoEm: 'desc' } }),
        prisma.assinatura.findMany(),
        prisma.product.groupBy({ by: ['tenantId'], _count: { _all: true } }),
        prisma.order.groupBy({ by: ['tenantId'], _count: { _all: true } }),
    ]);

    const assinaturaPorLoja = new Map(assinaturas.map((a) => [a.tenantId, a]));
    const produtosPorLoja = new Map(produtos.map((p) => [p.tenantId, p._count._all]));
    const pedidosPorLoja = new Map(pedidos.map((p) => [p.tenantId, p._count._all]));

    return lojas.map((l) => {
        const a = assinaturaPorLoja.get(l.id);
        return {
            id: l.id,
            nome: l.name,
            estado: l.ativo ? 'ativa' : 'desligada',
            assinatura: (a?.status as LinhaLoja['assinatura']) ?? 'sem-assinatura',
            plano: a?.plano ?? '',
            valor: a?.valor ?? 0,
            emailDono: a?.emailDono ?? '',
            testeAte: a?.testeAte ?? null,
            diasDeTeste: diasAte(a?.testeAte ?? null),
            ultimoPagamento: a?.ultimoPagamento ?? null,
            criadoEm: l.criadoEm,
            produtos: produtosPorLoja.get(l.id) ?? 0,
            pedidos: pedidosPorLoja.get(l.id) ?? 0,
        };
    });
}

export type Resumo = {
    lojas: number;
    ativas: number;
    emTeste: number;
    pagando: number;
    receitaMensal: number;
};

/** Os numeros do topo da tela. Receita e' a soma do que esta MAIS pagando hoje. */
export async function resumo(): Promise<Resumo> {
    const linhas = await listaDeLojas();
    const pagando = linhas.filter((l) => l.assinatura === 'ativa');
    return {
        lojas: linhas.length,
        ativas: linhas.filter((l) => l.estado === 'ativa').length,
        // Em teste e' loja sem assinatura ativa: e' o que ainda pode virar cliente.
        emTeste: linhas.filter((l) => l.assinatura !== 'ativa' && l.diasDeTeste > 0).length,
        pagando: pagando.length,
        receitaMensal: pagando.reduce((s, l) => s + l.valor, 0),
    };
}

/**
 * Desliga ou religa uma loja. E' o mesmo caminho do cliente inadimplente: o
 * login e' recusado e nada e' apagado, porque o pedido e' do dono da loja.
 */
export async function alternaLoja(tenantId: string, ligar: boolean): Promise<boolean> {
    const alvo = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!alvo) return false;

    await prisma.tenant.update({ where: { id: tenantId }, data: { ativo: ligar } });
    log.warn(`Loja ${ligar ? 'religada' : 'desligada'} pelo painel de administracao`, { tenantId });
    return true;
}

/**
 * Apaga a loja e tudo que pertence a ela. `onDelete: Cascade` e' quem faz o
 * trabalho: uma linha de Tenant derruba produto, pedido, conversa e caixa. Por
 * isso e' IRREVERSIVEL e fica longe do `alternaLoja`: desligar e' o dia a dia.
 */
export async function apagaLoja(tenantId: string): Promise<boolean> {
    const alvo = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
    if (!alvo) return false;

    await prisma.tenant.delete({ where: { id: tenantId } });
    log.error(`Loja APAGADA pelo painel de administracao: ${alvo.name}`, { tenantId });
    return true;
}