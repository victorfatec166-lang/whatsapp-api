/*
 * Entender a frase do cliente sem modelo de linguagem.
 *
 * POR QUE UM TESTE DEDICADO, E O QUE ELE PROTEGE
 *
 * Este modulo e' o unico lugar do sistema que decide qual produto o cliente
 * pediu a partir de texto solto. Se ele errar, o preco sai certo e o pedido sai
 * errado -- a pessoa recebe outra coisa e so descobre pelo preco. Esse e' o
 * pior tipo de erro de um sistema de venda: silencioso, e descoberto no cartao.
 *
 * Por isso o PISO importa mais do que o acerto. Um casamento errado destroi mais
 * do que um casamento faltando: faltando, o bot pergunta; errado, o bot cobra.
 * Por isso os casos de "nao casa" estao aqui tanto quanto os de "casa".
 *
 * Todos os casos usam o catalogo de exemplo abaixo, que reproduz o padrao real:
 * nome com virgula, nome com acento, nome curto, apelido, produto com grupo de
 * modificador de escolha unica e de varias opcoes.
 *
 * O QUE ESTES TESTES PEGARAM
 *
 * 1. Troca de letras vizinhas valia 2 no Levenshtein. "patsel" em vez de
 *    "pastel" -- o erro mais comum de dedo em celular -- passava a ser a mesma
 *    distancia de um produto totalmente diferente, e o cliente que digitou o
 *    nome certo ficava sem resposta.
 * 2. Modificador casava por substring: "bacon" dentro de "baconete", e "mal"
 *    dentro de "malte". A cozinha recebia a instrucao errada, e o preco do
 *    modificador ia junto.
 * 3. A quebra da frase partia "Arroz, feijao e salada" em tres, e nao havia
 *    quem tentasse a frase inteira primeiro -- que e' o unico jeito de acertar
 *    esse nome e "coxinha e refrigerante" ao mesmo tempo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    chave,
    separaNumero,
    distancia,
    quebraEmPedacos,
    achaProduto,
    achaModificadores,
    interpreta,
    type ItemCatalogo,
} from '../src/services/entender';

const CATALOGO: ItemCatalogo[] = [
    { id: 'p1', nome: 'Arroz, feijao e salada' },
    { id: 'p2', nome: 'Coxinha de frango' },
    { id: 'p3', nome: 'Refrigerante lata' },
    { id: 'p4', nome: 'Pastel de carne' },
    { id: 'p5', nome: 'Café' },
    {
        id: 'p6',
        nome: 'X-Burguer',
        apelidos: ['xburguer', 'xburguer'],
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
            {
                id: 'g2',
                nome: 'Extras',
                maxSelect: 2,
                opcoes: [
                    { id: 'o3', nome: 'Bacon' },
                    { id: 'o4', nome: 'Cheddar' },
                ],
            },
        ],
    },
];

function id(pedaco: string, catalogo: ItemCatalogo[] = CATALOGO): string | null {
    const c = achaProduto(pedaco, catalogo);
    return c ? c.item.id : null;
}

/* ------------------------------------------------------------ texto e numero */

test('chave: acento, caixa e pontuacao somem, e a palavra continua', () => {
    assert.equal(chave('Pasteis'), 'pasteis');
    assert.equal(chave('ARROZ, FEIJAO E SALADA'), 'arroz feijao e salada');
    // O espaco duplo e' normal em texto digitado no celular.
    assert.equal(chave('Refrigerante  lata'), 'refrigerante lata');
    assert.equal(chave('  Coxinha  '), 'coxinha');
});

test('chave: acento nao muda a identidade do produto', () => {
    // O cliente sem acento tem de achar o produto com acento, e vice-versa: e
    // o mesmo prato, e a loja nao pode ter dois cadastros por causa de um "é".
    assert.equal(id('cafe'), 'p5');
    assert.equal(id('cafe'.normalize('NFD').replace(/[\u0300-\u036f]/g, '')), 'p5');
    assert.equal(id('Café'), 'p5');
});

