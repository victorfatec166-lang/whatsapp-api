/*
 * Guard de rota: nenhuma rota de painel responde sem sessao.
 *
 * As tres que vazavam estavam no `server.ts`, fora do `/api/admin` protegido. A
 * segunda devolvia o QR do WhatsApp, que nao expira: dava para parear a loja.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import calendarioRoutes from '../src/routes/calendarioRoutes';

/** Rotas do calendario que devolvem dado do dono. */
const DO_CALENDARIO = ['/api/calendar/orders', '/api/calendar/lembretes?mes=2026-10'];

const RAIZ = join(__dirname, '..');
const servidorTexto = readFileSync(join(RAIZ, 'src', 'server.ts'), 'utf8');
const sistemaTexto = readFileSync(join(RAIZ, 'src', 'routes', 'sistemaRoutes.ts'), 'utf8');
const calendarioTexto = readFileSync(join(RAIZ, 'src', 'routes', 'calendarioRoutes.ts'), 'utf8');

/** Sobe um router e devolve a base. `listen(0)` escolhe porta livre, sem conflito. */
async function com(router: express.Router): Promise<{ base: string; fecha: () => Promise<void> }> {
    const app = express();
    app.use(express.json());
    app.use(router);
    const servidor = app.listen(0);
    const porta = (servidor.address() as AddressInfo).port;
    return {
        base: `http://127.0.0.1:${porta}`,
        fecha: () => new Promise<void>((ok) => servidor.close(() => ok())),
    };
}

test('calendarioRoutes: nada responde sem sessao', async () => {
    const { base, fecha } = await com(calendarioRoutes);
    try {
        for (const rota of DO_CALENDARIO) {
            const r = await fetch(base + rota);
            assert.equal(r.status, 401, `${rota} respondeu ${r.status} sem sessao`);
        }
    } finally {
        await fecha();
    }
});

/*
 * As rotas do bot ficam fora do teste de HTTP: `sistemaRoutes.ts` importa
 * `services/bot.ts`, que carrega o `whatsapp-rust-bridge` (ESM-only, que o runner
 * CommonJS nao resolve). Aqui a guarda e' conferida no texto da rota.
 */
test('as rotas do QR e do estado do WhatsApp declaram a guarda de sessao', () => {
    for (const rota of ['/api/bot/connection', '/api/bot/qr.svg']) {
        const linha = sistemaTexto.slice(sistemaTexto.indexOf(`'${rota}'`));
        const trecho = linha.slice(0, linha.indexOf(');'));
        assert.ok(trecho.length > 0, `${rota} nao existe em sistemaRoutes.ts`);
        assert.ok(/sessao/.test(trecho), `${rota} sem \`sessao\` -- voltaria a vazar`);
        assert.ok(/csrf/.test(trecho), `${rota} sem \`csrf\``);
    }
});

test('nenhuma das rotas protegidas ficou registrada no server.ts', () => {
    // As rotas inline do `server.ts` nao tem guarda: e' ali que as tres vazaram.
    // O `fetch` do JS do calendario pode -- e deve -- citar o endereco, entao o que
    // se procura e' o registro (`app.get('...')`), nao a occurrence.
    for (const rota of ['/api/bot/connection', '/api/bot/qr.svg', '/api/calendar/orders']) {
        const registrada = new RegExp(`app\\.(get|post|use)\\s*\\(\\s*['"\`]${rota}`).test(servidorTexto);
        assert.ok(
            !registrada,
            `${rota} voltou a ser registrada no server.ts, fora do app.use que exige sessao`
        );
    }
});

/**
 * O calendario passou a devolver so o que a grade desenha: contagem e receita. Se o
 * pedido inteiro voltar a entrar no `select` -- nome, telefone, itens -- e' este
 * teste que grita. A tela so le `count` e `totalRevenue`.
 */
test('o calendario nao pede o pedido inteiro, so o que a grade desenha', () => {
    const trecho = calendarioTexto.slice(calendarioTexto.indexOf("/api/calendar/orders"));

    for (const campo of ['clientName', 'clientPhone', 'items']) {
        assert.ok(
            !new RegExp(`select:\\s*\\{[^}]*${campo}`).test(trecho),
            `o calendario nao deve pedir ${campo} no select -- a tela so usa count e totalRevenue`
        );
    }

    // E o filtro de loja tem que vir do Prisma com tenant, nao do cliente cru.
    // O import fica no topo do arquivo, entao a checagem e' no arquivo inteiro --
    // mas o `prisma` CRU e' o que a rota antiga usava.
    assert.ok(
        /import\s*\{\s*prismaComLoja\s+as\s+prisma\s*\}/.test(calendarioTexto),
        'a rota do calendario precisa do Prisma com loja, nao do cliente cru'
    );
    assert.ok(
        !/import\s*\{\s*prisma\s*\}\s*from\s*'\.\.\/database\/prisma'/.test(calendarioTexto),
        'a rota do calendario nao pode usar o cliente cru: sem filtro de loja'
    );
});