/*
 * O sino so mostra o que da para atender hoje. Com janela de DOIS dias, quem
 * anotou "comprar carne" para o dia 14 num dia 29 via o lembrete no Calendario e
 * nunca no sino -- sem aviso, a unica conclusao era que a anotacao sumiu.
 */

/*
 * A janela de sete dias e' a correcao, e tem preco: sem agrupamento, sete lembretes
 * empurram para baixo os avisos de bot parado e estoque zerado, que custam dinheiro.
 * Por isso os dois formatos -- linha a linha para hoje, uma linha so para o resto.
 */

import nodeTest from 'node:test';
import assert from 'node:assert/strict';

import { montarPainel, DIAS_DE_ANTECEDENCIA } from '../src/services/notificacoes';
import { prismaComLoja } from '../src/database/prisma-com-loja';
import { comoLoja } from '../src/services/loja';

const prisma = prismaComLoja;

/** A loja do teste: lembrete e produto pertencem a uma loja, e o painel le dela. */
const LOJA = process.env.DELIVERYADMIN_TENANT?.trim() || 'local';

/*
 * Notificacoes consultam produtos e lembretes com tenant ativo;
 * o embrulho em nodeTest garante a execucao sob o contexto da loja.
 */
const test = ((nome: string, fn: (t: never) => unknown) =>
    nodeTest(nome, (t: never) => comoLoja(LOJA, () => fn(t)))) as typeof nodeTest;
Object.assign(test, nodeTest);

/** Data local em "AAAA-MM-DD", o fuso de quem olha a tela. */
function diasDaFrente(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
}

const criados: string[] = [];

/**
 * Tira do banco so o que este arquivo criou. Sem isso os testes se enxergam: a
 * linha agrupada mostra previa de tres lembretes, entao um teste que cria o
 * quarto descobre que "o meu lembrete nao apareceu" quando o que sumiu foi a previa.
 */
async function limpaTeste(): Promise<void> {
    if (criados.length > 0) {
        await prisma.reminder.deleteMany({ where: { id: { in: criados.splice(0) } } });
    }
}

/** Anota um lembrete e guarda o id, para apagar no fim. */
async function anota(dias: number, texto: string, feito = false): Promise<string> {
    const l = await prisma.reminder.create({
        data: { date: diasDaFrente(dias), text: texto, done: feito },
    });
    criados.push(l.id);
    return l.id;
}

const PRODUTO_ZERADO = {
    id: 'p1',
    name: 'Produto zerado',
    price: 1,
    costPrice: 1,
    category: 'Geral',
    stock: 0,
    minStock: 5,
    trackStock: true,
    isAvailable: true,
};

test('amanha vem linha a linha, com tom de informacao', async () => {
    await limpaTeste();
    const texto = 'teste sino: ligar para o fornecedor';
    await anota(1, texto);

    const painel = await montarPainel(true, []);
    const linha = painel.itens.find((i) => i.titulo === texto);

    assert.ok(linha, 'o lembrete de amanha precisa aparecer no sino');
    assert.equal(linha.detalhe, 'Lembrete para amanha');
    // Amanha pede acao, mas nao e' o que esta em chamas hoje.
    assert.equal(linha.tom, 'info');
});

test('hoje e o unico lembrete em ambar', async () => {
    await limpaTeste();
    const texto = 'teste sino: conferir o caixa';
    await anota(0, texto);

    const painel = await montarPainel(true, []);
    const linha = painel.itens.find((i) => i.titulo === texto);

    assert.ok(linha, 'o lembrete de hoje precisa aparecer no sino');
    assert.equal(linha.tom, 'ambar');
    assert.equal(linha.detalhe, 'Lembrete para hoje');
});

test('o que passou de amanha vem agrupado em uma linha so', async () => {
    await limpaTeste();
    // Tres lembretes nos dias 2, 3 e 4: um aviso cada transformaria o sino em
    // tres linhas e esconderia o que esta em chamas.
    await anota(2, 'teste agrupado: carne');
    await anota(3, 'teste agrupado: legumes');
    await anota(4, 'teste agrupado: premio da equipe');

    const painel = await montarPainel(true, []);
    const soltos = painel.itens.filter((i) => i.titulo.startsWith('teste agrupado:'));
    assert.equal(soltos.length, 0, 'os dias 2 a 4 nao podem virar linhas soltas');

    const grupo = painel.itens.find((i) => i.id === 'lembretes-mais-adiante');
    assert.ok(grupo, 'os lembretes da semana precisam virar uma linha agrupada');
    assert.equal(grupo.tom, 'info');
    assert.match(grupo.detalhe, /carne/);
    // Tres lembretes que criamos viram UMA linha nossa, e nao tres.
    assert.equal(
        painel.itens.filter((i) => i.titulo.startsWith('teste agrupado:') || i.id === 'lembretes-mais-adiante').length,
        1,
        'tres lembretes da semana sao uma linha, nao tres'
    );
});

