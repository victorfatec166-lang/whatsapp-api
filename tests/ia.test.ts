/*
 * A IA extrai a intencao, e nao decide nada. Estes casos travaram a separacao:
 * e' o que impede o modelo de inventar um prato que o dono nao cadastrou, que
 * seria um jeito criativo de perder dinheiro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extraiComIa, iaLigada } from '../src/services/ia';
import type { ItemCatalogo } from '../src/services/entender';

const CATALOGO: ItemCatalogo[] = [
    { id: 'p1', nome: 'Coxinha de frango' },
    { id: 'p2', nome: 'Refrigerante lata' },
    {
        id: 'p3',
        nome: 'X-Burguer',
        grupos: [
            {
                id: 'g1',
                nome: 'Ponto da carne',
                maxSelect: 1,
                opcoes: [
                    { id: 'o1', nome: 'Mal passado' },
                    { id: 'o2', nome: 'Ao ponto' },
                ],
            },
        ],
    },
];

/** Servidor de mentira: guarda o corpo e devolve o que o teste mandar. */
function comResposta(resposta: unknown, status = 200) {
    const anterior = process.env.BOT_IA_CHAVE;
    const urlAnterior = process.env.BOT_IA_URL;
    process.env.BOT_IA_CHAVE = 'chave-de-teste';
    process.env.BOT_IA_URL = 'http://127.0.0.1:9/v1/chat/completions';

    const global = globalThis as unknown as { fetch: typeof fetch };
    const real = global.fetch;
    global.fetch = (async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: resposta } }] }), {
            status,
            headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch;

    return async () => {
        global.fetch = real;
        if (anterior === undefined) delete process.env.BOT_IA_CHAVE;
        else process.env.BOT_IA_CHAVE = anterior;
        if (urlAnterior === undefined) delete process.env.BOT_IA_URL;
        else process.env.BOT_IA_URL = urlAnterior;
    };
}

test('sem chave a IA nao liga, e o bot fica so nas regras', async () => {
    const anterior = process.env.BOT_IA_CHAVE;
    delete process.env.BOT_IA_CHAVE;

    assert.equal(iaLigada(), false);
    assert.equal(await extraiComIa('coxinha de frango', CATALOGO), null);

    if (anterior !== undefined) process.env.BOT_IA_CHAVE = anterior;
});

test('BOT_IA=off desliga mesmo com a chave no lugar', () => {
    process.env.BOT_IA_CHAVE = 'chave';
    process.env.BOT_IA = 'off';
    assert.equal(iaLigada(), false);
    delete process.env.BOT_IA;
});

test('o nome que o modelo devolve vira o produto do catalogo, com o preco fora', async () => {
    const restaurar = await comResposta(
        JSON.stringify({ itens: [{ nome: 'Coxinha de frango', qtd: 3, modificadores: [] }], naoEntendidos: [] })
    );
    try {
        const r = await extraiComIa('me manda umas coxinha de frango', CATALOGO);
        assert.ok(r, 'a IA devolveu intencao');
        assert.equal(r.itens.length, 1);
        assert.equal(r.itens[0].id, 'p1', 'o id vem do catalogo, nunca do modelo');
        assert.equal(r.itens[0].qtd, 3);
    } finally {
        await restaurar();
    }
});

test('produto que o dono nao cadastrou nao vira item, vira naoEntendidos', async () => {
    // Este e' o teste que segura a promessa do modulo: um nome inventado pelo
    // modelo viraria uma linha que a cozinha nunca produziu.
    const restaurar = await comResposta(
        JSON.stringify({ itens: [{ nome: 'Pizza de quatro queijos', qtd: 1 }], naoEntendidos: [] })
    );
    try {
        const r = await extraiComIa('me manda uma pizza', CATALOGO);
        assert.equal(r, null, 'sem item valido a IA nao tem o que devolver');
    } finally {
        await restaurar();
    }
});

test('modificador sai do grupo do produto, com o id do catalogo', async () => {
    const restaurar = await comResposta(
        JSON.stringify({ itens: [{ nome: 'X-Burguer', qtd: 1, modificadores: ['Ao ponto'] }], naoEntendidos: [] })
    );
    try {
        const r = await extraiComIa('xburguer ao ponto', CATALOGO);
        assert.ok(r);
        assert.deepEqual(r.itens[0].modificadores.g1, ['o2'], "o id do modificador tambem e' do catalogo");
    } finally {
        await restaurar();
    }
});

test('resposta fora do formato vira "nao entendi", e nao item pela metade', async () => {
    const restaurar = await comResposta('desculpe, nao posso ajudar com isso');
    try {
        assert.equal(await extraiComIa('quero um lanche', CATALOGO), null);
    } finally {
        await restaurar();
    }
});

test('JSON embrulhado em cerca de codigo ainda vale', async () => {
    // Metade dos modelos devolve ```json. Sem tirar a cerca, o parse falhava e a
    // frase boa do cliente virava "nao entendi".
    const restaurar = await comResposta(
        '```json\n{"itens":[{"nome":"Refrigerante lata","qtd":2}],"naoEntendidos":[]}\n```'
    );
    try {
        const r = await extraiComIa('duas lata de refri', CATALOGO);
        assert.ok(r);
        assert.equal(r.itens[0].id, 'p2');
        assert.equal(r.itens[0].qtd, 2);
    } finally {
        await restaurar();
    }
});

test('servico fora do ar devolve null, e nao derruba o atendimento', async () => {
    const anterior = process.env.BOT_IA_CHAVE;
    const urlAnterior = process.env.BOT_IA_URL;
    process.env.BOT_IA_CHAVE = 'chave-de-teste';
    // Porta 9 e' o descarte: conexao recusada na hora, sem esperar timeout.
    process.env.BOT_IA_URL = 'http://127.0.0.1:9/v1/chat/completions';

    const global = globalThis as unknown as { fetch: typeof fetch };
    const real = global.fetch;
    global.fetch = real; // fetch de verdade, contra a porta fechada

    try {
        assert.equal(await extraiComIa('quero um lanche da tarde', CATALOGO), null);
    } finally {
        if (anterior === undefined) delete process.env.BOT_IA_CHAVE;
        else process.env.BOT_IA_CHAVE = anterior;
        if (urlAnterior === undefined) delete process.env.BOT_IA_URL;
        else process.env.BOT_IA_URL = urlAnterior;
    }
});