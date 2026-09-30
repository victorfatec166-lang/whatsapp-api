/*
 * funcoesOrfas: o detector de codigo morto do JavaScript embutido no painel.
 *
 * POR QUE ESTE TESTE EXISTE, E POR QUE IMPORTA A FUNCAO DE VERDADE
 *
 * A primeira versao do teste copiou a funcao para um arquivo proprio e testou a
 * copia. A copia estava desatualizada -- assinatura `(codigo, debug)` contra a
 * original `(codigo, html)` -- entao os seis casos passavam enquanto a funcao de
 * verdade devolvia lista vazia sempre. O `tsc` nao pega nada disso: o codigo
 * analisado vive dentro de `<script>` em template literal, que o TypeScript nao
 * inspeciona. E o verificador que roda no `npm run check` e' a propria funcao.
 * Testar a copia e' testar uma reimplementacao, e a reimplementacao sempre passa.
 *
 * POR QUE OS CASOS SAO TAO ESTRANHOS
 *
 * Cada caso abaixo e' um falso positivo que aconteceu de verdade neste projeto.
 * Nenhum deles e' hipotetico, e todos os seis apareceram com a implementacao
 * anterior, que era a "certa" no papel:
 *
 *   1. A propria declaracao contem o nome. `function orfa()` se defende sozinha e
 *      contava como usada. Nenhuma orfa era detectada, nunca.
 *   2. A funcao e' passada por REFERENCIA: `.then(aplicaPainel)`. Nao ha
 *      `aplicaPainel(` em lugar nenhum do painel, so `aplicaPainel` como valor.
 *   3. A funcao e' do LAYOUT, chamada por outra aba. `modalBind` so e' chamada
 *      por abas que tem janela; conferindo tela por tela, ela saia orfa nas outras.
 *   4. A funcao e' IIFE: `(function restauraAba() { ... })()`. Uma ocorrencia do
 *      nome no arquivo inteiro, e ela se executa no load mesmo assim.
 *   5. A chamada esta no HTML e so existe quando ha dado: o
 *      `onclick="cashReconcile('...')"` so e' renderizado quando existe turno.
 *   6. A funcao e' TypeScript do servidor, nao JavaScript de tela: `renderLogin`
 *      fica no mesmo arquivo que o script do navegador, e so aparece no `import`
 *      de `authRoutes.ts`.
 *
 * Os seis juntos dariam um verificador que acusa coisa funcionando em quase toda
 * tela -- e um verificador que acusa demais e' desligado na primeira semana, e
 * ai nao protege mais nada.
 *
 * NOTA SOBRE ASPAS: as mensagens de assertivo vao em aspas duplas de proposito.
 * O projeto nao usa acento e escreve "e'" para o "e", e um apostrofo dentro de
 * string simples fecha a string e derruba o arquivo inteiro -- ja aconteceu
 * quatro vezes no mesmo dia.
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
     * O caso que o painel real produz. O bug do detector nunca foi "acha demais"
     * nem "acha de menos" em um caso isolado: foi um detector que devolvia vazio
     * com a orfa plantada, e um que devolvia quinze nomes com o painel inteiro
     * funcionando. Este caso amarra as duas pontas: tem de acusar a orfa E deixar
     * em paz as quatro que tem referencia.
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
    /*
     * O corpus de verdade tem ~40 mil caracteres de JavaScript de tela, e o
     * detector roda nele inteiro. Um regex com backtrack ruim passa nos casos
     * pequenos e estoura no tamanho real -- e o tamanho real e' o unico que
     * interessa, porque e' o que o `npm run check` faz.
     */
    const partes = [];
    for (let i = 0; i < 300; i++) {
        partes.push(`function tela${i}(){ return ${i} }\n document.getElementById("x${i}").onclick = tela${i};`);
    }
    partes.push('function orfaNoFim(){ return 0 }');
    const codigo = partes.join('\n');

    const achadas = orfas(codigo);
    assert.deepEqual(achadas, ['orfaNoFim']);
});
