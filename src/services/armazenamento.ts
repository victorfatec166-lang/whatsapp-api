import * as fs from 'fs';
import * as path from 'path';
import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { inicioDoDia } from './retencao';
import { backupDir } from './backup';
import { pastaDeLogs } from './logger';
import { DIR_SESSAO_WHATSAPP } from './paths';
import { ehSqlite } from './sqlDial';

/**
 * O arquivo do banco, no modo SQLite. A URL e' `file:<caminho>`, e no Windows o
 * caminho vem com `/` e com letra de drive -- e por isso que ele passa por `path`.
 */
export function caminhoDoBanco(): string {
    const url = process.env.DATABASE_URL ?? '';
    return path.resolve(url.replace(/^file:/, ''));
}

/**
 * Onde estao os dados, quanto ocupam, e o que o sistema guarda.
 * Numero medido, nunca estimado -- e' o que permite dizer "cresceu 4 MB neste mes".
 * Sem grafico nem projecao: projetar sem historico e' inventar numero.
 */

/** Como o sistema esta exposto. Ver a nota de seguranca no fim do arquivo. */
export type Exposicao = {
    host: string;
    /** ABERTA = qualquer maquina da mesma rede chega no painel. */
    aberta: boolean;
    temSenha: boolean;
};

export type ResumoArmazenamento = {
    /** Tamanho do banco, e dos backups que o sistema guarda em disco. */
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
 * Pasta da sessao do WhatsApp, recalculada com a mesma regra do `bot.ts` em vez
 * de importada: `bot.ts` conecta o Baileys no import, e um modulo de
 * diagnostico nao pode ter esse efeito colateral.
 */
function pastaDaSessao(): string {
    const doAmbiente = process.env.BAILEYS_AUTH_DIR?.trim();
    if (doAmbiente) return path.resolve(doAmbiente);
    return DIR_SESSAO_WHATSAPP;
}

/** O que o sistema responde hoje sobre armazenamento, dados e exposicao. */
export async function resumoArmazenamento(agora: Date = new Date()): Promise<ResumoArmazenamento> {
    const inicio = inicioDoDia(agora);
    const pastaBackup = backupDir();
    const pastaLog = pastaDeLogs();
    const pastaSessao = pastaDaSessao();

    /*
     * O tamanho vem do proprio banco, e nao de `stat` num arquivo: no Postgres
     * gerenciado nao ha arquivo local. No SQLite, que E' um arquivo, o caminho e' o
     * inverso -- e `stat` e' exato, sem perguntar nada ao banco.
     */
    let bancoBytes: number | null = null;
    let nomeDoBanco = 'banco (Postgres)';
    if (ehSqlite) {
        nomeDoBanco = 'banco (SQLite)';
        try {
            bancoBytes = fs.statSync(caminhoDoBanco()).size;
        } catch {
            bancoBytes = null;
        }
    } else {
        try {
            const linhas = await prisma.$queryRawUnsafe<{ bytes: bigint | number }[]>(
                `SELECT pg_database_size(current_database()) AS bytes`
            );
            bancoBytes = linhas[0] ? Number(linhas[0].bytes) : null;
        } catch {
            bancoBytes = null;
        }
    }

    const bancoArquivos = bancoBytes === null ? [] : [{ nome: nomeDoBanco, bytes: bancoBytes }];

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
         * A regra escrita para quem le, e nao para quem implementa. "24 horas"
         * seria mais curto e menos verdade: o corte e' na meia-noite, e o que a
         * tela promete tem que ser o que o codigo faz.
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
            // campo aqui que dissesse "senha configurada" seria configuracao
            // que so o dono acredita.
            temSenha: false,
        },
    };
}
