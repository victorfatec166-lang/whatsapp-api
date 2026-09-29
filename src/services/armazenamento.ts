import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../database/prisma';
import { inicioDoDia } from './retencao';
import { backupDir } from './backup';
import { pastaDeLogs } from './logger';

/**
 * Onde estao os dados, quanto ocupam, e o que o sistema guarda.
 *
 * POR QUE ISSO E' UMA TELA
 *
 * O dono de um sistema que roda na propria maquina tem perguntas que ninguem
 * responde: isso ocupa quanto, o que e' guardado do cliente, onde esta o backup,
 * o que acontece quando o disco enche. Hoje a resposta boa estava no log do
 * boot, que e' a pior tela possivel para essa pergunta -- visivel uma vez, no
 * terminal, e jogada fora na proxima virada do dia.
 *
 * E a pergunta ficou mais especifica depois da virada do dia. O sistema apaga
 * conversa a meia-noite, e isso e' uma promessa: o que o dono nao guardou nao
 * esta em lugar nenhum. Promessa de retencao que ninguem consegue auditar na
 * tela e' promessa que so o developer acredita.
 *
 * Os numeros sao medidos, nao estimados. "Ocupa pouco" sem numero e' o que faz
 * o disco encher em silencio; o valor exato do arquivo e' o que permite dizer
 * "cresceu 4 MB neste mes, olha a pasta X".
 *
 * O QUE ESTA AQUI, E O QUE NAO ESTA
 *
 * Nao ha grafico, nem barra de uso, nem projecao. Nenhum dos tres seria verdade:
 * o que ocupa espaco depende de quantos pedidos e quantas mensagens o dia teve,
 * e projetar isso sem historico e' inventar numero. O que a tela da e' o estado
 * agora, a regra que decide o futuro, e o caminho para agir -- que sao as tres
 * coisas que continuam valendo amanha.
 */

/** Como o sistema esta exposto. Ver a nota de seguranca no fim do arquivo. */
export type Exposicao = {
    host: string;
    /** ABERTA = qualquer maquina da mesma rede chega no painel. */
    aberta: boolean;
    temSenha: boolean;
};

export type ResumoArmazenamento = {
    /** Tamanho do .db e dos arquivos que o SQLite mantem abertos. */
    bancoBytes: number;
    bancoArquivos: { nome: string; bytes: number }[];
    /** Total das copias de backup na pasta. */
    backupBytes: number;
    backupQuantidade: number;
    ultimoBackup: { arquivo: string; quando: Date } | null;
    logBytes: number;
    logQuantidade: number;
    /** Sessao do WhatsApp: cresce sozinha e e' o maior item depois do banco. */
    sessaoBytes: number;
    sessaoArquivos: number;

    mensagensHoje: number;
    conversasAtivas: number;
    pedidosHoje: number;

    pastaBackup: string;
    pastaLog: string;
    /** Regra de retencao, escrita para o dono e nao para o log. */
    retencao: string;
    proximaVirada: Date;
    exposicao: Exposicao;
};

function tamanhoDe(arquivo: string): number {
    try {
        return fs.statSync(arquivo).size;
    } catch {
        return 0;
    }
}

/** Soma de um padrao de nome, e a contagem junto. */
function somarArquivos(pasta: string, casa: (n: string) => boolean): { bytes: number; quantidade: number } {
    let bytes = 0;
    let quantidade = 0;
    let nomes: string[];
    try {
        nomes = fs.readdirSync(pasta);
    } catch {
        return { bytes: 0, quantidade: 0 };
    }
    for (const n of nomes) {
        if (!casa(n)) continue;
        quantidade++;
        bytes += tamanhoDe(path.join(pasta, n));
    }
    return { bytes, quantidade };
}

const ehBackup = (n: string) => n.startsWith('backup-') && n.endsWith('.db');
const ehLog = (n: string) => n.startsWith('app-') && n.endsWith('.log');

/**
 * Pasta da sessao do WhatsApp.
 *
 * Vem do `bot.ts` como `AUTH_DIR`, resolvida a partir de onde o processo roda.
 * Aqui e' recalculada com a mesma regra, e o motivo de nao importar o modulo
 * do bot e' concreto: `bot.ts` conecta o Baileys no import, e um modulo de
 * diagnostico nao pode ter esse efeito colateral.
 */
function pastaDaSessao(): string {
    const doAmbiente = process.env.BAILEYS_AUTH_DIR?.trim();
    if (doAmbiente) return path.resolve(doAmbiente);
    // `bot.ts` resolve a partir de `dist/`, que e' um nivel abaixo da raiz.
    return path.resolve(__dirname, '..', '..', 'auth_info_baileys');
}

