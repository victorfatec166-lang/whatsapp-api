/**
 * Atualizacao do sistema dentro do cliente de desktop.
 *
 * O instalador traz o Electron, as dependencias e UMA versao do sistema. A partir dai
 * o sistema vem da nuvem: no boot o cliente pergunta o que mudou, baixa so os
 * arquivos diferentes e sobe o que foi baixado.
 *
 * A regra que guia tudo e' que a loja NUNCA fica sem sistema. Um download que falha
 * deixa a versao antiga no lugar e o programa abre normal; so' a troca e' que destroi
 * a pasta antiga, e ela so' acontece depois de tudo conferido.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { caminhoDoBanco, urlDoBanco } = require('./dados');

/** A nuvem. Lida na hora, e nao na importacao: o `.env` ainda nao foi lido. */
function nuvem() {
    return (process.env.DELIVERYADMIN_NUVEM || 'https://whatsapp-api-7zra.onrender.com').replace(/\/+$/, '');
}

/** Pasta do sistema empacotado, ao lado deste arquivo. */
const RAIZ = path.join(__dirname, 'servidor');
const DIST = path.join(RAIZ, 'dist');

/** Onde a proxima versao e' montada antes de entrar no lugar da atual. */
const DIST_NOVO = path.join(RAIZ, 'dist.novo');
const DIST_ANTERIOR = path.join(RAIZ, 'dist.anterior');

const TEMPO_LIMITE_MS = 20_000;

function registro(texto) {
    console.log('[atualiza] ' + texto);
}

/** Samecaixa: no Windows `Views` e' o mesmo arquivo que `views`. */
function chave(caminho) {
    return String(caminho).replace(/\\/g, '/').toLowerCase();
}

/** O sha256 de um arquivo em disco, ou vazio se ele nao existir. */
function hashLocal(caminho) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(caminho)).digest('hex');
    } catch {
        return '';
    }
}

/** Hash declarado no manifesto, para o arquivo baixado ser conferido antes de entrar. */
let esperados = new Map();

/** O que a nuvem tem. `null` quando a rede falhou -- que e' diferente de "igual". */
async function manifesto() {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
    try {
        const resposta = await fetch(nuvem() + '/pacote/manifesto', { signal: controle.signal });
        if (!resposta.ok) return null;
        return await resposta.json();
    } catch {
        return null;
    } finally {
        clearTimeout(relogio);
    }
}

/**
 * Os arquivos que precisam descer.
 *
 * Compara hash a hash em vez de comparar versao: o manifesto ja' traz a resposta, e
 * um arquivo que bateu nao precisa ser baixado. Arquivo que a nuvem tem e o disco
 * nao tambem entra -- e' o que remove da versao nova o que o deploy apagou.
 */
function paraBaixar(arquivos) {
    return arquivos.filter((a) => hashLocal(path.join(DIST, a.caminho)) !== a.sha256);
}

/**
 * Copia a versao atual para a pasta nova antes de mexer nela.
 *
 * Sem esta copia, um arquivo que o deploy apagou continuaria no disco e a versao
 * "nova" seria a antiga comFew arquivos trocados.
 */
function copiaComoBase() {
    fs.rmSync(DIST_NOVO, { recursive: true, force: true });
    fs.cpSync(DIST, DIST_NOVO, { recursive: true });
}

async function baixa(caminho, destino) {
    const resposta = await fetch(nuvem() + '/pacote/arquivo?caminho=' + encodeURIComponent(caminho));
    if (!resposta.ok) throw new Error('download de ' + caminho + ' devolveu ' + resposta.status);
    const conteudo = Buffer.from(await resposta.arrayBuffer());
    // O hash confere o que CHEGOU, nao o que foi pedido: sem isto, um proxy ou um
    // arquivo trocado no caminho entraria no disco e so apareceria como erro no
    // primeiro acesso a rota.
    const declarado = esperados.get(chave(caminho));
    if (declarado && declarado !== crypto.createHash('sha256').update(conteudo).digest('hex')) {
        throw new Error('arquivo corrompido: ' + caminho);
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, conteudo);
}

