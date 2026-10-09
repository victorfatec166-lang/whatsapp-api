/*
 * O PC da loja puxa da nuvem duas coisas: o que o iFood e o 99Food empurraram, e o que
 * a assinatura esta'. A loja roda atras do roteador: o webhook chega na nuvem, vira
 * fila, e o PC pergunta a cada 20s. A nuvem guarda o HASH do segredo.
 */

import * as crypto from 'node:crypto';
import { prisma } from '../database/prisma';
import { prismaComLoja } from '../database/prisma-com-loja';
import { comoLoja, exigeLoja } from './loja';
import type { LicencaDaLoja } from './assinaturas';
import { cifrar, decifrar, type Canal } from './marketplace';
import { processaPedido } from './webhook';
import { logDoModulo } from './logger';

const log = logDoModulo('relay');

/** De quanto em quanto o PC pergunta se chegou pedido. */
const INTERVALO_MS = 20_000;

export const CABECALHO_LOJA = 'x-loja';
export const CABECALHO_CHAVE = 'x-chave-loja';

/** Um segredo novo, forte o bastante para ser a unica coisa entre a loja e a fila. */
export function novoSegredo(): string {
    return crypto.randomBytes(32).toString('base64url');
}

/** O que a nuvem guarda: o hash, nunca o segredo. */
export function hashDoSegredo(segredo: string): string {
    return crypto.createHash('sha256').update(segredo, 'utf8').digest('hex');
}

