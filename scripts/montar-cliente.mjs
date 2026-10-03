#!/usr/bin/env node
/*
 * Monta o cliente de desktop como um programa de dois cliques.
 *
 * POR QUE NAO USAR electron-builder
 *
 * Ele resolveria isso em um comando, e mesmo assim nao entra: e' mais 100 MB de
 * dependencia, um `electron-builder` na configuracao que precisa ficar correta para
 * Windows, e uma build de 10 minutos a cada ajuste. Sao tres dependencias para
 * copiar uma pasta que ja existe pronta.
 *
 * O QUE ESTE SCRIPT FAZ
 *
 * O Electron procura o programa em `resources/app`. Como a pasta `cliente` do
 * projeto tem o `main.js` na raiz -- que e' o que o `package.json` dela declara --
 * copiar o conteudo dela para la e' tudo que a mudanca de "@electron/packager"
 * faria. O `default_app.asar` que vem no pacote e' o que o Electron abre quando
 * nao acha programa nenhum, entao ele sai: sem ele, `resources/app` manda.
 *
 * `locales/` tem 55 idiomas e 48 MB. Um cliente que so roda em portugues e ingles
 * nao precisa deles, e sao 40 MB que nao pagam o.download.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RAIZ = resolve(process.argv[2] ?? '.');
const SAIDA = resolve(process.argv[3] ?? 'saida-cliente');
const DIST_ELECTRON = join(RAIZ, 'node_modules', 'electron', 'dist');
const CLIENTE = join(RAIZ, 'cliente');

/** Idiomas que o app precisa. Fora daqui, e' peso morto. */
const LOCALES = ['pt-BR.pak', 'en-US.pak'];

const destino = join(SAIDA, 'DeliveryAdmin');

function tamanhoDe(pasta) {
    let total = 0;
    for (const nome of readdirSync(pasta)) {
        const caminho = join(pasta, nome);
        total += statSync(caminho).isDirectory() ? tamanhoDe(caminho) : statSync(caminho).size;
    }
    return total;
}

function mb(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function principal() {
    if (!existsSync(DIST_ELECTRON)) throw new Error(`Electron nao encontrado em ${DIST_ELECTRON}`);
    if (!existsSync(CLIENTE)) throw new Error(`Pasta do cliente nao encontrada em ${CLIENTE}`);

    rmSync(SAIDA, { recursive: true, force: true });
    mkdirSync(destino, { recursive: true });

    console.log('1/5 copiando o runtime do Electron...');
    cpSync(DIST_ELECTRON, destino, { recursive: true });

    // O nome do executavel e' o primeiro detalhe que a pessoa ve no gerenciador.
    const exeAntigo = join(destino, 'electron.exe');
    const exeNovo = join(destino, 'DeliveryAdmin.exe');
    cpSync(exeAntigo, exeNovo);
    rmSync(exeAntigo, { force: true });

    console.log('2/5 guardando so os idiomas usados...');
    const locales = join(destino, 'locales');
    for (const arquivo of readdirSync(locales)) {
        if (!LOCALES.includes(arquivo)) rmSync(join(locales, arquivo), { force: true });
    }

    console.log('3/5 tirando o app de exemplo que vem junto...');
    rmSync(join(destino, 'resources', 'default_app.asar'), { force: true });

    console.log('4/5 colocando o programa do DeliveryAdmin em resources/app...');
    const app = join(destino, 'resources', 'app');
    mkdirSync(app, { recursive: true });
    for (const arquivo of readdirSync(CLIENTE)) {
        cpSync(join(CLIENTE, arquivo), join(app, arquivo), { recursive: true });
    }

    /*
     * Os atalhos ficam em `resources/app` junto com o codigo, e o executavel duas
     * pastas acima: por isso o `%~dp0..\..`. Com um `..` a menos, o duplo clique
     *Rodava um caminho que nao existe e o cliente nao abria sem mensagem nenhuma.
     *
     * A diferenca entre os dois e' so a URL do painel: o normal abre a nuvem, que e'
     * onde o sistema esta'. O `local` existe para quem desenvolve e sobe o servidor.
     */
    writeFileSync(
        join(app, 'abrir.cmd'),
        '@echo off\r\nrem Abre o DeliveryAdmin. O painel vem da nuvem por padrao.\r\n' +
            'start "" "%~dp0..\\..\\DeliveryAdmin.exe"\r\n',
        'latin1'
    );
    writeFileSync(
        join(app, 'abrir-local.cmd'),
        '@echo off\r\nrem Para desenvolvimento: so funciona com o servidor rodando nesta maquina.\r\n' +
            'set "DELIVERYADMIN_URL=http://localhost:3000/admin"\r\n' +
            'start "" "%~dp0..\\..\\DeliveryAdmin.exe"\r\n',
        'latin1'
    );

    console.log('5/5 medindo...');
    const total = tamanhoDe(destino);
    console.log('');
    console.log(`Pasta: ${destino}`);
    console.log(`Tamanho: ${mb(total)}`);
    console.log('');
    console.log('Para testar, abra DeliveryAdmin.exe dentro dela.');
}

principal();