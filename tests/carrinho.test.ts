/*
 * O carrinho do cliente: juncao, agrupamento e os comandos que fecham pedido.
 *
 * POR QUE UM TESTE DEDICADO
 *
 * O carrinho decide o que a cozinha vai produzir. A regra de juncao e' a que
 * mais destrói dinheiro em silencio: se dois pedidos iguais viram duas linhas, a
 * cozinha prepara duas vezes; se viram uma linha com o dobro da quantidade, o
 * preparo esta certo e o painel mostra errado. Os dois erros nao aparecem em
 * nenhuma tela de log.
 *
 * O total NAO entra aqui, e isso e' o ponto: este arquivo nao conhece preco. O
 * preco vem do banco, recalculado em `priceCart`, e o total do pedido sai de
 * la. Se algum destes testes precisasse de um valor em reais, seria sinal de que
 * a regra passou para o lugar errado.
 *
 * O QUE ESTES TESTES PEGARAM
 *
 * 1. Um item de quantidade zero virava "0x Coxinha" no resumo e contava no
 *    total. A pessoa que escreveu "0 coxinha" para desfazer via um numero zero
 *    apagava o item da lista e deixava a linha morta na tela.
 * 2. A ordem das opcoes de modificador mudava o resultado da comparacao: "bacon
 *    e cheddar" e "cheddar e bacon" sao a mesma combinacao, e a versao anterior
 *    tratava como duas linhas diferentes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    juntaItem,
    mesmaCombinacao,
    totalUnidades,
    textoDoCarrinho,
    ehComandoFechar,
    ehComandoLimpar,
    ehComandoVerCarrinho,
    type LinhaCarrinho,
} from '../src/services/carrinho';

/*
 * Os itens sao factories, e nao constantes.
 *
 * Isso nao e' estilo: uma constante compartilhada entre testes e' exatamente o
 * que expôs o bug de `juntaItem` somar no objeto de quem chamou -- o primeiro
 * caso alterava a constante, e os casos seguintes enxergavam aalteração. Com
 * factory, cada caso parte do zero e um bug de mutação aparece como falha no
 * lugar certo.
 */
const COXINHA = (qtd = 1): LinhaCarrinho => ({ id: 'p1', nome: 'Coxinha de frango', qtd, modificadores: {} });
const REFRIGERANTE = (qtd = 1): LinhaCarrinho => ({ id: 'p2', nome: 'Refrigerante lata', qtd, modificadores: {} });
const BURGER_MAL = (qtd = 1): LinhaCarrinho => ({
    id: 'p3',
    nome: 'X-Burguer',
    qtd,
    modificadores: { ponto: ['mal'] },
});
const BURGER_AO = (qtd = 1): LinhaCarrinho => ({
    id: 'p3',
    nome: 'X-Burguer',
    qtd,
    modificadores: { ponto: ['ao'] },
});

/* ------------------------------------------------------------------ juncao */

test('o mesmo item soma quantidade em uma linha so', () => {
    const c: LinhaCarrinho[] = [];
    juntaItem(c, COXINHA(1));
    juntaItem(c, COXINHA(2));
    juntaItem(c, COXINHA(3));

    assert.equal(c.length, 1, 'tres pedidos da mesma coisa e' + ' uma linha');
    assert.equal(c[0].qtd, 6, 'e a quantidade soma');
    assert.equal(totalUnidades(c), 6);
});

test('itens diferentes ficam em linhas diferentes', () => {
    const c: LinhaCarrinho[] = [];
    juntaItem(c, COXINHA());
    juntaItem(c, REFRIGERANTE());
    juntaItem(c, COXINHA());

    assert.equal(c.length, 2);
    assert.equal(totalUnidades(c), 3);
});

test('mesmo produto com modificador diferente e' + ' outra linha', () => {
    // "X-Burguer mal passado" e "X-Burguer ao ponto" sao dois pedidos, e a
    // cozinha precisa dos dois separadamente. Agrupar por produto e' ERRADO
    // aqui: a pessoa pagaria uma vez e receberia um sabor.
    const c: LinhaCarrinho[] = [];
    juntaItem(c, BURGER_MAL());
    juntaItem(c, BURGER_AO());

    assert.equal(c.length, 2);
    assert.equal(c[0].modificadores.ponto[0], 'mal');
    assert.equal(c[1].modificadores.ponto[0], 'ao');
});

test('a ordem das opcoes nao muda a combinacao', () => {
    // "bacon e cheddar" e "cheddar e bacon" sao o mesmo pedido. Com a ordem
    // levado em conta, viravam duas linhas e a cozinha preparava em dobro.
    const a = { extras: ['bacon', 'cheddar'] };
    const b = { extras: ['cheddar', 'bacon'] };
    assert.equal(mesmaCombinacao(a, b), true);

    const c: LinhaCarrinho[] = [];
    juntaItem(c, { id: 'p9', nome: 'Combo', qtd: 1, modificadores: a });
    juntaItem(c, { id: 'p9', nome: 'Combo', qtd: 1, modificadores: b });
    assert.equal(c.length, 1);
    assert.equal(c[0].qtd, 2);
});

test('quantidade zero apaga em vez de deixar um "0x" na tela', () => {
    /*
     * A pessoa que escreve "0 coxinha" quer tirar o item. Uma linha com zero
     * ficaria visivel no resumo e contaria no total -- e o total e' o que a
     * pessoa le antes de mandar "finalizar".
     */
    const c: LinhaCarrinho[] = [];
    juntaItem(c, COXINHA());
    juntaItem(c, COXINHA(0));

    assert.equal(c.length, 1, 'o zero nao pode criar uma linha nova');
    assert.equal(c[0].qtd, 1, 'e nao pode estragar a que existia');
});

