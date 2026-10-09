/*
 * O pacote de atualizacao do cliente de desktop: o `dist` que a loja baixa ao abrir o
 * programa. Nao vira vazamento -- e' o mesmo codigo que ja vai dentro do `.exe`, e
 * segredo nao mora no `dist`.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { logDoModulo } from './logger';

const log = logDoModulo('pacote');

/**
 * A raiz do que vai para o cliente: a pasta `dist` em si, e nada acima dela.
 *
 * Este arquivo roda de `dist/services`, e subir dois niveis sai do `dist` e chega na
 * raiz do repositorio -- onde estao o `node_modules`, o `.env` e o codigo-fonte. A
 * lista viria com o repositorio inteiro (e a rota de arquivo serviria qualquer um
 * deles), entao a parada e' em `dist`.
 */
function raizDoDist(): string {
    return path.resolve(__dirname, '..');
}

/** O `schema.prisma` do deploy: mora ao lado do `dist`, nunca dentro dele. */
function arquivoDoSchema(): string {
    return path.resolve(raizDoDist(), '..', 'prisma', 'schema.prisma');
}

export type ArquivoDoPacote = {
    caminho: string;
    tamanho: number;
    sha256: string;
};

/** Extensao que o cliente aceita. Nada fora daqui entra na loja. */
const EXTENSOES = new Set(['.js', '.json', '.css', '.map', '.html', '.svg', '.png', '.ico', '.woff2']);

function sha256(texto: Buffer | string): string {
    return crypto.createHash('sha256').update(texto).digest('hex');
}

/**
 * Todos os arquivos do `dist`, com o hash de cada um. E' o hash que decide o
 * download: um arquivo de mesmo hash e' o mesmo arquivo, e um deploy que so mexeu
 * numa view custa uma view -- sem os dois lados concordarem sobre "versao".
 */
export function listaDoPacote(): ArquivoDoPacote[] {
    const raiz = raizDoDist();
    const saida: ArquivoDoPacote[] = [];

    const anda = (dir: string) => {
        let entradas: fs.Dirent[];
        try {
            entradas = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
            const completo = path.join(dir, entrada.name);
            if (entrada.isDirectory()) {
                anda(completo);
                continue;
            }
            if (!EXTENSOES.has(path.extname(entrada.name).toLowerCase())) continue;
            const conteudo = fs.readFileSync(completo);
            saida.push({
                caminho: path.relative(raiz, completo).split(path.sep).join('/'),
                tamanho: conteudo.length,
                sha256: sha256(conteudo),
            });
        }
    };

    anda(raiz);
    return saida.sort((a, b) => a.caminho.localeCompare(b.caminho));
}

/** O manifesto inteiro: o que o cliente precisa para decidir o que baixar. */
export function manifesto(): { arquivos: ArquivoDoPacote[]; schema: string } {
    const arquivoSchema = arquivoDoSchema();
    let schema = '';
    try {
        schema = sha256(fs.readFileSync(arquivoSchema));
    } catch {
        // Sem `schema.prisma` ao lado do `dist` (empacotamento parcial): o cliente
        // simplesmente nao migra. Melhor do que derrubar a rota inteira.
        log.warn('schema.prisma nao encontrado ao lado do dist');
    }
    return { arquivos: listaDoPacote(), schema };
}

/**
 * O conteudo de um arquivo do pacote. O caminho vem da URL, entao volta resolvido
 * contra a raiz e so' e servido se ficar DENTRO dela, e com extensao conhecida --
 * sem isso um `../../.env` na URL devolveria a senha do banco.
 */
export function arquivoDoPacote(caminho: string): Buffer | null {
    const relativo = String(caminho ?? '').trim().replace(/\\/g, '/');
    if (!relativo || relativo.includes('..') || relativo.startsWith('/')) return null;
    if (!EXTENSOES.has(path.extname(relativo).toLowerCase())) return null;

    const raiz = raizDoDist();
    const completo = path.resolve(raiz, relativo);
    if (completo !== raiz && !completo.startsWith(raiz + path.sep)) return null;
    if (!fs.existsSync(completo) || !fs.statSync(completo).isFile()) return null;
    return fs.readFileSync(completo);
}

/** O schema atual, para o cliente manter o banco da loja em dia. */
export function schemaAtual(): string | null {
    const arquivo = arquivoDoSchema();
    return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : null;
}