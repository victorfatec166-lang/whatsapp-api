/*
 * Testar a funcao de verdade, e nao uma copia: a primeira versao do teste tinha
 * assinatura `(codigo, debug)` contra a original `(codigo, html)`, e os seis
 * casos passavam com a funcao devolvendo lista vazia. O `tsc` nao pega nada disso.
 */

/*
 * Cada caso abaixo ja foi um falso positivo real: a declaracao contem o nome,
 * a funcao vai por REFERENCIA, e' de layout chamada por outra aba, e' IIFE, so
 * aparece quando ha dado, ou e' TypeScript do servidor so citado num import.
 */

/*
 * E as mensagens de assertivo vao em aspas duplas de proposito: o projeto
 * escreve "e'" para o "e", e um apostrofo em string simples fecha a string e
 * derruba o arquivo inteiro -- ja aconteceu quatro vezes no mesmo dia.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { funcoesOrfas } = require('../scripts/check-js.js');

/** Atalho: declara em `codigo` e procura referencia em `corpus`. */
function orfas(codigo, corpus = codigo) {
    return funcoesOrfas(codigo, corpus);
}

test('acha a orfa de verdade e nao acusa a sua propria declaracao', () => {
    const codigo = 'function orfaPlantada(){return 1} function usada(){return 2} usada()';
    assert.deepEqual(orfas(codigo), ['orfaPlantada']);
});

test('funcao passada por referencia esta em uso', () => {
    // `aplicaPainel` e' o painel do sino, chamado assim: algo.then(aplicaPainel).
    const codigo = 'function aplicaPainel(d){}\n rota.then(aplicaPainel)';
    assert.deepEqual(orfas(codigo), [], "referencia sem parentes e' uso");
});

test('funcao do layout chamada por outra aba esta em uso', () => {
    const codigo = 'function modalBind(id,ep){}';
    const outra = 'function abreJanela(){ modalBind("x", "/api/y") }';
    const html = '<button data-modal="x">y</button>';
    assert.deepEqual(orfas(codigo, codigo + '\n' + outra + '\n' + html), [], "chamada em outra aba conta");
});

test("IIFE nao e' orfa, mesmo com o nome aparecendo uma vez so", () => {
    const codigo = '(function restauraAba() { document.body.dataset.pronto = "1"; })()';
    assert.deepEqual(orfas(codigo), [], 'IIFE se executa no load');
});

test('funcao so chamada por atributo no HTML esta em uso', () => {
    const codigo = 'function stockPrintReorder(){ fetch("/x") }';
    const html = '<button onclick="stockPrintReorder()">Repor</button>';
    assert.deepEqual(orfas(codigo, codigo + '\n' + html), [], 'onclick conta como uso');
});

test('funcao exportada em window esta em uso', () => {
    const codigo = 'window.lembreteSalva = async function(ev){ return ev; }';
    assert.deepEqual(orfas(codigo), [], 'window.X existe para o HTML chamar por atributo');
});

test('TypeScript do servidor nao entra na conta de orfa', () => {
    // `renderLogin` e' TS do Node: aparece no import de authRoutes, nunca dentro
    // de um <script>. A declaracao vem do script, a referencia vem de todo o src.
    const codigo = 'function renderLogin(){ return "<script>oi</script>" }';
    const corpus = codigo + "\nimport { renderLogin } from './views/login';\nrenderLogin();";
    assert.deepEqual(orfas(codigo, corpus), [], "TS do servidor nao e' orfa de tela");
});

test("funcao orfa e' achada mesmo com o resto do painel cheio de uso", () => {
    /*
     * O caso que o painel real produz: acusar a orfa plantada E deixar em paz as
     * quatro que tem referencia. O detector ja falhou para os dois lados.
     */
    const codigo = [
        'function orfa(){return 1}',
        'function usada(){return 2} usada()',
        'function porReferencia(){return 3} rota.then(porReferencia)',
        '(function iife(){ run() })()',
        'function soNoHtml(){return 5}',
    ].join('\n');
    const corpus = codigo + '\n<button onclick="soNoHtml()">x</button>';

    assert.deepEqual(orfas(codigo, corpus), ['orfa']);
});

test('declaracao em var/const tambem entra na conta', () => {
    const codigo = 'const soUsada = function(){return 1}; soUsada(); const naoUsada = () => 2;';
    assert.deepEqual(orfas(codigo), ['naoUsada']);
});

test("o verificador nao some quando o codigo e' grande e real", () => {
    // Regex com backtrack ruim passa nos casos pequenos e estoura no tamanho real,
    // que e' o unico que interessa: sao os ~40 mil caracteres que o
    // `npm run check` analisa.
    const partes = [];
    for (let i = 0; i < 300; i++) {
        partes.push(`function tela${i}(){ return ${i} }\n document.getElementById("x${i}").onclick = tela${i};`);
    }
    partes.push('function orfaNoFim(){ return 0 }');
    const codigo = partes.join('\n');

    const achadas = orfas(codigo);
    assert.deepEqual(achadas, ['orfaNoFim']);
});
