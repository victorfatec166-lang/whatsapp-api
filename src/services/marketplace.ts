import * as crypto from 'crypto';
import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { logDoModulo } from './logger';
import { exigeLoja } from './loja';

const log = logDoModulo('marketplace');

/**
 * Contas de marketplace: credencial guardada, estado real e casamento de itens.
 * Regra do modulo: a tela nao promete o que nao pode cumprir. O estado vem do
 * que este app consegue fazer, nao do 200 que o marketplace devolveu.
 */

/** Canais suportados. O id coincide com Order.channel. */
export const CANAIS = ['ifood', '99food'] as const;
export type Canal = (typeof CANAIS)[number];

/** Fases que a conexao pode estar. A ordem importa na tela. */
export const STATUS_CONTA = ['sem-credencial', 'homologacao', 'ativo', 'erro'] as const;
export type StatusConta = (typeof STATUS_CONTA)[number];

/**
 * Erro de regra: algo que a pessoa precisa ler para corrigir. Separa "faltou o
 * CHANNEL_SECRET" de "o banco caiu", e e' o unico ponto onde throw e' certo:
 * sao checagens que o chamador PRECISA conhecer.
 */
export class ErroDeRegra extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = 'ErroDeRegra';
    }
}

/**
 * Chave de cifra, do ambiente e sem valor padrao: sem CHANNEL_SECRET guardar
 * credencial e' recusado, e nao feito com chave fraca embutida no codigo.
 * Os 32 bytes saem de SHA-256, para o dono nao ter que contar bytes no .env.
 */
function chaveDeCifra(): Buffer | null {
    const bruto = process.env.CHANNEL_SECRET?.trim();
    if (!bruto) return null;
    // 32 bytes para o AES-256. Um texto de outro tamanho e' derivado com SHA-256
    // para o dono nao ter que contar bytes no .env.
    const chave = crypto.createHash('sha256').update(bruto).digest();
    return chave;
}

export function temChaveDeCifra(): boolean {
    return chaveDeCifra() !== null;
}

/**
 * Cifra um texto em AES-256-GCM, que traz autenticacao embutida: texto
 * adulterado faz a decifra falhar em vez de devolver lixo. O IV viaja ao lado
 * porque precisa ser novo a cada vez -- reusar IV com GCM vaza chave.
 */
