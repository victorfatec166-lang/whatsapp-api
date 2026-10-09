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
 * repositorio de desenvolvimento, e zero util na loja. Entram tambem o Prisma CLI e o
 * motor de schema: e' o que migra o banco da loja quando a nuvem manda um schema novo.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = join(RAIZ, 'node_modules');
/*
 * Onde vai o pacote. O padrao e' o do instalador (SQLite). O segundo nome existe porque
 * um cliente do Prisma so serve a um driver: quem precisa dos dois lado -- a prova do
 * relay, por exemplo -- monta um pacote de cada e sobe cada servidor do seu.
 */
const SAIDA = join(RAIZ, 'cliente', process.argv[2] ? `servidor-${process.argv[2]}` : 'servidor');
const SO_SQLITE = !process.argv[2];

/** Os pacotes de que o servidor precisa, fechados pelos `dependencies` de cada um. */
function fechaDeProducao(raiz) {
    const raizDoProjeto = join(raiz, 'package.json');
    const pedidos = Object.keys(JSON.parse(readFileSync(raizDoProjeto, 'utf8')).dependencies ?? {});
    return fecha(pedidos, join(raiz, 'node_modules'));
}

/**
 * Fecha uma lista de pacotes e as dependencias deles.
 *
 * E' o mesmo caminho usado para as dependencias do servidor, so que com a raiz fora:
 * o Prisma CLI e' pedido pelo `cliente/atualiza.js`, que roda dentro do programa
 * instalado, e ele nao esta' no `dependencies` do `package.json`.
 */
function fecha(pedidos, ondeResolver) {
    const vistos = new Map();
    const fila = [...pedidos];

    while (fila.length) {
        const nome = fila.shift();
        if (vistos.has(nome)) continue;
        // Aninhado primeiro: e' assim que o npm resolve versao diferente.
        const candidatos = [join(MODULES, nome), join(ondeResolver, nome)];
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

/** O cliente gerado e' de qual banco? O proprio arquivo gerado diz. */
function driverDoCliente() {
    const arquivo = join(RAIZ, 'node_modules', '.prisma', 'client', 'schema.prisma');
    if (!existsSync(arquivo)) return 'nenhum';
    const fonte = readFileSync(arquivo, 'utf8');
    return /provider\s*=\s*"sqlite"/.test(fonte) ? 'sqlite' : 'postgres';
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

    /*
     * O pacote da loja PRECISA do cliente do SQLite: e' o arquivo dele que abre. Com o
     * cliente do Postgres empacotado, o programa so quebra no PC do cliente -- nunca
     * aqui -- e a causa ("a URL deve comecar com file:") nao diz nada do instalador.
     */
    const driver = driverDoCliente();
    if (SO_SQLITE && driver !== 'sqlite') {
        console.error('\nFALHA: o servidor do instalador precisa do cliente do SQLite, e o atual e\' do Postgres.');
        console.error('       Rode "npm run banco:local" e monte de novo. Para voltar a nuvem: "npm run banco:postgres".\n');
        process.exit(1);
    }

    console.log('1/5 limpando a pasta anterior...');
    rmSync(SAIDA, { recursive: true, force: true });
    mkdirSync(join(SAIDA, 'node_modules'), { recursive: true });

    console.log('2/5 copiando o servidor compilado e o schema local...');
    cpSync(join(RAIZ, 'dist'), join(SAIDA, 'dist'), { recursive: true });
    mkdirSync(join(SAIDA, 'prisma'), { recursive: true });
    cpSync(join(RAIZ, 'prisma', 'schema.local.prisma'), join(SAIDA, 'prisma', 'schema.local.prisma'));

    console.log('3/5 copiando so as dependencias de producao...');
    const pacotes = fechaDeProducao(RAIZ);
    for (const [nome, origem] of pacotes) {
        const destino = join(SAIDA, 'node_modules', nome);
        mkdirSync(dirname(destino), { recursive: true });
        cpSync(origem, destino, { recursive: true, filter: (de) => !basename(de).startsWith('.cache') });
    }
    // O cliente gerado vive em `.prisma`, fora do pacote, e o `@prisma/client` so reexporta.
    mkdirSync(join(SAIDA, 'node_modules', '.prisma'), { recursive: true });
    copiaClienteDoPrisma(join(SAIDA, 'node_modules', '.prisma', 'client'));

    /*
     * O Prisma CLI vai junto porque e' ele que migra o banco da loja quando a nuvem
     * manda um schema novo, e a migracao acontece no PC da loja -- nao na nuvem, onde
     * o arquivo nem existe. Sao ~46 MB: o motor do Windows e' o mesmo que ja vai na
     * `.prisma/client`, e o `.cache` dos binarios fica de fora.
     */
    console.log('4/5 copiando o Prisma CLI, que migra o banco da loja...');
    const cli = fecha(['prisma'], join(RAIZ, 'node_modules'));
    for (const [nome, origem] of cli) {
        const destino = join(SAIDA, 'node_modules', nome);
        mkdirSync(dirname(destino), { recursive: true });
        cpSync(origem, destino, { recursive: true, filter: (de) => !basename(de).startsWith('.cache') });
    }

    const bytes = tamanhoDe(SAIDA);
    console.log('5/5 pronto.');
    console.log('');
    console.log(`Pasta:  ${SAIDA}`);
    console.log(`Pacotes: ${pacotes.size} de producao + ${cli.size} do Prisma CLI`);
    console.log(`Tamanho: ${mb(bytes)}`);
    console.log('');
    console.log('Para testar, suba daqui:  node cliente/servidor/dist/server.js');
}

principal();