import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import * as fs from 'fs';
import * as path from 'path';
import { logDoModulo } from './logger';
import { DIR_BACKUPS as DIR_BACKUPS_CENTRAL } from './paths';
const log = logDoModulo('backup');

/**
 * Backup do banco: o negocio inteiro cabe num SQLite, e nao ha de onde reconstruir
 * se ele some -- unica falha do sistema sem conserto por logica, so por copia. E'
 * VACUUM INTO e nao "copiar o arquivo": com Write-ahead Log a copia sairia truncada.
 */

const BACKUP_DIR = DIR_BACKUPS_CENTRAL;

/** Quantas copias manter. Cada uma tem o tamanho do banco, entao o numero
 *  importa: um mes de backups de uma base pequena ainda cabe facil, mas nao
 *  e para encher o disco. */
const KEEP = 14;

/** De quanto em quanto tempo fazer uma copia com o servidor no ar. */
const INTERVALO_HORAS = 6;

function carimbo(): string {
    // Nome ordenavel pelo proprio nome: 2026-09-28_1530
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return (
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
        `_${p(d.getHours())}${p(d.getMinutes())}`
    );
}

/**
 * As copias do sistema, mais novas primeiro.
 * O filtro e' `backup-*.db`, e nao `*.db`: um dump manual do dono nao pode ser
 * apagado por uma regra de rotacao.
 */
function copias(): string[] {
    try {
        return fs
            .readdirSync(BACKUP_DIR)
            .filter((f) => f.startsWith('backup-') && f.endsWith('.db'))
            // O carimbo no nome ordena por data, sem precisar abrir cada arquivo.
            .sort()
            .reverse();
    } catch {
        // Pasta ainda nao existe: nao ha copia nenhuma para remover.
        return [];
    }
}

export type CopiaBackup = {
    arquivo: string;
    bytes: number;
    /** Quando a copia foi feita, lido do carimbo do nome. */
    quando: Date;
};

/**
 * As copias que existem, com tamanho e hora, mais novas primeiro.
 * A hora vem do carimbo do NOME, e nao do mtime: sao a mesma coisa nas copias do
 * sistema, e um `stat` por arquivo e' desperdicio.
 */
export function listarBackups(): CopiaBackup[] {
    const saida: CopiaBackup[] = [];
    for (const arquivo of copias()) {
        let bytes = 0;
        try {
            bytes = fs.statSync(path.join(BACKUP_DIR, arquivo)).size;
        } catch {
            // Corrompido ou sumido entre a listagem e o stat: entra sem tamanho,
            // que e' melhor do que a tela inteira falhar por causa de um arquivo.
        }

        const carimbo = arquivo.replace('backup-', '').replace('.db', ''); // YYYY-MM-DD_HHMM
        const quando = new Date(
            `${carimbo.slice(0, 4)}-${carimbo.slice(4, 6)}-${carimbo.slice(6, 8)}T` +
                `${carimbo.slice(9, 11)}:${carimbo.slice(11, 13)}:00`
        );

        saida.push({
            arquivo,
            bytes,
            quando: Number.isNaN(quando.getTime()) ? new Date(0) : quando,
        });
    }
    return saida;
}

/**
 * Remove as copias mais antigas, mantendo as KEEP mais novas.
 *
 * Nao apaga nada se o diretorio sumir, e nunca apaga a unica copia que
 * existe: quando o total ainda cabe na cota, nao ha o que remover.
 */
function podar(): void {
    const sobrando = copias().slice(KEEP);
    for (const f of sobrando) {
        try {
            fs.unlinkSync(path.join(BACKUP_DIR, f));
            log.info(`copia antiga removida: ${f}`);
        } catch (error) {
            log.error('nao foi possivel remover', { arquivo: f, erro: String(error) });
        }
    }
}

/**
 * Remove as copias de antes de `hoje` ("YYYY-MM-DD").
 * Existe pela virada do dia: a copia e' o banco inteiro, entao um backup de
 * ontem continuaria sendo onde as mensagens apagadas sobrevivem.
 */
export function podarBackupsDoDia(hoje: string): number {
    // "backup-" tem 7 caracteres, e a data ocupa os 10 seguintes.
    const antes = copias().filter((f) => f.slice(7, 17) < hoje);

    for (const f of antes) {
        try {
            fs.unlinkSync(path.join(BACKUP_DIR, f));
            log.info(`copia de antes de ${hoje} removida: ${f}`);
        } catch (error) {
            log.error('nao foi possivel remover', { arquivo: f, erro: String(error) });
        }
    }
    return antes.length;
}

/**
 * Grava uma copia consistente do banco. Devolve o caminho, ou null se nao
 * deu certo: uma falha de backup nao pode derrubar o servidor.
 */
export async function backupNow(): Promise<string | null> {
    try {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });

        const destino = path.join(BACKUP_DIR, `backup-${carimbo()}.db`);
        // Destino tem que sumir antes: o VACUUM INTO falha se o arquivo ja
        // existir, e dois backups no mesmo minuto colidiram.
        if (fs.existsSync(destino)) fs.unlinkSync(destino);

        // caminho como string SQL, com aspa simples escapada: o nome do
        // arquivo vem do relogio e nao tem aspa, mas a string concatena com
        // literais que poderia mudar depois.
        await prisma.$executeRawUnsafe(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);

        const kb = Math.round(fs.statSync(destino).size / 1024);
        log.info(`copia gravada: ${destino} (${kb} KB)`);
        podar();
        return destino;
    } catch (error) {
        log.error('falhou:', error);
        return null;
    }
}

let timer: NodeJS.Timeout | null = null;

/**
 * Uma copia no startup e outra a cada seis horas; a primeira evita a janela sem
 * backup nenhum. Devolve a Promise, e nao `void`: a virada do dia escreve logo
 * depois, e um VACUUM INTO no meio do DELETE ja grava a copia sem o dia anterior.
 */
export function startBackupScheduler(): Promise<void> {
    if (timer) return Promise.resolve();

    const primeira = backupNow().then(() => undefined);

    timer = setInterval(
        () => {
            void backupNow();
        },
        INTERVALO_HORAS * 60 * 60 * 1000
    );
    // O agendador nao pode ser a razao do processo ficar vivo.
    timer.unref?.();

    return primeira;
}

/** Caminho da pasta de backups, para mostrar no log e na tela de status. */
export function backupDir(): string {
    return BACKUP_DIR;
}