test('grupo so de um lado nao e' + ' combinacao vazia', () => {
    // "sem cebola" contra "sem cebola e sem bacon": sao instrucoes diferentes,
    // e a cozinha precisa saber. Um grupo ausente nao e' o mesmo que um grupo
    // com lista vazia.
    assert.equal(mesmaCombinacao({ a: ['x'] }, {}), false);
    assert.equal(mesmaCombinacao({}, {}), true);
    assert.equal(mesmaCombinacao({ a: [] }, { a: [] }), true);
});

test('juntar em carrinho vazio cria a linha', () => {
    const c: LinhaCarrinho[] = [];
    juntaItem(c, COXINHA());
    assert.equal(c.length, 1);
    assert.equal(c[0].id, 'p1');
    assert.equal(c[0].qtd, 1);
});

test('totalUnidades: a soma e' + ' das quantidades, e nao das linhas', () => {
    const c: LinhaCarrinho[] = [];
    juntaItem(c, COXINHA(3));
    juntaItem(c, REFRIGERANTE(2));
    juntaItem(c, BURGER_MAL(1));

    assert.equal(c.length, 3, 'tres linhas');
    assert.equal(totalUnidades(c), 6, 'seis unidades');
});

/* -------------------------------------------------------------------- texto */

test('o texto lista o que foi pedido, com quantidade e modificador', () => {
    const c: LinhaCarrinho[] = [];
    juntaItem(c, COXINHA(3));
    juntaItem(c, BURGER_MAL());

    const t = textoDoCarrinho(c);
    assert.match(t, /3x Coxinha de frango/);
    assert.match(t, /X-Burguer/);
    assert.match(t, /4 item\(ns\)/, 'o total de unidades aparece para a pessoa conferir');
    assert.match(t, /finalizar/, 'e o texto diz como terminar');
});

test('o texto do carrinho vazio diz como sair dele', () => {
    const t = textoDoCarrinho([]);
    assert.match(t, /vazio/i);
    assert.match(t, /cardápio/);
});

test('o texto nao mostra dinheiro, porque o preco vem do servidor', () => {
    // Se este texto passasse a mostrar um total, o preco teria saído do lugar
    // -- e o lugar do preco e' a leitura do banco, no momento de fechar.
    const c: LinhaCarrinho[] = [];
    juntaItem(c, COXINHA(2));
    const t = textoDoCarrinho(c);
    assert.equal(/R\$/.test(t), false, 'nenhum valor em reais no resumo do pedido');
});

/* ---------------------------------------------------------------- comandos */

test('fechar: as varias formas que a pessoa usa', () => {
    // O motivo de existir varias: perder a venda no "finalizar" e' o pior lugar
    // possível para perder, porque a pessoa JÁ comprou na cabeça.
    for (const t of ['finalizar', 'finaliza', 'fechar', 'fechar pedido', 'pode enviar', 'enviar', 'confirmar', 'isso e tudo', 'e so isso']) {
        assert.equal(ehComandoFechar(t), true, `"${t}" devia fechar o pedido`);
    }
});

test('fechar: palavra parecida nao fecha pedido por acidente', () => {
    /*
     * "finalizando" e' a pessoa pensando em voz alta. Com "comeca com" no lugar
     * de igualdade, ela escreveria isso e o pedido fecharia sem ela querer --
     * sem ter confirmado, sem ter lido o resumo.
     */
    assert.equal(ehComandoFechar('finalizando'), false);
    assert.equal(ehComandoFechar('finalizar o pedido agora por favor'), false);
});

test('limpar: as formas de desfazer', () => {
    for (const t of ['limpar', 'apagar', 'cancelar', 'descartar', 'comecar de novo']) {
        assert.equal(ehComandoLimpar(t), true, `"${t}" devia limpar`);
    }
    assert.equal(ehComandoLimpar('apagar oacao'), false);
});

test('ver carrinho: as formas de conferir', () => {
    for (const t of ['carrinho', 'meu carrinho', 'meu pedido', 'o que eu pedi']) {
        assert.equal(ehComandoVerCarrinho(t), true, `"${t}" devia mostrar o pedido`);
    }
});

test('nenhum comando se sobrepoe a outro', () => {
    // Se "enviar" fosse visto como limpar, o pedido seria apagado no momento
    // em que a pessoa Confirmava. A sobreposicao e' o tipo de bug que so
    // aparece quando o cliente perde o pedido.
    const todos = ['finalizar', 'finaliza', 'fechar', 'enviar', 'manda', 'confirmar', 'acabou',
        'limpar', 'apagar', 'cancelar', 'descartar', 'zerar',
        'carrinho', 'meu pedido', 'o que eu pedi'];
    for (const t of todos) {
        const n = [ehComandoFechar(t), ehComandoLimpar(t), ehComandoVerCarrinho(t)].filter(Boolean).length;
        assert.equal(n, 1, `"${t}" respondendo a ${n} comandos ao mesmo tempo`);
    }
});

test('palavra de produto nunca e' + ' confundida com comando', () => {
    // O pior caso possivel: um produto chamado "Cancelado" faria o bot apagar o
    // pedido do cliente no meio da conversa. A comparacao e' exata, entao so
    // quebra se alguem colocar nome de produto na lista de comandos.
    assert.equal(ehComandoLimpar('cancelado'), false);
    assert.equal(ehComandoFechar('cachorro'), false);
    assert.equal(ehComandoVerCarrinho('pedido de wedding'), false);
});
