#!/usr/bin/env node
/*
 * Confere a sintaxe do JavaScript que o painel entrega ao navegador.
 *
 * Por que isso existe
 *
 * O painel e' HTML montado no servidor, com o comportamento de cada aba num
 * <script> escrito dentro de um template literal do TypeScript. Duas camadas de
 * escape separam o codigo do arquivo .ts do codigo que o navegador executa, e
 * as duas falham em silencio:
 *
 *   1. Um `\\"` escrito no .ts vira aspas simples no HTML. A string JS fecha
 *      mais cedo, o resto da linha vira lixo, e o bloco INTEIRO deixa de fazer
 *      parse. No navegador isso nao aparece: o console mostra o erro, a tela
 *      continua pintada e so o comportamento morre. Foi assim que a lista de
 *      conversas deixou de responder ao clique.
 *   2. Um backtick dentro de um comentario, dentro do template literal, fecha a
 *      string do TypeScript -- e o `tsc` aponta, mas a mensagem aponta a linha
 *      errada.
 *
 * O `tsc` nao pega nenhum dos dois: ele valida o arquivo .ts, nao o texto que
 * sai dele. So quem le o HTML entregue ve o problema.
 *
 * O que ele faz: pede cada aba ao servidor rodando, extrai os <script> e passa
 * cada um pelo construtor de funcao do proprio Node. `new Function(codigo)` faz
 * parse sem executar, entao nenhum handler roda aqui.
 *
 * Nao substitui teste de navegador. Pega a classe de erro que impede a tela de
 * funcionar, que e' a que passa mais despercebida.
 *
 * A SEGUNDA PARTE: atributo sem handler
 *
 * Sintaxe ok nao quer dizer botao funcionando. Houve um dia em que o PDV inteiro
 * ficou inerte -- clicar no produto nao acrescentava nada, o "+" e o "-" do
 * carrinho nao faziam nada, o troco nao recalculava -- e nada acusou: o `tsc`
 * passava, este script aqui passava (a sintaxe estava perfeita), o `check:ui`
 * passava (os rotulos estavam certos). A tela abria bonita e morta. O commit que
 * causou isso reescreveu a tela e levou o listener de delegacao junto, sem
 * nenhum sinal de que aquilo era comportamento.
 *
 * Entao, alem da sintaxe, este script confere se cada atributo `data-*` que o
 * HTML entrega e' lido por algum script da propria pagina. A regra e' simples e
 * tem um caso de falso positivo conhecido, tratado la embaixo: atributo que
 * ninguem le e' botao sem funcao.
 */
const http = require('node:http');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

/** Abas cujo script vale checar. Cobrir todas e' o ideal; a ordem e' a de uso. */
const ABAS = ['home', 'chat', 'config', 'marketplace', 'whatsapp', 'faturamento', 'estoque', 'pdv', 'kanban', 'calendario'];

function pegar(caminho) {
    return new Promise((resolve, reject) => {
        http
            .get(BASE + caminho, (res) => {
                let corpo = '';
                res.on('data', (d) => (corpo += d));
                res.on('end', () => resolve(corpo));
            })
            .on('error', reject);
    });
}

/** Reconta a linha do erro, que vem como deslocamento dentro do bloco. */
function suspecta(codigo, nome) {
    const linhas = codigo.split('\n');
    for (let i = 0; i < linhas.length; i++) {
        if (linhas[i].includes('onerror') || linhas[i].includes('<<<') || linhas[i].includes('@@@')) {
            console.log(`        linha ${i + 1}: ${linhas[i].trim().slice(0, 110)}`);
        }
    }
}

/**
 * Atributos `data-*` que aparecem no HTML e nao sao lidos por nenhum script.
 *
 * O nome no HTML vem em duas grafias e o script costuma ler so uma delas: o
 * `dataset` do navegador converte o hífen em maiúscula (`data-cart-inc` vira
 * `dataset.cartInc`), e a busca no texto do código acha qualquer uma das duas.
 * Por isso a comparação ignora o hífen e a caixa.
 *
 * O que NAO entra na conta, para o verificador não virar barulho:
 *
 *   - `data-modal-cancel`: é lido pelo behavior de janelas, que está no script
 *     do layout -- em todas as abas, e nem toda aba o inclui no proprio
 *     <script>. E `data-*` de comportamento, não de dado.
 *   - atributos que são só marcação semântica para leitor de tela e estilização.
 *   - `data-href` e afins: ligada por atributo, não por JavaScript.
 */
