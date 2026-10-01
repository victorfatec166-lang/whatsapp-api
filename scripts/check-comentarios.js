#!/usr/bin/env node
/*
 * O painel e' HTML montado no servidor: cada aba devolve um template literal do
 * TypeScript e o HTML vai para o navegador. Nessa borda moram duas armadilhas, e as
 * duas sao silenciosas -- a tela abre bonita e morta.
 */

/*
 * CRASE EM COMENTARIO DENTRO DE TEMPLATE LITERAL: a crase fecha a string, e o `tsc`
 * acusa a linha seguinte ao comentario, nao a do comentario. Aconteceu 4 vezes numa
 * sessao so, e por isso o comentario aqui vem nas tres formas: cada uma quebra diferente.
 */

/*
 * COMENTARIO FANTASMA: descreve o que o codigo FAZIA e nao faz. Nao quebra a tela, e
 * por isso e' pior -- quem le acredita e constroi sobre uma regra que o codigo ja nao
 * segue. O script so da o esqueleto; falso positivo e' aceitavel, enganoso nao.
 */

/*
 * Le as views e os servicos e procura: crase em comentario dentro de template; `${`
 * sem escape; comentario que cita identificador que sumiu; comentario que so traduz
 * o codigo; e caractere fora do alfabeto latino (dois glifos CJK entraram assim).
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const PASTAS = ['src', 'tests', 'scripts'];
/** Comentario e' no maximo este tanto de linha de conteudo. Regra do dono. */
const MAX_LINHAS = 3;

/** Commentario de uma linha e' `//`; de bloco e' entre `/*` e `*\/`. */
const RE_BLOCO = /\/\*([\s\S]*?)\*\//g;
const RE_LINHA = /^\s*\/\/(.*)$/gm;

/**
 * Aproximacao deliberada: conta crases, ignora as escapadas e abre a string em cada
 * crase impar. Analise lexica daria o mesmo resultado neste codigo e custaria um parser
 * para um problema que o `tsc` ja denuncia -- a diferenca aqui e' so a linha.
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
let contados = 0;

/*
 * Este arquivo nao se fiscaliza nas duas regras de crase: ele tem que CITER a crase
 * para explicar a regra da crase, e tem que escrever `${` para mostrar o que o
 * TypeScript tenta interpretar. Fiscalizar aqui seria exigir que o fiscal esconda do
 * fiscal o que ele existe para achar. As outras regras valem: um comentario aqui que
 * repete o codigo e' redundante do mesmo jeito que em qualquer outro lugar.
 */
const SEM_Crase = new Set(['scripts' + path.sep + 'check-comentarios.js']);

/*
 * COMENTARIO QUE SO TRADUZ O CODIGO. Estas formas aparecem quando alguem preenche
 * comentario por preenchimento: o texto diz, em portugues, a frase que a proxima linha
 * ja diz em TypeScript. Nao e' errado -- e' inutil, e ocupa a tela com a impressao de
 * que ali tem um motivo que o leitor nao achou.
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

/*
 * A REGRA DAS 3 LINHAS. Comentario longo nao e' codigo mal documentado, e' o codigo
 * sendo explicado duas vezes: uma no `por que` e outra em prosa. Custa leitura e
 * envelhece pior -- o comentario descreve a decisao de ontem e ninguem o atualiza.
 */

/*
 * O que sobra e' o `por que` de decisao complexa ou atipica, que e' a unica coisa
 * que o nome da variavel nao diz. Se precisa de mais, a resposta e' trocar o codigo,
 * nao escrever mais. Linha de conteudo e' a linha com texto: a abertura, o fecho e as
 * linhas so com asterisco nao contam, e run de `//` seguido conta como um so.
 */