export function cifrar(texto: string): string {
    if (!texto) return '';
    const chave = chaveDeCifra();
    if (!chave) {
        throw new ErroDeRegra("CHANNEL_SECRET nao configurado: nao e possivel guardar credencial.");
    }
    const iv = crypto.randomBytes(12);
    const cifra = crypto.createCipheriv('aes-256-gcm', chave, iv);
    const conteudo = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
    const tag = cifra.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${conteudo.toString('base64')}`;
}

/** Decifra. Texto vazio devolve vazio, que e' o estado de "sem credencial". */
export function decifrar(armazenado: string): string {
    if (!armazenado) return '';
    const chave = chaveDeCifra();
    if (!chave) return '';
    try {
        const [ivB64, tagB64, dadosB64] = armazenado.split('.');
        if (!ivB64 || !tagB64 || !dadosB64) return '';
        const decipher = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(dadosB64, 'base64')), decipher.final()]).toString('utf8');
    } catch (erro) {
        // Chave trocada depois de gravar, ou arquivo adulterado. Virou erro
        // logged e a conta volta para sem-credencial, que e' o estado honesto:
        // nao sabemos mais o que esta la dentro.
        log.error('Falha ao decifrar credencial; a conta volta para sem-credencial', {
            erro: String(erro),
        });
        return '';
    }
}

/** Resumo seguro da conta, sem credencial. E' o que a tela consome. */
export type ContaResumo = {
    channel: Canal;
    status: StatusConta;
    /** true quando ha credencial guardada. Nunca mostra o conteudo. */
    temCredencial: boolean;
    temWebhookSecret: boolean;
    lastOrderAt: Date | null;
    lastCheckAt: Date | null;
    lastError: string | null;
    /** Quantos itens do catalogo ja estao casado com o marketplace. */
    itensCasados: number;
    /** Quantos pedidos ja entraram por este canal. */
    pedidosRecebidos: number;
};

/**
 * Le a conta, criando-a se ainda nao existir: a tela precisa mostrar o caminho
 * ate a credencial mesmo antes de existir configuracao, e "conta inexistente"
 * nao tem o que mostrar.
 */
export async function obterConta(channel: Canal): Promise<ContaResumo> {
    const conta = await prisma.marketplaceAccount.upsert({
        where: { tenantId_channel: { tenantId: exigeLoja(), channel } },
        create: { tenantId: exigeLoja(), channel },
        update: {},
        include: { _count: { select: { items: true } } },
    });

    const pedidosRecebidos = await prisma.order.count({
        where: { channel, externalId: { not: null } },
    });

    return {
        channel: conta.channel as Canal,
        status: conta.status as StatusConta,
        temCredencial: conta.secretsEnc.length > 0,
        temWebhookSecret: conta.webhookSecretEnc.length > 0,
        lastOrderAt: conta.lastOrderAt,
        lastCheckAt: conta.lastCheckAt,
        lastError: conta.lastError,
        itensCasados: conta._count.items,
        pedidosRecebidos,
    };
}

/** As duas contas de uma vez, para a tela e para o boot. */
export async function listarContas(): Promise<ContaResumo[]> {
    const res = await Promise.all(CANAIS.map((c) => obterConta(c)));
    return res;
}

/** Guarda credencial e token de webhook, cifrados. */
export async function guardarCredencial(
    channel: Canal,
    dados: { segredo: string; webhookSecret?: string }
): Promise<void> {
    if (!temChaveDeCifra()) {
        throw new ErroDeRegra("CHANNEL_SECRET nao configurado no .env. Sem ele a credencial nao e guardada.");
    }
    if (!dados.segredo.trim()) {
        throw new ErroDeRegra('Informe a credencial do parceiro.');
    }

    await prisma.marketplaceAccount.upsert({
        where: { tenantId_channel: { tenantId: exigeLoja(), channel } },
        create: {
            tenantId: exigeLoja(),
            channel,
            secretsEnc: cifrar(dados.segredo.trim()),
            webhookSecretEnc: dados.webhookSecret?.trim() ? cifrar(dados.webhookSecret.trim()) : '',
            status: 'homologacao',
            lastError: null,
        },
        update: {
            secretsEnc: cifrar(dados.segredo.trim()),
            ...(dados.webhookSecret?.trim()
                ? { webhookSecretEnc: cifrar(dados.webhookSecret.trim()) }
                : {}),
            status: 'homologacao',
            lastError: null,
        },
    });
}

/** Apaga a credencial e volta o estado. Usado quando a credencial expira. */
export async function limparCredencial(channel: Canal): Promise<void> {
    await prisma.marketplaceAccount.update({
        where: { tenantId_channel: { tenantId: exigeLoja(), channel } },
        data: { secretsEnc: '', status: 'sem-credencial', lastError: null },
    });
}

/**
 * Registra o resultado de uma checagem de comunicacao.
 *
 * `ativo` so' e' gravado por quem testou de verdade -- ver testarCanal. Esta
 * funcao apenas anota o que aconteceu, e nao' decide estado sozinha.
 */
export async function registrarChecagem(
    channel: Canal,
    resultado: { ok: boolean; erro?: string }
): Promise<void> {
    await prisma.marketplaceAccount.update({
        where: { tenantId_channel: { tenantId: exigeLoja(), channel } },
        data: {
            status: resultado.ok ? 'ativo' : 'erro',
            lastCheckAt: new Date(),
            lastError: resultado.ok ? null : (resultado.erro ?? 'Falha desconhecida'),
        },
    });
}

/** Marca que um pedido chegou, para a tela mostrar "ultimo pedido". */
export async function registrarPedido(channel: Canal): Promise<void> {
    await prisma.marketplaceAccount.update({
        where: { tenantId_channel: { tenantId: exigeLoja(), channel } },
        data: { lastOrderAt: new Date() },
    });
}

/** Token de webhook em claro, para conferir assinatura. Vazio = recusar tudo. */
export async function tokenWebhook(channel: Canal): Promise<string> {
    const conta = await prisma.marketplaceAccount.findUnique({ where: { tenantId_channel: { tenantId: exigeLoja(), channel } } });
    if (!conta || !conta.webhookSecretEnc) return '';
    return decifrar(conta.webhookSecretEnc);
}

/** Guarda o casamento entre item do marketplace e produto do catalogo. */
export async function casarItem(
    channel: Canal,
    externalId: string,
    productId: string,
    lastPrice?: number
): Promise<void> {
    const conta = await prisma.marketplaceAccount.findUniqueOrThrow({ where: { tenantId_channel: { tenantId: exigeLoja(), channel } } });
    await prisma.marketplaceItem.upsert({
        where: { accountId_externalId: { accountId: conta.id, externalId } },
        create: {
            tenantId: exigeLoja(),
            accountId: conta.id,
            externalId,
            productId,
            lastPrice: lastPrice ?? null,
            lastSyncedAt: new Date(),
        },
        update: { productId, lastPrice: lastPrice ?? null, lastSyncedAt: new Date() },
    });
}

/**
 * Mapa item do marketplace -> produto local: e' o que permite dar baixa de
 * estoque num pedido de fora. Sem o casamento o sistema teria de adivinhar o
 * produto pelo nome -- e adivinhar estoque errado e' vender o que nao tem.
 */
export async function mapaDeItens(channel: Canal): Promise<Map<string, string>> {
    const conta = await prisma.marketplaceAccount.findUnique({ where: { tenantId_channel: { tenantId: exigeLoja(), channel } } });
    if (!conta) return new Map();
    const itens = await prisma.marketplaceItem.findMany({ where: { accountId: conta.id } });
    return new Map(itens.map((i) => [i.externalId, i.productId]));
}

/** Itens casados, para a tela de configuracao. */
export async function listarItensCasados(channel: Canal) {
    const conta = await prisma.marketplaceAccount.findUnique({ where: { tenantId_channel: { tenantId: exigeLoja(), channel } } });
    if (!conta) return [];
    return prisma.marketplaceItem.findMany({
        where: { accountId: conta.id },
        include: { product: { select: { id: true, name: true, price: true } } },
        orderBy: { product: { name: 'asc' } },
    });
}
