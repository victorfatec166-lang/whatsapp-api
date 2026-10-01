/*
 * Este guard nao e' seguranca: quem pode copiar a pasta da sessao pode editar a
 * checagem. O que ele pega e' o ACIDENTO -- instalacao copiada para testar, ou
 * pasta empacotada sem querer -- que faz o WhatsApp ver duas identidades.
 */


/*
 * As tres regras: sessao de outra maquina AVISA e diz o que fazer; marcacao
 * corrompida NAO bloqueia, porque trocar sessao possivelmente errada por bot
 * quebrado e' pior; sem id da maquina nao se inventa veredito.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { confereAmarracao, idDaMaquina } from '../src/services/maquina';

const ID_DESTA = 'a'.repeat(32);
const ID_DE_OUTRA = 'b'.repeat(32);

function pastaLimpa(t: any): string {
    const raiz = mkdtempSync(join(tmpdir(), 'guard-maquina-'));
    t.after(() => rmSync(raiz, { recursive: true, force: true }));
    const sessao = join(raiz, 'sessao');
    mkdirSync(sessao);
    return sessao;
}

function marca(pasta: string, id: string): void {
    writeFileSync(
        join(pasta, 'sessao-maquina.json'),
        JSON.stringify({ versao: 1, id, criadoEm: new Date().toISOString() }),
        'utf8'
    );
}

test('o id da maquina e estavel e nao vaza o GUID', () => {
    const id = idDaMaquina();

    // `id === ''` e' o caso sem MachineGuid, coberto pelo ultimo teste. E
    // t.skip(cond) nao serve: o runner nao aceita condicao, e t.skip(false) pula
    // do mesmo jeito -- a primeira versao pulava sempre e o id errado passava.
    if (id === '') return;

    assert.equal(id.length, 32, 'tamanho fixo');
    assert.equal(id, idDaMaquina(), 'estavel entre chamadas');
    // O valor lido do registro identifica a maquina em qualquer lugar que este
    // arquivo seja lido. O que e' gravado e' hash com sal fixo, e so precisa
    // comparar -- nunca ser lido de volta.
    assert.match(id, /^[0-9a-f]{32}$/, 'hex, nao o GUID em claro');
});

test('sessao nova nao gera aviso e grava a marcacao', (t) => {
    const sessao = pastaLimpa(t);
    assert.equal(confereAmarracao(sessao, ID_DESTA), null);
    assert.ok(existsSync(join(sessao, 'sessao-maquina.json')), 'marcacao gravada');
    // O guard marca a maquina; ele nunca cria credencial. Um "pareado" falso
    // aqui mandaria a tela para um QR que nao tem o que parear.
    assert.equal(existsSync(join(sessao, 'creds.json')), false, 'nenhuma credencial inventada');
});

test('sessao desta maquina nao avisa', (t) => {
    const sessao = pastaLimpa(t);
    writeFileSync(join(sessao, 'creds.json'), '{}', 'utf8');
    assert.equal(confereAmarracao(sessao, ID_DESTA), null);
});

test('sessao de outra maquina avisa, e o texto diz o que fazer', (t) => {
    const sessao = pastaLimpa(t);
    writeFileSync(join(sessao, 'creds.json'), '{}', 'utf8');
    marca(sessao, ID_DE_OUTRA);

    const r = confereAmarracao(sessao, ID_DESTA);
    assert.ok(r, 'deveria ter avisado');
    assert.equal(r!.podeAparear, true, 'a solucao e' + ' escanear o QR');
    // O texto nao pode ser so uma acusacao: quem le precisa sair da tela
    // sabendo o que fazer em um minuto.
    assert.match(r!.motivo, /outra maquina/i);
    assert.ok(r!.motivo.length > 40, 'o aviso explica, e nao' + ' so acusa');
});

test('o aviso some quando a marcacao volta a ser desta maquina', (t) => {
    const sessao = pastaLimpa(t);
    marca(sessao, ID_DE_OUTRA);
    assert.ok(confereAmarracao(sessao, ID_DESTA), 'primeiro avisa');
    marca(sessao, ID_DESTA);
    assert.equal(confereAmarracao(sessao, ID_DESTA), null, 'depois nao avisa mais');
});

test('marcacao corrompida nao bloqueia o WhatsApp', (t) => {
    const sessao = pastaLimpa(t);
    writeFileSync(join(sessao, 'sessao-maquina.json'), '{ nao e json', 'utf8');

    // Este e' o caso mais importante do arquivo. Um arquivo de texto ilegivel
    // derrubando o bot seria trocar uma sessao possivelmente errada por um bot
    // comprovadamente quebrado -- e sem ninguem conseguir descobrir o porque.
    assert.equal(confereAmarracao(sessao, ID_DESTA), null, 'nao vira bloqueio');

    const regravado = JSON.parse(readFileSync(join(sessao, 'sessao-maquina.json'), 'utf8'));
    assert.equal(regravado.id, ID_DESTA, 'foi reescrito com o id desta maquina');
});

test('sem id da maquina, nao se inventa veredito', (t) => {
    const sessao = pastaLimpa(t);
    marca(sessao, ID_DE_OUTRA);
    // Fingir que conferiu e' pior do que admitir que nao deu: o guard passaria
    // com a sessao errada, que e' exatamente o que ele existe para pegar.
    assert.equal(confereAmarracao(sessao, ''), null, 'sem id, sem veredito');
});
