/* Operacoes por chave unica sem a loja: `findUnique`, `findUniqueOrThrow`, `update`,
 * `upsert` e `delete`. Sem a loja na chave um id da loja vizinha entraria, e
 * `Product.findUnique` foi medido estourando -- impedia o bot de ler o produto. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function arquivosTs(dir: string): string[] {
    return readdirSync(dir).flatMap((nome) => {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) return arquivosTs(caminho);
        return nome.endsWith('.ts') ? [caminho] : [];
    });
}

/**
 * Modelos que a extensao deixa passar sem loja.
 *
 * Lido do `prisma-com-loja.ts`: e' a extensao que decide, e uma lista aqui
 * desatualizada acusaria `Assinatura`, que e' global de proposito.
 */
function modelosIsentos(): Set<string> {
    const fonte = readFileSync(join(SRC, 'database', 'prisma-com-loja.ts'), 'utf8');
    const semTenant = /SEM_TENANT\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(fonte);
    const idELoja = /ID_E_LOJA\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(fonte);
    /*
     * O bloco do `SEM_TENANT` e' multilinha e tem `SEM_LOJA` sem aspas; o do
     * `ID_E_LOJA` cabe numa linha. Extrai os nomes como identificadores, seja na
     * forma com aspas, seja na forma de constante, e descarta o resto.
     */
    const nomes = [...(semTenant?.[1] ?? '').split('\n'), ...(idELoja?.[1] ?? '').split('\n')]
        .flatMap((linha) => {
            const limpa = linha.split('//')[0];
            const entreAspas = [...limpa.matchAll(/'(\w+)'/g)].map((m) => m[1]);
            if (entreAspas.length) return entreAspas;
            // `SEM_LOJA` vem como constante: e' o nome da model global.
            return /^\s*SEM_LOJA\s*,?\s*$/.test(limpa) ? ['Tenant'] : [];
        });
    return new Set(nomes);
}

const ISENTOS = modelosIsentos();