/** O que o sistema responde hoje sobre armazenamento, dados e exposicao. */
export async function resumoArmazenamento(agora: Date = new Date()): Promise<ResumoArmazenamento> {
    const inicio = inicioDoDia(agora);
    const pastaBackup = backupDir();
    const pastaLog = pastaDeLogs();
    const pastaSessao = pastaDaSessao();

    /*
     * O caminho do .db vem do proprio SQLite, e nao de `path.join`.
     *
     * O `DATABASE_URL` e' relativo a pasta do schema, entao um join aqui erraria
     * justamente no caso que importa: banco apontado para outro disco. E ja
     * existe a mesma pergunta respondida na retencao -- `PRAGMA database_list`
     * devolve o caminho que o motor esta usando de fato.
     */
    let caminhoBanco: string | null = null;
    try {
        const linhas = await prisma.$queryRawUnsafe<{ file: string | null }[]>(`PRAGMA database_list`);
        caminhoBanco = linhas.find((l) => l.file)?.file ?? null;
    } catch {
        // Sem caminho, a secao mostra zeros em vez de mentir com um palpite.
        caminhoBanco = null;
    }

    const bancoArquivos = caminhoBanco
        ? [
              { nome: path.basename(caminhoBanco), bytes: tamanhoDe(caminhoBanco) },
              // O WAL e o SHM sao o que o SQLite mantem aberto. Eles nao
              // encolhem sozinhos depois de escritas -- e sao a razao de um
              // disco encher sem que ninguem tenha criado nada.
              { nome: `${path.basename(caminhoBanco)}-wal`, bytes: tamanhoDe(`${caminhoBanco}-wal`) },
              { nome: `${path.basename(caminhoBanco)}-shm`, bytes: tamanhoDe(`${caminhoBanco}-shm`) },
          ]
        : [];

    const [mensagensHoje, conversasAtivas, pedidosHoje] = await Promise.all([
        prisma.message.count({ where: { sentAt: { gte: inicio } } }),
        prisma.chat.count(),
        prisma.order.count({ where: { createdAt: { gte: inicio } } }),
    ]);

    const backups = somarArquivos(pastaBackup, ehBackup);

    // A copia mais recente pelo nome, que ja esta em ordem de data. Nao abrir
    // o arquivo para saber a hora: o carimbo no nome existe para isso, e abrir
    // 14 arquivos de banco para mostrar uma data e' desperdicio.
    let ultimoBackup: ResumoArmazenamento['ultimoBackup'] = null;
    try {
        const nomes = fs
            .readdirSync(pastaBackup)
            .filter(ehBackup)
            .sort()
            .reverse();
        const nome = nomes[0];
        if (nome) {
            const carimbo = nome.replace('backup-', '').replace('.db', ''); // YYYY-MM-DD_HHMM
            const quando = new Date(
                `${carimbo.slice(0, 4)}-${carimbo.slice(4, 6)}-${carimbo.slice(6, 8)}T${carimbo.slice(9, 11)}:${carimbo.slice(11, 13)}:00`
            );
            ultimoBackup = { arquivo: nome, quando: Number.isNaN(quando.getTime()) ? new Date(0) : quando };
        }
    } catch {
        // Pasta ausente: e' o estado de quem ainda nao rodou o servidor.
    }

    const logs = somarArquivos(pastaLog, ehLog);
    const sessao = somarArquivos(pastaSessao, () => true);

    const host = process.env.HOST?.trim() || '0.0.0.0';

    return {
        bancoBytes: bancoArquivos.reduce((a, f) => a + f.bytes, 0),
        bancoArquivos: bancoArquivos.filter((f) => f.bytes > 0),
        backupBytes: backups.bytes,
        backupQuantidade: backups.quantidade,
        ultimoBackup,
        logBytes: logs.bytes,
        logQuantidade: logs.quantidade,
        sessaoBytes: sessao.bytes,
        sessaoArquivos: sessao.quantidade,

        mensagensHoje,
        conversasAtivas,
        pedidosHoje,

        pastaBackup,
        pastaLog,
        /*
         * A regra escrita para quem le, e nao para quem implementa.
         *
         * "24 horas" seria mais curto de explicar e seria menos verdade: o
         * corte e' na meia-noite, entao uma mensagem das 23:00 vive uma hora e
         * uma das 00:10 vive quase vinte e quatro. O que a tela promete tem que
         * ser o que o codigo faz, entao o texto e' sobre a meia-noite.
         */
        retencao:
            `Na virada da meia-noite as mensagens de ontem saem do sistema, junto com a conversa na lista ` +
            `e com os backups e logs de antes de hoje. O que nao e' guardado em pedido (nome, telefone e itens) ` +
            `continua no banco, porque e' dele que o faturamento e o Kanban saem.`,
        proximaVirada: new Date(inicio.getTime() + 24 * 3600_000),
        exposicao: {
            host,
            aberta: host === '0.0.0.0' || host === '::',
            // Verdade, e e' a parte que incomoda: o painel nao tem senha. Um
            // campo aqui que dissesse "senha configurada" seria o tipo de
            // configuracao que so o dono acredita -- ver a nota no schema do
            // Config, sobre campo gravado e nao lido.
            temSenha: false,
        },
    };
}
