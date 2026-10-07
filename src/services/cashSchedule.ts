import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { prisma as prismaGlobal } from '../database/prisma';
import { comoLoja, exigeLoja } from './loja';
import { startShift, closeShiftAuto } from './cash';
import { logDoModulo } from './logger';
import { horaDoDono } from './fuso';
const log = logDoModulo('cashSchedule');

/**
 * Agenda automatica de abertura e fechamento do turno de caixa.
 * Tick periodico, e nao setTimeout de disparo unico: com setTimeout, reiniciar
 * o servidor depois da hora agendada pulava o evento silenciosamente.
 */

const TICK_MS = 30_000;

/** Aceita "HH:MM" e devolve minutos desde a meia-noite, ou null se invalido. */
export function parseHhMm(value: string | null | undefined): number | null {
    if (typeof value !== 'string') return null;
    const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
}

export function isValidHhMm(value: unknown): boolean {
    return typeof value === 'string' && parseHhMm(value) !== null;
}

/**
 * Turnos que atravessam a meia-noite (fecha 00:30, abre 22:00) quebram a
 * comparacao ingenua com "hoje". Aqui calculamos o primeiro fechamento
 * agendado que ocorre *depois* de o turno ter sido aberto, sem guardar estado.
 */
function closeMomentAfter(openedAt: Date, closeMinutes: number, now: Date): Date {
    const candidate = new Date(now);
    candidate.setHours(Math.floor(closeMinutes / 60), closeMinutes % 60, 0, 0);
    if (candidate <= openedAt) candidate.setDate(candidate.getDate() + 1);
    return candidate;
}

export type ScheduleOutcome =
    | { action: 'nenhuma' }
    | { action: 'abriu'; shiftId: string }
    | { action: 'fechou'; shiftId: string; expected: number }
    | { action: 'pulou-turno-vazio' };

/**
 * Executa a acao idempotente da agenda de caixa para o instante informado.
 * Recebe a loja como parametro por rodar em agendador assincrono fora de requisicao.
 */
export async function runScheduleTick(loja: string, now = new Date()): Promise<ScheduleOutcome> {
    return comoLoja(loja, () => agendaDaLoja(now));
}

async function agendaDaLoja(now: Date): Promise<ScheduleOutcome> {
    const config = await prisma.config.findUnique({
        where: { id: exigeLoja() },
        select: { cashAutoOpen: true, cashAutoClose: true, cashDefaultFloat: true },
    });
    if (!config) return { action: 'nenhuma' };

    const openMinutes = parseHhMm(config.cashAutoOpen);
    const closeMinutes = parseHhMm(config.cashAutoClose);

    const shift = await prisma.cashShift.findFirst({
        where: { closedAt: null },
        orderBy: { openedAt: 'desc' },
    });

    // ---- fechamento ----
    if (shift && closeMinutes !== null) {
        const moment = closeMomentAfter(shift.openedAt, closeMinutes, now);
        if (now >= moment) {
            const result = await closeShiftAuto(now);
            if (result.ok) return { action: 'fechou', shiftId: result.shiftId, expected: result.expected };
            if (result.ok === false && result.empty) return { action: 'pulou-turno-vazio' };
        }
        // Turno aberto: nao ha o que fazer, mesmo que a abertura ja tenha passado.
        return { action: 'nenhuma' };
    }

    // ---- abertura ----
    if (!shift && openMinutes !== null) {
        // Sem fundo de troco configurado, abrir automaticamente inventaria um
        // valor e a diferenca de todo fechamento sairia errada.
        if (!(config.cashDefaultFloat > 0)) return { action: 'nenhuma' };

        const today = new Date(now);
        today.setHours(Math.floor(openMinutes / 60), openMinutes % 60, 0, 0);
        if (now >= today) {
            const result = await startShift(config.cashDefaultFloat, now);
            if (result.ok && result.shiftId) return { action: 'abriu', shiftId: result.shiftId };
        }
    }

    return { action: 'nenhuma' };
}

let timer: NodeJS.Timeout | null = null;

/** Sobe o agendamento. Idempotente: chamar duas vezes nao cria dois timers. */
export function startCashScheduler(onAction?: (o: ScheduleOutcome, loja: string) => void): void {
    if (timer) return;

    const tick = async () => {
        try {
            // Uma volta por loja: o agendador e' global, o horario de cada uma e'
            // dela. Sem o laco, a loja B nunca abriria o turno -- e o primeiro
            // sintoma seria o fechamento do dia dela dando errado.
            const lojas = await prismaGlobal.tenant.findMany({ where: { ativo: true }, select: { id: true } });
            for (const { id } of lojas) {
                const outcome = await runScheduleTick(id);
                if (outcome.action === 'abriu') {
                    log.info(
                        `Turno aberto automaticamente as ${horaDoDono(new Date())} (loja ${id})`
                    );
                    onAction?.(outcome, id);
                } else if (outcome.action === 'fechou') {
                    log.info(
                        `Turno fechado automaticamente (loja ${id}). Esperado R$ ${outcome.expected.toFixed(2)} (conferencia pendente)`
                    );
                    onAction?.(outcome, id);
                }
            }
        } catch (error) {
            log.error('Erro no agendador de caixa:', error);
        }
    };

    timer = setInterval(tick, TICK_MS);
    // Nao segura o processo vivo por causa do agendador.
    timer.unref?.();
    void tick();
}