/** `chat` -> `Chat`, como a extensao escreve. */
function capitaliza(nome: string): string {
    return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/** Modelo da chamada: `prisma.product.update(` e `prismaComLoja.product.update(`. */
function modeloDaChamada(antes: string): string {
    const achado = /prisma\w*\.(\w+)\.\w+\(\s*\{\s*$/.exec(antes.trimEnd());
    if (achado) return achado[1];
    const solto = /prisma\w*\.(\w+)\./g;
    let ultimo = '';
    let m: RegExpExecArray | null;
    while ((m = solto.exec(antes))) ultimo = m[1];
    return ultimo;
}

/**
 * Extrai as chamadas `update`/`upsert`/`delete` e ve se a chave leva a loja.
 *
 * Conta as chaves para achar onde o `where` termina: ele quase sempre esta em
 * varias linhas, e um regex de linha so deixaria passar o defeito onde ele mora.
 */
export const METODOS_CHAVE = 'findUniqueOrThrow|findUnique|update|upsert|delete';

function chamadasSemLoja(fonte: string): string[] {
    const problemas: string[] = [];
    // `(?!\w)` depois do metodo e' o que separa `update` de `updateMany` -- sem
    // isso o filtro virava acento de metodo que a extensao deixa passar.
    const regex = new RegExp(String.raw`prisma\w*\.(\w+)\.(${METODOS_CHAVE})\b(?!\w)\(\s*\{`, 'g');
    let achado: RegExpExecArray | null;

    while ((achado = regex.exec(fonte))) {
        const modelo = achado[1];
        const metodo = achado[2];
        // O Prisma expoe o delegate em minuscula (`prisma.chat`, `prisma.assinatura`),
        // enquanto os nomes da extensao estao em CamelCase.
        if (ISENTOS.has(modelo) || ISENTOS.has(capitaliza(modelo))) continue;

        const trecho = fonte.slice(achado.index, achado.index + 500);
        const ondeWhere = trecho.search(/where:\s*\{/);
        if (ondeWhere === -1) continue;

        const abre = trecho.indexOf('{', ondeWhere + 'where:'.length);
        let profundidade = 0;
        let fim = abre;
        for (let i = abre; i < trecho.length; i++) {
            if (trecho[i] === '{') profundidade++;
            else if (trecho[i] === '}') {
                profundidade--;
                if (profundidade === 0) {
                    fim = i;
                    break;
                }
            }
        }
        const where = trecho.slice(abre, fim + 1);

        const temLoja =
            /tenantId_\w+/.test(where) ||
            /tenantId\s*:/.test(where) ||
            /\bid_\w+/.test(where) ||
            /\bid\s*:\s*(exigeLoja\(\)|lojaAtual\(\)|tenantId|loja\b)/.test(where);

        if (!temLoja) {
            const linha = fonte.slice(0, achado.index).split('\n').length;
            problemas.push(`${modelo}.${metodo} na linha ${linha}: ${where.replace(/\s+/g, ' ')}`);
        }
    }
    return problemas;
}

/**
 * Arquivos com chamadas ja conhecidas que ainda nao foram corrigidas.
 *
 * VAZIA de proposito (08/10): as 23 restantes foram corrigidas, com a unique
 * `tenantId_id` em Product, Order, User, CashShift e Reminder. Repovoar e' vazar.
 */
const JA_CONHECIDOS: string[] = [];

/**
 * Arquivos que usam o cliente CRU (`database/prisma`), sem a extensao.
 *
 * Sem loja para injetar nao ha o que quebrar: `Assinatura` e' global de proposito e
 * o webhook do Asaas roda antes de existir loja. Vem da importacao do caminho.
 */
function usaClienteCru(arquivo: string): boolean {
    const fonte = readFileSync(arquivo, 'utf8');
    return /from '\.\.?\/.*database\/prisma'/.test(fonte) && !/prismaComLoja|prisma-com-loja/.test(fonte);
}

test('nenhuma chamada nova(update/upsert/delete) fica sem a loja na chave', () => {
    const porArquivo = new Map<string, string[]>();
    for (const arquivo of arquivosTs(SRC)) {
        // O guarda-corpo cita os metodos no texto e seria acusacao falsa.
        if (arquivo.endsWith('prisma-com-loja.ts')) continue;
        // Cliente cru nao tem extensao, entao nao tem o que exigir.
        if (usaClienteCru(arquivo)) continue;
        const achados = chamadasSemLoja(readFileSync(arquivo, 'utf8'));
        if (achados.length) porArquivo.set(arquivo.replace(SRC, 'src'), achados);
    }

    const novas = [...porArquivo]
        .filter(([arquivo]) => !JA_CONHECIDOS.includes(arquivo))
        .map(([arquivo, achados]) => `${arquivo}:\n  ${achados.join('\n  ')}`);

    const total = [...porArquivo.values()].reduce((s, a) => s + a.length, 0);
    assert.deepEqual(
        novas,
        [],
        `chave sem loja em arquivo novo:\n${novas.join('\n')}\n\n(total de dividas conhecidas: ${total})`
    );
});

test('a lista de isentos sai da extensao, e nao de copia', () => {
    // Se a leitura das listas quebrar, o detector passa a acusar `Assinatura` e
    // `Tenant` como defeito, e o gate vira alarme falso.
    assert.ok(ISENTOS.has('Tenant'), 'Tenant (global) nao entrou');
    assert.ok(ISENTOS.has('Assinatura'), 'Assinatura (global) nao entrou');
    assert.ok(ISENTOS.has('Config'), `Config (loja no id) nao entrou: ${[...ISENTOS].join(',')}`);
    assert.ok(ISENTOS.has('SessaoWhatsApp'), 'SessaoWhatsApp nao entrou');
    assert.ok(!ISENTOS.has('Chat'), 'Chat nao pode estar isento: a loja esta na chave');
    assert.ok(!ISENTOS.has('Product'), 'Product nao pode estar isento');
});

test('o detector aponta o defeito de verdade e nao acusa o certo', () => {
    // `where: { id }` sem loja tem de ser apontado.
    assert.equal(chamadasSemLoja('await prisma.chat.update({ where: { id: x }, data: {} })').length, 1);
    // Com a loja na chave, nao.
    assert.equal(chamadasSemLoja('await prisma.chat.update({ where: { tenantId: t }, data: {} })').length, 0);
    // `Config` e `BotMessage` usam `id` como a propria loja.
    assert.equal(chamadasSemLoja('await prisma.config.update({ where: { id: exigeLoja() }, data: {} })').length, 0);
    // Filtro (`updateMany`) nunca e' acento: a extensao injeta a loja.
    assert.equal(chamadasSemLoja('await prisma.chat.updateMany({ where: { id: x }, data: {} })').length, 0);
    // `Assinatura` e' global: nem entra na conta.
    assert.equal(chamadasSemLoja('await prisma.assinatura.update({ where: { id: x }, data: {} })').length, 0);
    // `where` em varias linhas tambem e' lido.
    assert.equal(chamadasSemLoja('await prisma.chat.update({\n  where: { id: x },\n  data: {},\n})').length, 1);

    /*
     * `findUnique` tambem exige a loja, e era o que faltava: o bot nao conseguia nem
     * LER o produto escolhido pelo numero, entao o cliente caia no "deu um erro" e
     * o menu voltava -- que e' exatamente o sintoma do print.
     */
    assert.equal(chamadasSemLoja('await prisma.product.findUnique({ where: { id: x } })').length, 1);
    assert.equal(chamadasSemLoja('await prisma.product.findUniqueOrThrow({ where: { id: x } })').length, 1);
    // A chave composta e' o jeito certo e nao entra na conta.
    assert.equal(
        chamadasSemLoja('await prisma.product.findUnique({ where: { tenantId_id: { tenantId: t, id: x } } })')
            .length,
        0
    );
});