function linhasDeConteudo(corpo, bloco) {
    return corpo
        .split('\n')
        .map((l) => (bloco ? l.replace(/^\s*\*/, '') : l.replace(/^\s*\/\//, '')).trim())
        .filter(Boolean);
}

/** Runs de `//` colados formam um comentario so. */
function runsDeLinha(texto, marcador = '//') {
    const linhas = texto.split('\n');
    const runs = [];
    let atual = null;
    // `Multiline` e' obrigatorio: sem ela o `$` so casa no fim do arquivo, o finds de
    // `//` no meio dava ZERO casamento e a regra dos runs nao rodava -- 447 falhas, todas
    // de bloco. E o `\r?` explicito tambem: 38 arquivos sao CRLF e o `.` nao casa o `\r`.
    const esc = marcador.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const reLinha = new RegExp(`^(\\s*)${esc}(.*?)\\r?$`, 'm');
    const reSoMarca = new RegExp(`^\\s*${esc}`);
    for (let i = 0; i < linhas.length; i++) {
        const m = linhas[i].match(reLinha);
        if (m) {
            if (!atual) atual = { ini: i, corpo: [] };
            atual.corpo.push(m[2]);
            continue;
        }
        // Linha vazia ou so com a marca fecha o run. Uma linha em branco DENTRO do
        // paragrafo continua o run, e e' o que permite o titulo em caixa alta
        // seguido das explicacoes.
        if (atual && linhas[i].trim() === '') {
            let j = i;
            while (j + 1 < linhas.length && linhas[j + 1].trim() === '') j++;
            if (linhas[j + 1] && reSoMarca.test(linhas[j + 1])) {
                atual.corpo.push('');
                i = j;
                continue;
            }
        }
        if (atual) runs.push(atual);
        atual = null;
    }
    if (atual) runs.push(atual);
    return runs;
}

/*
 * Tapa o conteudo de string, mantendo o tamanho e as quebras de linha.
 *
 * Sem isso, o `/*` de dentro de `'application/*+json'` -- que e' o `type` do
 * express.raw, no proprio `server.ts` -- e' lido como abertura de bloco. O
 * verificador contava 9 linhas num comentario que nao existe, e nenhuma delas
 * era comentario. Pior: a "solucao" que apareceu primeiro foi escrever um
 * comentario ao lado para fechar o pseudo-bloco, o que resolve o sintoma e
 * conserta a causa errada.
 *
 * So aspas simples e duplas. O template literal ja e' tratado a parte, pelos
 * trechos de crase. A mascara troca o conteudo por `x` de mesmo comprimento, e
 * nao por nada: o comprimento e' o que mantem a contagem de linha exata, e sem
 * ela todo erro aqui vira "achou na linha errada", que e' pior do que nao
 * achar.
 */
function mascaraDeStrings(texto) {
    const saida = texto.split('');
    let i = 0;
    while (i < texto.length) {
        const c = texto[i];
        if (c === '/' && texto[i + 1] === '/') {
            while (i < texto.length && texto[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && texto[i + 1] === '*') {
            const fecha = texto.indexOf('*/', i + 2);
            i = fecha === -1 ? texto.length : fecha + 2;
            continue;
        }
        if (c === "'" || c === '"') {
            const aspas = c;
            let j = i + 1;
            while (j < texto.length) {
                if (texto[j] === '\\') { j += 2; continue; }
                if (texto[j] === aspas) break;
                if (texto[j] === '\n') break;
                j++;
            }
            for (let k = i + 1; k < j && k < texto.length; k++) {
                if (saida[k] !== '\n' && saida[k] !== '\r') saida[k] = 'x';
            }
            i = j + 1;
            continue;
        }
        i++;
    }
    return saida.join('');
}

function confereTamanho(rel, texto, templates, complain, marcador = '//') {
    const linhaDe = (pos) => texto.slice(0, pos).split('\n').length;
    // Os mesmo-length, o bloco de comment so muda a forma.
    const semStrings = mascaraDeStrings(texto);

    if (marcador === '//') {
        for (const m of semStrings.matchAll(RE_BLOCO)) {
            if (estaDentro(templates, m.index)) continue;
            const linhas = linhasDeConteudo(m[1], true);
            if (linhas.length <= MAX_LINHAS) continue;
            complain(
                linhaDe(m.index),
                `comentario de ${linhas.length} linhas (maximo ${MAX_LINHAS})`,
                `"${linhas[0].replace(/^\*+/, '').trim().slice(0, 60)}" -- garde o porque e corte o resto.`
            );
        }
    }

    for (const run of runsDeLinha(semStrings, marcador)) {
        const linhas = run.corpo.map((l) => l.trim()).filter(Boolean);
        if (linhas.length <= MAX_LINHAS) continue;
        complain(
            run.ini + 1,
            `comentario de ${linhas.length} linhas (maximo ${MAX_LINHAS})`,
            `"${linhas[0].slice(0, 60)}" -- guarde o porque e corte o resto.`
        );
    }
}

/*
 * O instalador tambem entra na regra, e nao so o `src`.
 *
 * Sao tres linguagens e tres marcas de comentario: `#` no PowerShell, `;` no
 * Inno Setup. Sem elas a regra valeria so onde o TypeScript mora, e o lugar
 * onde o comentario cresce mais -- documentando por que o instalador e' do jeito
 * que e' -- ficaria de fora. Commentario de 31 linhas num `.iss` nao e' mais
 * claro que comentario de 31 linhas num `.ts`.
 *
 * O `DeliveryAdmin.cs` fica de fora de proposito: sao 73 KB de C# com
 * `/// <summary>` em toda assinatura, e o estilo dele e' o do C#. A regra vale
 * para onde a regra e' nossa.
 */
const INSTALADOR = [
    { padrao: /\.ps1$/, marcador: '#' },
    { padrao: /\.iss$/, marcador: ';' },
];

for (const { padrao, marcador } of INSTALADOR) {
    const pasta = path.join(RAIZ, 'installer');
    if (!fs.existsSync(pasta)) continue;
    for (const nome of fs.readdirSync(pasta).sort()) {
        if (!padrao.test(nome)) continue;
        const rel = path.join('installer', nome);
        const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
        const complain = (n, msg, dica) => {
            console.log(`  FALHA  ${rel}:${n}  ${msg}`);
            if (dica) console.log(`         ${dica}`);
            problema++;
        };
        confereTamanho(rel, texto, [], complain, marcador);
        contados++;
    }
}

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

    // ---- 0: tamanho. Antes das outras, porque e' a mais barata de corrigir.
    confereTamanho(rel, texto, templates, complain);
    contados++;

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
     * Comentario HTML dentro do template literal. Mesmo defeito da crase, e mais facil
     * de achar: os blocos <!-- --> explicam decisao de layout justamente onde ha nome
     * de classe, que e' o que se escreve entre crases por habito -- e o `//` acima nao
     * alcanca comentario que nao e' codigo.
     */
    for (const m of texto.matchAll(/<!--([\s\S]*?)-->/g)) {
        if (!estaDentro(templates, m.index)) continue;
        crases.push([m.index, m[1], '<!--' + m[1]]);
    }

    for (const [pos, corpo, bruto] of crases) {
        comentarios++;

        /*
         * A linha que importa e' a do caractere, e nao a da abertura do bloco: um
         * `/* ... *\/` de quinze linhas que estraga o arquivo na oitava seria reportado
         * na primeira, e quem olha a linha 90 nao acha crase nenhuma e conclui que o
         * verificador inventou. Fiscal que aponta o lugar errado treina a ignorar.
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
     * CJK, cirilico e grego. O alcance e' deliberadamente estreito: so o que ESTE
     * projeto escreve. `node_modules`, `dist` e as pastas de dados ficam de fora porque
     * configuracao de ferramenta nao se traduz, e mexer nela estraga o funcionamento.
     */

    /*
     * O que nao entra: japones em dado de produto, que pode vir em qualquer idioma e
     * precisa ser exibido como veio. Por isso a regra olha o ARQUIVO do projeto, e nao
     * o conteudo de dado em tempo de execucao.
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
console.log(`${comentarios} comentario(s) conferido(s) em ${contados} arquivo(s): nenhum acima de ${MAX_LINHAS} linhas, nenhuma crase ou interpolacao solta, nenhum comentario fantasma.`);