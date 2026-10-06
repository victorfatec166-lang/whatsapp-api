import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Le o `.env` antes de ler qualquer variavel de ambiente. O Prisma so carrega o
 * `.env` quando e' importado, e a ordem de import nao e' garantia: avaliado antes,
 * este arquivo leria um `process.env` vazio e escolheria a pasta errada, em silencio.
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
 * Programa em `Program Files`, dado do usuario em `%APPDATA%`: e' o que impede o
 * sistema de pedir permissao de administrador a cada gravacao.
 */
export const DATA_DIR_PADRAO = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    NOME
);

/*
 * A pasta de dados: banco, sessao, log e backup nao podem ficar ao lado do
 * codigo, porque a atualizacao do programa trocaria a pasta junto com o dado.
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
 * Cria a arvore de dados na hora do boot. Exportada e nao so usada na importacao
 * porque o instalador chama o sistema com uma pasta recem-criada, e o teste precisa
 * montar e desmontar sem deixar rastro.
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
 * A senha do primeiro acesso, em arquivo em vez de so no log.
 *
 * O log resolve o desenvolvimento e nao resolve o dono do restaurante: ele abre o
 * programa e ve tela de login. Fica na area do usuario e some em `trocaSenha`.
 */
export const ARQUIVO_PRIMEIRO_ACESSO = path.join(DATA_DIR, 'primeiro-acesso.json');

/*
 * O caminho do banco NAO mora aqui: quem manda e' a `DATABASE_URL` do `.env`,
 * escrita na instalacao pelo `EscreveEnv`. O `CAMINHO_BANCO` que havia aqui era
 * um terceiro lugar com o nome do arquivo, e ninguem lia.
 */
