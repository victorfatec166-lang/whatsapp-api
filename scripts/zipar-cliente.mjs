#!/usr/bin/env node
/*
 * Zipa a pasta do cliente de desktop em um unico arquivo.
 *
 * POR QUE NAO `tar -a` OU `Compress-Archive`
 *
 * `tar -a` so vira zip no bsdtar (Windows e macOS); no Linux -- que e' onde o
 * Render roda -- o `tar` e' o GNU e ele nao conhece zip. `Compress-Archive` e'
 * PowerShell e nao existe no servidor. Um writer de zip em Node e' o unico jeito
 * que produz o mesmo arquivo nos tres lugares, e sao ~110 linhas.
 *
 * POR QUE EM STREAM, E COM ARQUIVO TEMPORARIO
 *
 * O `DeliveryAdmin.exe` tem 234 MB. A primeira versao lia o arquivo e comprimia de
 * uma vez, o que passa de 500 MB com o resultado -- a memoria do plano free do
 * Render -- e o build morria de OOM sem nunca subir. Agora o arquivo entra em
 * pedacos de 1 MB.
 *
 * O destino da compressao e' um arquivo temporario, e nao a memoria, porque o
 * cabecalho local do zip vem ANTES dos dados e precisa saber o tamanho final. A
 * alternativa seria o "data descriptor" (bit 3), que grava o CRC depois do
 * arquivo: economiza a passada extra, mas nem todo extrator do Windows lida com
 * ele, e aqui o preco de errar e' a pessoa baixando um pacote que nao abre.
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createDeflateRaw } from 'node:zlib';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const RAIZ = resolve(process.argv[2] ?? '.');
const FONTE = resolve(process.argv[3] ?? 'saida-cliente/DeliveryAdmin');
const DESTINO = resolve(process.argv[4] ?? 'cliente-dist/DeliveryAdmin-win-x64.zip');

/** Pedaco de leitura: 1 MB. Maior nao ajuda (memoria) e menor deixa o deflate lento. */
const PEDACO = 1 << 20;

let tabela = null;
/** CRC32 (polinomio 0xEDB88320), a tabela montada uma vez e usada em todos os bytes. */
function tabelaCrc() {
    if (tabela) return;
    tabela = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        tabela[i] = c;
    }
}

/** A hora no formato MS-DOS, que e' o que o cabecalho do zip guarda. */
function horaDos(mtime) {
    return {
        hora: ((mtime.getHours() & 31) << 11) | ((mtime.getMinutes() & 63) << 5) | ((mtime.getSeconds() / 2) & 31),
        dia: (((mtime.getFullYear() - 1980) & 127) << 9) | (((mtime.getMonth() + 1) & 15) << 5) | (mtime.getDate() & 31),
    };
}

function listaDeArquivos(pasta) {
    const saida = [];
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
        const completo = join(pasta, entrada.name);
        if (entrada.isDirectory()) saida.push(...listaDeArquivos(completo));
        else if (entrada.isFile()) saida.push(completo);
    }
    return saida;
}

