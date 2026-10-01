import * as crypto from 'crypto';
import { prisma } from '../database/prisma';
import { createOrderWithStock } from './orders';
import { logDoModulo } from './logger';
import { decifrar, mapaDeItens, registrarPedido, type Canal } from './marketplace';
import { comoLoja, exigeLoja } from './loja';

const log = logDoModulo('webhook');

/**
 * Endereco publico: sem conferir assinatura o que chega e' pedido falso, com estoque
 * do catalogo sendo baixado por quem nao comprou nada. Sem token configurado, RECUSA
 * -- nao existe "modo teste". Item sem casamento com o catalogo nao baixa estoque.
 */

/** Item normalizado, ja no formato interno. */
type ItemNormalizado = { productId: string; qty: number; nome: string; observacoes?: string };

export type PedidoNormalizado = {
    externalId: string;
    itens: ItemNormalizado[];
    /**
     * Itens que chegaram sem casamento com o catalogo local: entram no pedido para a
     * cozinha ver, mas SEM baixar estoque -- sem o casamento, a baixa seria no produto
     * errado, e vender o que nao tem e' pior do que nao baixar.
     */
    itensSemMapeamento: Array<{ nome: string; qty: number; externalId: string }>;
    clienteNome: string | null;
    clienteTelefone: string;
    observacoes: string | null;
    /** Valor declarado pelo marketplace. Guardado so para conferir. */
    totalDeclarado: number | null;
};

/**
 * Base64 ou hexadecimais porque cada plataforma escolheu uma; o que importa e'
 * comparar em tempo constante. Sem token devolve false: quem nao configurou nao
 * aceita nada.
 */
export function conferirAssinatura(corpo: string, cabecalhos: Record<string, string | undefined>, token: string): boolean {
    if (!token) return false;

    const recebido =
        cabecalhos['x-hub-signature-256'] ||
        cabecalhos['x-signature'] ||
        cabecalhos['x-ifood-signature'] ||
        cabecalhos['x-99food-signature'] ||
        '';

    if (!recebido) return false;

    // Alguns mandam "sha256=<hash>".
    const limpa = recebido.replace(/^sha256=/i, '').trim();

    const esperadoB64 = crypto.createHmac('sha256', token).update(corpo, 'utf8').digest('base64');
    const esperadoHex = crypto.createHmac('sha256', token).update(corpo, 'utf8').digest('hex');

    // timingSafeEqual exige mesmo tamanho; comparar o tamanho antes evita
    // que a propria comparacao vaze informacao.
    const confere = (a: string, b: string) => {
        const ba = Buffer.from(a);
        const bb = Buffer.from(b);
        if (ba.length !== bb.length) return false;
        return crypto.timingSafeEqual(ba, bb);
    };

    return confere(limpa, esperadoB64) || confere(limpa, esperadoHex);
}

/**
 * Unico lugar onde a variacao de nome de campo entre plataformas mora. O que importa
 * e aceitar o formato interno e o embrulhado, e recusar o resto pela metade.
 */
export function normalizar(corpo: unknown, mapa: Map<string, string>): PedidoNormalizado {
    const c = (corpo ?? {}) as Record<string, unknown>;

    // Aceita tanto o objeto direto quanto embrulhado em data/order/payload.
    const bruto =
        (c.data as Record<string, unknown>) ??
        (c.order as Record<string, unknown>) ??
        (c.payload as Record<string, unknown>) ??
        c;

    const itensBrutos = (bruto.items ?? bruto.products ?? bruto.itens ?? []) as unknown;
    if (!Array.isArray(itensBrutos) || itensBrutos.length === 0) {
        throw new Error('Pedido sem itens.');
    }

    const itens: ItemNormalizado[] = [];
    const semMapeamento: Array<{ nome: string; qty: number; externalId: string }> = [];

    for (const item of itensBrutos) {
        const it = (item ?? {}) as Record<string, unknown>;
        const nome = String(it.name ?? it.nome ?? it.title ?? '').trim();
        if (!nome) continue;

        const qtdBruta = Number(it.quantity ?? it.qtd ?? it.quantidade ?? 1);
        const qty = Math.max(1, Math.min(99, Math.round(Number.isFinite(qtdBruta) ? qtdBruta : 1)));

        // O id do marketplace tem preferencia; o nome serve de reserva manual.
        const externo = String(it.sku ?? it.id ?? it.productId ?? '').trim();
        const productId = mapa.get(externo) ?? mapa.get(nome.toLowerCase()) ?? '';

        if (!productId) {
            semMapeamento.push({ nome, qty, externalId: externo });
            continue;
        }

        itens.push({
            productId,
            qty,
            nome,
            observacoes: String(it.notes ?? it.observacoes ?? it.obs ?? '').trim() || undefined,
        });
    }

    // Pedido sem um item sequer e' pedido quebrado. Pedido com item sem
    // casamento e' pedido real, e entra -- ver receberPedido.
    if (itens.length === 0 && semMapeamento.length === 0) {
        throw new Error('Pedido sem itens validos.');
    }

    // Cliente vem aninhado em uma plataforma e solto em outra; e' a mesma
    // normalizacao dos itens, so que para o cliente.
    const cliente = (bruto.client ?? bruto.customer ?? bruto.cliente ?? {}) as Record<string, unknown>;

    const telefone = String(
        bruto.customerPhone ?? bruto.phone ?? bruto.telefone ?? cliente.phone ?? ''
    ).trim();

    const nomeCliente = String(
        bruto.customerName ?? cliente.name ?? cliente.nome ?? ''
    ).trim();

    return {
        externalId: String(bruto.id ?? bruto.orderId ?? bruto.externalId ?? '').trim(),
        itens,
        itensSemMapeamento: semMapeamento,
        clienteNome: nomeCliente || null,
        clienteTelefone: telefone || `marketplace:${Date.now()}`,
        observacoes: String(bruto.notes ?? bruto.observacoes ?? bruto.comment ?? '').trim() || null,
        totalDeclarado: Number.isFinite(Number(bruto.total)) ? Number(bruto.total) : null,
    };
}

