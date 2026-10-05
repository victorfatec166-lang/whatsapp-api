#!/usr/bin/env node
/*
 * Nada de comentario no HTML servido: quem abre o "ver fonte" nao deveria ler anotacao
 * de quem mexe no codigo. O filtro mora em `src/views/html.ts` (`semComentarios`), e
 * conferir no fonte nao bastaria -- o filtro pode regredir e o `tsc` nao ve HTML.
 */

const http = require('node:http');
const { sessaoDeTeste } = require('./lib/sessaoDeTeste.cjs');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

/** Telas do painel, com as sub-abas do Faturamento. */
const ABAS = [
    'home', 'chat', 'config', 'marketplace', 'whatsapp',
    'faturamento', 'estoque', 'pdv', 'kanban', 'calendario', 'usuarios',
];
const VARIACOES = { faturamento: ['resumo', 'caixa', 'clientes', 'pedidos'] };

/** Telas de entrada: nao precisam de sessao e por isso entram fora da lista de abas. */
const PUBLICAS = ['/entrar', '/sobre', '/ajuda', '/recuperar-senha', '/criar-conta', '/primeiro-acesso'];

let cookieSessao = '';

function pegar(caminho) {
    return new Promise((resolve, reject) => {
        const opcoes = cookieSessao ? { headers: { Cookie: cookieSessao } } : undefined;
        http
            .get(BASE + caminho, opcoes, (res) => {
                let corpo = '';
                res.on('data', (d) => (corpo += d));
                res.on('end', () => resolve(corpo));
            })
            .on('error', reject);
    });
}

/**
 * Uma linha que so' e' comentario quando esta DENTRO de um script.
 *
 * O `//` do protocolo de uma URL esta no meio da linha e nunca na comeco: e' o filtro
 * que poderia trocar o endereco do painel por outra pagina em producao.
 */
function comentarioDeScript(corpo) {
    const achados = [];
    for (const bloco of corpo.matchAll(new RegExp('<script\\b[^>]*>([\\s\\S]*?)</' + 'script>', 'gi'))) {
        let dentroDeBloco = false;
        bloco[1].split('\n').forEach((linha, i) => {
            const t = linha.trim();
            if (dentroDeBloco) {
                achados.push(`bloco em ${i + 1}: ${t.slice(0, 60)}`);
                if (t.includes('*/')) dentroDeBloco = false;
                return;
            }
            if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) {
                achados.push(`linha ${i + 1}: ${t.slice(0, 60)}`);
                if (t.startsWith('/*') && !t.includes('*/')) dentroDeBloco = true;
            }
        });
    }
    return achados;
}

function verifica(html, nome) {
    const problemas = [];
    const comentarios = html.match(new RegExp('<!--[\\s\\S]*?-->', 'g'));
    for (const c of comentarios || []) {
        problemas.push(`comentario de HTML: ${c.replace(/\s+/g, ' ').slice(0, 60)}`);
    }
    for (const achado of comentarioDeScript(html)) problemas.push(`comentario de script -- ${achado}`);
    return { nome, problemas };
}

async function main() {
    let pronto = false;
    for (let tentativa = 0; tentativa < 15; tentativa++) {
        try {
            await fetch(`${BASE}/api/bot-status`);
            pronto = true;
            break;
        } catch {
            await new Promise((r) => setTimeout(r, 500));
        }
    }
    if (!pronto) {
        console.log(`ERRO: servidor nao respondeu em ${BASE} depois de 7s.`);
        console.log('      Suba com "npm start" e rode de novo.');
        process.exitCode = 1;
        return;
    }

    try {
        const sessao = await sessaoDeTeste();
        cookieSessao = sessao.Cookie;
    } catch (e) {
        console.log(`ERRO: nao foi possivel entrar (${e.message}).`);
        process.exitCode = 1;
        return;
    }

    let total = 0;
    const telas = [];
    for (const caminho of PUBLICAS) telas.push(caminho);
    for (const aba of ABAS) {
        for (const variacao of VARIACOES[aba] || [null]) {
            telas.push('/admin?tab=' + aba + (variacao ? `&aba=${variacao}` : ''));
        }
    }
    // A pagina de erro tambem e' saida de HTML: 404 precisa responder igual as demais.
    telas.push('/pagina-que-nao-existe-para-o-gate');

    for (const caminho of telas) {
        let html;
        try {
            html = await pegar(caminho);
        } catch (e) {
            console.log(`  ERRO    ${caminho}: ${e.message}`);
            total++;
            continue;
        }
        const { nome, problemas } = verifica(html, caminho);
        if (problemas.length === 0) {
            console.log(`  ok      ${nome}`);
        } else {
            total += problemas.length;
            console.log(`  ${String(problemas.length).padStart(3)}x    ${nome}`);
            for (const p of problemas.slice(0, 5)) console.log(`         - ${p}`);
        }
    }

    console.log('');
    if (total === 0) {
        console.log('HTML servido sem comentario, em tela do painel, de entrada e de erro.');
    } else {
        console.log(`${total} comentario(s) no HTML servido.`);
        console.log('O filtro esta em src/views/html.ts (semComentarios). O que ele nao pega');
        console.log('e' + ' comentario DENTRO de uma tag, ou dentro de um atributo.');
        process.exitCode = 1;
    }
}

main();
