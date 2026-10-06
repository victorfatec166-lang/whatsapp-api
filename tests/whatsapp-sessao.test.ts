/*
 * Uma sessao por LOJA e por instalacao, e nao um arquivo por servidor: sem isso o
 * WhatsApp do SaaS era um so, e o segundo cliente assinante nao tinha numero. O codec
 * entra por parametro porque o Baileys e' ESM sem `require` e quebraria o runner.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prisma } from '../src/database/prisma';
import {
    apagaSessao,
    estadoDaSessao,
    idDaInstalacao,
    outraInstalacaoComSessao,
    type CodecsDaSessao,
} from '../src/services/whatsappSessao';

const LOJA = 'loja-sessao-teste';
const MAQUINA = 'teste-maquina-1';
const OUTRA = 'teste-maquina-2';

/**
 * O mesmo formato do `BufferJSON` do Baileys, sem depender da biblioteca. O
 * `v?.type === 'Buffer'` nao e' redundante: o `JSON.stringify` chama o `toJSON` do
 * Buffer antes do replacer, entao o replacer ve o objeto que o `toJSON` montou.
 */
const codecs: CodecsDaSessao = {
    credsVazios: () => ({ noiseKey: { private: Buffer.from([1]) }, registered: false }) as any,
    serializa: (valor) =>
        JSON.stringify(valor, (_chave, v) =>
            Buffer.isBuffer(v) || v instanceof Uint8Array || (v && v.type === 'Buffer')
                ? { type: 'Buffer', data: Buffer.from(v.data || v).toString('base64') }
                : v
        ),
    desserializa: (texto) =>
        JSON.parse(texto, (_chave, v) =>
            v && typeof v === 'object' && v.type === 'Buffer' && typeof v.data === 'string'
                ? Buffer.from(v.data, 'base64')
                : v
        ),
    preparar: (tipo, valor) =>
        tipo === 'app-state-sync-key' && valor ? { ...valor, classeDoProto: true } : valor,
};

function listaDaPasta(pasta: string): string[] {
    try {
        return readdirSync(pasta);
    } catch {
        return [];
    }
}

async function garanteLoja(): Promise<void> {
    await prisma.tenant.create({ data: { id: LOJA, name: LOJA, ativo: true } }).catch(() => {});
}

/*
 * A pasta de sessao de verdade fica fora daqui desde o primeiro teste: sem isso o
 * store importava a sessao real do WhatsApp desta maquina -- 24 mil chaves, e
 * seriam 24 mil linhas na loja de teste.
 */
const PASTA_REAL = process.env.BAILEYS_AUTH_DIR;
const PASTA_DO_TESTE = mkdtempSync(join(tmpdir(), 'sessao-whatsapp-teste-'));
process.env.BAILEYS_AUTH_DIR = PASTA_DO_TESTE;

test.after(async () => {
    if (PASTA_REAL === undefined) delete process.env.BAILEYS_AUTH_DIR;
    else process.env.BAILEYS_AUTH_DIR = PASTA_REAL;
    rmSync(PASTA_DO_TESTE, { recursive: true, force: true });
    await prisma.chaveWhatsApp.deleteMany({ where: { tenantId: LOJA } });
    await prisma.sessaoWhatsApp.deleteMany({ where: { tenantId: LOJA } });
    await prisma.tenant.delete({ where: { id: LOJA } }).catch(() => {});
    await prisma.$disconnect();
});

test('1. creds: a sessao salva volta igual depois de um novo processo', async () => {
    await garanteLoja();
    const primeiro = await estadoDaSessao(LOJA, codecs, MAQUINA);
    primeiro.creds.me = { id: '5511999999999:1@s.whatsapp.net', name: 'Padaria' } as any;
    primeiro.creds.registered = true;
    await primeiro.saveCreds();

    // O que um boot novo faz: outra chamada, sem levar o objeto em memoria.
    const segundo = await estadoDaSessao(LOJA, codecs, MAQUINA);
    assert.equal(segundo.creds.registered, true);
    assert.equal(segundo.creds.me?.name, 'Padaria');
});

