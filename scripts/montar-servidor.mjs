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
 * A ARVORE DE DEPENDENCIAS E' FECHADA AQUI, MAS SO DO JEITO CERTO
 *
 * O caminho e' o que o Node usaria: um pacote X precisa de N, e N e' procurado em
 * `X/node_modules`, depois subindo ate a raiz do `node_modules`. Achou ai, copiado no
 * mesmo lugar -- porque aplanilha e' achatada, e a versao aninhada (`pino` 9 do Baileys
 * contra o 8 da raiz) flattenada trocaria o pino do sistema. Duas vezes isso custou um
 * `Cannot find module` no PC da loja: no `npm ls --omit=dev --all --json`, que
 * deduplica e esconde os filhos de um no repetido, e no `npm ls` de outro projeto.
 *
 * O QUE ENTRA
 *
 * `dist/` compilado, o schema local, as dependencias de PRODUCAO, o Prisma CLI e o motor
 * de schema (e' o que migra o banco da loja quando a nuvem manda um schema novo). Fora o
 * `.cache` dos binarios e o `.tmp` do `generate` interrompido -- 238 MB no repositorio
 * de desenvolvimento, e zero util na loja.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
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

/** O `.tmp` do generate e' copia de transferencia; `.cache` e' o download dos binarios. */
const LIXO = ['.cache', '.tmp'];

/**
 * Fecha o grafo de dependencias a partir de uma lista de nomes.
 *
 * `de` e' a pasta de onde o pacote foi pedido, e e' por ela que a busca sobe: `pino`
 * pedido pelo Baileys resolve no `pino` aninhado dele, nao no da raiz. Achou ai, copiado
 * no mesmo lugar -- porque a planilha e' achatada, e trocar as duas versoes de `pino`
 * quebraria o logger do sistema.
 */
function fecha(nomes, de) {
    const vistos = new Set();
    const fila = nomes.map((nome) => ({ nome, de }));
    const pulados = [];

    while (fila.length) {
        const pedido = fila.shift();
        const origem = procuraNaArvore(pedido.de, pedido.nome);
        // Dependencia opcional de outra plataforma (`fsevents`, so no macOS) entra na
        // fila e nao existe no disco do Windows: pular e' o que o proprio npm faz.
        if (!origem) {
            pulados.push(pedido.nome);
            continue;
        }
        if (vistos.has(origem)) continue;
        vistos.add(origem);

        const pkg = JSON.parse(readFileSync(join(origem, 'package.json'), 'utf8'));
        for (const dep of Object.keys(pkg.dependencies ?? {})) fila.push({ nome: dep, de: origem });
    }

    return { vistos, pulados };
}

/** Onde o Node procuraria: a pasta do proprio pacote, subindo ate a raiz do projeto. */
function procuraNaArvore(de, nome) {
    let pasta = de;
    for (;;) {
        const tentativa = join(pasta, 'node_modules', nome);
        if (existsSync(join(tentativa, 'package.json'))) return tentativa;
        if (pasta === RAIZ) break;
        const pai = dirname(pasta);
        if (pai === pasta) break;
        pasta = pai;
    }
    return null;
}
function tamanhoDe(alvo) {
    if (!existsSync(alvo)) return 0;
    const p = statSync(alvo);
    if (p.isFile()) return p.size;
    let total = 0;
    for (const nome of readdirSync(alvo)) {
        total += tamanhoDe(join(alvo, nome));
    }
    return total;
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

/** Copia preservando o lugar do pacote na arvore (aninhado ou na raiz). */
function copiaPacote(origem, destino) {
    mkdirSync(dirname(destino), { recursive: true });
    cpSync(origem, destino, {
        recursive: true,
        filter: (de) => !LIXO.some((lixo) => basename(de) === lixo || basename(de).startsWith(lixo)),
    });
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
        console.error("\nFALHA: o servidor do instalador precisa do cliente do SQLite, e o atual e' do Postgres.");
        console.error('       Rode "npm run banco:local" e monte de novo. Para voltar a nuvem: "npm run banco:postgres".\n');
        process.exit(1);
    }

    console.log('1/4 limpando a pasta anterior...');
    rmSync(SAIDA, { recursive: true, force: true });
    mkdirSync(join(SAIDA, 'node_modules'), { recursive: true });

    console.log('2/4 copiando o servidor compilado, o schema local e a marca...');
    cpSync(join(RAIZ, 'dist'), join(SAIDA, 'dist'), { recursive: true });
    mkdirSync(join(SAIDA, 'prisma'), { recursive: true });
    cpSync(join(RAIZ, 'prisma', 'schema.local.prisma'), join(SAIDA, 'prisma', 'schema.local.prisma'));
    // `marca/` e' servida por `express.static(process.cwd() + '/marca')`: sem a pasta ao
    // lado do sistema, a tela de entrada e a barra lateral abrem com a imagem quebrada.
    cpSync(join(RAIZ, 'marca'), join(SAIDA, 'marca'), { recursive: true });

    console.log('3/4 copiando as dependencias de producao, como o Node resolve...');
    const producao = Object.keys(JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).dependencies ?? {});
    // O Prisma CLI entra a mao: e' de desenvolvimento no `package.json`, mas sem ele o
    // `atualiza.js` do programa instalado nao consegue migrar o banco da loja.
    const { vistos, pulados } = fecha([...producao, 'prisma'], RAIZ);
    for (const origem of vistos) {
        copiaPacote(origem, join(SAIDA, relative(RAIZ, origem)));
    }
    // O cliente gerado vive em `.prisma`, fora do pacote, e o `@prisma/client` so reexporta.
    mkdirSync(join(SAIDA, 'node_modules', '.prisma'), { recursive: true });
    copiaClienteDoPrisma(join(SAIDA, 'node_modules', '.prisma', 'client'));

    const bytes = tamanhoDe(SAIDA);
    console.log('4/4 pronto.');
    console.log('');
    console.log(`Pasta:  ${SAIDA}`);
    console.log(`Pacotes: ${vistos.size}${pulados.length ? ` (${pulados.length} opcional(is) fora: ${[...new Set(pulados)].join(', ')})` : ''}`);
    console.log(`Tamanho: ${mb(bytes)}`);
    console.log('');
    console.log('Para testar, suba daqui:  node cliente/servidor/dist/server.js');
}

/** O cliente gerado e' de qual banco? O proprio arquivo gerado diz. */
function driverDoCliente() {
    const arquivo = join(MODULES, '.prisma', 'client', 'schema.prisma');
    if (!existsSync(arquivo)) return 'nenhum';
    const fonte = readFileSync(arquivo, 'utf8');
    return /provider\s*=\s*"sqlite"/.test(fonte) ? 'sqlite' : 'postgres';
}

principal();