/**
 * De que loja e' este pedido?
 *
 * O webhook e' a unica entrada do sistema que chega SEM sessao: quem chama e' o
 * iFood, nao uma pessoa. E' por isso que ela precisa descobrir a loja sozinha --
 * e a assinatura e' o que faz isso.
 *
 * Cada loja tem o SEU token de webhook, e o HMAC e' deterministico: o mesmo corpo
 * com o token de outra loja da outra assinatura. Entao a loja do pedido e' a conta
 * cujo token confere com a assinatura recebida. Nao e' adivinhacao nem backdoor:
 * sem o token da loja B nao ha assinatura que passe contra o token da loja A.
 *
 * Esta e' a UNICA consulta do sistema que atravessa lojas de proposito, e e' a
 * lista de contas -- nao dado de venda. Por isso usa o cliente cru: no momento em
 * que ela roda, a loja AINDA NAO FOI DESCOBERTA, e e' por isso que o filtro de
 * loja nao pode estar no caminho.
 */
async function lojaDoPedido(
    channel: Canal,
    corpo: string,
    cabecalhos: Record<string, string | undefined>
): Promise<string | null> {
    const contas = await prisma.marketplaceAccount.findMany({
        where: { channel, tenant: { ativo: true } },
        select: { tenantId: true, webhookSecretEnc: true },
    });
    for (const conta of contas) {
        if (!conta.webhookSecretEnc) continue;
        const token = decifrar(conta.webhookSecretEnc);
        if (token && conferirAssinatura(corpo, cabecalhos, token)) return conta.tenantId;
    }
    return null;
}

/**
 * Deduplica antes de qualquer gravacao: a plataforma reenvia quando nao recebe
 * o retorno, e gravar duas vezes seria o mesmo pedido duas vezes no Kanban com o
 * estoque baixo duas vezes.
 */
export type RespostaWebhook =
    | { aceito: true; duplicado: boolean; id: string; loja: string }
    | { aceito: false; motivo: string };

export async function receberPedido(
    channel: Canal,
    corpo: string,
    cabecalhos: Record<string, string | undefined>
): Promise<RespostaWebhook> {
    const loja = await lojaDoPedido(channel, corpo, cabecalhos);
    if (!loja) {
        return { aceito: false, motivo: 'assinatura invalida' };
    }
    // Daqui para frente vale a loja: toda consulta do pedido sai com o filtro
    // certo, sem ninguem pedir. A loja volta na resposta porque o dono precisa
    // saber de qual loja veio o pedido -- com o painel unico, a pergunta "de onde
    // foi este?" e' a primeira que ele faz quando um pedido chega errado.
    const r = await comoLoja(loja, () => processaPedido(channel, corpo));
    return { ...(r as object), loja } as RespostaWebhook;
}

