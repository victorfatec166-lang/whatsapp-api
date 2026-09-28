import * as crypto from 'crypto';
import { prisma } from '../database/prisma';
import { createOrderWithStock } from './orders';
import { logDoModulo } from './logger';
import { mapaDeItens, registrarPedido, tokenWebhook, type Canal } from './marketplace';

const log = logDoModulo('webhook');

/**
 * Entrada de pedido de marketplace.
 *
 * O caminho e' parecido com o do bot: o pedido chega, e' normalizado para o
 * formato interno, e' precificado e gravado em UM commit, com a baixa de
 * estoque junto. A diferenca esta no comeco e no fim do caminho.
 *
 * No comeco, a assinatura. Um webhook e' um address publico: qualquer um na
 * internet pode mandar POST para ele. Sem conferir assinatura, o que chega e'
 * pedido falso -- com estoque do seu catalogo sendo baixado por gente que nao
 * comprou nada. Por isso a regra e' dura: sem token configurado, RECUSA. Nao
 * aceita "deixa passar em modo teste", porque e' assim que o falso entra.
 *
 * No fim, o casamento de item. O marketplace manda o id do produto DELE. Sem
 * saber qual produto do catalogo local e', nao ha como dar baixa de estoque sem
 * adivinhar, e adivinhar estoque errado e vender o que nao tem.
 */

/** Item normalizado, ja no formato interno. */
type ItemNormalizado = { productId: string; qty: number; nome: string; observacoes?: string };

export type PedidoNormalizado = {
    externalId: string;
    itens: ItemNormalizado[];
    /**
     * Itens que chegaram sem casamento com o catalogo local.
     *
     * Eles entram no pedido para a cozinha ver, mas SEM baixar estoque: sem o
     * casamento, qualquer baixa seria no produto errado, e vender o que nao tem
     * e' pior do que nao baixar. A tela de configuracao avisa quantos faltam.
     */
    itensSemMapeamento: Array<{ nome: string; qty: number; externalId: string }>;
    clienteNome: string | null;
    clienteTelefone: string;
    observacoes: string | null;
    /** Valor declarado pelo marketplace. Guardado so para conferir. */
    totalDeclarado: number | null;
};

/**
 * Confere a assinatura do webhook.
 *
 * O marketplace assina o corpo cru com o token compartilhado, em HMAC-SHA256
 * codificado em base64 ou hexadecimal. As duas formas sao aceitas porque cada
 * plataforma escolheu uma, e o que importa e' comparar em tempo constante.
 *
 * Quando nao ha token configurado, devolve false. Configuracao segura e
 * negativa: o padrao de quem nao configurou e' nao aceitar nada.
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
 * Normaliza o corpo do pedido.
 *
 * O nome dos campos varia de plataforma para plataforma, e essa funcao e' o
 * unico lugar onde essa variacao mora. O resto do sistema so' ve o formato
 * interno.
 *
 * O que NAO esta aqui e' a tabela de campos exata de cada uma: os nomes mudam
 * conforme a versao do contrato do parceiro. O que importa agora e' que o
 * caminho aceite duas formas -- "data"/"items", o formato interno -- e uma
 * forma embrulhada, e que qualquer coisa fora disso seja recusada em vez de
 * entrar pela metade.
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

    // O cliente vem aninhado em algumas plataformas e solto em outras. O
    // cast vem do `unknown` do campo generico, nao de uma suposicao sobre o
    // formato: e' a mesma normalizacao dos itens, so que para o cliente.
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
 * Recebe o pedido de fora e grava.
 *
 * O passo de deduplicacao vem antes de qualquer gravacao: a plataforma
 * reenvia quando nao recebe o retorno, entao o mesmo pedido pode chegar varias
 * vezes em minutos. Gravar duas vezes seria o mesmo pedido duas vezes no
 * Kanban e o estoque baixo duas vezes.
 */
