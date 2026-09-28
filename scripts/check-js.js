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
    }

    console.log('');
    if (falha > 0) {
        console.log(`${falha} aba(s) com script invalido. O painel pode pintar certo e nao responder.`);
        process.exitCode = 1;
    } else {
        console.log(`${ABAS.length} aba(s), ${totalBlocos} bloco(s) de script: sintaxe ok.`);
    }
}

main();
