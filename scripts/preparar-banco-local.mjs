#!/usr/bin/env node
/*
 * Gera o schema local (SQLite) a partir do schema.prisma, e cria um banco vazio.
 *
 * POR QUE UM SCRIPT E NAO UM ARQUIVO DE SCHEMA
 *
 * O schema.prisma e' a fonte unica dos MODELOS. Se o SQLite tivesse um segundo
 * arquivo escrito a mao, os dois divergiriam na primeira mudanca de campo -- e a
 * divergencia so apareceria no SQLite, ou seja, na maquina do cliente, nunca aqui.
 * O script troca so o bloco `datasource`: em SQLite o `url` continua sendo a
 * DATABASE_URL, e um caminho `file:` serve igual.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEM = resolve(RAIZ, 'prisma', 'schema.prisma');
const DESTINO = resolve(RAIZ, 'prisma', 'schema.local.prisma');
const BANCO = resolve(RAIZ, 'cliente', 'banco-inicial.db');

/**
 * O bloco do datasource, reescrito. Fica aqui em vez de ser um template porque o
 * bloco original tem um comentario que explica a escolha do Postgres -- e um
 * arquivo local que carrega esse comentario mente sobre o proprio conteudo.
 */
const DATASOURCE_LOCAL = `datasource db {
  // SQLite, gerado por scripts/preparar-banco-local.mjs a partir do schema.prisma.
  //
  // Nao edite este arquivo: ele e' reescrito na hora do build do instalador, e o
  // que manda e' o schema.prisma. Para mudar um campo, muda la.
  provider = "sqlite"
  url      = env("DATABASE_URL")
}`;

/** Rebaixa o `datasource`, trocando o bloco inteiro ate a chave que fecha. */
function comDatasourceLocal(texto) {
    const abre = texto.indexOf('datasource db {');
    if (abre < 0) throw new Error('schema.prisma nao tem bloco `datasource db`.');

    let fecha = -1;
    let nivel = 0;
    for (let i = abre; i < texto.length; i++) {
        if (texto[i] === '{') nivel++;
        else if (texto[i] === '}') {
            nivel--;
            if (nivel === 0) {
                fecha = i;
                break;
            }
        }
    }
    if (fecha < 0) throw new Error('O bloco `datasource db` do schema.prisma nao fecha.');

    return texto.slice(0, abre) + DATASOURCE_LOCAL + texto.slice(fecha + 1);
}

function prisma(args, url) {
    const r = spawnSync('npx', ['prisma', ...args], {
        cwd: RAIZ,
        stdio: 'inherit',
        shell: true,
        // O `.env` aponta para o Postgres. Quem manda aqui e' a variavel de ambiente:
        // o dotenv do Prisma nao sobrescreve o que ja existe, entao o Postgres
        // seria gerado por engano e o erro apareceria so no boot do cliente.
        env: { ...process.env, DATABASE_URL: url },
    });
    if (r.status !== 0) throw new Error(`prisma ${args.join(' ')} falhou.`);
}

function principal() {
    if (!existsSync(ORIGEM)) throw new Error(`schema.prisma nao encontrado em ${ORIGEM}`);

    writeFileSync(DESTINO, comDatasourceLocal(readFileSync(ORIGEM, 'utf8')), 'utf8');
    console.log('1/3 schema.local.prisma gerado a partir do schema.prisma.');

    mkdirSync(dirname(BANCO), { recursive: true });
    const url = `file:${BANCO.replace(/\\/g, '/')}`;

    prisma(['generate', '--schema', DESTINO], url);
    console.log('2/3 cliente do Prisma gerado para SQLite.');

    prisma(['db', 'push', '--schema', DESTINO, '--skip-generate', '--accept-data-loss'], url);
    console.log(`3/3 banco vazio criado em ${BANCO}`);
}

try {
    principal();
} catch (erro) {
    console.error(`\nFALHA: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exit(1);
}