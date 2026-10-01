import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

import { DIR_LOGS as DIR_LOGS_CENTRAL } from './paths';

/**
 * Log do sistema.
 * A saida nao e JSON cru: e' leitura humana, com horario e nivel na frente e os
 * dados estruturados no fim -- e vai para arquivo, com rotacao diaria.
 */

const NIVEL_PADRAO = 'info';

function nivelDoAmbiente(): string {
    const v = process.env.LOG_LEVEL?.trim().toLowerCase();
    return v === 'debug' || v === 'warn' || v === 'error' || v === 'silent' ? v : NIVEL_PADRAO;
}

const DIR_LOGS = DIR_LOGS_CENTRAL;

/**
 * Arquivo do dia, e nao rotacao por tamanho: quem abre "o log de ontem" espera
 * encontrar o log de ontem, e nao tres arquivos sem nome de dia.
 */
function arquivoDoDia(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const dia = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return path.join(DIR_LOGS, `app-${dia}.log`);
}

function horaCurta(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Escreve no terminal e no arquivo do dia: hora e nivel na frente, porque a
 * saida do pino nao tem horario nem nivel visivel.
 */
function linhaDoTerminal(nivel: string, mensagem: string, dados?: unknown): string {
    const base = `[${horaCurta()}] ${nivel.toUpperCase().padEnd(5)} ${mensagem}`;
    if (dados === undefined || dados === null) return base;
    if (typeof dados !== 'object') return `${base} ${String(dados)}`;
    return `${base} ${JSON.stringify(dados)}`;
}

function criarStream(): NodeJS.WritableStream {
    // O arquivo pode nao existir ainda na primeira execucao, e criar diretorio
    // dentro do stream-sync travaria o processo. Por isso ele nasce antes.
    try {
        fs.mkdirSync(DIR_LOGS, { recursive: true });
    } catch {
        // Sem permissao para a pasta: o log continua no terminal, que e' o
        // essencial. Falhar de vez por causa de log seria pior que nao logar.
    }
    return {
        write(linha: string) {
            /*
             * O pino entrega JSON; remontamos em leitura humana ANTES de sair para
             * qualquer lado, inclusive o terminal.
             */
            // Niveis do pino sao 10, 20, 30 e nao 0, 1, 2: sem o -1 todo mundo
            // aparecia como INFO, inclusive os erros.
            const niveis = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

            let nivel = 'info';
            let mensagem = linha.trim();
            let dados: unknown;

            try {
                const o = JSON.parse(linha);
                if (typeof o.level === 'number') nivel = niveis[o.level / 10 - 1] ?? 'info';
                if (typeof o.msg === 'string') mensagem = o.msg;
                // pid e hostname ficam de fora: sao ruido no terminal. `modulo`
                // tambem sai do dump, ja que esta no inicio da mensagem; continua
                // no registro estruturado, que e' onde um grep acha.
                const { level, msg, time, pid, hostname, modulo, ...resto } = o;
                void level; void msg; void time; void pid; void hostname; void modulo;
                dados = Object.keys(resto).length > 0 ? resto : undefined;
            } catch {
                // Linha que nao e JSON nosso: passa como mensagem mesmo assim.
            }

            const formatada = linhaDoTerminal(nivel, mensagem, dados);
            process.stdout.write(formatada + '\n');

            try {
                fs.appendFileSync(arquivoDoDia(), formatada + '\n');
            } catch {
                // Disco cheio ou pasta removida: perder log e' melhor do que
                // derrubar a venda. O terminal ainda mostra tudo.
            }
            return true;
        },
    } as unknown as NodeJS.WritableStream;
}

/** Raiz do logger. Use `log.info(...)` onde nao houver contexto melhor. */
export const log = pino(
    {
        level: nivelDoAmbiente(),
        // O prefixo de tempo do proprio pino e' redundante com o do nosso
        // cabecalho e atrapalha o alinhamento da leitura humana.
        timestamp: false,
    },
    criarStream()
);

/**
 * Logger com nome de origem.
 * O nome vai no campo `modulo` e no inicio da mensagem, porque o prefixo acabaria
 * esquecido em metade dos arquivos.
 */
export function logDoModulo(modulo: string) {
    /*
     * Instancias de `Error` nao possuem propriedades enumeraveis no spread;
     * extrair message e stack garante diagnostico detalhado em erros 500.
     */
    const comContexto = (dados: unknown) => {
        if (!dados || typeof dados !== 'object') return {};
        if (dados instanceof Error) return { erro: dados.message, pilha: dados.stack };
        return dados as object;
    };

    return {
        debug: (msg: string, dados?: unknown) => log.debug({ modulo, ...comContexto(dados) }, `[${modulo}] ${msg}`),
        info: (msg: string, dados?: unknown) => log.info({ modulo, ...comContexto(dados) }, `[${modulo}] ${msg}`),
        warn: (msg: string, dados?: unknown) => log.warn({ modulo, ...comContexto(dados) }, `[${modulo}] ${msg}`),
        error: (msg: string, dados?: unknown) => log.error({ modulo, ...comContexto(dados) }, `[${modulo}] ${msg}`),
    };
}

/**
 * Remove os logs de antes de `hoje` ("YYYY-MM-DD"): o log era a unica parte do
 * sistema que guardava texto do cliente sem retencao. O de hoje nunca e' tocado,
 * porque e' o arquivo aberto pelo logger.
 */
export function podarLogsDoDia(hoje: string): string[] {
    let nomes: string[];
    try {
        nomes = fs.readdirSync(DIR_LOGS);
    } catch {
        // Sem pasta de log (sem permissao, ou rodando de outro lugar): nao ha o
        // que remover, e falhar aqui derrubaria a virada do dia.
        return [];
    }

    // "app-" tem 4 caracteres, e a data ocupa os 10 seguintes.
    const antes = nomes.filter((f) => f.startsWith('app-') && f.endsWith('.log') && f.slice(4, 14) < hoje);

    for (const f of antes) {
        try {
            fs.unlinkSync(path.join(DIR_LOGS, f));
        } catch {
            // Log trancado por um leitor, ou sem permissao. Perder log antigo e'
            // melhor do que derrubar a virada, que e' o que importa.
        }
    }
    return antes;
}

/** Caminho da pasta de logs, para mostrar no boot. */
export function pastaDeLogs(): string {
    return DIR_LOGS;
}
