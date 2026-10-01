/*
 * A virada do dia apaga o que e' de ontem, e e' a unica rotina que DELETA dado
 * de cliente. O perigo nao e' falhar e deixar dado para tras: e' funcionar bem
 * demais e levar a mensagem de hoje junto.
 */

/*
 * Para o teste nao comer o banco de quem roda: `podarDiaAnterior` recebe o
 * instante, entao o teste passa um `agora` de DUAS semanas atras, a meia-noite
 * artificial fica antes de tudo e o `DELETE` de producao so pega as fixtures.
 */

/*
 * Backups e logs nao passam pelo Prisma, e nome de arquivo errado nao da erro:
 * so para de apagar. Ja `--test-concurrency=1` existe porque a virada chama
 * `VACUUM` e tranca o `dev.db` que os quatro arquivos de teste dividem.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

import { podarDiaAnterior, inicioDoDia, carimboDoDia } from '../src/services/retencao';
import { podarBackupsDoDia, backupDir } from '../src/services/backup';
import { podarLogsDoDia, pastaDeLogs } from '../src/services/logger';
import { prismaComLoja } from '../src/database/prisma-com-loja';
import { comoLoja } from '../src/services/loja';
import nodeTest from 'node:test';

const prisma = prismaComLoja;

/** A loja do teste: a mesma do ambiente, que e' quem tem a linha em `Tenant`. */
const LOJA = process.env.DELIVERYADMIN_TENANT?.trim() || 'local';

/*
 * Poda e fixtures exigem tenantId ativo em toda gravacao;
 * o embrulho em nodeTest executa a suite inteira comoLoja(LOJA).
 */
const test = ((nome: string, fn: (t: never) => unknown) =>
    nodeTest(nome, (t: never) => comoLoja(LOJA, () => fn(t)))) as typeof nodeTest;
// `after`, `before` e `mock` sao propriedades da propria funcao; sem esta copia o
// embrulho perderia o `test.after` que limpa a base no fim do arquivo.
Object.assign(test, nodeTest);

/* ------------------------------------------------------------------ helpers */

/** O "hoje" do teste: duas semanas atras, para a corte nao alcançar o real. */
function instanteArtificial(): Date {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    d.setHours(9, 0, 0, 0);
    return d;
}

const JID_BOT = '5500000000001@teste-virada-bot';
const JID_HUMANO = '5500000000002@teste-virada-humano';

/**
 * `hojeTambem`: a conversa atravessa a meia-noite -- sobrevive a virada e perde
 * so as mensagens de ontem -- ou parou ontem, e a linha inteira e' removida.
 */

/**
 * `lastMessageAt` tem de ser o instante do ultimo `sentAt`: e' o que segura a
 * conversa, ja que `Message.chatId` tem `onDelete: Cascade` e levar a conversa
 * e levar as mensagens de hoje junto.
 */
async function semeia(phone: string, atendente: 'bot' | 'humano', hojeTambem: boolean) {
    const agora = instanteArtificial();
    const antes = new Date(inicioDoDia(agora).getTime() - 3 * 3600_000);
    const depois = new Date(inicioDoDia(agora).getTime() + 3600_000);

    await prisma.chat.deleteMany({ where: { phone } });
    const chat = await prisma.chat.create({
        data: {
            phone,
            name: 'Cliente de Teste',
            telefone: '5500000000000',
            atendente,
            ultimaMensagem: 'mensagem de ontem',
            lastMessageAt: hojeTambem ? depois : antes,
            naoLidas: 3,
        },
    });
    await prisma.message.createMany({
        data: [
            { chatId: chat.id, from: 'cliente', text: 'ontem 1', sentAt: antes },
            { chatId: chat.id, from: 'cliente', text: 'ontem 2', sentAt: new Date(antes.getTime() + 60_000) },
            ...(hojeTambem
                ? [{ chatId: chat.id, from: 'cliente' as const, text: 'depois da meia-noite', sentAt: depois }]
                : []),
        ],
    });
    return chat.id;
}

async function mensagensDo(chatId: string): Promise<string[]> {
    const linhas = await prisma.message.findMany({ where: { chatId }, orderBy: { sentAt: 'asc' } });
    return linhas.map((m) => m.text);
}

/* ------------------------------------------------- o dia, e a fuso do processo */

