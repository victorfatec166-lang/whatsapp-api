import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Log do sistema.
 *
 * Duas decisoes aqui, e ambas contrariam o costume.
 *
 * A saida nao e JSON cru. O padrao do pino e um objeto por linha, que e' otimo
 * para uma maquina coletando log e pessimo para quem abre o terminal do
 * computador da marmitaria as 12h15 tentando entender por que o pedido nao
 * saiu. Entao o formato e de leitura humana, com o horario e o nivel na frente
 * e o resto alinhado. O que muda e que continua sendo log de verdade: tem
 * horario, tem nivel, e os dados estruturados vao no fim, onde um grep acha.
 *
 * Alem disso ele vai para arquivo, com rotacao diaria. Enquanto o processo
 * estava vivo, o diagnostico de "o que aconteceu quando o pedido travou" era
 * olhar a tela e perder. Em arquivo, vira evidencia.
 *
 * Por que um modulo so, e nao `console.log` espalhado
 *
 * Com console, cada erro impresso e' um erro sem horario, sem nivel e sem
 * contexto de onde veio. Erro de banco e erro de negocio ficam com a mesma
 * aparencia, e nao ha como consultar depois. Aqui o nivel separa o que e'
 * informativo do que e' problema, e o espaco de nomes do modulo diz de onde veio.
 *
 * Nivis
 *
 *   info  - o que o sistema fez (turno aberto, backup gravado)
 *   warn  - o que merece atencao (vendeu sem saldo)
 *   error - o que deu errado
 *   debug - so com LOG_LEVEL=debug no ambiente
 *
 * O padrao e 'info'. Em 'debug' entra a fila de escrita, que e' o lugar onde
 * vale a pena olhar quando o problema e' de concorrencia.
 */

const NIVEL_PADRAO = 'info';

function nivelDoAmbiente(): string {
    const v = process.env.LOG_LEVEL?.trim().toLowerCase();
    return v === 'debug' || v === 'warn' || v === 'error' || v === 'silent' ? v : NIVEL_PADRAO;
}

const DIR_LOGS = path.resolve(__dirname, '..', '..', 'logs');

/**
 * Arquivo do dia.
 *
 * Um arquivo por dia, e nao rotacao por tamanho: quem abre "o log de ontem"
 * espera encontrar o log de ontem. Com rotacao por tamanho seria "o log de
 * ontem" divided em tres arquivos sem nome de dia, e ninguem acharia.
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
 * Escreve no terminal e no arquivo do dia.
 *
 * O pino entrega a linha ja formatada; o que ele nao formata e' o cabecalho,
 * porque a saida do pino nao tem horario nem nivel visivel. Aqui eu coloco os
 * dois na frente e o resto fica como o pino montou.
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
             * O pino entrega JSON. Desmontamos e remontamos no formato de
             * leitura humana ANTES de sair para qualquer lado, inclusive para o
             * terminal. A versao anterior formatava so o arquivo, e o terminal
             * continuava recebendo JSON cru, que era o que queriamos evitar.
             */
            // Niveis do pino sao 10, 20, 30... e nao 0, 1, 2. A divisao por 10
            // com o -1 era o que faltava: sem isso todo mundo aparecia como
            // INFO, inclusive os erros, que e' exatamente o que o nivel
            // existe para evitar.
            const niveis = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

            let nivel = 'info';
            let mensagem = linha.trim();
            let dados: unknown;

            try {
                const o = JSON.parse(linha);
                if (typeof o.level === 'number') nivel = niveis[o.level / 10 - 1] ?? 'info';
                if (typeof o.msg === 'string') mensagem = o.msg;
                // pid e hostname ficam de fora de proposito: sao ruido para
                // quem le o terminal, e o nome da maquina nao ajuda a
                // descobrir uma venda perdida.
                // `modulo` tambem sai do dump: ele ja esta no inicio da
                // mensagem, e repetir nao ajuda ninguem a ler. Continua no
                // registro estruturado do pino, que e' onde um grep acha.
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
 *
 * O nome entra no campo `modulo` e tambem no inicio da mensagem, porque quem le
 * no terminal precisa saber de onde veio sem abrir o campo estruturado. E o
 * formato e' esse atalho justamente para o nome nao faltar: escrever
 * logDoModulo('caixa').error(...) e' o que a pessoa vai digitar de novo em cada
 * arquivo, e o prefixo acabaria esquecido em metade.
 */
export function logDoModulo(modulo: string) {
    const comContexto = (dados: unknown) => (dados && typeof dados === 'object' ? (dados as object) : {});

    return {
        debug: (msg: string, dados?: unknown) => log.debug({ modulo, ...comContexto(dados) }, `[${modulo}] ${msg}`),
        info: (msg: string, dados?: unknown) => log.info({ modulo, ...comContexto(dados) }, `[${modulo}] ${msg}`),
        warn: (msg: string, dados?: unknown) => log.warn({ modulo, ...comContexto(dados) }, `[${modulo}] ${msg}`),
        error: (msg: string, dados?: unknown) => log.error({ modulo, ...comContexto(dados) }, `[${modulo}] ${msg}`),
    };
}

/**
 * Remove os logs de antes de `hoje` ("YYYY-MM-DD").
 *
 * A virada do dia chama isto. O arquivo de log e' a unica parte do sistema que
 * guardava o texto do cliente em texto puro, e ele nao tinha retencao nenhuma:
 * um arquivo por dia, para sempre. Sem esta chamada, apagar as mensagens do
 * banco nao apagaria nada do ponto de vista de quem abre a pasta -- o texto
 * estaria em `app-2026-09-28.log` ate o ano que vem.
 *
 * O log de hoje nunca e' tocado, e nao por uma razao de cuidado com o arquivo:
 * e' o arquivo que o logger esta escrevendo neste instante. Apagar um log
 * aberto no Windows falharia, e no Linux daria certo e perderia o que viesse
 * depois.
 *
 * A comparacao e' entre os prefixos dos nomes, que sao `YYYY-MM-DD`. O que
 * importa nao e' a hora da primeira linha: e' de que dia e' o arquivo.
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