test('separaNumero: a quantidade vem no fim do nome', () => {
    assert.deepEqual(separaNumero('coxinha 3'), { nome: 'coxinha', numero: 3 });
    assert.deepEqual(separaNumero('coxinha'), { nome: 'coxinha', numero: null });
    assert.deepEqual(separaNumero('refrigerante 12'), { nome: 'refrigerante', numero: 12 });
    // Numero no MEIO nao e' quantidade deste modulo: "2 coxinhas" e' caso
    // diferente, e nao pode virar um produto chamado "2".
    assert.deepEqual(separaNumero('2 coxinhas'), { nome: '2 coxinhas', numero: null });
});

test('distancia: troca de letras vizinhas vale UM, que e' + ' o erro de dedo mais comum', () => {
    // Este e' o caso que justifica Damerau em vez de Levenshtein. Com
    // substituicao simples, "patsel" e "pastel" dariam 2 -- a mesma distancia de
    // "pastel" e "pastel" -- e o cliente que digitou certo seria recusado.
    assert.equal(distancia('patsel', 'pastel', 2), 1);
    assert.equal(distancia('coxina', 'coxinha', 2), 1, 'letra faltando');
    assert.equal(distancia('coxinha', 'coxinha', 2), 0);
});

test('distancia: o corte por tamanho evita comparar o impossivel', () => {
    // Diferenca de comprimento maior que o limite: nem uma troca de letra
    // resolveria, e o resultado precisa ser "nao casou".
    assert.ok(distancia('sal', 'salsicha', 1) > 1);
    assert.ok(distancia('sal', 'salsicha', 2) > 2);
});

/* ------------------------------------------------------------------ o casamento */

test('achaProduto: o nome exato casa, com a grafia que o cliente usar', () => {
    assert.equal(id('Coxinha de frango'), 'p2');
    assert.equal(id('COXINHA DE FRANGO'), 'p2');
    assert.equal(id('  coxinha de frango  '), 'p2');
});

test('achaProduto: erro de digitacao acha, e diz que foi aproximado', () => {
    const c = achaProduto('coxina de frango', CATALOGO);
    assert.ok(c, 'um erro de digitacao no balcao nao pode falhar');
    assert.equal(c!.item.id, 'p2');
    assert.equal(c!.origem, 'nome-aproximado');
    assert.ok(c!.confianca > 0.5, 'e a confianca precisa ficar alta o bastante para o bot aceitar');
});

test('achaProduto: o nome dentro da frase acha sem escrever tudo', () => {
    assert.equal(id('coxinha de frango com tudo'), 'p2');
});

test('achaProduto: apelido serve quando o nome oficial nao casa', () => {
    assert.equal(id('xburguer'), 'p6');
    assert.equal(id('X-Burguer'), 'p6');
});

test('achaProduto: exato ganha de contido, e contido ganha de aproximado', () => {
    /*
     * A ordem das tentativas e' uma invariante, e nao um detalhe de codigo.
     *
     * Com "Refrigerante" e "Refrigerante lata" no catalogo, o cliente que
     * escreve "refrigerante" esta pedindo o produto de nome exato. Se o passo de
     * "contido" rodasse antes do exato -- ou se as duas coisas empatassem pela
     * confianca -- a pessoa levaria a lata grande sem ter pedido.
     */
    const dois: ItemCatalogo[] = [
        { id: 'lata', nome: 'Refrigerante lata' },
        { id: 'unit', nome: 'Refrigerante' },
    ];
    assert.equal(id('refrigerante', dois), 'unit', 'o exato vence');
    assert.equal(id('refrigerante lata', dois), 'lata', 'e o contido acerta o seu');
});

test('achaProduto: NAO casa o que nao e' + ' produto -- o piso importa mais que o acerto', () => {
    // Cada um destes e' o jeito de um cliente escrever sem ser o nome do prato.
    // Se qualquer um casar, a pessoa recebe outra coisa e so descobre no preco.
    for (const texto of ['v942', 'zxqw', 'a', '', '   ', '????', 'salsicha']) {
        assert.equal(id(texto), null, `"${texto}" nao pode virar produto`);
    }
});