test('dentro do grupo, o primeiro e o mais proximo', async () => {
    await limpaTeste();
    /*
     * A ordem dentro do detalhe vem do sort por `iso`. Se alguem trocar por ordem
     * de insercao, o sino passa a anunciar o lembrete mais distante em primeiro
     * lugar -- e quem le a linha resume le o dia errado.
     */
    await anota(5, 'teste ordem: quinto dia');
    await anota(2, 'teste ordem: segundo dia');
    await anota(6, 'teste ordem: sexto dia');

    const painel = await montarPainel(true, []);
    const grupo = painel.itens.find((i) => i.id === 'lembretes-mais-adiante');
    assert.ok(grupo, 'precisa existir o grupo para conferir a ordem');

    const dias = [...grupo.detalhe.matchAll(/dia (\d\d)\/(\d\d)/g)].map((m) => Number(m[1]));
    assert.equal(dias.length, 3, 'os tres dias precisam caber na previa');

    const ordenados = [...dias].sort((a, b) => a - b);
    assert.deepEqual(dias, ordenados, 'o agrupamento lista do dia mais proximo ao mais distante');
});

test('lembrete concluido e lembrete de ontem somem do sino', async () => {
    await limpaTeste();
    const feito = 'teste sumico: ja resolvido';
    await anota(0, feito, true);
    const passado = 'teste sumico: ontem';
    await anota(-1, passado);

    const painel = await montarPainel(true, []);
    const titulos = painel.itens.map((i) => i.titulo);

    assert.ok(!titulos.includes(feito), 'lembrete concluido nao e aviso');
    assert.ok(!titulos.includes(passado), 'ontem ja passou: e agenda, nao aviso');
});

test('a ordem e por gravidade, e nao por chegada', async () => {
    /*
     * A ordem do sino e' a de quem doi mais, e dois vermelhos empatados sao
     * desempatados pela ordem em que foram montados, nao por um relogio lido em
     * instantes diferentes: foi assim que bot parado e estoque trocaram de lugar.
     */
    await limpaTeste();
    const hoje = await anota(0, 'teste prioridade: lembrete de hoje');
    const semana = await anota(3, 'teste prioridade: lembrete da semana');

    const painel = await montarPainel(false, [PRODUTO_ZERADO]);
    const pos = (id: string) => painel.itens.findIndex((i) => i.id === id);

    assert.ok(pos('bot-offline') >= 0, 'bot parado precisa aparecer');
    assert.ok(pos('estoque-zerado') >= 0, 'produto zerado precisa aparecer');
    assert.ok(pos(`lembrete-${semana}`) < 0, 'o dia 3 nao vira aviso proprio');
    assert.ok(pos('lembretes-mais-adiante') >= 0, 'os dias da semana entram agrupados');

    // A ordem importa entre os itens que este teste criou. Nao se compara a
    // lista inteira: o dev.db e' o mesmo de quem esta usando o sistema, e o sino
    // pode ter com legitimidade um lembrete real de amanha no meio.
    assert.ok(pos('bot-offline') < pos('estoque-zerado'), 'bot parado vem antes de estoque');
    assert.ok(pos('estoque-zerado') < pos(`lembrete-${hoje}`), 'estoque zerado vem antes do lembrete de hoje');
    assert.ok(
        pos(`lembrete-${hoje}`) < pos('lembretes-mais-adiante'),
        'o lembrete de hoje vem antes do resumo da semana'
    );

    // O agrupamento e' informacao, entao nao entra na contagem de urgente.
    const urgentes = painel.itens.filter((i) => i.tom === 'vermelho' || i.tom === 'ambar');
    assert.ok(
        urgentes.every((i) => i.id !== 'lembretes-mais-adiante'),
        'a linha agrupada da semana nao e urgente'
    );
});

test('a borda da janela e o contrato que o Calendario anuncia', async () => {
    /*
     * A janela de sete dias aparece no filtro do sino e na mensagem do Calendario.
     * Se um mudar sem o outro, a pessoa e avisada de uma regra que o sistema nao
     * cumpre. Por isso o teste e' de BORDA, e nao do valor: o limite entra.
     */
    await limpaTeste();
    const dentro = 'teste borda: ultimo dia da janela';
    const fora = 'teste borda: ja fora da janela';
    await anota(DIAS_DE_ANTECEDENCIA, dentro);
    await anota(DIAS_DE_ANTECEDENCIA + 1, fora);

    const painel = await montarPainel(true, []);
    const texto = painel.itens.map((i) => i.detalhe).join(' | ');

    assert.ok(texto.includes(dentro), 'o dia limite ainda e aviso');
    assert.ok(!texto.includes(fora), 'um dia a mais ja e agenda, e o Calendario avisa isso');
});

// O `after` e' registrado a parte, porque o embrulho cobre os testes e nao as
// ganchos: a limpeza tambem precisa da loja.
test.after(() =>
    comoLoja(LOJA, async () => {
        await limpaTeste();
        await prisma.$disconnect();
    })
);
