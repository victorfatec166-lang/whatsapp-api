#!/usr/bin/env node
/*
 * Confere os comentarios do codigo antes de qualquer coisa rodar.
 *
 * POR QUE ESTE SCRIPT EXISTE
 *
 * O painel e' HTML montado no servidor: cada aba devolve um template literal do
 * TypeScript, e o HTML vai para o navegador. Duas armadilhas vivem nessa borda,
 * e as duas sao silenciosas -- a tela abre bonita e morta.
 *
 * 1. CRASE EM COMENTARIO DENTRO DE TEMPLATE LITERAL
 *
 *    Uma crase dentro de um `//` ou `/** *\/` que esta dentro de um template
 *    literal FECHA a string. O `tsc` acusa, mas aponta a linha seguinte a
 *   Comentario -- a primeira linha de codigo que virou lixo -- e nao a linha do
 *    comentario. Achar a causa a partir da mensagem e' adivinhar.
 *
 *    Aconteceu quatro vezes em uma sessao so, e uma delas bem agora, num
 *    comentario explicativo sobre classes CSS. Por isso o comentario aqui e' das
 *    tres formas de escrever, porque cada uma quebra de um jeito.
 *
 * 2. COMENTARIO FANTASMA
 *
 *    Comentario que descreve coisa que nao existe mais. Nao quebra a tela, e por
 *    isso e' pior: a pessoa que for mexer naquela area le, acredita, e constroi
 *    em cima de uma regra que o codigo ja nao segue. O caso classico e' o
 *    comentario que explica o que o codigo FAZIA, ao lado de um codigo que faz
 *    outra coisa, sem nenhuma nota de que a mudanca aconteceu.
 *
 *    Deteccao completa de comentario fantasma e' problema de semantica, e nao
 *    cabe num script. O que cabe e' o esqueleto: comentario que menciona um
 *    identificador que nao existe mais no arquivo e' suspeito, e o script aponta
 *    para a pessoa conferir. Falso positivo e' aceitavel aqui; comentario
 *    enganoso nao.
 *
 * O QUE O SCRIPT FAZ
 *
 * - Le as views e os servicos.
 * - Procura crase dentro de comentario que esta dentro de template literal.
 * - Procura `${` sem escape dentro de comentario, que tem o mesmo efeito de
 *   interpolar sem querer.
 * - Procura comentario que cita um identificador com maiuscula que sumiu do
 *   arquivo.
 * - Aponta comentario que so traduz o codigo ("incrementa a variavel"), que e'
 *   o que sobra quando alguem escreve comentario por obrigao.
 * - Aponta caractere fora do alfabeto latino num arquivo do projeto. Dois
 *   glifos de CJK entraram no codigo enquanto este script era escrito, ambos em
 *   comentario, ambos em tela na frente de quem estava conferindo. Nao
 *   quebravam nada -- so apareciam. Ver a nota sobre o alcance da regra.
 *
 *   node scripts/check-comentarios.js
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const PASTAS = ['src', 'tests', 'scripts'];

/** Commentario de uma linha e' `//`; de bloco e' entre `/*` e `*\/`. */
const RE_BLOCO = /\/\*([\s\S]*?)\*\//g;
const RE_LINHA = /^\s*\/\/(.*)$/gm;

/**
 * Trechos que sao template literal.
 *
 * Aproximacao deliberada: conta crases, ignora as que estiverem escapadas e
 * considera que a string abre em cada crase impar. Uma analise lexica de
 * verdade daria o mesmo resultado neste codigo, que nao usa crase dentro de
 * crase, e custaria um parser para um problema que o proprio `tsc` ja
 * denuncia -- a diferenca aqui e so a linha.
 */
function trechosTemplate(texto) {
    const trechos = [];
    let aberta = -1;
    for (let i = 0; i < texto.length; i++) {
        if (texto[i] === '\\') {
            i++;
            continue;
        }
        if (texto[i] === '`') {
            if (aberta === -1) aberta = i;
            else {
                trechos.push([aberta, i]);
                aberta = -1;
            }
        }
    }
    return trechos;
}

function estaDentro(trechos, pos) {
    return trechos.some(([a, b]) => pos > a && pos < b);
}

function arquivos(pasta) {
    const saida = [];
    const completo = path.join(RAIZ, pasta);
    if (!fs.existsSync(completo)) return saida;
    for (const entrada of fs.readdirSync(completo, { withFileTypes: true })) {
        const alvo = path.join(completo, entrada.name);
        if (entrada.isDirectory()) saida.push(...arquivos(path.join(pasta, entrada.name)));
        else if (entrada.name.endsWith('.ts') || entrada.name.endsWith('.js')) saida.push(path.join(pasta, entrada.name));
    }
    return saida;
}

