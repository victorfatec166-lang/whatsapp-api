/*
 *   npm run migrar:loja -- <id>                     so conta o que vem
 *   npm run migrar:loja -- <id> --escrever          grava no PC da loja
 *   npm run migrar:loja -- <id> --escrever --ligar-na-nuvem
 */

/*
 * Uma vez por loja, na mao de quem cuida: o Postgres da nuvem e o arquivo SQLite do PC
 * estao em maquinas diferentes, e ninguem dentro do painel tem as duas pontas. Por isso
 * nao apaga nada -- a nuvem continua com a copia, que e' a volta atras.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

import { copiaLoja } from '../src/services/migracaoLoja';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** O cliente do SQLite vive no pacote do PC, e nao no `node_modules` da raiz. */
const CLIENTE_DO_PC = resolve(RAIZ, 'cliente', 'servidor', 'node_modules', '@prisma', 'client');

function falha(mensagem: string): never {
    console.error(`\n${mensagem}\n`);
    process.exit(1);
}

/** O `.env` da pasta, como no `nova-assinatura.ts`: quem roda na mao nao tem `process.env`. */
function leEnv(chave: string): string | null {
    try {
        const texto = readFileSync(resolve(RAIZ, '.env'), 'utf8');
        for (const linha of texto.split('\n')) {
            const limpa = linha.trim();
            if (limpa.startsWith('#') || limpa === '') continue;
            const igual = limpa.indexOf('=');
            if (igual < 1 || limpa.slice(0, igual).trim() !== chave) continue;
            const valor = limpa.slice(igual + 1).trim();
            const comAspas =
                valor.length > 1 &&
                ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'")));
            return comAspas ? valor.slice(1, -1) : valor;
        }
    } catch {}
    return null;
}

function opcoesDaLinha(): { loja: string; escrever: boolean; ligarNaNuvem: boolean; sessao: boolean } {
    const argumentos = process.argv.slice(2);
    const opcoes = { loja: '', escrever: false, ligarNaNuvem: false, sessao: false };
    for (const argumento of argumentos) {
        if (argumento === '--escrever') opcoes.escrever = true;
        else if (argumento === '--ligar-na-nuvem') opcoes.ligarNaNuvem = true;
        else if (argumento === '--copiar-sessao-whatsapp') opcoes.sessao = true;
        else if (argumento.startsWith('--')) falha(`Opcao desconhecida: ${argumento}`);
        else if (!opcoes.loja) opcoes.loja = argumento;
    }
    return opcoes;
}

async function principal(): Promise<void> {
    const opcoes = opcoesDaLinha();
    if (!opcoes.loja) {
        console.log('Uso: npm run migrar:loja -- <id-da-loja> [--escrever] [--ligar-na-nuvem] [--copiar-sessao-whatsapp]');
        console.log('Sem --escrever o script so conta. A lista de lojas esta em /ops.');
        process.exit(0);
    }
    if (!existsSync(CLIENTE_DO_PC)) {
        falha(
            "O pacote do PC da loja nao esta montado, e' ele que tem o cliente do SQLite.\n" +
                'Rode "npm run banco:local" e depois "node scripts/montar-servidor.mjs".'
        );
    }

    const { caminhoDoBanco, guardaIdDaLoja, garanteBancoInicial } = require(resolve(RAIZ, 'cliente', 'dados.js'));
    const destino = caminhoDoBanco();
    const url = process.env.DATABASE_URL || leEnv('DATABASE_URL') || '';
    if (!url) falha('DATABASE_URL nao esta no ambiente nem no .env: sem ela nao da para ler a nuvem.');

    // PC novo nao tem banco ainda: e' o mesmo banco inicial que o instalador deixa.
    garanteBancoInicial();

    const { PrismaClient: PrismaDoPC } = require(CLIENTE_DO_PC);
    const origem = new PrismaClient();
    const pc = new PrismaDoPC({ datasourceUrl: 'file:' + destino.split('\\').join('/') });

    try {
        const loja = await origem.tenant.findUnique({
            where: { id: opcoes.loja },
            select: { id: true, name: true, ativo: true, local: true },
        });
        if (!loja) falha(`A loja ${opcoes.loja} nao existe na nuvem.`);

        console.log(`Loja: ${loja.name} (${loja.id})`);
        console.log(`Destino: ${destino}`);
        if (loja.local) console.log('A nuvem ja enfileira o pedido desta loja: o PC e\' o dono dos dados.');
        console.log('');

        const repetida = await pc.tenant.count({ where: { id: loja.id } });
        if (repetida > 0) console.log('O destino ja tem essa loja: rodar de novo completa o que faltou, sem duplicar.');
        const temLocal = await pc.tenant.count({ where: { id: 'local' } });
        if (temLocal > 0 && loja.id !== 'local') console.log("O destino ainda tem a loja 'local' do primeiro boot; ela fica sem uso.");
        console.log('');

        const resultados = await copiaLoja(origem, pc, loja.id, { simular: !opcoes.escrever, sessaoWhatsApp: opcoes.sessao });

        console.log('modelo'.padEnd(24) + 'lidas'.padStart(8) + 'gravadas'.padStart(10) + 'repetidas'.padStart(11));
        for (const linha of resultados) {
            console.log(
                linha.modelo.padEnd(24) +
                    String(linha.lidas).padStart(8) +
                    String(linha.gravadas).padStart(10) +
                    String(linha.repetidas).padStart(11)
            );
        }
        console.log('');
        console.log(`${resultados.reduce((soma, r) => soma + r.lidas, 0)} linha(s) da loja.`);

        if (!opcoes.escrever) {
            console.log('Nada gravado. Para gravar mesmo: repita com --escrever.');
            return;
        }

        guardaIdDaLoja(loja.id);
        console.log(`PC apontado para a conta ${loja.id} (loja.txt).`);
        console.log('');
        console.log('Falta, na mao:');
        console.log('  1. /ops -> "Chave do PC": copie e cole na aba iFood e 99Food da loja.');
        console.log('  2. Recredenciar o iFood, se usa: o segredo cifrado nao atravessa.');
        console.log('  3. Parear o WhatsApp no PC (QR na aba WhatsApp).');
        if (!opcoes.ligarNaNuvem) {
            console.log('  4. --ligar-na-nuvem, quando a loja entrar em uso no PC.');
        }
    } finally {
        await origem.$disconnect().catch(() => 0);
        await pc.$disconnect().catch(() => 0);
    }

    if (opcoes.ligarNaNuvem) {
        await origem.tenant.update({ where: { id: opcoes.loja }, data: { local: true } });
        console.log('');
        console.log(`Nuvem: ${opcoes.loja} enfileira pedido em vez de gravar.`);
    }
}

principal().catch((erro) => falha(`FALHA: ${erro instanceof Error ? erro.message : String(erro)}`));