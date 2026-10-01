#!/usr/bin/env node
/*
 * A regra do painel e' uma so: a tela tem que caber sem a pessoa descer com o mouse.
 * Nao e' preferencia estetica -- e' a diferenca entre um painel lido de relance e um
 * que obriga a rolar para voltar ao topo e lembrar onde estava.
 */

/*
 * A regra e' facil de quebrar em silencio, e a causa quase nunca e' o cabecalho: e' um
 * container com `overflow-y-auto` e altura em rem. Teto absoluto funciona no monitor
 * de 1080 -- 36rem cabem -- e nao no 1366x768 do balcao, com a barra do navegador.
 */

/*
 * As duas familias: `max-h-[36rem]` em lista, teto absoluto que nao sabe quanto sobra
 * (o certo e' `calc(100vh - <altura do que esta acima>)`); e lista sem teto, que cresce
 * com os dados -- 100 pedidos no Kanban e' uma coluna de tres metros ao lado de outra.
 */

/*
 * Le o TypeScript das telas, e nao o HTML servido, porque o defeito esta no codigo que
 * gera o HTML. Acha todo container com rolagem propria: teto em viewport passa, teto
 * em rem ou px falha com o numero, e sem teto tambem falha.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const VIEWS = path.join(RAIZ, 'src', 'views');

/**
 * E' o que deveria ser a unica coisa a rolar. `overflow-hidden` nao entra: ali quem
 * impede a rolagem e' o proprio elemento, e nao ha lista dentro dele para o usuario ver.
 */
const ROLAGEM = /overflow-y-(?:auto|scroll)/;

/**
 * Aceita `calc(100vh - ...)` e a vh solta: 55vh ocupa a mesma fracao em qualquer
 * monitor. O que reprova e' rem e px -- numeros absolutos escritos por alguem
 * olhando a propria tela.
 */
const TETO_VIEWPORT = /(?:max-h|h)-\[(?:calc\(100vh[\w\s.+-]*\)|[\d.]+vh)\]/;

/**
 * A fronteira antes do nome da classe separa `max-h-[36rem]` (teto) de
 * `min-h-[5rem]` (piso). Sem ela, "min-h" casa o "h" do final e toda lista com
 * um minimo vira acusacao de teto fixo.
 */
const TETO_FIXO = /(?:^|[\s"'])(?:max-h|h)-\[(\d+(?:\.\d+)?(?:rem|px|vh|ch|em))\]/;

/**
 * `layout.ts` e' o casco: a barra lateral e' de altura fixa e precisa rolar sozinha
 * quando a lista de abas nao cabe -- e ela e' curta demais para isso acontecer, entao
 * o teto seria codigo morto.
 */

/**
 * `ui/` e' as janelas, que ja tem `max-height: 88vh` no esqueleto (ver `.modal-panel`
 * no app.css) e a lista interna cabe dentro disso. Fiscalizar a lista interna seria
 * exigir duas vezes a mesma regra.
 */
const FORA = new Set(['layout.ts']);


function arquivos(dir) {
    const saida = [];
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entrada.name);
        if (entrada.isDirectory()) saida.push(...arquivos(p));
        else if (entrada.name.endsWith('.ts')) saida.push(p);
    }
    return saida;
}

let problema = 0;
let comTeto = 0;
let semTeto = 0;

console.log('\n=== ALTURA FIXA OU AUSENTE EM LISTA (src/views) ===\n');

for (const arquivo of arquivos(VIEWS)) {
    const nome = path.basename(arquivo);
    const rel = path.relative(RAIZ, arquivo);
    if (FORA.has(nome) || rel.includes(`${path.sep}ui${path.sep}`)) continue;
    const texto = fs.readFileSync(arquivo, 'utf8');

    // Uma `class` por linha e' o formato do projeto; quando a classe quebra em
    // varias linhas, junta as linhas que comecam com espacos e so depois le.
    texto.split('\n').forEach((linha, i) => {
        if (!ROLAGEM.test(linha)) return;

        /*
         * `flex-1 min-h-0 overflow-y-auto` nao precisa de max-height: o limite vem
         * do pai, coluna flex de altura conhecida. E' o padrao do casco novo, e
         * resolve o carrinho do PDV, onde qualquer rem erra porque o de cima muda.
         */

        /*
         * Sem o `min-h-0` no meio do caminho o flex nao encolhe o item, ele prefere
         * a altura do conteudo. Por isso o verificador exige `flex-1` E `min-h-0`, e
         * nao um dos dois.
         */
        const porFlex = /\bflex-1\b/.test(linha) && /\bmin-h-0\b/.test(linha);
        if (porFlex) {
            comTeto++;
            return;
        }

        if (TETO_VIEWPORT.test(linha)) {
            comTeto++;
            return;
        }

        const fixo = linha.match(TETO_FIXO);
        if (fixo) {
            const valor = fixo[1];
            problema++;
            console.log(`  FALHA  ${rel}:${i + 1}  teto de ${valor} em lista com rolagem`);
            console.log(`         ${valor} cabe numa tela e nao na outra. Troque por max-h-[calc(100vh - <altura do que vem acima>)].`);
            return;
        }

        semTeto++;
        problema++;
        console.log(`  FALHA  ${rel}:${i + 1}  lista com rolagem e sem teto`);
        console.log(`         cresce com os dados: 40 pedidos viram uma coluna de tres metros. Defina max-h-[calc(100vh - ...)].`);
    });
}

console.log('');
console.log(`${comTeto} lista(s) com teto de viewport; ${problema} problema(s).`);

if (problema > 0) {
    console.log('Regra do painel: a tela cabe sem descer. Lista que rola e' + ' o lugar da rolagem -- a pagina nao.');
    process.exit(1);
}
console.log('Toda lista com rolagem tem teto de viewport.');
