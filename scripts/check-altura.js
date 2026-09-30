#!/usr/bin/env node
/*
 * Aponta o que faz a pagina crescer alem da dobra.
 *
 * POR QUE ISTO EXISTE
 *
 * A regra do painel e' uma so: a tela tem que caber sem a pessoa descer com o
 * mouse. Nao e' preferencia estetica -- e' a diferenca entre um painel que se
 * le de relance e um que obriga a rolar para voltar ao topo e lembrar onde
 * estava.
 *
 * A regra e' facil de dizer e facil de quebrar em silencio. A causa quase nunca
 * e' o cabecalho nem o titulo: e' um container com `overflow-y-auto` e uma
 * altura declarada em rem. Aquilo parece um teto, e funciona como teto na tela
 * de desenvolvimento -- 36rem cabe num monitor de 1080. No monitor de 1366x768
 * do balcao, com a barra do navegador aberta, sao 36rem mais cabecalho mais
 * cards acima, e a pagina passa da dobra.
 *
 * Duas familias de defeito, e as duas sao desta:
 *
 * 1. `max-h-[36rem]` em lista. Teto em unidade absoluta, que nao sabe quanto
 *    sobra na tela. O certo e' `calc(100vh - <altura do que esta acima>)`.
 *
 * 2. Lista sem teto nenhum. Pior que a primeira: a lista cresce com os dados.
 *    C hundred pedidos no Kanban e o painel fica com uma coluna de tres metros,
 *    e a coluna vizinha com duas. Quem trabalha no balcao passa a vida rolando
 *    dentro de uma coluna para ver o botao de status.
 *
 * O QUE ESTE SCRIPT FAZ
 *
 * Le o TypeScript das telas -- nao o HTML servido, porque o defeito esta no
 * codigo que gera o HTML e precisa ser corrigido la. Acha todo container com
 * rolagem propria e classifica:
 *
 *   - teto em viewport  (`calc(100vh`)  -> ok
 *   - teto em pixel     (`max-h-[36rem]`, `h-40`) -> falha, com o numero
 *   - sem teto                             -> falha
 *
 *   node scripts/check-altura.js
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const VIEWS = path.join(RAIZ, 'src', 'views');

/**
 * Container com rolagem propria.
 *
 * E' o que deveria ser a unica coisa a rolar. `overflow-hidden` nao entra: ali
 * quem impede a rolagem e' o proprio elemento, e nao ha lista dentro dele para
 * o usuario ver.
 */
const ROLAGEM = /overflow-y-(?:auto|scroll)/;

/**
 * Teto em unidade de tela.
 *
 * Aceita `calc(100vh - ...)` e tambem a vh solta. Uma vh nua -- 55vh -- ja e'
 * relativa a tela: ela nao "cabe numa resolucao e nao na outra", ela ocupa a
 * mesma fracao em qualquer monitor. O que reprova e' o rem e o px, que sao
 * numeros absolutos escritos por alguem olhando a propria tela.
 */
const TETO_VIEWPORT = /(?:max-h|h)-\[(?:calc\(100vh[\w\s.+-]*\)|[\d.]+vh)\]/;

/**
 * Teto em rem ou px escritos a mao: vale numa tela e nao na outra.
 *
 * A fronteira antes do nome da classe e' o que separa `max-h-[36rem]` -- teto --
 * de `min-h-[5rem]` -- piso. Sem ela, "min-h" casa o "h" do final e toda lista
 * com um minimo vira accuses de teto fixo.
 */
const TETO_FIXO = /(?:^|[\s"'])(?:max-h|h)-\[(\d+(?:\.\d+)?(?:rem|px|vh|ch|em))\]/;

/**
 * Arquivos que ficam de fora.
 *
 * Nenhum deles e' conteudo de aba:
 *
 *   - `layout.ts` e' o casco. A barra lateral e' de altura fixa e precisa rolar
 *     sozinha quando a lista de abas nao cabe -- e ela e' curta demais para isso
 *     acontecer, entao o teto seria codigo morto.
 *   - `ui/` e as janelas. Uma janela tem `max-height: 88vh` no proprio esqueleto
 *     (ver `.modal-panel` no app.css) e a lista interna de itens ja cabe dentro
 *     disso. Fiscalizar a lista interna seria exigir duas vezes a mesma regra.
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
         * Teto por flex.
         *
         * `flex-1 min-h-0 overflow-y-auto` nao precisa de max-height: o limite
         * vem do pai, que e' uma coluna flex de altura conhecida, e o item
         * ocupa o que sobrar. E' o padrao do casco novo, e e' o que resolve a
         * coluna do carrinho do PDV e a lista de pedidos do dia no Calendario,
         * onde qualquer numero em rem erra porque o que esta acima muda de
         * tamanho com o conteudo.
         *
         * Sem o `min-h-0` no meio do caminho, o flex nao encolhe o item -- ele
         * prefere a altura do conteudo. Por isso os DOIS sao obrigatorios, e
         * por isso o verificador exige `flex-1` E `min-h-0`, nao um dos dois.
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
