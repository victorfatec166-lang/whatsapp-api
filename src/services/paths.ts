import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Le o `.env` antes de ler qualquer variavel de ambiente.
 *
 * POR QUE ISTO NAO E' "SO O PRISMA JA FAZ ISSO"
 *
 * Porque o Prisma carrega o `.env` quando o `@prisma/client` e' importado, e a
 * ordem de import do `server.ts` nao e' uma garantia. Se `paths.ts` for avaliado
 * antes do cliente do Prisma, ele le um `process.env` vazio e escolhe a pasta
 * errada sem nenhum aviso. Pior: a escolha errada e' silenciosa e plausivel -- o
 * sistema sobe, cria uma pasta de dados nova e vazia, e o dono percebe que o
 * banco sumiu dias depois.
 *
 * Ler aqui deixa a ordem de import irrelevante. E o que esta funcao NAO faz:
 * sobrescrever variavel que ja existe no ambiente. Quem manda no sistema
 * instalado e' o launcher, e nao o arquivo de texto.
 *
 * Le o suficiente para este caso -- `CHAVE=valor`, `#` de comentario, aspas
 * opcionais -- e nao tenta ser interpretador de .env. Um interpretador mal feito
 * e' pior do que um que so sabe o necessario.
 */
function leEnvDoPrograma(): void {
    let texto: string;
    try {
        texto = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
    } catch {
        // Sem `.env`: quem instala recebe a configuracao por variavel de ambiente,
        // e quem desenvolve costuma ter. Nao e' erro.
        return;
    }

    for (const linhaBruta of texto.split('\n')) {
        const linha = linhaBruta.trim();
        if (linha === '' || linha.startsWith('#')) continue;

        const igual = linha.indexOf('=');
        if (igual < 1) continue;

        const chave = linha.slice(0, igual).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(chave)) continue;
        if (process.env[chave] !== undefined) continue;

        let valor = linha.slice(igual + 1).trim();
        const comAspas =
            valor.length > 1 &&
            ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'")));
        process.env[chave] = comAspas ? valor.slice(1, -1) : valor;
    }
}

leEnvDoPrograma();
/** Nome da pasta de dados dentro de %APPDATA%. */
const NOME = 'DeliveryAdmin';


/**
 * Onde fica o sistema quando o `.env` nao diz.
 *
 * A regra do Windows: programa em `Program Files`, dado do usuario em
 * `%APPDATA%`. Nao e' preferencia estetica -- e' o que impede o sistema de
 * pedir permissao de administrador a cada gravacao, e o que faz uma atualizacao
 * poder trocar a pasta do programa sem encostar no banco.
 */
export const DATA_DIR_PADRAO = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    NOME
);

/**
 * Onde o sistema guarda o que o dono nao pode perder.
 *
 * POR QUE EXISTE UM `DATA_DIR`
 *
 * Ate aqui, banco, sessao do WhatsApp, log, backup e foto de produto ficavam ao
 * lado do codigo, resolvidos por `path.resolve(__dirname, ...)`. Isso funciona
 * enquanto o programa roda de dentro da pasta do projeto, e quebra na hora em que
 * ele passa a ser um programa instalado.
 *
 * O Windows separa as duas coisas por uma razao antiga e sensata: o programa vai
 * em `C:\Program Files`, que nao pode ser escrito pelo usuario comum, e o dado do
 * usuario vai em `%APPDATA%`, que pode. Um instalador que colocasse os dois no
 * mesmo lugar teria ou de pedir administrador a cada gravacao -- banco, log e
 * foto a cada venda -- ou de pedir administrador uma vez so e nunca mais, o que
 * e' pior: a permissao concedida fica valendo para sempre.
 *
 * A separacao tambem e' o que torna atualizacao segura. Trocar a pasta do
 * programa nao toca em banco, sessao nem backup, entao uma versao nova com defeito
 * ainda devolve o sistema ao estado anterior sem que ninguem precise restaurar
 * nada.
 *
 * COMO SE ESCOLHE A PASTA
 *
 * A variavel `DELIVERYADMIN_DATA` manda, e e' o que o instalador escreve. Sem
 * ela, cai no lugar de sempre -- a pasta do projeto -- e por isso o ambiente de
 * desenvolvimento continua funcionando sem mudar uma linha de codigo. A variavel
 * e' lida uma vez, na importacao, e nao a cada chamada: mudar o valor no meio
 * execucao deixaria o log num lugar e o backup em outro.
 *
 * A pasta e' criada na importacao, e nao na primeira gravacao. O dono precisa
 * ver a existencia do log antes do primeiro cliente aparecer, e um caminho que so
 * existe depois da primeira venda e' caminho que falha sem aviso.
 */

/** Nome da pasta de dados dentro de `%APPDATA%`. */
/**
 * A pasta de dados.
 *
 * O `resolve` normaliza e remove a barra final. E' feio de fazer, mas evita que
 * apareca caminho duplo na tela de Configuracoes, que mostra a pasta por extenso.
 */
export const DATA_DIR = path.resolve(process.env.DELIVERYADMIN_DATA?.trim() || DATA_DIR_PADRAO);

/** Cria a pasta de dados, se ainda nao existir. Silencioso quando ja' existe. */
function garante(dir: string): string {
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch {
        // Sem permissao ou disco cheio: a gravacao que vem vai falhar com a
        // mensagem dela, que e' mais util do que um aviso aqui que ninguem le.
    }
    return dir;
}

/**
 * Cria a arvore de dados na hora do boot.
 *
 * Exportada e nao so usada na importacao porque o instalador chama o sistema com
 * uma pasta recem-criada, e o teste de `paths` precisa montar e desmontar sem
 * deixar rastro na maquina de quem roda.
 */
export function criaArvoreDeDados(): void {
    for (const sub of ['logs', 'backups', 'auth_info_baileys', path.join('uploads', 'produtos'), 'prisma']) {
        garante(path.join(DATA_DIR, sub));
    }
}

/** O log do dia. */
export const DIR_LOGS = garante(path.join(DATA_DIR, 'logs'));

/** As copias do banco. */
export const DIR_BACKUPS = garante(path.join(DATA_DIR, 'backups'));

/** A sessao pareada do WhatsApp. NUNCA entra no git nem no payload do instalador. */
export const DIR_SESSAO_WHATSAPP = garante(path.join(DATA_DIR, 'auth_info_baileys'));

/** Foto de produto. */
export const DIR_UPLOADS = path.join(DATA_DIR, 'uploads');

/** Subpasta de foto de produto, que e' o que o sistema grava. */
export const DIR_UPLOADS_PRODUTOS = garante(path.join(DIR_UPLOADS, 'produtos'));

/**
 * O banco, como caminho absoluto, pronto para a variavel do Prisma.
 *
 * O schema usa `env("DATABASE_URL")` e o Prisma resolve caminho relativo a partir
 * do proprio arquivo do schema -- que, numa instalacao, fica dentro de
 * `Program Files`. Passar o caminho absoluto e' o que impede o banco de acabar
 * gravado dentro da pasta do programa, onde a proxima atualizacao apaga.
 */
export const CAMINHO_BANCO = path.join(DATA_DIR, 'prisma', 'marmitaria.db');

/**
 * O .env pronto para a instalacao, escrito pelo instalador.
 *
 * Fica ao lado do programa, e nao na pasta de dados, porque ele e' configuracao do
 * PROGRAMA (qual porta, qual pasta de dados) e nao dado do dono. Os dois se
 * trocam: o `.env` aponta para a pasta, e a pasta guarda o que o dono produz.
 */
export const ARQUIVO_ENV = path.join(__dirname, '..', '..', '.env');
