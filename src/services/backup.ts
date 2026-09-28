import { prisma } from '../database/prisma';
import * as fs from 'fs';
import * as path from 'path';
import { logDoModulo } from './logger';
const log = logDoModulo('backup');

/**
 * Backup do banco.
 *
 * O negocio inteiro cabe em um arquivo SQLite. Se esse arquivo se perde, some
 * o historico de pedidos, o caixa conferido e o catalogo, e nao ha como
 * reconstruir: nao existe outro lugar de onde a informacao veio. E' a unica
 * falha do sistema que nao tem conserto por logica, so por copia.
 *
 * Por que VACUUM INTO e nao "copiar o arquivo"
 *
 * Copiar o dev.db enquanto o servidor roda pode capturar o arquivo no meio de
 * uma escrita, e o SQLite temWrite-ahead Log: a copia sai truncada ou
 * inconsistente. VACUUM INTO pede ao proprio banco que grave uma copia
 * consistente, num arquivo novo, com a base em uso. Por isso roda no startup
 * e no meio do dia sem precisar derrubar o servidor.
 *
 * O que isso NAO protege
 *
 * A copia fica em outro arquivo na mesma maquina. Protege contra registro
 * apagado por engano, banco corrompido e erro de operacao. Nao protege contra
 * disco queimado, roubo ou fire: para isso a copia precisa sair daqui, por
 * exemplo para um disco externo ou um sync de pasta.
 */

const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'backups');

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
 * Remove as copias mais antigas, mantendo as KEEP mais novas.
 *
 * Nao apaga nada se o diretorio sumir, e nunca apaga a unica copia que
 * existe: quando o total ainda cabe na cota, nao ha o que remover.
 */
function podar(): void {
    const arquivos = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith('.db'))
        // O carimbo no nome ordena por data, sem precisar abrir cada arquivo.
        .sort()
        .reverse();

    const sobrando = arquivos.slice(KEEP);
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
 * Sobe o backup automatico: uma copia logo no startup e outra a cada seis
 * horas enquanto o processo viver.
 *
 * A primeira copia no startup e' proposital. Se o servidor esta rodando ha
 * semanas, esse e' o primeiro ponto onde a rotina executa, e um backup que so
 * comeca seis horas depois deja a janela aberta sem nenhuma copia.
 */
export function startBackupScheduler(): void {
    if (timer) return;

    void backupNow();

    timer = setInterval(
        () => {
            void backupNow();
        },
        INTERVALO_HORAS * 60 * 60 * 1000
    );
    // O agendador nao pode ser a razao do processo ficar vivo.
    timer.unref?.();
}

/** Caminho da pasta de backups, para mostrar no log e na tela de status. */
export function backupDir(): string {
    return BACKUP_DIR;
}