/** Apaga da versao nova o que o deploy nao tem mais. */
function removeMortos(arquivos) {
    const vivos = new Set(arquivos.map((a) => chave(a.caminho)));
    for (const caminho of arquivosLocais(DIST_NOVO)) {
        const relativo = caminho.slice(DIST_NOVO.length + 1).split(path.sep).join('/');
        if (!vivos.has(chave(relativo))) fs.rmSync(caminho, { force: true });
    }
}

function arquivosLocais(raiz) {
    const achados = [];
    const anda = (dir) => {
        let entradas;
        try {
            entradas = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entrada of entradas) {
            const completo = path.join(dir, entrada.name);
            if (entrada.isDirectory()) anda(completo);
            else achados.push(completo);
        }
    };
    anda(raiz);
    return achados;
}

/**
 * Troca a pasta do sistema.
 *
 * `dist` -> `dist.anterior` -> `dist.novo` -> `dist`. O Windows nao renomeia pasta que
 * esta' em uso, e o servidor so sobe DEPOIS daqui -- por isso a troca vem antes de
 * qualquer coisa ser carregada.
 */
function troca() {
    fs.rmSync(DIST_ANTERIOR, { recursive: true, force: true });
    if (fs.existsSync(DIST)) fs.renameSync(DIST, DIST_ANTERIOR);
    fs.renameSync(DIST_NOVO, DIST);
}

/** Volta a versao anterior. Chamado quando a versao nova levantou e caiu. */
function volta() {
    if (!fs.existsSync(DIST_ANTERIOR)) return false;
    try {
        fs.rmSync(DIST, { recursive: true, force: true });
        fs.renameSync(DIST_ANTERIOR, DIST);
        registro('a versao anterior voltou a valer');
        return true;
    } catch (erro) {
        registro('nao deu para voltar a versao anterior: ' + erro.message);
        return false;
    }
}

/**
 * O `datasource` que o banco da loja usa.
 *
 * O schema que chega da nuvem aponta para o Postgres, e `db push` num arquivo SQLite
 * com esse comando falha. E' o mesmo rebaixamento que `preparar-banco-local.mjs` faz no
 * build do instalador -- duplicado aqui porque o cliente nao empacota `scripts/`.
 */
const DATASOURCE_LOCAL = `// Nao edite este arquivo: ele e' reescrito quando a nuvem manda um schema novo,
  // e o que manda e' o schema.prisma de la. Para mudar um campo, muda na nuvem.
  provider = "sqlite"
  url      = env("DATABASE_URL")
}`;

function comDatasourceLocal(texto) {
    const abre = texto.indexOf('datasource db {');
    if (abre < 0) throw new Error('o schema da nuvem nao tem bloco `datasource db`');

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
    if (fecha < 0) throw new Error('o bloco `datasource db` do schema da nuvem nao fecha');

    return texto.slice(0, abre) + DATASOURCE_LOCAL + texto.slice(fecha + 1);
}

/** Onde o `prisma generate` e' o `db push` vao ler. O mesmo caminho do instalador. */
const SCHEMA_LOCAL = path.join(RAIZ, 'prisma', 'schema.local.prisma');

/**
 * O Prisma CLI dentro do proprio pacote da loja.
 *
 * Sem ele a migracao do banco nao roda: e' o `prisma` que le o schema novo e ajusta o
 * arquivo, e o `node_modules` do sistema so leva `@prisma/client`. O caminho da raiz do
 * projeto e' o fallback de desenvolvimento, antes de o pacote estar montado.
 */
const PRISMA = [
    path.join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js'),
    path.join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js'),
].find((c) => fs.existsSync(c));

/** O hash do schema local, em hex. Vazio quando ele ainda nao existe. */
function hashDoSchemaLocal() {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(SCHEMA_LOCAL, 'utf8')).digest('hex');
    } catch {
        return '';
    }
}

/**
 * Deixa o banco da loja igual ao schema novo.
 *
 * `db push` e' o caminho de sempre (`banco:local`): o banco da loja e' um arquivo, e
 * comparar schema e' mais fragil do que aplicar. O `-wal` some junto porque um WAL de
 * outro schema corrompe o banco na proxima abertura.
 */
