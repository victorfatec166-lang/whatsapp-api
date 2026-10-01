#!/usr/bin/env node
/*
 * O montar.ps1 ficou commitado por semanas sem nunca ter rodado, e o motivo e' uma
 * palavra: apostrofa dentro de string de aspas simples. A aspas fecha em "que e'", o
 * resto da linha vira comando, e o arquivo inteiro para de fazer parse.
 */

/*
 * O git status mostrava o arquivo ali, normal, e o `npm run installer` e' que
 * reclamava. Como o instalador vinha sendo gerado a mao (pelo ISCC direto, num
 * terminal), mais ninguem rodou o script e mais ninguem viu o erro.
 */

/*
 * A consequencia foi maior que o script quebrado: o montar.ps1 gravava o
 * configurador em installer\dist\ e o DeliveryAdmin.iss lia de installer\build\. As
 * pontas nunca se encontraram, e a emenda so fechava com copia manual do arquivo.
 */

/*
 * Nenhum outro gate pegaria isso: o `tsc` nao ve PowerShell, o `check:js` ve o
 * JavaScript do painel, e nenhum teste roda o instalador. Este le cada .ps1 e passa
 * pelo construtor de AST do proprio PowerShell -- faz parse, nao executa.
 */

/*
 * Reprova, e nao avisa: um .ps1 que nao faz parse nao roda, e um .ps1 que nao roda
 * e' build quebrado, com a falha aparecendo so na hora de gerar a entrega. E e' rapido
 * de proposito -- gate que demora precisa ser rodado a mao.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PASTA = path.join(RAIZ, 'installer');

/** O comando que o build usa, e o que este script precisa ler. */
const POWERSHELL = 'powershell';

/**
 * O parse e' feito pelo proprio PowerShell, e nao por um pacote do npm, porque a
 * gramatica nao e' estavel entre versoes: uma regra aceita na 5.1 pode ser recusada
 * na 7. O interpretador da maquina responde a pergunta que importa -- "roda aqui?".
 */
function errosDeParse(caminho) {
    /*
     * ParseFile le do disco e devolve a AST sem executar uma linha. A primeira versao
     * mandava o texto pelo stdin, e `powershell -Command -` le o comando do stdin: o
     * texto a analisar virou codigo rodado, o ISCC disparou e o `npm install` junto.
     */

    /*
     * O caminho vai por variavel de ambiente para nao pedir aspas dentro da linha de
     * comando.
     */
    const comando =
        '$e = $null; ' +
        '[void][System.Management.Automation.Language.Parser]::ParseFile(' +
        '$env:PS1_ALVO, [ref]$null, [ref]$e); ' +
        'if ($e.Count) { $e | ForEach-Object { ' +
        '($_.Extent.StartLineNumber.ToString() + "`t" + $_.Message -replace "[\\r\\n]+", " ") } }';

    const saida = execFileSync(POWERSHELL, ['-NoProfile', '-Command', comando], {
        env: { ...process.env, PS1_ALVO: caminho },
        encoding: 'utf8',
        windowsHide: true,
    });

    // A mensagem do PowerShell pode ter quebra de linha dentro, e uma quebra
    // partiria a linha no meio e faria a proxima ser lida como se fosse outro
    // erro. Por isso o -replace acima, do lado do PowerShell.
    return saida
        .split(/\r?\n/)
        .map((linha) => linha.trim())
        .filter(Boolean)
        .map((linha) => {
            const sep = linha.indexOf('\t');
            return { linha: Number(linha.slice(0, sep)), mensagem: linha.slice(sep + 1) };
        });
}

function main() {
    if (!fs.existsSync(PASTA)) {
        console.log('  ok      scripts do instalador (pasta installer/ nao existe)');
        return 0;
    }

    const arquivos = fs
        .readdirSync(PASTA)
        .filter((nome) => nome.toLowerCase().endsWith('.ps1'))
        .sort();

    if (arquivos.length === 0) {
        console.log('  ok      scripts do instalador (nenhum .ps1 em installer/)');
        return 0;
    }

    let falha = 0;

    for (const nome of arquivos) {
        const completo = path.join(PASTA, nome);
        let erros;

        try {
            erros = errosDeParse(completo);
        } catch (e) {
            console.log(`  FALHA   ${nome}  (nao deu para conferir: ${e.message})`);
            falha++;
            continue;
        }

        if (erros.length === 0) {
            console.log(`  ok      ${nome}  (faz parse)`);
            continue;
        }

        // A primeira linha da frase e' a causa; as outras sao o eco. Mostrar
        // todas seria oito linhas de "falta }" para um unico ponto e.
        const primeira = erros[0];
        const eco = erros.length - 1;
        console.log(`  FALHA   ${nome}:${primeira.linha}  ${primeira.mensagem}`);
        if (eco > 0) {
            console.log(`          (e mais ${eco} erro(s) derivado(s) -- a causa e' a linha acima)`);
        }
        console.log("          Apostrofo dentro de string de aspas simples fecha a string e quebra o arquivo inteiro.");
        falha++;
    }

    if (falha > 0) {
        console.log('');
        console.log(`  ${falha} script(s) do instalador nao fazem parse e nao vao rodar.`);
    }

    return falha;
}

if (require.main === module) {
    process.exitCode = main() > 0 ? 1 : 0;
}

module.exports = { errosDeParse };