test('a virada e' + ' a meia-noite do dia local, e nao a de UTC', () => {
    // Mesmo erro do grafico de receita: `toISOString()` jogava para o dia seguinte
    // o que era feito depois das 21h. O corte usa getFullYear/getMonth/getDate, que
    // leem o fuso de quem esta olhando a tela.
    const fimDaNoite = new Date(2026, 8, 28, 23, 59, 59);
    const corte = inicioDoDia(fimDaNoite);
    assert.equal(carimboDoDia(corte), '2026-09-28');
    assert.equal(corte.getHours(), 0);
    assert.equal(corte.getMinutes(), 0);
    assert.ok(corte <= fimDaNoite, 'o corte e' + ' anterior ao instante dado');
});

test('o carimbo ordena como data, que e' + ' o que a comparacao de arquivo usa', () => {
    // Nomes de arquivo se comparam com `<` string a string, o que so vale se o
    // formato ordenar por data e for sempre YYYY-MM-DD: com DD-MM-YYYY, "2026-2-01"
    // passaria na frente de "2026-10-01".
    const dias = ['2026-09-28', '2026-10-01', '2026-10-10', '2027-01-01'].sort();
    assert.deepEqual(dias, ['2026-09-28', '2026-10-01', '2026-10-10', '2027-01-01']);
    assert.equal(carimboDoDia(new Date(2026, 0, 5)).length, 10, 'sempre 10 caracteres');
});

/* -------------------------------------------------------------- a poda no banco */

test('a poda leva o dia anterior e deixa o dia atual', async (t) => {
    /*
     * Conversa que atravessou a meia-noite: as duas mensagens de ontem caem, a
     * de hoje fica, e a conversa continua na lista. E' o caso comum de uma loja
     * que atende ate tarde.
     */
    const idBot = await semeia(JID_BOT, 'bot', true);
    const agora = instanteArtificial();

    t.after(async () => {
        await prisma.chat.deleteMany({ where: { phone: { in: [JID_BOT, JID_HUMANO] } } });
    });

    const r = await podarDiaAnterior(agora);

    assert.equal(r.mensagens, 2, 'as duas mensagens de ontem sairam');
    assert.equal(r.conversasRemovidas, 0, 'conversa com mensagem de hoje nao e' + ' removida');
    assert.deepEqual(await mensagensDo(idBot), ['depois da meia-noite'], 'a de hoje continua');
    assert.equal(await prisma.chat.count({ where: { id: idBot } }), 1, 'e a linha da conversa tambem');
});

test('a borda e' + ' a meia-noite: um segundo antes fica, um segundo depois sai', async (t) => {
    /*
     * `lt` e' estrito, e isso e' o que faz a virada segura de rodar no meio da
     * madrugada: a mensagem que chega 00:00:00 nao entra na conta, porque a
     * poda da proxima rodada a trata como "de hoje".
     */
    const phone = '5500000000003@teste-virada-borda';
    const agora = instanteArtificial();
    const corte = inicioDoDia(agora);

    await prisma.chat.deleteMany({ where: { phone } });
    const chat = await prisma.chat.create({ data: { phone, lastMessageAt: corte } });
    await prisma.message.createMany({
        data: [
            { chatId: chat.id, from: 'cliente', text: '1s antes', sentAt: new Date(corte.getTime() - 1000) },
            { chatId: chat.id, from: 'cliente', text: 'na meia-noite', sentAt: corte },
        ],
    });

    t.after(async () => {
        await prisma.chat.deleteMany({ where: { phone } });
    });

    await podarDiaAnterior(agora);
    assert.deepEqual(await mensagensDo(chat.id), ['na meia-noite']);
});

test('rodar duas vezes nao apaga nada na segunda', async (t) => {
    const phone = '5500000000004@teste-virada-idem';
    const agora = instanteArtificial();
    const corte = inicioDoDia(agora);

    await prisma.chat.deleteMany({ where: { phone } });
    const chat = await prisma.chat.create({ data: { phone, lastMessageAt: corte } });
    await prisma.message.create({ data: { chatId: chat.id, from: 'cliente', text: 'ontem', sentAt: new Date(corte.getTime() - 1000) } });

    t.after(async () => {
        await prisma.chat.deleteMany({ where: { phone } });
    });

    const primeira = await podarDiaAnterior(agora);
    const segunda = await podarDiaAnterior(agora);

    assert.equal(primeira.mensagens, 1);
    /*
     * E' o que mantem o log em silencio: 96 ticks por dia, e se o segundo
     * devolvesse numero, a virada voltaria a anunciar trabalho a cada 15 minutos.
     * O `OR` no filtro das conversas assumidas existe pela mesma razao.
     */
    assert.equal(segunda.mensagens, 0);
    assert.equal(segunda.conversasRemovidas, 0);
    assert.equal(segunda.conversasAssumidas, 0);
});

