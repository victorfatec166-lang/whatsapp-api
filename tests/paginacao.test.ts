/*
 * Paginacao do historico de conversa.
 *
 * Por que precisa de teste, e nao pode ser so logica pura
 *
 * A janela de paginacao tem tres estados que so aparecem juntos: `take` com
 * `orderBy desc` para pegar o fim da conversa, `lt` estrito no cursor para nao
 * repetir a mensagem da borda, e a inversao para exibicao. Cada um passa
 * sozinho e o conjunto passa errado -- e o erro aparece como uma mensagem
 * duplicada ou faltando no meio da conversa do cliente, que ninguem nota ate
 * procurar por ela.
 *
 * Este teste escreve no banco de verdade, com 250 mensagens, e apaga tudo no
 * fim. Nao envia nada pelo WhatsApp: grava direto na base, entao a loja real
 * nao ve nada.
 *
 * Precisa do servidor rodando e do banco com a migration do Chat aplicada.
 * Quando o servidor nao responde, o teste avisa e falha -- nao da verde falso.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';

// A sessao de teste e' o mesmo login que o navegador faz -- nenhum bypass, e a
// conta e' de operador. Ver o porque em scripts/lib/sessaoDeTeste.cjs.
const { sessaoDeTeste } = createRequire(import.meta.url)('./../scripts/lib/sessaoDeTeste.cjs');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const JID = '5500000000000@teste-paginacao';
const TOTAL = 250;
const PAGINA = 100;

const prisma = new PrismaClient();

/** Cabecalho de cookie da sessao, montado no primeiro uso. */
let cookie: string | undefined;
async function sessao(): Promise<string> {
    if (!cookie) cookie = (await sessaoDeTeste()).Cookie;
    return cookie;
}

type Mensagem = { text: string; sentAt: string };
type Pagina = { mensagens: Mensagem[]; temMais: boolean };

/** Semeia TOTAL mensagens com um minuto de intervalo, e devolve o id da conversa. */
async function semeia(): Promise<string> {
    await prisma.chat.deleteMany({ where: { phone: JID } });
    const chat = await prisma.chat.create({
        data: { phone: JID, name: 'Cliente de Teste', telefone: '5500000000000' },
    });

    const base = Date.now() - TOTAL * 60_000;
    const linhas = Array.from({ length: TOTAL }, (_, i) => ({
        chatId: chat.id,
        from: i % 3 === 0 ? 'cliente' : 'atendente',
        text: `mensagem ${i + 1}`,
        sentAt: new Date(base + i * 60_000),
    }));
    // createMany respeita o limite de variaveis do SQLite, entao vai em lotes.
    for (let i = 0; i < linhas.length; i += 100) {
        await prisma.message.createMany({ data: linhas.slice(i, i + 100) });
    }
    return chat.id;
}

async function pegaPagina(id: string, antes?: string): Promise<Pagina> {
    const url = antes ? `${BASE}/api/admin/chat/${id}?antes=${encodeURIComponent(antes)}` : `${BASE}/api/admin/chat/${id}`;
    const r = await fetch(url, { headers: { Cookie: await sessao() } });
    if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
    return (await r.json()) as Pagina;
}

test('paginacao do historico', async (t) => {
    // Servidor fora do ar: avisar e falhar. Um teste que pula silencioso
    // quando o servidor nao subiu e' um teste que nunca roda.
    try {
        await fetch(`${BASE}/api/bot-status`);
    } catch {
        assert.fail(`Servidor nao responde em ${BASE}. Suba com "npm start" antes de "npm test".`);
    }

    const id = await semeia();
    t.after(async () => {
        await prisma.chat.deleteMany({ where: { phone: JID } });
        await prisma.$disconnect();
    });

    await t.test('primeira pagina traz o fim da conversa, nao o comeco', async () => {
        const p = await pegaPagina(id);
        assert.equal(p.mensagens.length, PAGINA);
        assert.equal(p.temMais, true);
        // A conversa esta no fim: quem atende abre a tela para o que acabou de
        // acontecer. Abrir no "oi" de tres dias atras obriga a rolar ate o fim.
        assert.equal(p.mensagens[0].text, `mensagem ${TOTAL - PAGINA + 1}`);
        assert.equal(p.mensagens[PAGINA - 1].text, `mensagem ${TOTAL}`);
    });

    await t.test('a pagina esta em ordem cronologica', async () => {
        const p = await pegaPagina(id);
        const d = p.mensagens.map((m) => new Date(m.sentAt).getTime());
        for (let i = 1; i < d.length; i++) {
            assert.ok(d[i] >= d[i - 1], `fora de ordem na posicao ${i}`);
        }
    });

    await t.test('o cursor e estrito e nao repete a mensagem da borda', async () => {
        const p1 = await pegaPagina(id);
        const p2 = await pegaPagina(id, p1.mensagens[0].sentAt);
        assert.equal(p2.mensagens.length, PAGINA);
        // `lt` estrito sobre o inicio da pagina 1 pega o bloco anterior inteiro.
        // Com `lte`, a mensagem 151 entraria duas vezes.
        assert.equal(p2.mensagens[0].text, `mensagem ${TOTAL - 2 * PAGINA + 1}`);
        assert.equal(p2.mensagens[PAGINA - 1].text, `mensagem ${TOTAL - PAGINA}`);
    });

    await t.test('a ultima pagina avisa que nao ha mais', async () => {
        let cursor: string | undefined;
        let ultima: Pagina | undefined;
        for (let i = 0; i < 10; i++) {
            ultima = await pegaPagina(id, cursor);
            if (!ultima.temMais) break;
            cursor = ultima.mensagens[0].sentAt;
        }
        assert.ok(ultima, 'nenhuma pagina lida');
        assert.equal(ultima.temMais, false);
        assert.equal(ultima.mensagens[0].text, 'mensagem 1');
    });

    await t.test('as paginas cobrem a conversa inteira, sem buraco nem repetida', async () => {
        const paginas: Pagina[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < 10; i++) {
            const p = await pegaPagina(id, cursor);
            paginas.push(p);
            if (!p.temMais) break;
            cursor = p.mensagens[0].sentAt;
        }

        const todas = paginas.flatMap((p) => p.mensagens).map((m) => m.text);
        assert.equal(todas.length, TOTAL, 'total de mensagens devolvidas');
        assert.equal(new Set(todas).size, TOTAL, 'houve mensagem repetida');

        // Cada bloco vem do mais novo para o mais velho, e os blocos vem na
        // ordem inversa. Juntando ao contrario e' que a conversa aparece inteira.
        const emOrdem = [...paginas].reverse().flatMap((p) => p.mensagens).map((m) => m.text);
        for (let i = 0; i < TOTAL; i++) {
            assert.equal(emOrdem[i], `mensagem ${i + 1}`, `buraco ou troca na posicao ${i}`);
        }
    });

    await t.test('data invalida no cursor nao derruba a rota', async () => {
        const p = await pegaPagina(id, 'lixo');
        assert.equal(p.mensagens.length, PAGINA, 'cai na primeira pagina');
    });
});