test('2. chave de sinal: bytes entram como bytes e nao como lista de numeros', async () => {
    const { keys } = await estadoDaSessao(LOJA, codecs, MAQUINA);
    const bytes = Buffer.from([1, 2, 3, 250, 255]);

    await keys.set({ session: { '5511900000000@s.whatsapp.net.0': bytes } });

    const lido = await keys.get('session', ['5511900000000@s.whatsapp.net.0']);
    const valor = lido['5511900000000@s.whatsapp.net.0'] as unknown as Buffer;
    assert.ok(Buffer.isBuffer(valor), 'o Baileys recebe Buffer');
    assert.deepEqual([...valor], [...bytes]);

    const linha = await prisma.chaveWhatsApp.findUnique({
        where: {
            tenantId_maquinaId_tipo_chave: {
                tenantId: LOJA,
                maquinaId: MAQUINA,
                tipo: 'session',
                chave: '5511900000000@s.whatsapp.net.0',
            },
        },
    });
    assert.ok(linha, 'a chave esta no banco');
    assert.ok(linha!.valor.includes('"type":"Buffer"'), 'guardada em base64, nao como array');
});

test('3. chave apagada: o valor null some do banco', async () => {
    const { keys } = await estadoDaSessao(LOJA, codecs, MAQUINA);
    await keys.set({ session: { '5511900000001@s.whatsapp.net.0': Buffer.from([9]) } });
    await keys.set({ session: { '5511900000001@s.whatsapp.net.0': null } });

    const linhas = await prisma.chaveWhatsApp.findMany({
        where: { tenantId: LOJA, maquinaId: MAQUINA, tipo: 'session', chave: '5511900000001@s.whatsapp.net.0' },
    });
    assert.equal(linhas.length, 0);
});

test('4. app-state-sync-key passa pelo `preparar`, que devolve a classe do proto', async () => {
    const { keys } = await estadoDaSessao(LOJA, codecs, MAQUINA);
    await keys.set({ 'app-state-sync-key': { chaveDeEstado: { keyData: Buffer.from([7, 7]) } } });

    const lido = await keys.get('app-state-sync-key', ['chaveDeEstado']);
    const valor: any = lido['chaveDeEstado'];
    assert.equal(valor.classeDoProto, true, 'recebeu o objeto do proto, e nao o JSON cru');
    assert.deepEqual([...Buffer.from(valor.keyData)], [7, 7]);
});

test('5. pre-key em lote: um `set` com 30 chaves grava as 30 e atualiza sem duplicar', async () => {
    const { keys } = await estadoDaSessao(LOJA, codecs, MAQUINA);
    const lote: Record<string, { public: Buffer; private: Buffer }> = {};
    for (let i = 0; i < 30; i++) lote[String(i)] = { public: Buffer.from([i]), private: Buffer.from([i, i]) };

    await keys.set({ 'pre-key': lote });
    const linhas = await prisma.chaveWhatsApp.count({ where: { tenantId: LOJA, maquinaId: MAQUINA, tipo: 'pre-key' } });
    assert.equal(linhas, 30);

    // Reescrita do mesmo lote: tem que atualizar, e nao duplicar nem estourar o unique.
    await keys.set({ 'pre-key': { '0': { public: Buffer.from([200]), private: Buffer.from([201]) } } });
    const depois = await prisma.chaveWhatsApp.count({ where: { tenantId: LOJA, maquinaId: MAQUINA, tipo: 'pre-key' } });
    assert.equal(depois, 30, 'atualizou em vez de inserir outra vez');

    const lido = await keys.get('pre-key', ['0']);
    assert.deepEqual([...(lido['0'] as any).public], [200], 'a releitura ve o valor novo');
});

