import { prisma } from '../database/prisma';
import { isValidHhMm } from './cashSchedule';
import { logDoModulo } from './logger';

const log = logDoModulo('config');

/**
 * Configuracoes do negocio, em um lugar so.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * A configuracao era validada em dois lugares diferentes, e so um deles
 * validava alguma coisa: a tela do painel gravava direto no banco
 * (`POST /admin/config/save`), e a API REST devolvia 501 dizendo que o modelo
 * "nao existe" -- sendo que ele existe e a tela usa. Duas rotas para a mesma
 * gravacao e' a forma garantida de elas divergirem, e foi o que aconteceu: a
 * rota da tela aceitou nome de negocio vazio e a agenda do caixa pela metade,
 * sem avisar ninguem.
 *
 * Aqui fica a regra, e as duas rotas chamam. O mesmo movimento que o `priceCart`
 * faz com preco: um lugar que decide, e todo mundo pergunta.
 *
 * A REGRA DO NOME DO NEGOCIO
 *
 * O nome nao e' um campo como outro: ele aparece no logo da lateral
 * (`layout.ts`), no titulo da aba do navegador, no cabecalho da comanda da
 * impressora (`comanda.ts`, que faz `.toUpperCase()`) e no rodape do cardapio do
 * WhatsApp. Nome vazio nao e' "sem nome": e' um logo em branco, um titulo
 * " | ", e uma comandathermal impressa sem cabecalho.
 *
 * E o espelho do defeito que a propria tela documenta: ali, um campo que nao
 * mudava nada era pior que a ausencia dele, porque o dono acreditava que
 * estava protegido. Aqui e' o mesmo erro pelo outro lado -- o campo e'
 * obrigatorio na pratica, e nada obrigava.
 *
 * A REGRA DA AGENDA DO CAIXA
 *
 * `runScheduleTick` so abre turno com `cashDefaultFloat > 0`, porque um fundo
 * estimado contaminaria a diferenca de caixa de todo fechamento. Entao
 * "horario preenchido + fundo vazio" e' um estado que o sistema aceita gravar e
 * silenciosamente nao faz nada. A tela falava disso num paragrafo estatico,
 * que e' texto de manual e nao estado do sistema.
 *
 * Aqui o estado e' DERIVADO e testavel (`estadoAgendaCaixa`), e a gravacao recusa
 * o estado pela metade. Recusar em vez de avisar e' a escolha: o dono preencheu
 * um horario, quase com certeza quer a abertura automatica, e salvar em silencio
 * deixa ele acreditando que amanha o turno abre sozinho. A mensagem de erro diz
 * exatamente o que fazer.
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

/**
 * Estado da agenda automatica, derivado da configuracao.
 *
 * Funcao pura de proposito: e' a mesma forma de `stockStatus` e
 * `closeMomentAfter` no `cashSchedule` -- dado de entrada, dado de saida, sem
 * banco e sem relogio. A tela mostra isso antes de salvar, e o agendador
 * continua sendo quem decide de verdade.
 */
/*
 * Dinheiro na frase, no formato do painel.
 *
 * `toFixed(2)` devolve "50.00", com ponto, e essa frase aparece na tela que o
 * dono le. Todo dinheiro do painel passa por `toLocaleString('pt-BR')` -- ver
 * `currency` em stats.ts -- e um unico "50.00" com ponto num texto de tela, ao
 * lado de "R$ 50,00" nos cartoes, e' o tipo de coisa que faz a pessoa duvidar
 * do numero em vez do ponto.
 */
function dinheiro(valor: number): string {
    return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Estado da agenda automatica, derivado da configuracao.
 *
 * Funcao pura de proposito: e' a mesma forma de `stockStatus` e
 * `closeMomentAfter` no `cashSchedule` -- dado de entrada, dado de saida, sem
 * banco e sem relogio. A tela mostra isso antes de salvar, e o agendador
 * continua sendo quem decide de verdade.
 */
export type EstadoAgenda =
    | { ativa: true; resumo: string }
    | { ativa: false; motivo: 'sem-horario' | 'sem-fundo' | 'incompleta'; resumo: string };

/*
 * Type guards.
 *
 * O projeto roda com `strict: false`, e sem `strictNullChecks` o TypeScript nao
 * estreita uniao por discriminante booleano: `if (!r.ok)` deixa de descartar o
 * ramo do sucesso, e o compilador passa a dizer que `.error` nao existe no tipo
 * inteiro. O mesmo problema e' o motivo de `falhou()` existir em
 * `services/validation.ts`, e a solucao e' a mesma -- um type guard, em vez de
 * fingir que o modo do compilador nao importa.
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
    // faz nada. Aqui ele e' nomeado, porque quem le precisa saber o que falta.
    if (!(fundo > 0)) {
        return {
            ativa: false,
            motivo: 'sem-fundo',
            resumo: 'Nao vai funcionar ainda: falta o fundo de troco. Sem ele o turno nao abre sozinho.',
        };
    }

    // Abertura sem fechamento (ou o contrario) nao e' erro: uma loja que so abre
    // automaticamente e fecha na mao e' uma configuracao legitima. Mas a tela
    // precisa dizer qual dos dois e' automatico, senao "preenchido" parece
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
 * Valida o que veio do formulario.
 *
 * Regras de forma e uma regra de combinacao. As de forma sao obvias; a de
 * combinacao e' a que faltava e e' a unica que o dono nao consegue prever
 * olhando o formulario: os dois campos tem cara de campo independente.
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
    const linha = await prisma.config.findUnique({ where: { id: 'default' } });
    const c = linha ?? (await prisma.config.create({ data: { id: 'default' } }));
    return {
        businessName: c.businessName,
        cashAutoOpen: c.cashAutoOpen,
        cashAutoClose: c.cashAutoClose,
        cashDefaultFloat: c.cashDefaultFloat,
    };
}

/**
 * Grava a configuracao, depois de validar.
 *
 * Retorna a mesma forma da validacao, para a rota nao ter que saber a ordem:
 * validar, gravar, e so entao responder. Quem chama e' a tela e a API, e as duas
 * precisam da mesma resposta -- inclusive quando da errado.
 */
export type ResultadoSalvar = { ok: true; dados: DadosConfig; avisos: string[] } | { ok: false; error: string };

export async function salvarConfig(entrada: unknown): Promise<ResultadoSalvar> {
    const v = validarConfig(entrada);
    if (falhouValidacao(v)) return { ok: false, error: v.error };

    const { dados, avisos } = v;
    try {
        await prisma.config.upsert({
            where: { id: 'default' },
            update: dados,
            create: { id: 'default', ...dados },
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