test('servidor que sobe as 09:00 ainda apaga o dia que passou', async (t) => {
    /*
     * Downtime: a virada nao tem marcador de "ja fiz", entao quem liga as 09:00
     * produz o mesmo estado de quem rodou a meia-noite.
     */
    const phone = '5500000000005@teste-virada-downtime';
    const agora = instanteArtificial();
    const corte = inicioDoDia(agora);

    await prisma.chat.deleteMany({ where: { phone } });
    const chat = await prisma.chat.create({ data: { phone, lastMessageAt: corte } });
    await prisma.message.createMany({
        data: [
            { chatId: chat.id, from: 'cliente', text: 'ontem', sentAt: new Date(corte.getTime() - 1000) },
            { chatId: chat.id, from: 'cliente', text: 'ante de ontem', sentAt: new Date(corte.getTime() - 86400_000) },
        ],
    });

    t.after(async () => {
        await prisma.chat.deleteMany({ where: { phone } });
    });

    const r = await podarDiaAnterior(agora); // 09:00, bem depois da meia-noite
    assert.equal(r.mensagens, 2, 'as duas noites foram embora, nao so a ultima');
    assert.deepEqual(await mensagensDo(chat.id), []);
});

/* ----------------------------------------------------- quem fica e quem sai */

test('conversa que o bot atendia sai da lista; a que um humano assumiu fica', async (t) => {
    const idBot = await semeia(JID_BOT, 'bot', false);
    const idHumano = await semeia(JID_HUMANO, 'humano', false);
    const agora = instanteArtificial();

    t.after(async () => {
        await prisma.chat.deleteMany({ where: { phone: { in: [JID_BOT, JID_HUMANO] } } });
    });

    const r = await podarDiaAnterior(agora);

    assert.equal(r.conversasRemovidas, 1, 'a conversa do bot saiu da lista');
    assert.equal(r.conversasAssumidas, 1, 'a do humano ficou, com a previa limpa');
    assert.equal(await prisma.chat.count({ where: { id: idBot } }), 0, 'a linha do bot nao sobrou');
    assert.equal(await prisma.chat.count({ where: { id: idHumano } }), 1, 'a linha do humano sobrou');
});

test('a conversa que sobra nao guarda mais nada do texto de ontem', async (t) => {
    const idHumano = await semeia(JID_HUMANO, 'humano', false);
    const agora = instanteArtificial();

    t.after(async () => {
        await prisma.chat.deleteMany({ where: { phone: JID_HUMANO } });
    });

    await podarDiaAnterior(agora);

    /*
     * A sobrevida mantem a LINHA, nao o conteudo: `ultimaMensagem` e' previa do
     * que o cliente escreveu, e se ela sobreviver o trabalho de apagar o texto
     * seria desfeito na mesma tela.
     */
    // `findFirst` e nao `findUnique`: e' a forma de filtro, entao a extensao
    // injeta a loja. `findUnique({ where: { id } })` estoura -- e o erro e' o aviso
    // de que a consulta nao carregava a loja.
    const c = await prisma.chat.findFirst({ where: { id: idHumano } });
    assert.ok(c, 'a conversa continua na lista');
    assert.equal(c!.ultimaMensagem, '', 'nada da mensagem de ontem ficou na previa');
    assert.equal(c!.naoLidas, 0, 'o contador de nao lidas nao sobra de ontem');

    // E o motivo de a linha continuar: o bot segue calado nela.
    assert.equal(c!.atendente, 'humano', 'quem assumiu continua sendo quem responde');
});

/* ------------------------------------------------------------------ arquivos */

/*
 * Datas de 1999 e 2000, e nao as de hoje: os arquivos vao na pasta de verdade e a
 * regra apaga pelo nome, entao o dump do teste colidiria com um backup gravado
 * de madrugada no mesmo dia -- e o teste acabaria apagando o backup de quem roda.
 */