test('6. uma loja nao enxerga a sessao de outra instalacao', async () => {
    const outra = await estadoDaSessao(LOJA, codecs, OUTRA);
    await outra.saveCreds();

    const encontradas = await outraInstalacaoComSessao(LOJA, MAQUINA);
    assert.deepEqual(encontradas.map((e) => e.maquinaId), [OUTRA]);

    const comoOutra = await outraInstalacaoComSessao(LOJA, OUTRA);
    assert.deepEqual(
        comoOutra.map((e) => e.maquinaId),
        [MAQUINA],
        'a outra ve a sessao daqui, mas nao a si mesma'
    );

    // A chave de sinal da outra tambem tem de ficar fora daqui.
    const { keys } = await estadoDaSessao(LOJA, codecs, MAQUINA);
    await keys.set({ session: { 'sessao-so-desta': Buffer.from([5]) } });
    const daOutra = await outra.keys.get('session', ['sessao-so-desta']);
    assert.equal(daOutra['sessao-so-desta'], undefined, 'a chave nao atravessa a instalacao');
});

test('7. logout: apaga creds e chaves desta instalacao', async () => {
    const { keys, saveCreds } = await estadoDaSessao(LOJA, codecs, MAQUINA);
    await keys.set({ session: { 'some-com-o-logout': Buffer.from([3]) } });
    await saveCreds();

    await apagaSessao(LOJA, MAQUINA);

    assert.equal(await prisma.sessaoWhatsApp.count({ where: { tenantId: LOJA, maquinaId: MAQUINA } }), 0);
    assert.equal(await prisma.chaveWhatsApp.count({ where: { tenantId: LOJA, maquinaId: MAQUINA } }), 0);
});

test('8. sessao em arquivo entra no banco uma vez, com as chaves', async (t) => {
    const pasta = mkdtempSync(join(tmpdir(), 'sessao-whatsapp-'));
    const anterior = process.env.BAILEYS_AUTH_DIR;
    process.env.BAILEYS_AUTH_DIR = pasta;
    t.after(() => {
        if (anterior === undefined) delete process.env.BAILEYS_AUTH_DIR;
        else process.env.BAILEYS_AUTH_DIR = anterior;
        rmSync(pasta, { recursive: true, force: true });
    });

    // O que o Baileys deixa na pasta: creds e um arquivo por chave de sinal.
    writeFileSync(
        join(pasta, 'creds.json'),
        codecs.serializa({ me: { id: '5511888888888:2@s.whatsapp.net', name: 'Sushi' }, registered: true }),
        'utf8'
    );
    writeFileSync(
        join(pasta, 'sender-key-memory-5511900000000@g.us.json'),
        codecs.serializa({ '5511900000000@g.us': true }),
        'utf8'
    );
    // Mais que o lote de insercao, de proposito: e' o que pega a sessao grande, que
    // no Postgres morre num INSERT so por estourar o limite de parametros.
    for (let i = 0; i < 600; i++) {
        writeFileSync(
            join(pasta, `session-55119000${String(i).padStart(4, '0')}@s.whatsapp.net.0.json`),
            codecs.serializa(Buffer.from([i % 256])),
            'utf8'
        );
    }

    const { creds, keys, saveCreds } = await estadoDaSessao(LOJA, codecs, 'importada');
    assert.equal((creds.me as any)?.name, 'Sushi', 'os creds do arquivo valem no processo');

    // A sessao importada precisa responder as chaves com os mesmos ids do arquivo.
    const lido = await keys.get('session', ['551190000123@s.whatsapp.net.0']);
    assert.deepEqual([...(lido['551190000123@s.whatsapp.net.0'] as unknown as Buffer)], [123]);
    const grupo = await keys.get('sender-key-memory', ['5511900000000@g.us']);
    assert.equal((grupo['5511900000000@g.us'] as any)['5511900000000@g.us'], true);

    // O nome do tipo mais longo tem de vencer o prefixo mais curto.
    const linhas = await prisma.chaveWhatsApp.findMany({ where: { tenantId: LOJA, maquinaId: 'importada' } });
    assert.equal(linhas.length, 601, 'todas as chaves entraram, mesmo alem do lote');
    assert.deepEqual(
        linhas.filter((l) => l.tipo === 'sender-key-memory').map((l) => l.chave),
        ['5511900000000@g.us']
    );

    await saveCreds();
    const quantas = await prisma.sessaoWhatsApp.count({ where: { tenantId: LOJA, maquinaId: 'importada' } });
    assert.equal(quantas, 1, 'nao duplica a sessao ja importada');
});

