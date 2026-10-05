import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { logDoModulo } from './logger';

const log = logDoModulo('cliente');

/*
 * `cliente-dist/` e' build e nao dado, e no Render o disco morre a cada deploy.
 * O pacote do cliente nao cabe no build de la (367 MB do Electron num runner de
 * 512 MB), entao ele vive como release do repositorio e a rota redireciona para ca.
 */

const RAIZ = resolve(__dirname, '..', '..');

/** Onde o `montar-cliente.mjs` deixa a pasta e onde o zip fica. */
export const PASTA_CLIENTE = join(RAIZ, 'saida-cliente', 'DeliveryAdmin');
export const ZIP_CLIENTE = join(RAIZ, 'cliente-dist', 'DeliveryAdmin-win-x64.zip');

/** O que o navegador recebe: nome com versao nenhuma e caminho estavel. */
export const NOME_DO_ZIP = 'DeliveryAdmin-win-x64.zip';

/**
 * Endereco de onde o pacote pode ser baixado, ou `null` se `CLIENTE_DOWNLOAD_URL=off`.
 *
 * O padrao e' a release mais recente: `releases/latest/download/<arquivo>` e' do proprio
 * GitHub, entao versao nova e' anexar o arquivo, sem mexer em codigo. Release SEM o nome
 * do arquivo e' a pagina do release (que abre no navegador), entao o `/download` e'
 * completado aqui: o valor no `.env` da maquina aponta assim.
 */
export function urlDoPacote(): string | null {
    const configurado = process.env.CLIENTE_DOWNLOAD_URL?.trim();
    if (configurado === 'off') return null;
    const url =
        configurado ||
        'https://github.com/victorfatec166-lang/whatsapp-api/releases/latest/download/DeliveryAdmin-win-x64.zip';
    return /\/releases\/(latest|tag\/[^/]+)$/.test(url) ? `${url}/download/${NOME_DO_ZIP}` : url;
}

/** Mounting em andamento: duas requisicoes simultaneas nao podem gerar dois zips. */
let montando: Promise<string | null> | null = null;

/** O caminho do zip, ou `null` se ainda nao existe -- estado normal de quem develope sem ter montado. */
export function zipDoCliente(): string | null {
    return existsSync(ZIP_CLIENTE) ? ZIP_CLIENTE : null;
}

/** Tamanho em bytes, para o `Content-Length`: sem ele o navegador mostra barra de progresso em branco. */
export function tamanhoDoZip(): number | null {
    const caminho = zipDoCliente();
    return caminho ? statSync(caminho).size : null;
}

/** Monta a pasta e o zip. Nao levanta: quem chama decide o que fazer com o erro. */
function monta(): Promise<string | null> {
    return new Promise((ok) => {
        const passo = ['scripts/montar-cliente.mjs', 'scripts/zipar-cliente.mjs'];
        const executa = (i: number) => {
            if (i >= passo.length) return ok(zipDoCliente());
            const filho = spawn(process.execPath, [join(RAIZ, passo[i])], { cwd: RAIZ, stdio: 'ignore' });
            filho.on('error', () => ok(null));
            /*
             * `stdio: 'ignore'` de proposito: com `inherit`, a falha despejava o
             * stack do Node no log de producao e enterrava a causa real em dez
             * linhas de `node:internal`.
             */
            filho.on('close', (codigo) => {
                if (codigo === 0) return executa(i + 1);
                log.warn('montagem do cliente falhou', { passo: passo[i], codigo });
                ok(null);
            });
        };
        executa(0);
    });
}

/** `null` em vez de estourar: quem chama e' rota de download, e um 500 na hora de instalar o app e' pior que uma pagina dizendo que o pacote nao foi montado. */
export function garanteZipDoCliente(): Promise<string | null> {
    const pronto = zipDoCliente();
    if (pronto) return Promise.resolve(pronto);
    if (!montando) {
        log.info('zip do cliente ausente; montando na hora');
        montando = monta().finally(() => {
            montando = null;
        });
    }
    return montando;
}