/** Confere em tempo constante, como o do webhook. */
function confere(chave: string, hashEsperado: string): boolean {
    if (!chave || !hashEsperado) return false;
    const a = Buffer.from(hashDoSegredo(chave), 'hex');
    const b = Buffer.from(hashEsperado, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Gera (ou troca) a chave de uma loja e devolve o segredo, que so aparece aqui. */
export async function geraChave(loja: string): Promise<string> {
    const segredo = novoSegredo();
    await prisma.chaveDeLoja.upsert({
        where: { tenantId: loja },
        create: { tenantId: loja, hash: hashDoSegredo(segredo) },
        update: { hash: hashDoSegredo(segredo), criadoEm: new Date() },
    });
    return segredo;
}

/** A loja do segredo. Sem token nao ha loja: quem nao configurou nao busca nada. */
export async function lojaDoSegredo(chave: string): Promise<string | null> {
    if (!chave) return null;
    const linhas = await prisma.chaveDeLoja.findMany({ select: { tenantId: true, hash: true } });
    for (const linha of linhas) {
        if (confere(chave, linha.hash)) {
            void prisma.chaveDeLoja
                .update({ where: { tenantId: linha.tenantId }, data: { ultimoUsoEm: new Date() } })
                .catch(() => 0);
            return linha.tenantId;
        }
    }
    return null;
}

/** Onde a nuvem esta': a propria base. Sem isso a loja local buscaria a si mesma. */
function urlDaNuvem(): string {
    const doAmbiente = process.env.DELIVERYADMIN_NUVEM?.trim();
    if (doAmbiente) return doAmbiente.replace(/\/+$/, '');
    return 'https://whatsapp-api-7zra.onrender.com';
}

/** Grava o segredo da loja, cifrado, no banco dela. */
export async function registraSegredo(segredo: string): Promise<void> {
    // `upsert` e' obrigatorio aqui: a linha de Config de uma loja recem-instalada so
    // nasce quando alguem abre a tela de ajustes, e colar a chave do relay e' justamente
    // o primeiro passo de quem instalou agora. Com `update` a loja ficava travada.
    await prismaComLoja.config.upsert({
        where: { id: exigeLoja() },
        update: { relayChaveEnc: cifrar(segredo) },
        create: { id: exigeLoja(), relayChaveEnc: cifrar(segredo) },
    });
}

/** O segredo guardado, ou vazio se a loja ainda nao configurou. */
export async function segredoDaLoja(): Promise<string> {
    const linha = await prismaComLoja.config.findUnique({
        where: { id: exigeLoja() },
        select: { relayChaveEnc: true },
    });
    return decifrar(linha?.relayChaveEnc ?? '');
}

export type PedidoPendente = { id: string; channel: string; corpo: string; tentativas: number };

/** Um pedido que chegou, no formato que a loja sabe processar. */
export async function pendentes(loja: string, segredo: string): Promise<PedidoPendente[]> {
    const resposta = await fetch(`${urlDaNuvem()}/api/loja/pedidos-pendentes`, {
        headers: { [CABECALHO_LOJA]: loja, [CABECALHO_CHAVE]: segredo },
    });
    if (!resposta.ok) throw new Error(`fila respondeu ${resposta.status}`);
    const dados = (await resposta.json()) as { pedidos?: PedidoPendente[] };
    return dados.pedidos ?? [];
}

/** O PC ja gravou: a fila pode esquecer. */
export async function confirma(loja: string, segredo: string, id: string, erro?: string): Promise<void> {
    const resposta = await fetch(`${urlDaNuvem()}/api/loja/pedidos-pendentes/${encodeURIComponent(id)}/entregue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [CABECALHO_LOJA]: loja, [CABECALHO_CHAVE]: segredo },
        body: JSON.stringify(erro ? { erro: erro.slice(0, 300) } : {}),
    });
    if (!resposta.ok) log.warn('a fila nao aceitou a confirmacao', { id, status: resposta.status });
}

/*
 * O que a tela mostra da ligacao com a nuvem. Fica na memoria do processo e nao no
 * banco de proposito: e' fato do PC que esta rodando agora, nao dado da loja, e
 * gravar a cada 20s para saber "ha quanto tempo" seria escrever no disco a cada 20s.
 */
let estado: { ultimaBusca: string | null; ultimoRecebido: number } = { ultimaBusca: null, ultimoRecebido: 0 };

/** Para a tela "iFood e 99Food" da loja. */
export function estadoDoRelay(): { ultimaBusca: string | null; ultimoRecebido: number } {
    return estado;
}

/** O que a nuvem disse da assinatura da loja, e quando. Vem no mesmo tique da fila. */
let licenca: (LicencaDaLoja & { consultadaEm: string }) | null = null;

/** O que o PC sabe da assinatura, ou `null` enquanto a nuvem nao respondeu. */
export function estadoDaLicenca(): (LicencaDaLoja & { consultadaEm: string }) | null {
    return licenca;
}

/**
 * Pergunta a assinatura e guarda a resposta na memoria.
 *
 * Falha nao apaga o que ja sabia: quem esta sem internet precisa continuar abrindo o
 * painel. O corte de verdade depende disto e vem com o gateway de pagamento.
 */
async function consultaLicenca(loja: string, segredo: string): Promise<void> {
    try {
        const resposta = await fetch(`${urlDaNuvem()}/api/loja/licenca`, {
            headers: { [CABECALHO_LOJA]: loja, [CABECALHO_CHAVE]: segredo },
        });
        if (!resposta.ok) throw new Error(`a assinatura respondeu ${resposta.status}`);
        const dados = (await resposta.json()) as LicencaDaLoja;
        licenca = { ...dados, consultadaEm: new Date().toISOString() };
    } catch (erro) {
        log.warn('nao deu para saber da assinatura:', String(erro).slice(0, 120));
    }
}

/**
 * Puxa a fila e grava no banco da loja, pelo mesmo `processaPedido` de sempre --
 * inclusive a deduplicacao por `externalId`. Confirmar so depois: se o PC cair no
 * meio, o pedido volta e a deduplicacao da loja barra o segundo.
 */
export async function buscaEGrava(): Promise<{ pular: number; gravados: number }> {
    const loja = exigeLoja();
    const segredo = await segredoDaLoja();
    if (!segredo) return { pular: 0, gravados: 0 };

    let fila: PedidoPendente[];
    try {
        fila = await pendentes(loja, segredo);
    } catch (erro) {
        log.warn('nao deu para falar com a fila:', String(erro).slice(0, 120));
        return { pular: 0, gravados: 0 };
    }
    estado = { ultimaBusca: new Date().toISOString(), ultimoRecebido: fila.length };
    await consultaLicenca(loja, segredo);

    let gravados = 0;
    for (const item of fila) {
        const r = (await comoLoja(loja, () => processaPedido(item.channel as Canal, item.corpo))) as {
            aceito?: boolean;
            motivo?: string;
            duplicado?: boolean;
        };
        // Duplicado tambem conta como resolvido: a loja ja tem esse pedido.
        const resolvido = r?.aceito === true;
        await confirma(loja, segredo, item.id, resolvido ? undefined : (r?.motivo ?? 'recusado'));
        if (resolvido) gravados++;
    }
    if (gravados) log.info(`${gravados} pedido(s) do marketplace chegaram pela fila`);
    return { pular: fila.length - gravados, gravados };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Liga a busca periodica. Roda uma vez na hora e depois a cada 20s: o pedido do
 * iFood aparece no painel em menos de meio minuto, que e' o que a plataforma espera.
 */
export function iniciaRelay(): void {
    if (timer) return;
    const umaVez = () => void buscaEGrava().catch((erro) => log.warn('falha na fila:', String(erro).slice(0, 120)));
    umaVez();
    timer = setInterval(umaVez, INTERVALO_MS);
    timer.unref?.();
}