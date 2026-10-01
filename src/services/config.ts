import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { isValidHhMm } from './cashSchedule';
import { logDoModulo } from './logger';
import { exigeLoja } from './loja';

const log = logDoModulo('config');

/**
 * A regra mora aqui porque tela e API gravavam a mesma config por rotas diferentes e
 * divergiam em silencio. "Horario preenchido com fundo vazio" e' estado que o sistema
 * aceita gravar e nao faz nada, entao a gravacao recusa em vez de avisar.
 */

export type DadosConfig = {
    businessName: string;
    /** Horarios em "HH:MM". Vazio = desativado. */
    cashAutoOpen: string;
    cashAutoClose: string;
    cashDefaultFloat: number;
};

export type ResultadoValidacao =
    | { ok: true; dados: DadosConfig; avisos: string[] }
    | { ok: false; error: string };

const NOMES_CAMPO: Record<keyof DadosConfig, string> = {
    businessName: 'Nome do negocio',
    cashAutoOpen: 'Abre as',
    cashAutoClose: 'Fecha as',
    cashDefaultFloat: 'Fundo de troco',
};

/*
 * Dinheiro na frase no formato do painel. toFixed(2) devolve "50.00" com ponto,
 * e um unico valor assim num texto de tela, ao lado de R$ 50,00 nos cartoes, faz
 * a pessoa duvidar do numero em vez do ponto.
 */