export async function receberPedido(channel: Canal, corpo: string, cabecalhos: Record<string, string | undefined>) {
    const token = await tokenWebhook(channel);
    if (!conferirAssinatura(corpo, cabecalhos, token)) {
        return { aceito: false, motivo: 'assinatura invalida' as const };
    }

    let bruto: unknown;
    try {
        bruto = JSON.parse(corpo);
    } catch {
        return { aceito: false, motivo: 'json invalido' as const };
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
     * Reenvio normal: o pedido ja esta no banco, e a plataforma quer o mesmo
     * retorno. Confirmar de novo e' a resposta certa -- o pedido ja esta no
     * Kanban e repetir seria o erro.
     *
     * Esta checagem cobre o caso comum. A corrida entre duas entregas do mesmo
     * pedido chegando no mesmo instante nao passa por aqui: as duas leem antes
     * de qualquer uma gravar. Quem fecha essa janela e' o indice unico, com o
     * externalId entrando no mesmo commit do insert -- a segunda delas falha no
     * insert e sobe como 500, que e' melhor do que pedido duplicado.
     */
    const jaExiste = await prisma.order.findUnique({
        where: { channel_externalId: { channel, externalId: normalizado.externalId } },
    });
    if (jaExiste) {
        return { aceito: true, duplicado: true, id: jaExiste.id };
    }

    /*
     * Itens sem casamento entram com o nome, mas SEM baixa de estoque.
     *
     * Entrar e' melhor do que recusar: o pedido e' real, o cliente pagou, e a
     * cozinha precisa saber o que montar. O que nao pode e' baixar o estoque
     * do produto errado, entao esse item vai no pedido sem tocar no saldo, e a
     * tela avisa quantos faltam casar. Recusar o pedido faria a loja perder
     * dinheiro de verdade.
     */
    const linhas = [
        ...normalizado.itens.map((i) => ({
            qty: i.qty,
            name: i.nome,
            mods: i.observacoes ? [i.observacoes] : [],
        })),
        // A mesma lista que a normalizacao ja separou. Ela nao e' reprocessada
        // aqui de proposito: ler o payload duas vezes e' como os dois leitores
        // passam a divergir depois de uma manutencao.
        ...normalizado.itensSemMapeamento.map((i) => ({ qty: i.qty, name: i.nome, mods: [] })),
    ];

    const { serializeItems } = await import('./items');
    const textoItens = serializeItems(linhas);

    // Subtotal: usa o declarado pelo marketplace quando vem, para nao divergir
    // do que o cliente pagou. A diferenca com o catalogo local fica visivel.
    const subtotal = normalizado.totalDeclarado ?? 0;

    const criado = await createOrderWithStock(
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
             * No mesmo commit do insert, e nao num update depois.
             *
             * A versao anterior criava o pedido e so entao gravava o
             * externalId, num segundo commit. Entre os dois, o pedido estava no
             * banco com externalId nulo, e um reenvio da plataforma nesse
             * intervalo passava pelo indice unico -- o mesmo pedido entrava duas
             * vezes no Kanban e o estoque baixava duas vezes. A plataforma
             * reenvia justamente quando nao recebe o retorno, ou seja, existe
             * alguem reenviando.
             *
             * Se o indice unico barrar agora, o erro sobe como falha de banco e
             * o webhook responde 500. Isso e' a resposta certa: o pedido ja
             * existe, e repetir ele seria o erro. A checagem la em cima trata o
             * reenvio normal; esta trata a corrida entre duas entregas do mesmo
             * pedido chegando ao mesmo tempo.
             */
            externalId: normalizado.externalId,
        },
        normalizado.itens.map((i) => ({ productId: i.productId, qty: i.qty })),
        'pdv'
    );

    await registrarPedido(channel);

    return {
        aceito: true,
        duplicado: false,
        id: criado.order.id,
        itensSemMapeamento: normalizado.itensSemMapeamento,
        shortfalls: criado.shortfalls.length,
    };
}
