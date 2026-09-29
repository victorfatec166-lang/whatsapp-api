/*
 * O que roda depois de `npm install`.
 *
 * Duas coisas, e so duas:
 *
 * 1. O cliente do Prisma. E' o codigo que fala com o banco, e ele e' gerado a
 *    partir do schema. Sem esse passo, qualquer tela da "table does not
 *    exist" nao importa -- o erro e' outro, e nao diz nada sobre a causa.
 *
 * 2. Aviso quando falta o .env, e nao erro. O `.env` e' configuracao da
 *    maquina e nao entra no git, entao ele legitimamente nao existe aqui. Um
 *    `postinstall` que falha trava o `npm install` inteiro por causa de um
 *    arquivo que o usuario ainda vai criar -- e a primeira impressao do projeto
 *    seria um erro vermelho em vez de "instale, copie o .env, rode".
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function principal() {
    const r = spawnSync('npx', ['prisma', 'generate'], {
        cwd: RAIZ,
        stdio: 'inherit',
        shell: true,
    });

    if (r.status !== 0) {
        console.warn('\n[aviso] Nao foi possivel gerar o cliente do Prisma agora.');
        console.warn('         Rode "npx prisma generate" antes de "npm start".\n');
    }

    if (!existsSync(resolve(RAIZ, '.env'))) {
        console.log('');
        console.log('  Antes de subir, crie a configuracao:');
        console.log('');
        console.log('      copy .env.example .env');
        console.log('');
        return;
    }

    // O aviso do CHANNEL_SECRET e' util, mas nao pode falhar o install. Envolve
    // numa leitura defensiva: um .env com codificacao inesperada ou sem
    // permissao de leitura nao pode derrubar a instalacao.
    let env = '';
    try {
        env = readFileSync(resolve(RAIZ, '.env'), 'utf8');
    } catch {
        return;
    }
    if (!/^\s*CHANNEL_SECRET\s*=/m.test(env)) {
        console.log('  [aviso] O .env nao tem CHANNEL_SECRET. O Mercado (iFood/99Food)');
        console.log('          recusa credencial sem ele. O resto funciona normal.');
        console.log('');
    }
}

principal();