test('backup de ontem sai, o de hoje fica, e o dump avulso nao e' + ' tocado', () => {
    const hoje = '2000-01-01';
    const pasta = backupDir();
    fs.mkdirSync(pasta, { recursive: true });

    const nomes = [
        'backup-1999-12-31_1830.db', // antes de hoje: sai
        'backup-1999-11-20_0600.db', // muito antes: sai
        'backup-2000-01-01_0005.db', // hoje, de madrugada: fica
        'backup-2000-01-01_2359.db', // hoje, agora: fica
        // Dump manual de manutencao. Nao e' copia do sistema, entao nenhuma
        // regra de rotacao pode encostar nele -- foi exatamente o que a regra
        // anterior, que casava com qualquer ".db", faria.
        'pre-drop-colunas-20260928-172125.db',
    ];
    for (const f of nomes) fs.writeFileSync(path.join(pasta, f), 'x');

    try {
        const removidos = podarBackupsDoDia(hoje);
        assert.equal(removidos, 2, 'as duas de antes de hoje sairam');
        assert.equal(fs.existsSync(path.join(pasta, 'backup-1999-12-31_1830.db')), false);
        assert.equal(fs.existsSync(path.join(pasta, 'backup-1999-11-20_0600.db')), false);
        assert.equal(fs.existsSync(path.join(pasta, 'backup-2000-01-01_0005.db')), true, 'o de hoje fica');
        assert.equal(fs.existsSync(path.join(pasta, 'backup-2000-01-01_2359.db')), true, 'o de hoje fica');
        assert.equal(
            fs.existsSync(path.join(pasta, 'pre-drop-colunas-20260928-172125.db')),
            true,
            'dump manual nao e' + ' backup do sistema'
        );
    } finally {
        for (const f of nomes) {
            const alvo = path.join(pasta, f);
            if (fs.existsSync(alvo)) fs.unlinkSync(alvo);
        }
    }
});

test('log de ontem sai e o de hoje fica', () => {
    const hoje = '2000-01-01';
    const pasta = pastaDeLogs();
    fs.mkdirSync(pasta, { recursive: true });

    const nomes = ['app-1999-12-31.log', 'app-2000-01-01.log', 'app-1999-08-01.log', 'nao-e-log.txt'];
    for (const f of nomes) fs.writeFileSync(path.join(pasta, f), 'linha de log\n');

    try {
        const removidos = podarLogsDoDia(hoje);
        assert.deepEqual(removidos.sort(), ['app-1999-08-01.log', 'app-1999-12-31.log']);
        assert.equal(fs.existsSync(path.join(pasta, 'app-2000-01-01.log')), true, 'o log de hoje esta aberto pelo logger');
        assert.equal(fs.existsSync(path.join(pasta, 'nao-e-log.txt')), true, 'a pasta so tem logs do sistema');
    } finally {
        for (const f of nomes) {
            const alvo = path.join(pasta, f);
            if (fs.existsSync(alvo)) fs.unlinkSync(alvo);
        }
    }
});

/* ----------------------------------------------------- o teste nao come o banco */

test('a poda nao alcanca nada de hoje, e isso vale com a base cheia', async (t) => {
    /*
     * A garantia final: uma mensagem gravada AGORA, no mesmo dia do teste, tem
     * que sobreviver a uma poda. E o que pega o `where` alargado -- os outros
     * provam que apaga o que deve, este prova que nao apaga o que nao deve.
     */
    const phone = '5500000000006@teste-virada-hoje';
    const antes = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM "Message"`);
    const conversasAntes = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM "Chat"`);

    await prisma.chat.deleteMany({ where: { phone } });
    const chat = await prisma.chat.create({
        data: { phone, lastMessageAt: new Date() }, // hoje, de verdade
    });
    await prisma.message.createMany({
        data: [
            { chatId: chat.id, from: 'cliente', text: 'de hoje mesmo', sentAt: new Date() },
            { chatId: chat.id, from: 'cliente', text: 'de hoje, mais cedo', sentAt: new Date(Date.now() - 3600_000) },
        ],
    });

    t.after(async () => {
        await prisma.chat.deleteMany({ where: { phone } });
    });

    // Corte artificial de duas semanas atras: nao alcanca nada do que acabou de
    // ser gravado, porque e' anterior a hoje.
    const r = await podarDiaAnterior(instanteArtificial());

    const depois = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM "Message"`);
    const conversasDepois = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM "Chat"`);

    assert.equal(r.mensagens, 0, 'a poda artificial nao tinha o que apagar');
    assert.equal(Number(depois[0].n), Number(antes[0].n) + 2, 'so as duas mensagens do teste entraram na base');
    assert.equal(Number(conversasDepois[0].n), Number(conversasAntes[0].n) + 1);
    assert.deepEqual(await mensagensDo(chat.id), ['de hoje mesmo', 'de hoje, mais cedo'].reverse());
});

// O `after` e' registrado a parte, porque o embrulho cobre os testes e nao as
// ganchos: a limpeza também precisa da loja, senao o `deleteMany` estoura.
test.after(() =>
    comoLoja(LOJA, async () => {
        await prisma.chat.deleteMany({ where: { phone: { contains: '@teste-virada' } } });
        await prisma.$disconnect();
    })
);
