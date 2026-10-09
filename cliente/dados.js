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

module.exports = { pastaDeDados, caminhoDoBanco, urlDoBanco, garanteBancoInicial };