async function processaPedido(channel: Canal, corpo: string) {
    let bruto: unknown;
    try {
        bruto = JSON.parse(corpo);
    } catch {
        return { aceito: false, motivo: 'json invalida' as const };
    }

    const mapa = await mapaDeItens(channel);
    let normalizado: PedidoNormalizado;
    try {
        normalizado = normalizar(bruto, mapa);
    } catch (erro) {
        return { aceito: false, motivo: String(erro) as never };
    }

    if (!normalizado.externalId) {
        return { aceito: false, motivo: 'pedido sem id de origem' as never };
    }

    /*
     * Reenvio normal: confirmar de novo e' a resposta certa. Duas entregas no mesmo
     * instante passam as duas por aqui, e a janela fecha no indice unico -- a segunda
     * falha no insert, o que e' melhor do que pedido duplicado.
     */
    const jaExiste = await prisma.order.findUnique({
        where: { tenantId_channel_externalId: { tenantId: exigeLoja(), channel, externalId: normalizado.externalId } },
    });
    if (jaExiste) {
        return { aceito: true, duplicado: true, id: jaExiste.id };
    }

    /*
     * Entram no pedido SEM baixa de estoque: recusar perderia dinheiro real, mas
     * baixar o saldo do produto errado e' vender o que nao tem. A tela avisa
     * quantos faltam casar.
     */
    const linhas = [
        ...normalizado.itens.map((i) => ({
            qty: i.qty,
            name: i.nome,
            mods: i.observacoes ? [i.observacoes] : [],
        })),
        // Lista que a normalizacao ja separou, nao reprocessada: ler o payload duas
        // vezes e' como os dois leitores divergem depois de uma manutencao.
        ...normalizado.itensSemMapeamento.map((i) => ({ qty: i.qty, name: i.nome, mods: [] })),
    ];

    const { serializeItems } = await import('./items');
    const textoItens = serializeItems(linhas);

    // Subtotal: usa o declarado pelo marketplace quando vem, para nao divergir
    // do que o cliente pagou. A diferenca com o catalogo local fica visivel.
    const subtotal = normalizado.totalDeclarado ?? 0;

    /*
     * O catch cobre a corrida do mesmo pedido chegando junto: as duas passam do "ja
     * existe" e uma e' barrada no indice unico. Isso NAO e' falha, entao vira resposta
     * de reenvio -- com 500 a plataforma marca o pedido como perdido com a cozinha montando.
     */
    let criado: Awaited<ReturnType<typeof createOrderWithStock>>;
    try {
        criado = await createOrderWithStock(
            {
                clientPhone: normalizado.clienteTelefone,
                clientName: normalizado.clienteNome,
                items: textoItens,
                subtotal,
                total: subtotal,
                notes: normalizado.observacoes,
                status: 'pendente',
                channel,
                paymentMethod: 'plataforma',
                /*
                 * No mesmo commit do insert: a versao anterior gravava o externalId
                 * num segundo commit, e um reenvio nesse intervalo passava pelo
                 * indice unico -- o mesmo pedido entrava duas vezes no Kanban.
                 */
                externalId: normalizado.externalId,
            },
            normalizado.itens.map((i) => ({ productId: i.productId, qty: i.qty })),
            'pdv'
        );
    } catch (erro) {
        if (ehViolacaoDeExternalId(erro)) {
            // O pedido que ganhou a corrida ja esta no Kanban. Devolve o mesmo
            // "duplicado" do reenvio normal.
            log.warn(`Corrida no webhook de ${channel}: o pedido ${normalizado.externalId} ja tinha sido gravado`);
            const jaGravado = await prisma.order.findUnique({
                where: { tenantId_channel_externalId: { tenantId: exigeLoja(), channel, externalId: normalizado.externalId } },
                select: { id: true },
            });
            return { aceito: true, duplicado: true, id: jaGravado?.id ?? '' };
        }
        throw erro;
    }

    await registrarPedido(channel);

    return {
        aceito: true,
        duplicado: false,
        id: criado.order.id,
        itensSemMapeamento: normalizado.itensSemMapeamento,
        shortfalls: criado.shortfalls.length,
    };
}

/**
 * Confere o indice em meta.target e nao so o codigo P2002: qualquer outro indice
 * unico violado tem o mesmo codigo e significaria outra coisa.
 */
function ehViolacaoDeExternalId(error: unknown): boolean {
    const e = error as { code?: unknown; meta?: { target?: unknown } };
    if (e?.code !== 'P2002') return false;
    const alvo = e.meta?.target;
    const lista = Array.isArray(alvo) ? alvo : typeof alvo === 'string' ? [alvo] : [];
    // O nome do indice vem como "Order_channel_externalId_key" ou como a lista
    // de colunas, dependendo da versao. Os dois casos sao tratados.
    return lista.some((t: unknown) => typeof t === 'string' && /channel.*externalId|externalId.*channel/i.test(t));
}
