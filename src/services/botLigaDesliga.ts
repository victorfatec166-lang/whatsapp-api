/*
 * O interruptor do bot, por loja. Antes o silencio era so por CONVERSA, que nao
 * resolve "a loja quer o bot calado hoje": fechar o WhatsApp era a unica saida.
 * Desligar aqui RESPONDE a conversa -- recusar mensagem e' o pior que um bot faz.
 */

import { prisma } from '../database/prisma';
import { logDoModulo } from './logger';
const log = logDoModulo('bot-liga');

/** O que a loja escreveu, ou uma frase honesta sobre estar pausado. */
const AVISO_PADRAO =
    'Oi! Nosso atendimento automatico esta pausado no momento, e o pedido ja pode ser ' +
    'feito direto com a equipe. Agradecemos a preferencia.';

/** Resposta unica enquanto o bot da loja esta' desligado. */
export function textoDePausado(avisoDaLoja: string | null | undefined): string {
    const escrito = (avisoDaLoja ?? '').trim();
    return escrito === '' ? AVISO_PADRAO : escrito;
}

/** Cache por loja, com o mesmo destino do `botMessages`: ler Config por mensagem e' caro. */
const cachePorLoja = new Map<string, EstadoDoBot>();

type EstadoDoBot = { ativo: boolean; aviso: string; ia: boolean };

/**
 * A IA externa so roda com o consentimento do dono: mandar o texto do cliente
 * para fora do Brasil e' transferencia internacional (art. 33 da LGPD).
 * Desligado, o bot responde apenas pelas regras locais do cardapio.
 */
export async function iaLiberada(tenantId: string): Promise<boolean> {
    if (cachePorLoja.has(tenantId)) return cachePorLoja.get(tenantId)!.ia;
    await botAtivo(tenantId);
    return cachePorLoja.get(tenantId)?.ia ?? false;
}

/** `true` quando o bot responde. `false` e' o estado seguro quando da' para ler. */
export async function botAtivo(tenantId: string): Promise<boolean> {
    if (cachePorLoja.has(tenantId)) return cachePorLoja.get(tenantId)!.ativo;

    try {
        const linha = await prisma.config.findUnique({
            where: { id: tenantId },
            select: { botAtivo: true, botAvisoPausado: true, botIaAtiva: true },
        });
        cachePorLoja.set(tenantId, {
            ativo: linha?.botAtivo !== false,
            aviso: linha?.botAvisoPausado ?? '',
            ia: linha?.botIaAtiva === true,
        });
        return cachePorLoja.get(tenantId)!.ativo;
    } catch (erro) {
        /*
         * Sem ler o Config, responder e' o estado seguro: uma falha de banco nao
         * pode calar o bot de uma loja que esta' pagando. Quem corta o bot e' o
         * dono, no painel, de proposito -- nunca um erro de leitura.
         */
        log.warn('Nao consegui ler o estado do bot; respondendo como ligado.', String(erro));
        return true;
    }
}

/** O texto de pausa desta loja, ja preenchido com o que o dono escreveu. */
export async function avisoDePausado(tenantId: string): Promise<string> {
    if (cachePorLoja.has(tenantId)) return textoDePausado(cachePorLoja.get(tenantId)!.aviso);
    await botAtivo(tenantId);
    return textoDePausado(cachePorLoja.get(tenantId)?.aviso ?? '');
}

/**
 * Grava o estado e limpa o cache. E' o unico caminho que muda: chamar direto no
 * banco deixaria o bot ligado ate o proximo reinicio, e o dono veria o botao
 * desligado sem efeito.
 */
export async function defineBotAtivo(
    tenantId: string,
    ativo?: boolean,
    aviso?: string,
    ia?: boolean
): Promise<void> {
    let proxAtivo: boolean | undefined = ativo;
    if (ativo !== undefined) {
        /* ligar depois de pausado nao reseta o aviso: o dono escolheu o texto */
    } else {
        proxAtivo = (cachePorLoja.get(tenantId)?.ativo) ?? true;
    }
    await prisma.config.upsert({
        where: { id: tenantId },
        create: {
            id: tenantId,
            botAtivo: proxAtivo,
            botIaAtiva: ia === true,
            ...(aviso === undefined ? {} : { botAvisoPausado: aviso }),
        },
        update: {
            botAtivo: proxAtivo,
            ...(ia === undefined ? {} : { botIaAtiva: ia }),
            ...(aviso === undefined ? {} : { botAvisoPausado: aviso }),
        },
    });
    cachePorLoja.delete(tenantId);
    log.info(`Bot da loja ${tenantId} ${ativo ? 'ligado' : 'desligado'} pelo painel`);
}

/** Descarta o cache do boot. So os testes usam: em producao o processo e' um. */
export function esqueceCacheDoBot(): void {
    cachePorLoja.clear();
}