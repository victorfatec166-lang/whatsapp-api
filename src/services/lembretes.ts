import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { logDoModulo } from './logger';
import { inicioDoDia } from './retencao';
import { notifyClients } from './sse';
import { exigeLoja } from './loja';

const log = logDoModulo('lembretes');

/** `where: { id }` sozinho e' recusado pela extensao de loja. Ver `chaveDoProduto`. */

/**
 * Lembretes do calendario. Anotar e' para o dia que esta na tela, e a data e'
 * meia-noite LOCAL: `new Date('2026-09-25')` e' meia-noite UTC, que no Brasil e' 21h
 * do dia anterior. Concluir mantem o registro e so esconde da lista.
 */

/** O que a tela recebe, ja em pt-BR e com o dia em texto. */
export type LembreteView = {
    id: string;
    /** "2026-09-25" */
    iso: string;
    /** "25/09" */
    dia: string;
    texto: string;
    feito: boolean;
};

function dataIso(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function paraView(r: { id: string; date: Date; text: string; done: boolean }): LembreteView {
    return {
        id: r.id,
        iso: dataIso(r.date),
        dia: `${String(r.date.getDate()).padStart(2, '0')}/${String(r.date.getMonth() + 1).padStart(2, '0')}`,
        texto: r.text,
        feito: r.done,
    };
}

/**
 * Os lembretes de um mes.
 * O recorte usa o primeiro dia e o dia seguinte do mes, e nao o ultimo dia: mes de
 * 30 dias em ano bissexto e' dia 30, e o fuso do `new Date` empurra o limite.
 */
export async function listarDoMes(mesIso: string): Promise<LembreteView[]> {
    const [ano, mes] = mesIso.split('-').map((n) => parseInt(n, 10));
    if (!Number.isFinite(ano) || !Number.isFinite(mes)) return [];

    const inicio = new Date(ano, mes - 1, 1);
    const fim = new Date(ano, mes, 1);
    const linhas = await prisma.reminder.findMany({
        where: { date: { gte: inicio, lt: fim } },
        orderBy: [{ done: 'asc' }, { createdAt: 'asc' }],
    });
    return linhas.map(paraView);
}

/**
 * Type guards. O projeto roda com `strict: false`, e sem `strictNullChecks` o
 * TypeScript nao estreita uniao por discriminante booleano: `if (!r.ok)` deixa de
 * descartar o ramo do sucesso. O guard resolve sem depender do compilador.
 */
export type FalhouLembrete = { ok: false; error: string };

export function falhouAnotar(r: { ok: boolean }): r is FalhouLembrete {
    return !r.ok;
}
export function falhouConcluir(r: { ok: boolean }): r is FalhouLembrete {
    return !r.ok;
}
export function falhouApagar(r: { ok: boolean }): r is FalhouLembrete {
    return !r.ok;
}

/** Anota. O dia vem da tela; sem dia, e' hoje. */
export async function anotar(texto: unknown, diaIso?: string): Promise<{ ok: true; lembrete: LembreteView } | { ok: false; error: string }> {
    const limpo = String(texto ?? '').trim();
    if (limpo === '') return { ok: false, error: 'Escreva o lembrete antes de salvar.' };
    if (limpo.length > 160) return { ok: false, error: 'O lembrete e' + ' longo demais (160 caracteres no maximo).' };

    const dia = diaIso && /^\d{4}-\d{2}-\d{2}$/.test(diaIso) ? diaIso : dataIso(new Date());
    const [ano, mes, d] = dia.split('-').map((n) => parseInt(n, 10));

    try {
        const criado = await prisma.reminder.create({
            data: { tenantId: exigeLoja(), date: inicioDoDia(new Date(ano, mes - 1, d)), text: limpo },
        });
        notifyClients();
        return { ok: true, lembrete: paraView(criado) };
    } catch (error) {
        log.error('nao foi possivel anotar lembrete:', error);
        return { ok: false, error: 'Nao foi possivel salvar o lembrete.' };
    }
}

/** Marca como feito, ou desfaz. */
export async function alternarConcluido(id: string): Promise<{ ok: true; feito: boolean } | { ok: false; error: string }> {
    try {
        const atual = await prisma.reminder.findUnique({ where: { tenantId_id: { tenantId: exigeLoja(), id } }, select: { done: true } });
        if (!atual) return { ok: false, error: 'Lembrete nao encontrado.' };
        const depois = await prisma.reminder.update({ where: { tenantId_id: { tenantId: exigeLoja(), id } }, data: { done: !atual.done } });
        notifyClients();
        return { ok: true, feito: depois.done };
    } catch (error) {
        log.error('nao foi possivel concluir lembrete:', error);
        return { ok: false, error: 'Nao foi possivel atualizar o lembrete.' };
    }
}

export async function apagar(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        await prisma.reminder.delete({ where: { tenantId_id: { tenantId: exigeLoja(), id } } });
        notifyClients();
        return { ok: true };
    } catch (error) {
        log.error('nao foi possivel apagar lembrete:', error);
        return { ok: false, error: 'Nao foi possivel apagar o lembrete.' };
    }
}
