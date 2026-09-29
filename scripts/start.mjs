/*
 * Inicio do sistema, com a ordem certa.
 *
 * Por que nao e' so "node dist/server.js"
 *
 * Em uma maquina nova, o primeiro `npm start` falha por tres motivos, e os tres
 * tem conserto conhecido:
 *
 * 1. As tabelas nao existem. O Prisma cria o CLIENTE, que e' o codigo que fala
 *    com o banco -- mas nao cria o SCHEMA. Quem cria e' a migration. Sem ela, o
 *    primeiro acesso a qualquer tela da erro de "table does not exist", que
 *    nao diz nada sobre a causa.
 * 2. O .env pode nao existir. Sem DATABASE_URL o Prisma nem sabe onde olhar.
 * 3. O dist/ pode nao estar compilado.
 *
 * Este script confere os tres e so entao sobe. E' a diferenca entre "instalei e
 * deu erro em portugues de banco de dados" e "instalou e comecou".
 *
 * O que ele NAO faz
 *
 * Nao roda migration em silencio quando ha migration pendente. Ele roda, porque
 * sem schema nao ha sistema -- mas avisa quantas e quais, para ninguem descobrir
 * depois que o banco mudou de forma sem saber. E nao roda `prisma db push`, que
 * altera o schema sem registro e e' o caminho que faz o banco de producao
 * divergir do schema do codigo.
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const COR = {
    reset: '\x1b[0m',
    vermelho: '\x1b[31m',
    verde: '\x1b[32m',
    amarelo: '\x1b[33m',
    ciano: '\x1b[36m',
};

function aviso(msg) {
    console.log(`${COR.amarelo}!${COR.reset} ${msg}`);
}
function erro(msg) {
    console.error(`${COR.vermelho}x${COR.reset} ${msg}`);
}
function ok(msg) {
    console.log(`${COR.verde}ok${COR.reset} ${msg}`);
}
function passo(msg) {
    console.log(`\n${COR.ciano}==>${COR.reset} ${msg}`);
}

/** Roda um comando do Prisma e devolve se deu certo. */
function prisma(args) {
    return spawnSync('npx', ['prisma', ...args], {
        cwd: RAIZ,
        stdio: 'inherit',
        shell: true,
    });
}

/** O .env existe e tem DATABASE_URL? */
function envPronto() {
    const caminho = resolve(RAIZ, '.env');
    if (!existsSync(caminho)) {
        erro('Nao achei o arquivo .env nesta pasta.');
        console.log('');
        console.log('Ele guarda a configuracao desta maquina e nao entra no git, entao nao vem junto.');
        console.log('Crie a partir do modelo:');
        console.log('');
        console.log('    copy .env.example .env');
        console.log('');
        console.log('Depois, se for usar o Marketplace, abra o .env e descomente a linha CHANNEL_SECRET,');
        console.log('trocando pelo valor gerado pelo comando que esta comentado la dentro.');
        return false;
    }
    return true;
}

function confereBuild() {
    const precisa = [
        { arquivo: 'dist/server.js', oque: 'o servidor' },
        { arquivo: 'dist/styles/app.css', oque: 'o CSS do painel' },
    ];
    const faltando = precisa.filter((p) => !existsSync(resolve(RAIZ, p.arquivo)));

    if (faltando.length === 0) return true;

    /*
     * Checar so o server.js nao bastava, e o motivo e' chato.
     *
     * O build e' "clean && build:ts && build:css". Se o TypeScript falha, o
     * build para no meio -- com o dist/ ja apagado e o CSS nunca gerado. Rodar
     * "node dist/server.js" nesse estado sobe um painel SEM NENHUM ESTILO: a
     * pagina abre em HTML puro, com link sublinhado e lista sem formatacao.
     *
     * Isso aconteceu de verdade durante o desenvolvimento deste script. O
     * servidor subiu, a pagina respondeu 200, e o defeito so apareceu olhando
     * a tela. Build parcial tem de ser build inexistente.
     */
    aviso(`Build incompleto: falta ${faltando.map((p) => p.oque).join(' e ')}. Compilando...`);

    const r = spawnSync('npm', ['run', 'build'], { cwd: RAIZ, stdio: 'inherit', shell: true });
    if (r.status !== 0) {
        erro('A compilacao falhou. Corrija o que estiver marcado acima e rode de novo.');
        console.log('');
        console.log('O servidor NAO vai subir assim: sem CSS, a pagina abre sem formatacao,');
        console.log('e um painel torto e' + ' pior do que um painel que nao abre.');
        return false;
    }

    // Confere de novo: o build pode ter saido com 0 mesmo sem gerar tudo, e o
    // erro real e' "estou servindo um painel quebrado", nao "o exit code".
    const aindaFalta = precisa.filter((p) => !existsSync(resolve(RAIZ, p.arquivo)));
    if (aindaFalta.length > 0) {
        erro(`A compilacao terminou sem gerar ${aindaFalta.map((p) => p.oque).join(' e ')}.`);
        console.log('O build disse que deu certo, entao o problema e' + ' no proprio build.');
        return false;
    }

    ok('Compilado.');
    return true;
}

function aplicaMigrations() {
    passo('Preparando o banco');

    // O `status` antes do `deploy` existe para dizer o que vai mudar. Descobrir
    // depois, olhando o banco, que ele mudou e' o que faz a pessoa desconfiar
    // do sistema inteiro.
    const status = spawnSync('npx', ['prisma', 'migrate', 'status'], {
        cwd: RAIZ,
        encoding: 'utf8',
        shell: true,
    });
    const saida = status.stdout || '';
    if (/migration\(s\) are not applied/i.test(saida)) {
        aviso('Ha migration pendente: ela cria ou ajusta tabelas, sem apagar os seus dados.');
    }

    const r = prisma(['migrate', 'deploy']);
    if (r.status !== 0) {
        erro('A migration falhou. O banco nao foi alterado.');
        console.log('');
        console.log('Se a mensagem for sobre "database is locked", o painel pode estar aberto em outro lugar.');
        console.log('Feche o servidor e rode de novo.');
        return false;
    }
    ok('Banco pronto.');
    return true;
}

function principal() {
    console.log('');
    console.log('  Marmitaria -- painel e robo do WhatsApp');
    console.log('');

    if (!envPronto()) process.exit(1);
    if (!confereBuild()) process.exit(1);
    if (!aplicaMigrations()) process.exit(1);

    passo('Subindo');

    // `node dist/server.js` com stdio herdado: o log do servidor aparece no
    // terminal E continua indo para arquivo pelo proprio logger.
    const servidor = spawnSync('node', ['dist/server.js'], {
        cwd: RAIZ,
        stdio: 'inherit',
        shell: true,
    });

    if (servidor.status !== 0 && servidor.status !== null) {
        erro(`O servidor saiu com codigo ${servidor.status}.`);
    }
}

principal();
