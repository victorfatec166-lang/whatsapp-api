/**
 * Onde a loja guarda o que nao pode ser reinstallado: banco, log, sessao do WhatsApp,
 * backups e a chave de cifra. Vive aqui porque dois arquivos precisam da MESMA pasta --
 * o `main.js` que sobe o sistema e o `atualiza.js` que migra o banco -- e cada um
 * com o seu caminho era um `db push` num arquivo que o servidor nunca abre.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** `%APPDATA%\DeliveryAdmin`, ou o que `DELIVERYADMIN_DATA` mandar. */
function pastaDeDados() {
    const doAmbiente = (process.env.DELIVERYADMIN_DATA || '').trim();
    if (doAmbiente) return path.resolve(doAmbiente);
    return path.join(process.env.APPDATA || os.homedir(), 'DeliveryAdmin');
}

/** O arquivo do banco da loja. O nome e' o mesmo do servidor (`caminhoDoBanco`). */
function caminhoDoBanco() {
    return path.join(pastaDeDados(), 'prisma', 'loja.db');
}

/** A `DATABASE_URL` do SQLite, no formato que o Prisma exige: `file:` e barra. */
function urlDoBanco() {
    return 'file:' + caminhoDoBanco().split(path.sep).join('/');
}

/**
 * De qual conta da nuvem e' este PC.
 *
 * O id precisa ser o mesmo dos dois lados: e' ele que o relay manda no cabecalho e o
 * que a nuvem usa para saber que loja esta perguntando. Sem ele, a loja ficaria com o
 * `local` do primeiro boot -- que a nuvem nao conhece, e a fila e a assinatura nunca
 * valeriam. O arquivo e' escrito pela migracao (`scripts/migrar-loja.mjs`).
 */
function idDaLoja() {
    try {
        const guardado = fs.readFileSync(path.join(pastaDeDados(), 'loja.txt'), 'utf8').trim();
        if (guardado) return guardado;
    } catch {
        // Instalacao nova: ainda nao migrou nada, e o `local` do primeiro boot serve.
    }
    return 'local';
}

/** Aponta o PC para uma conta da nuvem. */
function guardaIdDaLoja(loja) {
    const pasta = pastaDeDados();
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, 'loja.txt'), String(loja).trim() + '\n', 'utf8');
}

/**
 * Deixa o banco da loja criado na primeira abertura.
 *
 * O instalador leva um banco vazio, com o schema de hoje: sem ele o sistema abre e
 * morre na primeira consulta. Copiar so quando o arquivo nao existe e' o que faz uma
 * reinstall nao apagar os pedidos -- a segunda abertura encontra o banco e nao mexe.
 */
function garanteBancoInicial() {
    const destino = caminhoDoBanco();
    if (fs.existsSync(destino)) return destino;

    const origem = path.join(__dirname, 'banco-inicial.db');
    if (!fs.existsSync(origem)) {
        throw new Error('o pacote do programa nao tem o banco inicial (' + origem + ')');
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(origem, destino);
    console.log('[dados] banco da loja criado em ' + destino);
    return destino;
}

module.exports = { pastaDeDados, caminhoDoBanco, urlDoBanco, garanteBancoInicial, idDaLoja, guardaIdDaLoja };