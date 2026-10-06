/*
 * A senha do primeiro acesso: um arquivo em texto claro para o dono do programa
 * descobrir sem abrir log. Travam as duas garantias que tornam isso aceitavel --
 * so existe no modo local, e some na hora em que a senha e' trocada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const PASTA = resolve(tmpdir(), 'deliveryadmin-teste-primeiro-acesso');

/*
 * `paths.ts` le a pasta do ambiente na importacao do modulo, entao o `require'
 * abaixo tem de acontecer DEPOIS desta linha -- e nao pode ser `import` estatico,
 * que o Node resolveria antes. Top-level await nao serve: o tsx compila para cjs.
 */
const exigir = createRequire(import.meta.url);
function auth() {
    return exigir('../src/services/auth') as typeof import('../src/services/auth');
}

function arquivo() {
    return resolve(PASTA, 'primeiro-acesso.json');
}

function comArquivo(conteudo: unknown) {
    mkdirSync(PASTA, { recursive: true });
    writeFileSync(arquivo(), JSON.stringify(conteudo), 'utf8');
}

test.before(() => {
    process.env.DELIVERYADMIN_DATA = PASTA;
    delete process.env.MODO_LOCAL;
    auth();
});

test.after(() => {
    rmSync(PASTA, { recursive: true, force: true });
});

test('sem o modo local a rota nao entrega nada, mesmo com o arquivo na pasta', () => {
    /*
     * Este e' o teste que impede o pior desfecho: a rota vive FORA da protecao de
     * sessao (quem ainda nao entrou e' quem precisa dela), entao se respondesse na
     * nuvem qualquer um chegava na porta e puxava a senha do administrador.
     */
    comArquivo({ email: 'admin@localhost', senha: 'SenhaSecreta123' });
    assert.equal(auth().primeiroAcessoLocal(), null, 'fora do modo local devia ser null');
});

test('no modo local a senha do arquivo e' + ' devolvida', () => {
    process.env.MODO_LOCAL = '1';
    try {
        comArquivo({ email: 'admin@localhost', senha: 'SenhaSecreta123', criadoEm: '2026-10-06' });
        assert.deepEqual(auth().primeiroAcessoLocal(), { email: 'admin@localhost', senha: 'SenhaSecreta123' });
    } finally {
        delete process.env.MODO_LOCAL;
    }
});

test('sem arquivo, ou com arquivo estragado, devolve null em vez de estourar', () => {
    process.env.MODO_LOCAL = '1';
    try {
        rmSync(arquivo(), { force: true });
        assert.equal(auth().primeiroAcessoLocal(), null, 'sem arquivo ainda nao houve primeiro acesso');

        mkdirSync(PASTA, { recursive: true });
        writeFileSync(arquivo(), 'isto nao e json', 'utf8');
        assert.equal(auth().primeiroAcessoLocal(), null, 'corrompido e' + ' null, e nao excecao');

        comArquivo({ email: 'admin@localhost' });
        assert.equal(auth().primeiroAcessoLocal(), null, 'sem senha nao ha o que entregar');
    } finally {
        delete process.env.MODO_LOCAL;
    }
});

test('a troca de senha apaga o arquivo, e o arquivo fica na area do usuario', () => {
    /*
     * A segunda metade importa porque ao lado do executavel o dado se perde na
     * atualizacao -- e uma atualizacao que apaga a senha recomeca o primeiro acesso.
     */
    assert.ok(PASTA.includes('deliveryadmin-teste'), 'a pasta vem do ambiente');

    process.env.MODO_LOCAL = '1';
    try {
        comArquivo({ email: 'admin@localhost', senha: 'SenhaVelha123' });
        assert.notEqual(auth().primeiroAcessoLocal(), null, 'antes da troca o arquivo existe');

        auth().apagaPrimeiroAcesso();
        assert.equal(existsSync(arquivo()), false, 'a senha trocada nao pode ficar em arquivo');
        assert.equal(auth().primeiroAcessoLocal(), null);
    } finally {
        delete process.env.MODO_LOCAL;
    }
});