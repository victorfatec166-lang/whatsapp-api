#!/usr/bin/env node
/*
 * Zipa a pasta do cliente de desktop em um unico arquivo.
 *
 * POR QUE NAO `tar -a` OU `Compress-Archive`
 *
 * `tar -a` so vira zip no bsdtar (Windows e macOS); no Linux -- que e' onde o
 * Render roda -- o `tar` e' o GNU e ele nao conhece zip. `Compress-Archive` e'
 * PowerShell e nao existe no servidor. Um writer de zip em Node e' o unico jeito
 * que produz o mesmo arquivo nos tres lugares, e sao ~100 linhas.
 *
 * O formato e' o de sempre: cabecalho local, dados, diretorio central no fim e o
 * registro de fim. A diferenca que importa aqui e' o bit 11 (nome em UTF-8), sem
 * ele o Windows troca os acentos do nome de arquivo por lixo.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, relative, resolve, sep } from 'node:path';

const RAIZ = resolve(process.argv[2] ?? '.');
const FONTE = resolve(process.argv[3] ?? 'saida-cliente/DeliveryAdmin');
const DESTINO = resolve(process.argv[4] ?? 'cliente-dist/DeliveryAdmin-win-x64.zip');

/** Cabecalho local de um arquivo: 30 bytes fixos, mais o nome. */
function cabecalhoLocal(nome, crc, tamCompacto, tamOriginal, data) {
    const b = Buffer.alloc(30);
    b.writeUInt32LE(0x04034b50, 0);
    b.writeUInt16LE(20, 4);
    b.writeUInt16LE(0x0800, 6); // 0x0800 = nome em UTF-8
    b.writeUInt16LE(8, 8); // 8 = deflate
    b.writeUInt16LE(data.hora, 10);
    b.writeUInt16LE(data.data, 12);
    b.writeUInt32LE(crc, 14);
    b.writeUInt32LE(tamCompacto, 18);
    b.writeUInt32LE(tamOriginal, 22);
    b.writeUInt16LE(Buffer.byteLength(nome), 26);
    return Buffer.concat([b, Buffer.from(nome, 'utf8')]);
}

let tabelaCrc = null;
/** CRC32 da tabela padrao do ZIP (polinomio 0xEDB88320), calculada uma vez. */
function crc32(buf) {
    if (!tabelaCrc) {
        tabelaCrc = new Int32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            tabelaCrc[i] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = tabelaCrc[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}

/** A hora do arquivo no formato MS-DOS, que e' o que o cabecalho do zip guarda. */
function horaDos(dados) {
    const hora = ((dados.getHours() & 31) << 11) | ((dados.getMinutes() & 63) << 5) | ((dados.getSeconds() / 2) & 31);
    const dia = (((dados.getFullYear() - 1980) & 127) << 9) | (((dados.getMonth() + 1) & 15) << 5) | (dados.getDate() & 31);
    return { hora, dia };
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

async function principal() {
    if (!existsSync(FONTE)) {
        console.log(`Pasta do cliente nao encontrada em ${FONTE}: nada para zipar.`);
        return;
    }

    mkdirSync(dirname(DESTINO), { recursive: true });
    rmSync(DESTINO, { force: true });

    const arquivos = listaDeArquivos(FONTE);
    const saida = createWriteStream(DESTINO);
    /** Espera o `drain` e solta o ouvinte: um por arquivo, sem isso o Node reclama de vazamento. */
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
        const cru = readFileSync(arquivo);
        const comprimido = deflateRawSync(cru, { level: 6 });
        const crc = crc32(cru);
        const { hora, dia } = horaDos(statSync(arquivo).mtime);

        await escrever(cabecalhoLocal(nome, crc, comprimido.length, cru.length, { hora, data: dia }));
        await escrever(comprimido);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0x0800, 8);
        cd.writeUInt16LE(8, 10);
        cd.writeUInt16LE(hora, 12);
        cd.writeUInt16LE(dia, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(comprimido.length, 20);
        cd.writeUInt32LE(cru.length, 24);
        cd.writeUInt16LE(Buffer.byteLength(nome), 28);
        cd.writeUInt32LE(offset, 42);
        diretorio.push(Buffer.concat([cd, Buffer.from(nome, 'utf8')]));

        offset += 30 + Buffer.byteLength(nome) + comprimido.length;
        totalCru += cru.length;
        totalZip += comprimido.length;
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

    console.log('2/2 medindo...');
    console.log('');
    console.log(`Zip:    ${DESTINO} (${mb(statSync(DESTINO).size)})`);
    console.log(`Cru:    ${mb(totalCru)} -> ${mb(totalZip)} de conteudo (${((totalZip / totalCru) * 100).toFixed(0)}%)`);
}

principal().catch((e) => {
    console.error(e);
    process.exit(1);
});
