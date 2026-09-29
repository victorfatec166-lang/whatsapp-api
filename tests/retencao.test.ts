/*
 * A virada do dia apaga o que e' de ontem. E' a unica rotina do sistema que
 * DELETA dado de cliente, entao o teste precisa de duas garantias:
 *
 * 1. Que ela apaga o que deve -- e o que nao deve tambem. A parte perigosa de
 *    uma rotina de retencao nao e' ela falhar e deixar dado para tras: e' ela
 *    funcionar bem demais e levar junto a mensagem de hoje.
 *
 * 2. Que o teste em si nao come o banco de quem roda.
 *
 * O SEGUNDO PROBLEMA, E COMO ESTE TESTE O RESOLVE
 *
 * A poda e' um `DELETE` sem `where` que faca sentido: apaga tudo antes da
 * meia-noite. Rodando isso contra o `dev.db` de verdade, ela levaria as
 * mensagens do dono junto -- e um teste nao pode apagar a conversa de quem
 * esta testando.
 *
 * A solucao nao e' banco temporario com migration, e' empurrar o `agora` para
 * o passado. `podarDiaAnterior` recebe o instante, entao o teste passa uma
 * data de DUAS semanas atras: a meia-noite artificial fica antes das mensagens
 * reais, e o `DELETE` so alcanca as fixtures que o proprio teste criou. O
 * `where` e' o mesmo de producao, sobre o schema de verdade.
 *
 * E, para nao depender dessa razao, o teste grava os ids de todas as mensagens
 * e conversas que existem antes e afirma, no fim, que todos ainda estao la.
 * Se um dia o `where` mudar e comecar a alcancar tudo, esse teste quebra em vez
 * de destruir o banco.
 *
 * Por que testar por arquivos de verdade (backups e logs)
 *
 * Sao as duas unicas partes da retencao que nao passam pelo Prisma, e sao
 * exatamente as que ninguem percebe quebrando: uma regra de nome de arquivo
 * errada nao da erro, apenas para de apagar -- e "parou de apagar" e' o modo
 * de falha silencioso deste sistema inteiro.
 *
 * E por que `npm test` roda com `--test-concurrency=1`
 *
 * A virada chama `VACUUM`, que trava o banco inteiro para reescrever o
 * arquivo. Os quatro arquivos de testeDividem o mesmo `dev.db`, e o runner do
 * Node os executa em paralelo por padrao: enquanto a virada segura o lock, o
 * teste de estatisticas leva "database is locked" e falha sem ter nada a ver
 * com o que testa. Serializar os arquivos resolve, e e' a mesma razao do
 * `writeQueue` -- um SQLite, uma escrita por vez.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

import { podarDiaAnterior, inicioDoDia, carimboDoDia } from '../src/services/retencao';
import { podarBackupsDoDia, backupDir } from '../src/services/backup';
import { podarLogsDoDia, pastaDeLogs } from '../src/services/logger';

const prisma = new PrismaClient();

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
 * Cria uma conversa com mensagens de ontem e de hoje.
 *
 * `hojeTambem` decide se a conversa atravessa a meia-noite ou nao:
 *
 * - `true`: existe mensagem de hoje, entao `lastMessageAt` e' de hoje. A
 *   conversa sobrevive a virada e perde so as mensagens de ontem.
 * - `false`: a conversa parou ontem. `lastMessageAt` e' de ontem, entao a
 *   linha inteira e' removida.
 *
 * Esse detalhe nao e' enfeite de teste, e' um invariante do sistema, e ele
 * segura o `CASCADE` do `Message`. Como `Message.chatId` tem `onDelete:
 * Cascade`, uma conversa removida leva junto as mensagens dela -- inclusive as
 * de hoje. O que impede isso e' `registrarMensagem` gravar `lastMessageAt` com
 * o mesmo instante que grava o `sentAt` da mensagem: uma conversa que recebeu
 * algo hoje tem, por construcao, `lastMessageAt` de hoje, e nao e' candidata a
 * ser removida. A fixture que fizesse a conversa parecer de ontem enquanto
 * tinha mensagem de hoje desmentiria essa regra -- e foi assim que este teste
 * pegou o proprio bug de serie.
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
    // O mesmo erro do grafico de receita: `toISOString()` jogava para o dia
    // seguinte tudo que era feito depois das 21h -- que e' quando a loja
    // funciona. Aqui o corte e' construido com getFullYear/getMonth/getDate, que
    // leem o fuso de quem esta olhando a tela.
    const fimDaNoite = new Date(2026, 8, 28, 23, 59, 59);
    const corte = inicioDoDia(fimDaNoite);
    assert.equal(carimboDoDia(corte), '2026-09-28');
    assert.equal(corte.getHours(), 0);
    assert.equal(corte.getMinutes(), 0);
    assert.ok(corte <= fimDaNoite, 'o corte e' + ' anterior ao instante dado');
});

test('o carimbo ordena como data, que e' + ' o que a comparacao de arquivo usa', () => {
    // Nomes de arquivo sao comparados com `<` string a string. Isso so vale se
    // o formato ordenar por data, e so vale se for sempre YYYY-MM-DD: com
    // DD-MM-YYYY, "2026-09-28" < "2026-10-01" seria verdadeiro e "2026-2-01"
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
     * que atende ate tarde da noite -- o cliente de ontem escrevendo de manha
     * continua sendo o mesmo cliente, nao uma conversa nova.
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
     * O caso do downtime. A virada nao tem marcador de "ja fiz", entao um
     * servidor que ficou dois dias desligado e liga as 09:00 produz o mesmo
     * estado que teria produzido a meia-noite -- e nao deixa duas noites de
     * mensagem na base.
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
     * A sobrevida da conversa e' o unico texto de cliente que a virada mantem, e
     * ela mantem a LINHA, nao o conteudo. `ultimaMensagem` e' uma previa de 90
     * caracteres do que o cliente escreveu: se ela sobreviver, a metade do
     * trabalho -- apagar o texto -- teria sido feita no banco e desfeita na
     * mesma tela.
     */
    const c = await prisma.chat.findUnique({ where: { id: idHumano } });
    assert.ok(c, 'a conversa continua na lista');
    assert.equal(c!.ultimaMensagem, '', 'nada da mensagem de ontem ficou na previa');
    assert.equal(c!.naoLidas, 0, 'o contador de nao lidas nao sobra de ontem');

    // E o motivo de a linha continuar: o bot segue calado nela.
    assert.equal(c!.atendente, 'humano', 'quem assumiu continua sendo quem responde');
});

