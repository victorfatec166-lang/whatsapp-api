import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { logDoModulo } from './logger';

const log = logDoModulo('cliente');

/*
 * `cliente-dist/` e' build e nao dado, e no Render o disco morre a cada deploy -- por
 * isso o `render.yaml` monta o pacote no build. Aqui so cobre o develope que nunca
 * rodou o passo: nesse caso o pacote e' montado uma vez, no primeiro pedido.
 */

const RAIZ = resolve(__dirname, '..', '..');

/** Onde o `montar-cliente.mjs` deixa a pasta e onde o zip fica. */
export const PASTA_CLIENTE = join(RAIZ, 'saida-cliente', 'DeliveryAdmin');
export const ZIP_CLIENTE = join(RAIZ, 'cliente-dist', 'DeliveryAdmin-win-x64.zip');

/** O que o navegador recebe: nome com versao nenhuma e caminho estavel. */
export const NOME_DO_ZIP = 'DeliveryAdmin-win-x64.zip';

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
