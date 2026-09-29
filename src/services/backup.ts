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
 * As copias do sistema, mais novas primeiro.
 *
 * O filtro e' `backup-*.db` e nao `*.db` de proposito. A pasta e' o unico lugar
 * onde o dono pode fazer um dump manual -- e foi o que aconteceu: um
 * `pre-drop-colunas-20260928-172125.db` deixado durante uma manutencao estava
 * na fila de `podar()`, que considerava qualquer `.db` uma copia do sistema. Um
 * backup que o sistema nao fez nao pode ser apagado por uma regra de rotacao.
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
 *
 * Existe por causa da virada do dia. A copia e' o banco inteiro, entao mesmo
 * depois de a poda apagar as mensagens, um backup de ontem continuaria sendo o
 * lugar onde elas sobrevivem -- e o backup e' o unico arquivo que sai do
 * controle do dia a dia. Depois desta chamada, o que a loja nao guardou nao
 * esta em nenhuma copia.
 *
 * A comparacao e' entre os prefixos de data dos nomes, que sao `YYYY-MM-DD` e
 * ordenam como data sem abrir nenhum arquivo. O que importa nao e' a hora da
 * copia: e' de que dia ela e'.
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
 * Sobe o backup automatico: uma copia logo no startup e outra a cada seis
 * horas enquanto o processo viver.
 *
 * A primeira copia no startup e' proposital. Se o servidor esta rodando ha
 * semanas, esse e' o primeiro ponto onde a rotina executa, e um backup que so
 * comecou seis horas depois deixaria a janela aberta sem nenhuma copia.
 *
 * Devolve a Promise da primeira copia, e nao `void`, por causa da ordem de
 * partida: a virada do dia (`retencao`) roda logo depois e escreve no banco. Um
 * `VACUUM INTO` que pega o meio de um `DELETE` grava uma copia consistente --
 * consistente no sentido do SQLite, ou seja, transacionalmente correta -- porem
 * sem a combinacao que o dono espera: um backup feito no mesmo instante da
 * poda pode ja vir sem as mensagens de ontem, e ai o backup deixa de ser o
 * lugar de onde se recupera o dia anterior. Quem chama precisa poder esperar.
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