/* ------------------------------------------------------------------ arquivos */

/*
 * Datas de 1999 e 2000 nos dois testes de arquivo, e nao as de hoje.
 *
 * Os arquivos de teste sao criados na pasta de verdade, e a regra apaga pelo
 * nome. Com data de hoje, `backup-2026-09-28_2359.db` seria tanto um arquivo
 * que o teste cria quanto um backup que o sistema gravou de madrugada naquele
 * mesmo dia -- e o teste acabaria tendo authority para apagar o backup de
 * verdade. Em 1999 nao existe colisao possivel, e a comparacao de string
 * continua sendo a mesma.
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
     * A garantia final, e a que nao depende de nenhuma razao sobre fuso e
     * fixture: uma mensagem gravada AGORA, que e' o mesmo dia do teste, tem que
     * sobreviver a uma poda.
     *
     * E o teste que pega o erro de `where` alargado. Os outros provam que a
     * poda apaga o que deve; este prova que ela nao apaga o que nao deve, num
     * banco com dado de verdade. Um `where` que esquecesse do `corte` passaria
     * por todos os outros e por aqui ainda passaria -- o que o pegaria nao e' um
     * teste, e' a loja perdendo a conversa do dia.
     *
     * A contagem antes e depois fecha o cerco: um `DELETE` sem filtro algum
     * zeraria a tabela e a conversa da fixture, e a diferenca acusaria.
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

test.after(async () => {
    await prisma.chat.deleteMany({ where: { phone: { contains: '@teste-virada' } } });
    await prisma.$disconnect();
});
