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
import { existsSync, readFileSync } from 'fs';
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

/** Roda um comando do Prisma e devolve se deu certo, com a saida de pe para ser lida. */
function prisma(args) {
    const r = spawnSync('npx', ['prisma', ...args], {
        cwd: RAIZ,
        encoding: 'utf8',
        shell: true,
    });
    // O `P1001` vai para o stderr, e e' a unica pista do deploy cair por IPv6: com
    // stdio herdado ele ia para o log do Render e o codigo nunca o via, entao a
    // orientacao do pooler ficava de fora justamente quando era ela que resolvia.
    const saida = (r.stdout || '') + (r.stderr || '');
    if (saida) process.stdout.write(saida);
    return { ...r, saida };
}

/**
 * A configuracao esta no ambiente, e nao precisa estar num arquivo.
 *
 * Na maquina do dono a configuracao vem do `.env`; na nuvem (Render) ela vem das
 * variaveis de ambiente do painel, e o arquivo NAO existe. Exigir o arquivo
 * fazia o deploy terminar com "Nao achei o .env" mesmo com a `DATABASE_URL`
 * cadastrada -- o script olhava o lugar errado e recusava um deploy pronto.
 *
 * O que importa e' `DATABASE_URL`: e' ela que o Prisma le, e sem ela nao ha
 * schema nem sistema. O aviso abaixo serve para quem esta na maquina e ainda nao
 * criou o arquivo, e some sozinho quando a variavel existe.
 */
/** O valor de uma chave no `.env` da pasta, ou null. Le o arquivo, nao adivinha. */
function leEnv(chave) {
    let texto;
    try {
        texto = readFileSync(resolve(RAIZ, '.env'), 'utf8');
    } catch {
        return null;
    }
    for (const linha of texto.split('\n')) {
        const limpa = linha.trim();
        if (limpa.startsWith('#') || limpa === '') continue;
        const igual = limpa.indexOf('=');
        if (igual < 1 || limpa.slice(0, igual).trim() !== chave) continue;
        let valor = limpa.slice(igual + 1).trim();
        const comAspas =
            valor.length > 1 &&
            ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'")));
        return comAspas ? valor.slice(1, -1) : valor;
    }
    return null;
}

function envPronto() {
    /*
     * A variavel do processo tem prioridade, mas o `.env` conta tambem: quem roda na
     * maquina tem a configuracao no arquivo e o `process.env` vazio -- o Prisma le
     * o arquivo por conta propria, e este script roda antes dele. Exigir so o
     * processo recusava a maquina do dono, que era o caso mais comum.
     */
    const doProcesso = process.env.DATABASE_URL?.trim();
    const doArquivo = doProcesso ? null : leEnv('DATABASE_URL')?.trim();
    const valor = doProcesso || doArquivo;
    if (valor) {
        // O resto do script e o Prisma ainda nao tem a variavel do arquivo; larga
        // ela no ambiente para que a migration e o servidor vejam a mesma config.
        if (!doProcesso) process.env.DATABASE_URL = valor;
        return true;
    }

    if (existsSync(resolve(RAIZ, '.env'))) {
        erro('O .env existe, mas nao tem a linha DATABASE_URL.');
        console.log('');
        console.log('Confira no .env e rode de novo -- o arquivo so e lido no boot.');
        return false;
    }

    erro('Nao achei a variavel DATABASE_URL.');
    console.log('');
    console.log('Na maquina, crie o arquivo:');
    console.log('');
    console.log('    copy .env.example .env');
    console.log('');
    console.log('Na nuvem (Render), cadastre DATABASE_URL em Environment Variables, no painel do servico.');
    console.log('As duas respostas servem: o Prisma le a variavel, e nao o arquivo.');
    console.log('');
    console.log('Se for usar o Marketplace, cadastre tambem CHANNEL_SECRET, com um valor aleatorio longo.');
    return false;
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

/**
 * O que fazer quando o banco nao respondeu.
 *
 * "P1001" e "Can't reach database server" e' rede, nao senha: revirar a senha
 * nao resolve e faz a pessoa perder tempo no lugar errado. No Supabase a causa
 * quase sempre e' o host direto, que so tem IPv6 -- e o Render nao tem IPv6.
 */
function explicaBancoInalcancavel(saida) {
    const naoAlcancou = /P1001|Can't reach database server/i.test(saida);
    if (!naoAlcancou) return false;

    const url = process.env.DATABASE_URL || '';
    const eSupabase = /supabase\.(co|com)/i.test(url);
    const direto = /@db\.[^@]+\.supabase\.co/i.test(url);

    erro('O banco nao respondeu -- e isso e' + ' rede, nao senha.');
    console.log('');

    if (eSupabase && direto) {
        console.log('O host do Supabase direto so tem IPv6, e este servidor nao tem IPv6.');
        console.log('Troque pela linha do POOLER, que tem IPv4. No painel do Supabase:');
        console.log('Settings > Database > Connection string > URI, e pegue a que comeca');
        console.log('por "aws-0-", e nao por "db.".');
        console.log('');
        console.log('Repare que no pooler o usuario leva o prefixo "postgres." antes do projeto:');
        console.log('  postgresql://postgres.PROJETO:SENHA@aws-0-REGIAO.pooler.supabase.com:5432/postgres');
    } else {
        console.log('Confira o host e a porta em DATABASE_URL, e se a rede deste servidor');
        console.log('chega ate la. Em container, firewall e porta bloqueada aparecem assim.');
    }
    console.log('');
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
    const saida = (status.stdout || '') + (status.stderr || '');
    if (/migration\(s\) are not applied/i.test(saida)) {
        aviso('Ha migration pendente: ela cria ou ajusta tabelas, sem apagar os seus dados.');
    }

    const r = prisma(['migrate', 'deploy']);
    if (r.status !== 0) {
        if (explicaBancoInalcancavel(r.saida)) return false;
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