let problema = 0;
let comentarios = 0;

/*
 * Este arquivo nao se fiscaliza nas duas regras de crase.
 *
 * Ele tem que CITER a crase para explicar a regra da crase, e tem que escrever
 * `${` para mostrar o que o TypeScript tenta interpretar. Fiscalizar aqui e
 * exigir que o fiscal esconda do fiscal o que ele existe para achar -- e a
 * diferenca entre uma regra e uma excecao escrita a mao.
 *
 * As outras regras valem neste arquivo: um comentario aqui que repete o codigo
 * e' redundante do mesmo jeito que em qualquer outro lugar.
 */
const SEM_Crase = new Set(['scripts' + path.sep + 'check-comentarios.js']);

/*
 * COMENTARIO QUE SO TRADUZ O CODIGO.
 *
 * Estas formas aparecem quando alguem preenche comentario por preenchimento: o
 * texto diz, em portugues, a mesma frase que a proxima linha ja diz em
 * TypeScript. Nao e' errado -- e' inutil. Pior: ocupa a tela e da a impressao de
 * que ali tem um motivo que o leitor nao achou.
 *
 * As seis frases abaixo cobrem os casos que mais aparecem no projeto. Quem
 * escreve "soma mais um no total" do lado de `contador++` esta fazendo o
 * comentario falar mais do que o codigo.
 */
const REDUNDANTES = [
    { re: /\b(retorna|devolve)\s+o?\s*(valor|resultado)\b/i, dica: 'o return ja diz o que devolve' },
    { re: /\b(incrementa|aumenta|decres|reduz)\s+o?\s*(contador|indice|total)\b/i, dica: 'o ++/-- ao lado ja diz' },
    { re: /\bdeclara\s+(a\s+)?variavel\b/i, dica: 'a declaracao esta na linha seguinte' },
    { re: /\b(fecha|abre)\s+o\s+(div|span|bloco|elemento)\b/i, dica: 'a tag esta na linha seguinte' },
    { re: /^importa\s+o\s+m[oó]dulo/i, dica: 'o import esta na linha seguinte' },
    { re: /\bdefine\s+a\s+(fun[cç][aã]o|funcao)\b/i, dica: 'a assinatura esta na linha seguinte' },
    { re: /\bchama\s+a?\s*(rota|endpoint|api|fetch)\b/i, dica: 'o fetch esta na linha seguinte' },
];

