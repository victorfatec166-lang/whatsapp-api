#!/usr/bin/env node
/*
 * Monta `cliente/servidor/`: o sistema pronto para o instalador levar dentro.
 *
 * POR QUE UMA PASTA SEPARADA
 *
 * O `electron-builder` empacota o `projectDir` (que e' `cliente/`), entao o servidor
 * precisa estar la dentro para entrar no instalador. Montar em vez de copiar na mao e'
 * o que mantem `node_modules` do projeto intacto -- `prisma generate` alterna o cliente
 * entre Postgres e SQLite, e um `node_modules` meio copiado quebra os dois.
 *
 * O QUE ENTRA
 *
 * `dist/` compilado, o schema local, e so as dependencias de PRODUCAO: nove no
 * `package.json`, mas cada uma arrasta as suas. O Prisma vai com o motor do Windows
 * (18 MB) e sem os `.tmp`, que sao lixo de `generate` interrompido -- 238 MB no
 * repositorio de desenvolvimento, e zero util na loja.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = join(RAIZ, 'node_modules');
const SAIDA = join(RAIZ, 'cliente', 'servidor');

/** Os pacotes de que o servidor precisa, fechados pelos `dependencies` de cada um. */
function fechaDeProducao(raiz) {
    const raizDoProjeto = join(raiz, 'package.json');
    const pedidos = Object.keys(JSON.parse(readFileSync(raizDoProjeto, 'utf8')).dependencies ?? {});
    const vistos = new Map();
    const fila = [...pedidos];

    while (fila.length) {
        const nome = fila.shift();
        if (vistos.has(nome)) continue;
        // Aninhado primeiro: e' assim que o npm resolve versao diferente.
        const candidatos = [join(MODULES, nome), join(raiz, 'node_modules', nome)];
        const caminho = candidatos.find((c) => existsSync(join(c, 'package.json')));
        if (!caminho) {
            console.warn(`  [aviso] ${nome} nao encontrado; o servidor pode nao subir.`);
            continue;
        }
        const pkg = JSON.parse(readFileSync(join(caminho, 'package.json'), 'utf8'));
        vistos.set(nome, caminho);
        for (const dep of Object.keys(pkg.dependencies ?? {})) fila.push(dep);
    }
    return vistos;
}

function tamanhoDe(alvo) {
    if (!existsSync(alvo)) return 0;
    const p = statSync(alvo);
    if (p.isFile()) return p.size;
    return readdirSync(alvo).reduce((s, nome) => s + tamanhoDe(join(alvo, nome)), 0);
}

function mb(bytes) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function copiaClienteDoPrisma(destino) {
    const origem = join(MODULES, '.prisma', 'client');
    cpSync(origem, destino, {
        recursive: true,
        // `.tmp*` e' copia de transferencia do `generate`: 18 MB cada, e nao serve.
        filter: (de) => !basename(de).startsWith('query_engine-windows.dll.node.tmp'),
    });
}

function basename(caminho) {
    return caminho.split(/[\\/]/).pop();
}

function principal() {
    if (!existsSync(join(RAIZ, 'dist', 'server.js'))) {
        console.error('\nFALHA: dist/server.js nao existe. Rode "npm run build" antes.\n');
        process.exit(1);
    }
    if (!existsSync(join(RAIZ, 'prisma', 'schema.local.prisma'))) {
        console.error('\nFALHA: prisma/schema.local.prisma nao existe. Rode "npm run banco:local".\n');
        process.exit(1);
    }

    console.log('1/4 limpando a pasta anterior...');
    rmSync(SAIDA, { recursive: true, force: true });
    mkdirSync(join(SAIDA, 'node_modules'), { recursive: true });

    console.log('2/4 copiando o servidor compilado e o schema local...');
    cpSync(join(RAIZ, 'dist'), join(SAIDA, 'dist'), { recursive: true });
    mkdirSync(join(SAIDA, 'prisma'), { recursive: true });
    cpSync(join(RAIZ, 'prisma', 'schema.local.prisma'), join(SAIDA, 'prisma', 'schema.local.prisma'));

    console.log('3/4 copiando so as dependencias de producao...');
    const pacotes = fechaDeProducao(RAIZ);
    for (const [nome, origem] of pacotes) {
        const destino = join(SAIDA, 'node_modules', nome);
        mkdirSync(dirname(destino), { recursive: true });
        cpSync(origem, destino, { recursive: true });
    }
    // O cliente gerado vive em `.prisma`, fora do pacote, e o `@prisma/client` so reexporta.
    mkdirSync(join(SAIDA, 'node_modules', '.prisma'), { recursive: true });
    copiaClienteDoPrisma(join(SAIDA, 'node_modules', '.prisma', 'client'));

    const bytes = tamanhoDe(SAIDA);
    console.log('4/4 pronto.');
    console.log('');
    console.log(`Pasta:  ${SAIDA}`);
    console.log(`Pacotes: ${pacotes.size} de producao (+ cliente do Prisma)`);
    console.log(`Tamanho: ${mb(bytes)}`);
    console.log('');
    console.log('Para testar, suba daqui:  node cliente/servidor/dist/server.js');
}

principal();