function mb(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Comprime um arquivo para `destino` e devolve crc e os dois tamanhos. */
function comprime(arquivo, destino) {
    return new Promise((ok, er) => {
        const saida = createWriteStream(destino);
        const deflate = createDeflateRaw({ level: 6 });
        let crc = -1;
        let tamCru = 0;
        let tamZip = 0;

        deflate.on('data', (pedaco) => {
            tamZip += pedaco.length;
            saida.write(pedaco);
        });
        deflate.on('error', er);
        deflate.on('end', () => saida.end(() => ok({ crc: (crc ^ -1) >>> 0, tamCru, tamZip })));

        createReadStream(arquivo, { highWaterMark: PEDACO })
            .on('data', (pedaco) => {
                tamCru += pedaco.length;
                for (let i = 0; i < pedaco.length; i++) crc = tabela[(crc ^ pedaco[i]) & 0xff] ^ (crc >>> 8);
            })
            .on('error', er)
            .pipe(deflate);
    });
}

/** Cabecalho local de um arquivo: 30 bytes fixos, mais o nome. */
function cabecalhoLocal(nome, crc, tamCompacto, tamOriginal, mtime) {
    const b = Buffer.alloc(30);
    b.writeUInt32LE(0x04034b50, 0);
    b.writeUInt16LE(20, 4);
    b.writeUInt16LE(0x0800, 6); // 0x0800 = nome em UTF-8
    b.writeUInt16LE(8, 8); // 8 = deflate
    b.writeUInt16LE(horaDos(mtime).hora, 10);
    b.writeUInt16LE(horaDos(mtime).dia, 12);
    b.writeUInt32LE(crc, 14);
    b.writeUInt32LE(tamCompacto, 18);
    b.writeUInt32LE(tamOriginal, 22);
    b.writeUInt16LE(Buffer.byteLength(nome), 26);
    return Buffer.concat([b, Buffer.from(nome, 'utf8')]);
}

/** Entrada do diretorio central: o que o extrator le para achar cada arquivo. */
function cabecalhoCentral(nome, crc, tamCompacto, tamOriginal, mtime, posicao) {
    const { hora, dia } = horaDos(mtime);
    const b = Buffer.alloc(46);
    b.writeUInt32LE(0x02014b50, 0);
    b.writeUInt16LE(20, 4); // versao que fez o arquivo
    b.writeUInt16LE(20, 6); // versao minima para extrair
    b.writeUInt16LE(0x0800, 8);
    b.writeUInt16LE(8, 10);
    b.writeUInt16LE(hora, 12);
    b.writeUInt16LE(dia, 14);
    b.writeUInt32LE(crc, 16);
    b.writeUInt32LE(tamCompacto, 20);
    b.writeUInt32LE(tamOriginal, 24);
    b.writeUInt16LE(Buffer.byteLength(nome), 28);
    b.writeUInt32LE(posicao, 42);
    return Buffer.concat([b, Buffer.from(nome, 'utf8')]);
}

async function principal() {
    if (!existsSync(FONTE)) {
        console.log(`Pasta do cliente nao encontrada em ${FONTE}: nada para zipar.`);
        return;
    }

    tabelaCrc();
    mkdirSync(dirname(DESTINO), { recursive: true });
    rmSync(DESTINO, { force: true });

    const arquivos = listaDeArquivos(FONTE);
    const temporario = join(tmpdir(), `zip-cliente-${process.pid}-${basename(FONTE)}`);
    rmSync(temporario, { force: true });

    const saida = createWriteStream(DESTINO);
    const escrever = (buf) =>
        new Promise((ok, er) => {
            if (saida.write(buf)) return ok();
            const pronto = () => {
                saida.off('error', er);
                ok();
            };
            saida.once('drain', pronto);
            saida.once('error', er);
        });

    const diretorio = [];
    let offset = 0;
    let totalCru = 0;
    let totalZip = 0;

    console.log(`1/2 zipando ${arquivos.length} arquivo(s) de ${FONTE}...`);

    for (const arquivo of arquivos) {
        const nome = relative(FONTE, arquivo).split(sep).join('/');
        const mtime = statSync(arquivo).mtime;

        const { crc, tamCru, tamZip } = await comprime(arquivo, temporario);

        await escrever(cabecalhoLocal(nome, crc, tamZip, tamCru, mtime));
        for await (const pedaco of createReadStream(temporario, { highWaterMark: PEDACO })) await escrever(pedaco);

        diretorio.push(cabecalhoCentral(nome, crc, tamZip, tamCru, mtime, offset));
        offset += 30 + Buffer.byteLength(nome) + tamZip;
        totalCru += tamCru;
        totalZip += tamZip;
        rmSync(temporario, { force: true });
    }

    const cd = Buffer.concat(diretorio);
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(arquivos.length, 8);
    fim.writeUInt16LE(arquivos.length, 10);
    fim.writeUInt32LE(cd.length, 12);
    fim.writeUInt32LE(offset, 16);
    await escrever(cd);
    await escrever(fim);

    await new Promise((ok, er) => saida.end((e) => (e ? er(e) : ok())));
    rmSync(temporario, { force: true });

    console.log('2/2 medindo...');
    console.log('');
    console.log(`Zip:    ${DESTINO} (${mb(statSync(DESTINO).size)})`);
    console.log(`Cru:    ${mb(totalCru)} -> ${mb(totalZip)} de conteudo (${((totalZip / totalCru) * 100).toFixed(0)}%)`);
    console.log(`Origem: ${RAIZ}`);
}

principal().catch((e) => {
    console.error(e);
    process.exit(1);
});