for (const rel of PASTAS.flatMap((pasta) => arquivos(pasta))) {
    const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const templates = trechosTemplate(texto);
    const linhas = texto.split('\n');
    const linhaDe = (pos) => texto.slice(0, pos).split('\n').length;

    const complain = (n, msg, dica) => {
        console.log(`  FALHA  ${rel}:${n}  ${msg}`);
        if (dica) console.log(`         ${dica}`);
        problema++;
    };

    // ---- 1 e 2: crase e `${` sem escape dentro de comentario em template ----
    const crases = [];
    for (const m of texto.matchAll(RE_BLOCO)) {
        if (!estaDentro(templates, m.index)) continue;
        crases.push([m.index, m[1], m[0]]);
    }
    for (const m of texto.matchAll(RE_LINHA)) {
        if (!estaDentro(templates, m.index)) continue;
        crases.push([m.index, m[1], '//' + m[1]]);
    }

    /*
     * Comentario HTML dentro do template literal.
     *
     * Mesmo defeito da crase, e ainda mais facil de encontrar: os blocos
     * <!-- --> explicam decisao de layout e de comportamento justamente onde
     * ha nome de classe -- que e' o que a pessoa escreve entre crases por
     * habito. E o comentario HTML nao e' CODE, entao o `//` acima nao alcança.
     */
    for (const m of texto.matchAll(/<!--([\s\S]*?)-->/g)) {
        if (!estaDentro(templates, m.index)) continue;
        crases.push([m.index, m[1], '<!--' + m[1]]);
    }

    for (const [pos, corpo, bruto] of crases) {
        comentarios++;

        /*
         * A linha que importa e' a do caractere, nao a da abertura do bloco.
         *
         * Um `/* ... *\/` de quinze linhas que estraga o arquivo na oitava e'
         * reportado na primeira se o script usar a posicao da abertura. A pessoa
         * olha a linha 90, nao acha crase nenhuma, e conclui que o verificador
         * inventou problema. Um fiscal que aponta o lugar errado e' pior do que
         * nao ter fiscal: treina a ignorar a saida.
         */
        const linhaDoCaractere = (prefixo) =>
            linhaDe(pos) + (prefixo.match(/\n/g) || []).length;

        if (corpo.includes('`') && !SEM_Crase.has(rel)) {
            complain(
                linhaDoCaractere(corpo.slice(0, corpo.indexOf('`'))),
                'crase dentro de comentario, dentro de template literal',
                'a crase fecha a string do TypeScript e o tsc aponta a linha errada. Escreva o nome da classe sem crase.'
            );
        }
        if (corpo.includes('${') && !SEM_Crase.has(rel)) {
            complain(
                linhaDoCaractere(corpo.slice(0, corpo.indexOf('${'))),
                'interpolacao sem escape dentro de comentario em template literal',
                '${ dentro de comentario interpolado faz o TS tentar ler a variavel. Escreva $ { sem chafe ou escape.'
            );
        }

        const limpo = bruto.replace(/^\/\*+|\*+\/$/g, '').replace(/^\s*\/\/\s?/, '');
        for (const regra of REDUNDANTES) {
            if (regra.re.test(limpo)) {
                complain(n, `comentario que repete o codigo: "${limpo.trim().slice(0, 60)}"`, `${regra.dica}. Se o motivo nao cabe numa frase, ele e' sobre o PORQUE.`);
                break;
            }
        }
    }

    // ---- 4: caractere de outro alfabeto ----
    /*
     * CJK, cirilico e grego.
     *
     * O alcance e' deliberadamente estreito: so o que ESTE projeto escreve.
     * `node_modules`, `dist` e as pastas de dados ficam de fora, e o motivo nao
     * e' o linguista: e' que a configuracao de ferramenta e de plugin nao se
     * traduz, e mexer nela estraga o funcionamento em vez de arrumar. Um
     * arquivo de terceiros com o nome em outra lingua e' nome de arquivo.
     *
     * O que nao entra: japanese em dados de produto -- nome imported pode
     * vir em qualquer idioma e precisa ser exibido como veio. Por isso a regra
     * olha o ARQUIVO do projeto, e nao o conteudo de dado em tempo de execucao.
     */
    const ALFABETOS_ESTRANHOS = /[\u2E80-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u0400-\u04FF\u0370-\u03FF]/g;
    for (const m of texto.matchAll(ALFABETOS_ESTRANHOS)) {
        const n = linhaDe(m.index);
        const trecho = linhas[n - 1].trim().slice(0, 80);
        complain(
            n,
            `caractere fora do alfabeto latino: "${m[0]}"`,
            `linha: ${trecho}\n         Se for nome de dado importado ou texto de tela, o arquivo e' valido e a regra nao se aplica. Se nao for, apague o caractere.`
        );
    }

    // ---- 3: comentario que cita identificador que nao existe mais ----
    for (const [pos, corpo] of crases) {
        // Identificador em CamelCase citado no texto do comentario. So os com
        // letra minuscula no inicio: maiuscula seria classe CSS, que nao tem
        // por que existir no arquivo.
        for (const m of corpo.matchAll(/\b([a-z][a-zA-Z0-9]{4,})\b/g)) {
            const nome = m[1];
            // Palavras do project's Finder, nao identificadores. Esta lista e'
            // curta de proposito: e' melhor deixar passar um nome comum do que
            // acusar palavra em ingles numa frase sobre o codigo.
            if (/\b(the|then|this|that|with|from|have|been|were|what|when|which|there|their|about|would|could|should|class|const|return|let|true|false)\b/.test(nome)) continue;
            // Procurando o nome inteiro no arquivo inteiro: o comentario pode
            // citar o identificador de outro arquivo, e nesse caso o erro e'
            // real, mas nao cabe aqui.
            if (texto.includes(nome)) continue;
            complain(
                linhaDe(pos),
                `comentario cita "${nome}", que nao existe mais neste arquivo`,
                'comentario fantasma: ele descreve uma regra que o codigo ja nao segue. Confira se a mudanca foi documentada.'
            );
            break;
        }
    }
}

console.log('');
if (problema > 0) {
    console.log(`${problema} problema(s) em ${comentarios} comentario(s).`);
    console.log('Comentario em template literal nao aceita crase nem ${. E comentario que so repete o codigo ocupa espaco sem informar nada.');
    process.exit(1);
}
console.log(`${comentarios} comentario(s) conferido(s): nenhuma crase ou interpolacao solta, nenhum comentario fantasma.`);