const NAO_CHECAR = new Set(['modal-cancel', 'href', 'target', 'label', 'value']);

function atributosDataNaoLidos(html, codigo) {
    const noHtml = new Set();
    for (const m of html.matchAll(/\sdata-([a-z0-9-]+)\s*=/gi)) {
        noHtml.add(m[1].toLowerCase());
    }

    // O script é procurado com o hífen removido, porque é assim que o
    // `dataset` entrega o nome. E o atributo tambem: `data-cart-inc` no HTML
    // e' `dataset.cartInc` no script, e as duasformas precisam chegar na mesma
    // string antes de comparar.
    const codigoSemHifen = codigo.replace(/-/g, '').toLowerCase();

    const orphans = [];
    for (const attr of noHtml) {
        if (NAO_CHECAR.has(attr)) continue;
        if (codigoSemHifen.includes(attr.replace(/-/g, ''))) continue;
        orphans.push(attr);
    }
    return [...orphans].sort();
}

async function main() {
    let falha = 0;
    let totalBlocos = 0;

    for (const aba of ABAS) {
        let html;
        try {
            html = await pegar(`/admin?tab=${aba}`);
        } catch (e) {
            console.log(`  ERRO    ${aba}: servidor nao respondeu (${e.message})`);
            falha++;
            continue;
        }

        const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

        /*
         * Script externo entra na conta tambem.
         *
         * O calendario e' o unico caso de script servido por rota, e ele nao
         * estava sendo conferido: a aba passava por estar "ok" com dois blocos
         * inline perfeitos, enquanto o arquivo de verdade -- o que desenha a
         * grade e responde ao clique no dia -- podia estar com erro de sintaxe e
         * ninguem ver. Verificador que so olha metade do que a pagina entrega
         * da verde falso no que ele nao cobre.
         */
        const externos = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
        for (const src of externos) {
            try {
                blocos.push(await pegar(src));
            } catch (e) {
                console.log(`  ERRO    ${aba}: nao foi possivel baixar ${src} (${e.message})`);
                falha++;
            }
        }

        totalBlocos += blocos.length;
        const ruins = [];

        blocos.forEach((codigo, i) => {
            try {
                new Function(codigo);
            } catch (e) {
                ruins.push({ i, e, codigo });
            }
        });

        if (ruins.length === 0) {
            console.log(`  ok      ${aba}  (${blocos.length} bloco(s))`);
        } else {
            falha++;
            console.log(`  FALHA   ${aba}  (${ruins.length} de ${blocos.length} bloco(s) nao fazem parse)`);
            for (const r of ruins) {
                console.log(`        bloco ${r.i}: ${r.e.message}`);
                suspecta(r.codigo, aba);
            }
        }

        /*
         * Sintaxe ok e' precondicao para a parte de atributo: um bloco que nao
         * faz parse pode "nao usar" um atributo so porque morreu no meio, e
         * acusar o atributo em vez do parse seria apontar o sintoma.
         */
        if (ruins.length === 0) {
            const orphans = atributosDataNaoLidos(html, blocos.join('\n'));
            if (orphans.length > 0) {
                falha++;
                console.log(`  FALHA   ${aba}  (${orphans.length} atributo(s) data-* sem handler)`);
                console.log(`        ${orphans.join(', ')}`);
                console.log('        atributo data-* que ninguem le = botao sem funcao. O painel abre, e o clique nao faz nada.');
            }
        }
    }

    console.log('');
    if (falha > 0) {
        console.log(`${falha} problema(s). O painel pode pintar certo e nao responder.`);
        process.exitCode = 1;
    } else {
        console.log(`${ABAS.length} aba(s), ${totalBlocos} bloco(s) de script: sintaxe ok e todo data-* tem handler.`);
    }
}

main();
