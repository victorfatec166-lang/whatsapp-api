import { prisma } from '../database/prisma';
import { logDoModulo } from './logger';
import { inicioDoDia } from './retencao';
import { notifyClients } from './sse';

const log = logDoModulo('lembretes');

/**
 * Lembretes do calendario.
 *
 * O que este modulo decide, e por que a decisao nao e' trivial:
 *
 * ANOTAR E' PARA O DIA QUE ESTA NA TELA
 *
 * A pessoa clica no dia 25 e anota "ligar para o fornecedor". Se o lembrete
 * fosse para o dia de hoje, ela estaria anotando para amanha sem querer, e o
 * lembrete apareceria no lugar errado sem nenhum aviso. A tela manda o dia, e o
 * servico usa o dia que veio -- a unica excecao e' um dia que nao veio, que
 * vira hoje.
 *
 * A data e' MEIA-NOITE LOCAL, nunca data pura
 *
 * `new Date('2026-09-25')` em JavaScript e' meia-noite UTC, que no Brasil e'
 * 21h do dia anterior: o lembrete anotado no dia 25 aparecia no dia 24. E' o
 * mesmo erro que ja custou 8 pedidos aparecendo no grafico de receita com o dia
 * errado. Por isso o recorte e' sempre feito com `inicioDoDia`, que le o fuso de
 * quem esta olhando a tela.
 *
 * CONCLUIR NAO APAGA
 *
 * Marcar como feito esconde o lembrete da lista e mantem o registro. Apagar
 * perderia a resposta para "essa entrega ja saiu?", que e' a pergunta que a
 * lista de lembretes existe para responder -- e o mesmo raciocinio que impede o
 * "Pedidos concluidos" de sair do historico do Faturamento.
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
 *
 * O mes vem como "AAAA-MM" e o recorte usa o primeiro e o dia seguinte -- nao o
 * ultimo dia do mes. Montar o ultimo dia e' o caminho curto, e passa dois
 * problemas: mes com 30 dias em ano bissexto e' dia 30, e o fuso do `new Date`
 * empurra o limite. Aproximar pelo primeiro dia do mes seguinte e' exato.
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
 * Type guards.
 *
 * Mesma razao dos de `services/config.ts` e `services/validation.ts`: o projeto
 * roda com `strict: false`, e sem `strictNullChecks` o TypeScript nao estreita
 * uniao por discriminante booleano. `if (!r.ok)` deixa de descartar o ramo do
 * sucesso, e o compilador passa a dizer que `.error` nao existe no tipo inteiro.
 * Um type guard resolve sem depender do modo do compilador.
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
            data: { date: inicioDoDia(new Date(ano, mes - 1, d)), text: limpo },
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
        const atual = await prisma.reminder.findUnique({ where: { id }, select: { done: true } });
        if (!atual) return { ok: false, error: 'Lembrete nao encontrado.' };
        const depois = await prisma.reminder.update({ where: { id }, data: { done: !atual.done } });
        notifyClients();
        return { ok: true, feito: depois.done };
    } catch (error) {
        log.error('nao foi possivel concluir lembrete:', error);
        return { ok: false, error: 'Nao foi possivel atualizar o lembrete.' };
    }
}

export async function apagar(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        await prisma.reminder.delete({ where: { id } });
        notifyClients();
        return { ok: true };
    } catch (error) {
        log.error('nao foi possivel apagar lembrete:', error);
        return { ok: false, error: 'Nao foi possivel apagar o lembrete.' };
    }
}