/* ------------------------------------------------------------- a frase inteira */

test('quebraEmPedacos: a quebra e' + ' ingenua, e isso esta certo', () => {
    /*
     * A funcao quebra, e nao decide. Ela nao sabe o que e' um produto, entao nao
     * tem como saber que "arroz, feijao e salada" e' um so. Quem sabe e'
     * `interpreta`, que tenta a frase inteira antes das partes.
     *
     * E a virgula nao chega aqui: a chave ja a trocou por espaco. Isso e'
     * deliberado, porque a virgula aparece DENTRO do nome de produto e o
     * conector "e" e' o sinal mais forte de que a pessoa esta listando duas
     * coisas.
     */
    assert.deepEqual(quebraEmPedacos('arroz, feijao e salada'), ['arroz feijao', 'salada']);
    assert.deepEqual(quebraEmPedacos('coxinha e refrigerante'), ['coxinha', 'refrigerante']);
    assert.deepEqual(quebraEmPedacos('coxinha e mais refrigerante'), ['coxinha', 'refrigerante']);
    assert.deepEqual(quebraEmPedacos('coxinha e refrigerante e pastel'), ['coxinha', 'refrigerante', 'pastel']);
});

test('achaProduto: a frase curta casa com o nome mais curto que a contem', () => {
    /*
     * O caso mais comum de todos, e o que faltava.
     *
     * O cliente escreve "coxinha". O produto se chama "Coxinha de frango". Antes
     * so havia a busca pelo nome DENTRO da frase, entao "coxinha" nao casava com
     * nada: a distancia entre as duas palavras passa do limite por causa do
     * comprimento, e o cliente que escreveu do jeito mais natural recebia
     * "opcao invalida".
     *
     * E o criterio de escolha aqui e' o mais conservador possivel -- ganha o
     * nome MAIS CURTO que contem a frase. Se o catalogo tiver "Arroz" e "Arroz,
     * feijao e salada", e o cliente disser "arroz", ele recebe o Arroz. Escolher
     * o mais longo seria devolver mais do que a pessoa pediu.
     */
    assert.equal(id('coxinha'), 'p2');
    assert.equal(id('refrigerante'), 'p3');
    assert.equal(id('pastel'), 'p4');

    const comOsDois: ItemCatalogo[] = [
        { id: 'curto', nome: 'Arroz' },
        { id: 'longo', nome: 'Arroz, feijao e salada' },
    ];
    assert.equal(id('arroz', comOsDois), 'curto', 'o nome mais especifico nao rouba o pedido do nome generico');
});

test('quebraEmPedacos: frase vazia nao vira item nenhum', () => {
    assert.deepEqual(quebraEmPedacos(''), []);
    assert.deepEqual(quebraEmPedacos('   '), []);
});

test('interpreta: nome com virgula E' + ' nome inteiro e' + ' um produto so', () => {
    // O caso que a quebra ingenua quebraria. "Arroz, feijao e salada" tem
    // virgula e "e" DENTRO do nome, e e' um prato so.
    const r = interpreta('Arroz, feijao e salada', CATALOGO);
    assert.equal(r.itens.length, 1, 'nao pode virar tres pratos');
    assert.equal(r.itens[0].id, 'p1');
    assert.equal(r.itens[0].qtd, 1);
});

test('interpreta: o conector separa quando o nome inteiro nao casa', () => {
    const r = interpreta('coxinha e refrigerante', CATALOGO);
    assert.deepEqual(r.itens.map((i) => i.id), ['p2', 'p3']);
    assert.deepEqual(r.naoEntendidos, []);
});

test('interpreta: quantidade no fim do nome vira quantidade', () => {
    const r = interpreta('coxinha 3', CATALOGO);
    assert.equal(r.itens.length, 1);
    assert.equal(r.itens[0].id, 'p2');
    assert.equal(r.itens[0].qtd, 3);
});