test('9. sessao encerrada no WhatsApp nao volta nem do arquivo nem do banco', async (t) => {
    const pasta = mkdtempSync(join(tmpdir(), 'sessao-whatsapp-morta-'));
    const anterior = process.env.BAILEYS_AUTH_DIR;
    process.env.BAILEYS_AUTH_DIR = pasta;
    t.after(() => {
        if (anterior === undefined) delete process.env.BAILEYS_AUTH_DIR;
        else process.env.BAILEYS_AUTH_DIR = anterior;
        rmSync(pasta, { recursive: true, force: true });
    });

    // O que o Baileys deixa depois de um logout: `registered: false` no creds.
    writeFileSync(
        join(pasta, 'creds.json'),
        codecs.serializa({ registered: false, me: { id: '5511777777777:9@s.whatsapp.net' } }),
        'utf8'
    );
    writeFileSync(join(pasta, 'session-5511900000000@s.whatsapp.net.0.json'), codecs.serializa(Buffer.from([1])), 'utf8');

    const { creds, keys } = await estadoDaSessao(LOJA, codecs, 'encerrada');

    assert.equal(creds.registered, false, 'veio creds novos, nao a sessao morta');
    assert.equal(
        await prisma.sessaoWhatsApp.count({ where: { tenantId: LOJA, maquinaId: 'encerrada' } }),
        0,
        'a sessao morta foi gravada no banco'
    );
    assert.equal(
        await prisma.chaveWhatsApp.count({ where: { tenantId: LOJA, maquinaId: 'encerrada' } }),
        0,
        'as chaves da sessao morta foram para o banco'
    );

    const lido = await keys.get('session', ['5511900000000@s.whatsapp.net.0']);
    assert.equal(lido['5511900000000@s.whatsapp.net.0'], undefined);
    assert.deepEqual(listaDaPasta(pasta), [], 'a pasta da sessao morta ficou para tras');
});

test('10. sem sessao e sem arquivo, nascem creds novos em vez de erro', async (t) => {
    const pasta = mkdtempSync(join(tmpdir(), 'sessao-whatsapp-vazia-'));
    const anterior = process.env.BAILEYS_AUTH_DIR;
    process.env.BAILEYS_AUTH_DIR = pasta;
    t.after(() => {
        if (anterior === undefined) delete process.env.BAILEYS_AUTH_DIR;
        else process.env.BAILEYS_AUTH_DIR = anterior;
        rmSync(pasta, { recursive: true, force: true });
    });

    const { creds } = await estadoDaSessao(LOJA, codecs, 'do-zero');
    assert.ok((creds as any).noiseKey.private, 'tem chave de ruido: e o que o handshake exige');
    assert.equal(creds.registered, false);
    // Sessao recem-nascida nao grava nada sozinha: quem grava e' o Baileys, no `creds.update`.
    assert.equal(await prisma.sessaoWhatsApp.count({ where: { tenantId: LOJA, maquinaId: 'do-zero' } }), 0);
});

test('10. a instalacao da nuvem nao muda a cada boot', () => {
    const id = idDaInstalacao();
    assert.ok(id.length > 0, 'id vazio faria a sessao virar outra a cada deploy');
    assert.equal(id, idDaInstalacao(), 'estavel entre chamadas');

    const anterior = process.env.BAILEYS_INSTALACAO;
    process.env.BAILEYS_INSTALACAO = 'instancia-2';
    assert.equal(idDaInstalacao(), 'instancia-2', 'o ambiente separa duas maquinas na nuvem');
    if (anterior === undefined) delete process.env.BAILEYS_INSTALACAO;
    else process.env.BAILEYS_INSTALACAO = anterior;
});