function migraBanco() {
    if (!PRISMA) throw new Error('o Prisma CLI nao esta no pacote do programa');
    const banco = caminhoDoBanco();
    fs.mkdirSync(path.dirname(banco), { recursive: true });

    const roda = (comando) =>
        spawnSync(process.execPath, comando, {
            cwd: RAIZ,
            env: { ...process.env, DATABASE_URL: urlDoBanco() },
            encoding: 'utf8',
            timeout: 180_000,
        });

    const gera = roda([PRISMA, 'generate', '--schema', SCHEMA_LOCAL]);
    if (gera.status !== 0) throw new Error('prisma generate falhou: ' + (gera.stderr || '').slice(-300));

    const empurra = roda([PRISMA, 'db', 'push', '--schema', SCHEMA_LOCAL, '--skip-generate', '--accept-data-loss']);
    if (empurra.status !== 0) throw new Error('prisma db push falhou: ' + (empurra.stderr || '').slice(-300));

    for (const sufixo of ['-wal', '-shm']) fs.rmSync(banco + sufixo, { force: true });
    registro('banco da loja atualizado para o schema novo');
}

/**
 * Grava o schema que veio da nuvem, ja apontado para o arquivo da loja.
 *
 * O `generate` le o schema do disco, entao ele e' escrito ANTES da migracao: escrever
 * depois geraria cliente para o schema antigo e o `db push` brigaria com ele.
 */
function escreveSchemaLocal(textoDaNuvem) {
    fs.mkdirSync(path.dirname(SCHEMA_LOCAL), { recursive: true });
    fs.writeFileSync(SCHEMA_LOCAL, comDatasourceLocal(textoDaNuvem), 'utf8');
    registro('schema local atualizado para o da nuvem');
}

/**
 * O passo de cada abertura: o que mudou, o que desceu, e se deu para.
 *
 * Devolve um relatorio e nunca lanca. Um erro aqui NAO pode impedir o programa de
 * abrir -- quem precisa do sistema e' a loja, e ela abre com a versao que tem.
 */
async function atualiza() {
    const relatorio = { atualizou: false, baixados: 0, migrou: false, motivo: '' };

    const lista = await manifesto();
    if (!lista) {
        relatorio.motivo = 'a nuvem nao respondeu';
        return relatorio;
    }
    if (!Array.isArray(lista.arquivos) || lista.arquivos.length === 0) {
        relatorio.motivo = 'manifesto vazio';
        return relatorio;
    }

    const faltando = paraBaixar(lista.arquivos);
    const schemaMudou = Boolean(lista.schema) && lista.schema !== hashDoSchemaLocal();

    if (faltando.length === 0 && !schemaMudou) return relatorio;

    registro('a nuvem tem ' + faltando.length + ' arquivo(s) diferente(s)' + (schemaMudou ? ' e um schema novo' : ''));

    try {
        copiaComoBase();
        esperados = new Map(lista.arquivos.map((a) => [chave(a.caminho), a.sha256]));
        for (const arquivo of faltando) await baixa(arquivo.caminho, path.join(DIST_NOVO, arquivo.caminho));
        removeMortos(lista.arquivos);

        if (schemaMudou) {
            const resposta = await fetch(nuvem() + '/pacote/schema');
            if (resposta.ok) escreveSchemaLocal(await resposta.text());
            else relatorio.motivo = 'schema novo nao veio da nuvem';
        }

        troca();
        if (schemaMudou) migraBanco();

        relatorio.atualizou = true;
        relatorio.baixados = faltando.length;
        relatorio.migrou = schemaMudou;
        registro('sistema atualizado (' + faltando.length + ' arquivo(s))');
    } catch (erro) {
        fs.rmSync(DIST_NOVO, { recursive: true, force: true });
        relatorio.motivo = erro.message;
        registro('a atualizacao falhou e a versao atual segue valendo: ' + erro.message);
    }

    return relatorio;
}

module.exports = { atualiza, volta, nuvem, RAIZ, DIST };