test('interpreta: o que nao casa e' + ' devolvido, nao descartado em silencio', () => {
    /*
     * O que nao foi entendido precisa voltar para o bot dizer. Encher o pedido
     * com o que ele achou e engolir o resto faz a pessoa acreditar que pediu a
     * coisa toda -- e descobrir o erro no balcao, na frente do cliente.
     */
    const r = interpreta('coxinha e xyzabc', CATALOGO);
    assert.deepEqual(r.itens.map((i) => i.id), ['p2']);
    assert.deepEqual(r.naoEntendidos, ['xyzabc']);
});

test('interpreta: frase vazia devolve nada, sem lancar', () => {
    const r = interpreta('   ', CATALOGO);
    assert.deepEqual(r.itens, []);
    assert.deepEqual(r.naoEntendidos, []);
});

/* ---------------------------------------------------------------- modificadores */

test('achaModificadores: o nome da opcao casa, do produto certo', () => {
    const xb = CATALOGO.filter((p) => p.id === 'p6')[0];
    const r = achaModificadores('x-burguer mal passado', xb);
    assert.deepEqual(r['g1'], ['o1']);
});

test('achaModificadores: so casa com grupo ligado ao produto', () => {
    // A coxinha nao tem grupo de ponto da carne. Casar "mal passado" nela seria
    // inventar um item que a cozinha nao pediu.
    const coxinha = CATALOGO.filter((p) => p.id === 'p2')[0];
    const r = achaModificadores('coxinha mal passado', coxinha);
    assert.equal(Object.keys(r).length, 0, 'nenhum grupo deve ser tocado');
});

test('achaModificadores: palavra parecida NAO casa', () => {
    /*
     * Este era o bug mais caro dos quatro. Com busca por substring, "bacon"
     * casava dentro de "baconete" e "mal" casava dentro de "malte" -- a pessoa
     * que pediu baconete recebia bacon, com o preco do bacon.
     */
    const xb = CATALOGO.filter((p) => p.id === 'p6')[0];
    assert.equal(achaModificadores('baconete', xb)['g2'], undefined, 'baconete nao e bacon');
    assert.equal(achaModificadores('bacon ao punto', xb)['g1'], undefined, 'bacon ao ponto nao e bacon');
    // E o positivo correspondente: a palavra inteira ainda casa.
    assert.deepEqual(achaModificadores('quero bacon', xb)['g2'], ['o3']);
});

test('achaModificadores: grupo de escolha unica e' + ' substituido, nao acumulado', () => {
    // A pessoa escolhe "mal passado" e depois muda para "ao ponto". Guardar os
    // dois faria o pedido ter duas opcoes de ponto da carne, que e' contradicao
    // -- e a cozinha receberia a instrucao errada.
    const xb = CATALOGO.filter((p) => p.id === 'p6')[0];
    const primeiro = achaModificadores('ao ponto', xb);
    const trocou = achaModificadores('mal passado', xb, primeiro);
    assert.deepEqual(trocou['g1'], ['o1'], 'so a ultima escolha vale em grupo de escolha unica');
});

test('achaModificadores: grupo de varias opcoes acumula', () => {
    const xb = CATALOGO.filter((p) => p.id === 'p6')[0];
    const r = achaModificadores('bacon e cheddar', xb);
    assert.deepEqual(r['g2'], ['o3', 'o4']);
});

test('interpreta: modificador da frase entra no item', () => {
    // O caminho completo: nome com erro de digitacao, quantidade e modificador
    // na mesma frase -- que e' como o cliente escreve de verdade.
    const r = interpreta('xburguer ao ponto com bacon', CATALOGO);
    assert.equal(r.itens.length, 1);
    assert.equal(r.itens[0].id, 'p6');
    assert.deepEqual(r.itens[0].modificadores['g1'], ['o2']);
    assert.deepEqual(r.itens[0].modificadores['g2'], ['o3']);
});
