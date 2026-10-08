#!/usr/bin/env node
/*
 * A suite inteira num banco de teste descartavel, em SQLite.
 *
 * POR QUE UM SCRIPT E NAO SO UM COMANDO
 *
 * `npm test` usa o `DATABASE_URL` de quem roda, e na nuvem esse URL aponta para o
 * Postgres de producao: a suite criava e apagava tenant de teste LA dentro. Aqui o
 * banco nasce do schema local, some no fim e nao toca em loja nenhuma.
 *
 * PRECISA DO CLIENTE SQLITE
 *
 * Um cliente do Prisma so serve a um driver. Com o cliente do Postgres a suite roda
 * igual, mas os casos de data -- que so rodam em SQLite -- pulam. A mensagem abaixo
 * diz o comando certo em vez de deixar o teste pular em silencio.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BANCO = join(RAIZ, 'prisma', 'teste.db');
const URL_BANCO = `file:${BANCO.replace(/\\/g, '/')}`;
const SCHEMA_LOCAL = join(RAIZ, 'prisma', 'schema.local.prisma');

/** O cliente gerado e' de qual banco? O proprio arquivo gerado diz. */
function driverDoCliente() {
    const arquivo = join(RAIZ, 'node_modules', '.prisma', 'client', 'schema.prisma');
    if (!existsSync(arquivo)) return 'nenhum';
    const fonte = readFileSync(arquivo, 'utf8');
    return /provider\s*=\s*"sqlite"/.test(fonte) ? 'sqlite' : 'postgres';
}

function falha(mensagem) {
    console.error(`\n${mensagem}\n`);
    process.exit(1);
}

if (driverDoCliente() !== 'sqlite') {
    falha('A suite local precisa do cliente do SQLite. Rode "npm run banco:local" antes, e\n"npm run banco:postgres" quando voltar para a nuvem.');
}
if (!existsSync(SCHEMA_LOCAL)) {
    falha('prisma/schema.local.prisma nao existe. Ele vem de "npm run banco:local".');
}

rmSync(BANCO, { force: true });

const ambiente = { ...process.env, DATABASE_URL: URL_BANCO, MODO_LOCAL: '1', DELIVERYADMIN_TENANT: '' };

const schema = spawnSync('npx', ['prisma', 'db', 'push', '--schema', SCHEMA_LOCAL, '--skip-generate'], {
    cwd: RAIZ,
    stdio: 'inherit',
    shell: true,
    env: ambiente,
});
if (schema.status !== 0) falha('Nao deu para criar o banco de teste.');

// O glob e' do shell; aqui a lista sai da propria pasta, que e' o que o npm test faz.
const arquivos = readdirSync(join(RAIZ, 'tests'))
    .filter((nome) => nome.endsWith('.test.ts') || nome.endsWith('.test.js'))
    .map((nome) => join('tests', nome));

const suite = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', '--test-concurrency=1', ...arquivos],
    { cwd: RAIZ, stdio: 'inherit', env: ambiente }
);

process.exit(suite.status ?? 1);