function dinheiro(valor: number): string {
    return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Funcao pura de proposito, como stockStatus e closeMomentAfter no cashSchedule:
 * sem banco e sem relogio. A tela mostra o estado antes de salvar, mas quem
 * decide de verdade continua sendo o agendador.
 */
export type EstadoAgenda =
    | { ativa: true; resumo: string }
    | { ativa: false; motivo: 'sem-horario' | 'sem-fundo' | 'incompleta'; resumo: string };

/*
 * Type guards: sem strictNullChecks o TypeScript nao estreita uniao por
 * discriminante booleano, e `if (!r.ok)` deixa de descartar o ramo do sucesso.
 * Mesma solucao de falhou() em services/validation.ts.
 */
export type FalhouConfig = { ok: false; error: string };

export function falhouValidacao(v: ResultadoValidacao): v is FalhouConfig {
    return !v.ok;
}

export function falhouSalvar(v: ResultadoSalvar): v is FalhouConfig {
    return !v.ok;
}

export function agendaDesligada(e: EstadoAgenda): e is { ativa: false; motivo: 'sem-horario' | 'sem-fundo' | 'incompleta'; resumo: string } {
    return !e.ativa;
}

export function estadoAgendaCaixa(c: {
    cashAutoOpen: string;
    cashAutoClose: string;
    cashDefaultFloat: number;
}): EstadoAgenda {
    const abre = c.cashAutoOpen;
    const fecha = c.cashAutoClose;
    const fundo = c.cashDefaultFloat;

    if (abre === '' && fecha === '') {
        return { ativa: false, motivo: 'sem-horario', resumo: 'Desativada. O turno e' + ' aberto e fechado a mao.' };
    }

    // Horario preenchido sem fundo e' o estado que o sistema aceita gravar e nao
    // faz nada. Aqui ele e' nomeado, para quem le saber o que falta.
    if (!(fundo > 0)) {
        return {
            ativa: false,
            motivo: 'sem-fundo',
            resumo: 'Nao vai funcionar ainda: falta o fundo de troco. Sem ele o turno nao abre sozinho.',
        };
    }

    // Abrir sozinho e fechar na mao e' configuracao legitima, nao erro. A tela
    // precisa dizer qual metade e' automatica, senao "preenchido" parece
    // "preenchido e funcionando" nos dois casos.
    if (abre !== '' && fecha === '') {
        return { ativa: true, resumo: `Abre sozinho as ${abre} com R$ ${dinheiro(fundo)} de fundo. O fechamento continua sendo manual.` };
    }
    if (fecha !== '' && abre === '') {
        return { ativa: true, resumo: `Fecha sozinho as ${fecha}, conferindo o dinheiro da gaveta. A abertura continua sendo manual.` };
    }

    return { ativa: true, resumo: `Abre as ${abre} com R$ ${dinheiro(fundo)} de fundo e fecha as ${fecha}.` };
}

/**
 * A regra de combinacao (horario preenchido exige fundo) e' a unica que o dono
 * nao previa olhando o formulario: os dois campos tem cara de campo independente.
 */
export function validarConfig(entrada: unknown): ResultadoValidacao {
    const b = (entrada ?? {}) as Record<string, unknown>;

    const nome = String(b.businessName ?? '').trim();
    if (nome === '') {
        return {
            ok: false,
            error: `O nome do negocio nao pode ficar vazio: e' ele que aparece no logo, no titulo e na comanda da impressora.`,
        };
    }
    if (nome.length > 60) {
        return { ok: false, error: `${NOMES_CAMPO.businessName} tem 60 caracteres no maximo.` };
    }

    const abre = String(b.cashAutoOpen ?? '').trim();
    const fecha = String(b.cashAutoClose ?? '').trim();

    // Horario invalido era convertido em vazio, que e' "desativado". Traduzir
    // erro de digitacao em "desligado" e' o pior dos dois: o dono preencheu,
    // viu "salvo", e o turno nunca mais abriu sozinho. Agora volta o erro.
    if (abre !== '' && !isValidHhMm(abre)) {
        return { ok: false, error: `${NOMES_CAMPO.cashAutoOpen} invalido. Use HH:MM, como 08:00.` };
    }
    if (fecha !== '' && !isValidHhMm(fecha)) {
        return { ok: false, error: `${NOMES_CAMPO.cashAutoClose} invalido. Use HH:MM, como 22:00.` };
    }

    const fundoCru = b.cashDefaultFloat;
    const fundo = fundoCru === '' || fundoCru === undefined || fundoCru === null ? 0 : Number(fundoCru);
    if (!Number.isFinite(fundo) || fundo < 0) {
        return { ok: false, error: `${NOMES_CAMPO.cashDefaultFloat} invalido. Use um valor como 50,00.` };
    }

    const dados: DadosConfig = {
        businessName: nome,
        cashAutoOpen: abre,
        cashAutoClose: fecha,
        // Arredonda na entrada: o campo e' dinheiro, e 0.1 + 0.2 na gaveta e'
        // problema de quem fecha o turno, nao de quem salvou a tela.
        cashDefaultFloat: Math.round(fundo * 100) / 100,
    };

    const estado = estadoAgendaCaixa(dados);
    if (agendaDesligada(estado) && estado.motivo === 'sem-fundo') {
        return {
            ok: false,
            error:
                'Voce preencheu um horario de abertura/fechamento, mas o fundo de troco ficou vazio. ' +
                'Sem ele o turno nao abre sozinho. Preencha o fundo, ou apague os horarios para desativar de vez.',
        };
    }

    // Aviso, e nao erro: uma loja que so abre automaticamente e' legitima, e o
    // dono precisa saber qual metade da agenda esta automatica.
    const avisos: string[] = [];
    if (estado.ativa && (dados.cashAutoOpen === '' || dados.cashAutoClose === '')) {
        avisos.push(estado.resumo);
    }
    return { ok: true, dados, avisos };
}

/** A configuracao atual, criando a linha de fabrica se ela ainda nao existir. */
export async function carregarConfig(): Promise<DadosConfig> {
    const linha = await prisma.config.findUnique({ where: { id: exigeLoja() } });
    const c = linha ?? (await prisma.config.create({ data: { id: exigeLoja() } }));
    return {
        businessName: c.businessName,
        cashAutoOpen: c.cashAutoOpen,
        cashAutoClose: c.cashAutoClose,
        cashDefaultFloat: c.cashDefaultFloat,
    };
}

/**
 * Mesma forma da validacao, para a rota nao ter que saber a ordem: validar,
 * gravar, so entao responder. Tela e API precisam da mesma resposta, inclusive
 * quando da errado.
 */
export type ResultadoSalvar = { ok: true; dados: DadosConfig; avisos: string[] } | { ok: false; error: string };

export async function salvarConfig(entrada: unknown): Promise<ResultadoSalvar> {
    const v = validarConfig(entrada);
    if (falhouValidacao(v)) return { ok: false, error: v.error };

    const { dados, avisos } = v;
    try {
        await prisma.config.upsert({
            where: { id: exigeLoja() },
            update: dados,
            create: { id: exigeLoja(), ...dados },
        });
    } catch (error) {
        log.error('nao foi possivel gravar a configuracao:', error);
        return { ok: false, error: 'Nao foi possivel salvar agora. Tente de novo.' };
    }

    // O aviso vai para o log e volta para a tela. A agenda meio preenchida
    // funciona -- o dono pode terQuerido so uma das metades -- entao nao e'
    // erro; e' o caso em que ele precisa saber qual.
    for (const a of avisos) log.warn(a);
    return { ok: true, dados, avisos };
}
