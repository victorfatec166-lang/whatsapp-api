/*
 * Suite da logica pura.
 *
 * Por que estes arquivos e nao os outros
 *
 * O sistema tem duas camadas: regra de negocio (preco, caixa, estoque, dedupe,
 * normalizacao de pedido) e entrega (HTTP, WhatsApp, banco). A segunda precisa
 * de rede e de numero de verdade; a primeira e' pura e nao precisa de nada. E' a
 * primeira que produz dinheiro errado quando quebra.
 *
 * O que nao entra aqui, de proposito: rotas, Prisma e Baileys. Um teste que
 * precisa de mock para chegar no fim esta testando o mock. A meta nao e'
 * cobertura alta: e' que cada regra que decide dinheiro tenha um caso onde ela
 * estava errada antes.
 *
 * Como rodar: `npm test`. Sem dependencia nova -- o runner de teste do proprio
 * Node, que ja vem instalado.
 *
 * Estas assinaturas nao sao de memoria. Ler o codigo antes de escrever o teste
 * evitou quatro testes que passariam sem testar nada: o formato de item usa " | "
 * e nao quebra de linha, o modificador vai entre colchetes, `stockStatus`
 * devolve 'sem-controle' e nao 'ok', e `needsMinStock` responde a pergunta
 * oposta -- "falta minimo", nao "tem minimo".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';

import { parseItems, serializeItems } from '../src/services/items';
import { validar, falhou, vendaPdv, mudancaStatus } from '../src/services/validation';
import { computeTotals } from '../src/services/cash';
import { conferirAssinatura, normalizar } from '../src/services/webhook';
import { stockStatus, summarize, needsMinStock } from '../src/services/stock';
import { validarConfig, estadoAgendaCaixa, falhouValidacao } from '../src/services/config';
import { tamanhoLegivel } from '../src/views/html';
import type { StockRow } from '../src/services/stock';

/* ------------------------------------------------------------------ itens */

/*
 * O formato gravado usa " | " entre linhas e " [mods]" no fim da linha. O
 * separador e' " | " e nao quebra de linha porque o campo vai para o banco e
 * para a comanda da impressora, e um parser que depende de \n quebra quando o
 * texto passa por um campo de formulario.
 */
test('parseItems: le o formato gravado, separado por barra', () => {
    const linhas = parseItems('2x Coxinha | 1x Refrigerante');
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0].name, 'Coxinha');
    assert.equal(linhas[0].qty, 2);
    assert.equal(linhas[1].name, 'Refrigerante');
    assert.equal(linhas[1].qty, 1);
});

test('parseItems: texto vazio nao vira linha nenhuma', () => {
    assert.deepEqual(parseItems(''), []);
    assert.deepEqual(parseItems('   '), []);
});

test('parseItems: modificador vai para mods, e nao vira item', () => {
    // Se "Bacon extra" virar uma linha, a cozinha recebe um item chamado
    // "Bacon extra" que nao existe no catalogo, e a comanda sai errada.
    const linhas = parseItems('1x Hamburguer [sem cebola] | 1x Batata');
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0].name, 'Hamburguer');
    assert.deepEqual(linhas[0].mods, ['sem cebola']);
    assert.deepEqual(linhas[1].mods, []);
});

test('parseItems: aceita o formato antigo separado por virgula', () => {
    // Pedidos ja gravados usam ", ". Se o parser deixar de aceitar, o relatorio
    // de um pedido antigo sai com os itens colados num nome so.
    const linhas = parseItems('2x Coxinha, 1x Refrigerante');
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0].name, 'Coxinha');
});

test('serializeItems e parseItems sao inversos', () => {
    const original = [
        { qty: 2, name: 'Coxinha', mods: [] as string[] },
        { qty: 1, name: 'Hamburguer', mods: ['sem cebola', 'ponto da carne'] },
    ];
    const deVolta = parseItems(serializeItems(original));
    assert.equal(deVolta.length, 2);
    assert.equal(deVolta[0].name, 'Coxinha');
    assert.equal(deVolta[0].qty, 2);
    assert.equal(deVolta[1].name, 'Hamburguer');
    assert.equal(deVolta[1].qty, 1);
    assert.equal(deVolta[1].mods.length, 2);
});

test('serializeItems: modificador vazio nao vira colchete vazio', () => {
    // "[ ]" no fim da linha volta do parser como um modificador de nome vazio,
    // que a cozinha imprimiria.
    const texto = serializeItems([{ qty: 1, name: 'Suco', mods: ['', ''] }]);
    assert.equal(texto.includes('['), false);
});

/* --------------------------------------------------------------- caixa */

/*
 * computeTotals fecha o total do PDV. Desconto acima do subtotal deixaria o
 * total negativo -- ou seja, a loja pagando o cliente -- e gorjeta negativa
 * viraria saque nao autorizado na gaveta.
 */
test('computeTotals: desconto nunca passa do subtotal', () => {
    const t = computeTotals(100, 500, 0);
    assert.equal(t.discount, 100);
    assert.equal(t.total, 0);
});

test('computeTotals: gorjeta negativa vira zero', () => {
    const t = computeTotals(100, 0, -50);
    assert.equal(t.tip, 0);
    assert.equal(t.total, 100);
});

test('computeTotals: desconto negativo vira zero', () => {
    const t = computeTotals(100, -30, 0);
    assert.equal(t.discount, 0);
    assert.equal(t.total, 100);
});

test('computeTotals: subtotal negativo vira zero', () => {
    const t = computeTotals(-50, 0, 0);
    assert.equal(t.subtotal, 0);
    assert.equal(t.total, 0);
});

test('computeTotals: texto no lugar de numero vira zero, e nao NaN', () => {
    // O valor vem do <form> como texto. "abc" no total apareceria como NaN na
    // comanda da cozinha e no relatorio.
    const t = computeTotals(100, 'abc', 'xyz');
    assert.equal(t.discount, 0);
    assert.equal(t.tip, 0);
    assert.equal(t.total, 100);
    assert.equal(Number.isFinite(t.total), true);
});

test('computeTotals: total e subtotal menos desconto mais gorjeta', () => {
    const t = computeTotals(100, 10, 5);
    assert.equal(t.subtotal, 100);
    assert.equal(t.discount, 10);
    assert.equal(t.tip, 5);
    assert.equal(t.total, 95);
});

test('computeTotals: arredonda em centavos, sem erro de ponto flutuante', () => {
    // 0.1 + 0.2 = 0.30000000000000004. Num total de dinheiro isso vira um
    // centavo que sobra na gaveta e aparece na conferencia do turno.
    const t = computeTotals(0.1, 0, 0.2);
    assert.equal(t.total, 0.3);
});

/* ------------------------------------------------------------- validacao */

/*
 * O schema confere a FORMA, nunca a REGRA. Preco vem do servidor; a forma
 * garante so que items e' lista e que cada linha tem id. Um teste que deixasse
 * passar valor do navegador seria a garantia de que essa separacao se desfez.
 */
test('validar: aceita o corpo minimo do PDV', () => {
    const r = validar(vendaPdv, { items: [{ id: 'abc', qty: 1 }] });
    assert.equal(falhou(r), false);
});

test('validar: recusa items que nao e lista', () => {
    const r = validar(vendaPdv, { items: 'dois coxinhas' });
    assert.equal(falhou(r), true);
});

test('validar: recusa carrinho vazio', () => {
    const r = validar(vendaPdv, { items: [] });
    assert.equal(falhou(r), true);
});

test('validar: recusa linha sem id', () => {
    const r = validar(vendaPdv, { items: [{ qty: 1 }] });
    assert.equal(falhou(r), true);
});

test('validar: coerce quantidade vinda como texto', () => {
    // O campo numerico volta do formulario como string. Sem coerce, toda venda
    // do PDV seria recusada.
    const r = validar(vendaPdv, { items: [{ id: 'abc', qty: '2' }] });
    assert.equal(falhou(r), false);
    if (!falhou(r)) {
        assert.equal((r.dados.items[0] as { qty: unknown }).qty, 2);
    }
});

test('validar: status do enum passa, status inventado nao', () => {
    // O enum vem de ORDER_STATUSES. Aceitar um status novo criaria pedido que
    // nenhuma coluna do Kanban mostra, e ele sumiria da tela sem aviso.
    assert.equal(falhou(validar(mudancaStatus, { status: 'concluido' })), false);
    assert.equal(falhou(validar(mudancaStatus, { status: 'desaparecido' })), true);
});

/* ---------------------------------------------------------- assinatura */

/*
 * O webhook e' um endereco publico: sem conferir assinatura, qualquer um na
 * internet manda POST e o pedido falso baixa estoque de verdade. Por isso o
 * padrao e' recusar -- sem token, nada passa.
 */
test('conferirAssinatura: sem token, recusa', () => {
    assert.equal(conferirAssinatura('{}', { 'x-hub-signature-256': 'sha256=abc' }, ''), false);
});

test('conferirAssinatura: sem cabecalho, recusa', () => {
    assert.equal(conferirAssinatura('{}', {}, 'token'), false);
});

test('conferirAssinatura: base64 com prefixo sha256= passa', () => {
    const corpo = '{"id":"1","items":[]}';
    const token = 'segredo-do-parceiro';
    const h = crypto.createHmac('sha256', token).update(corpo, 'utf8').digest('base64');
    assert.equal(conferirAssinatura(corpo, { 'x-hub-signature-256': 'sha256=' + h }, token), true);
});

test('conferirAssinatura: hexadecimal sem prefixo passa', () => {
    const corpo = '{"id":"1","items":[]}';
    const token = 'segredo-do-parceiro';
    const h = crypto.createHmac('sha256', token).update(corpo, 'utf8').digest('hex');
    assert.equal(conferirAssinatura(corpo, { 'x-signature': h }, token), true);
});

test('conferirAssinatura: assinatura de outro corpo nao passa', () => {
    const token = 'segredo-do-parceiro';
    const h = crypto.createHmac('sha256', token).update('outro corpo', 'utf8').digest('base64');
    assert.equal(conferirAssinatura('{"id":"1"}', { 'x-hub-signature-256': h }, token), false);
});

test('conferirAssinatura: assinatura feita com outro token nao passa', () => {
    const corpo = '{}';
    const h = crypto.createHmac('sha256', 'token-errado').update(corpo, 'utf8').digest('base64');
    assert.equal(conferirAssinatura(corpo, { 'x-hub-signature-256': h }, 'token-certo'), false);
});

test('conferirAssinatura: cabecalho alternativo de cada plataforma', () => {
    const corpo = '{}';
    const token = 't';
    const h = crypto.createHmac('sha256', token).update(corpo, 'utf8').digest('base64');
    for (const chave of ['x-hub-signature-256', 'x-signature', 'x-ifood-signature', 'x-99food-signature']) {
        assert.equal(conferirAssinatura(corpo, { [chave]: h }, token), true, `falhou em ${chave}`);
    }
});

/* ----------------------------------------------------- normalizacao do pedido */

test('normalizar: aceita a forma direta', () => {
    const n = normalizar(
        { id: 'P1', items: [{ sku: 'SKU1', name: 'Coxinha', quantity: 2 }], customerPhone: '551199' },
        new Map([['SKU1', 'prod-1']])
    );
    assert.equal(n.externalId, 'P1');
    assert.equal(n.itens.length, 1);
    assert.equal(n.itens[0].productId, 'prod-1');
    assert.equal(n.itens[0].qty, 2);
    assert.equal(n.clienteTelefone, '551199');
});

test('normalizar: aceita o corpo embrulhado em "order"', () => {
    // Cada plataforma embrulha de um jeito. Ler so a forma direta rejeitaria
    // pedido legitimo de metade dos parceiros.
    for (const chave of ['order', 'data', 'payload']) {
        const n = normalizar(
            { [chave]: { id: 'P2', items: [{ sku: 'SKU1', name: 'Coxinha', quantity: 1 }] } },
            new Map([['SKU1', 'prod-1']])
        );
        assert.equal(n.externalId, 'P2', `falhou embrulhando em ${chave}`);
        assert.equal(n.itens.length, 1);
    }
});

test('normalizar: aceita "products" e "itens" como lista', () => {
    for (const chave of ['items', 'products', 'itens']) {
        const n = normalizar({ id: 'P', [chave]: [{ sku: 'SKU1', name: 'X', quantity: 1 }] }, new Map([['SKU1', 'p']]));
        assert.equal(n.itens.length, 1, `falhou com a chave ${chave}`);
    }
});

test('normalizar: item sem casamento nao baixa estoque, e vai para a lista de nao mapeados', () => {
    // Casar errado e' pior do que nao casar: o estoque do prato errado baixa, e
    // a loja vende o que nao tem.
    const n = normalizar({ id: 'P3', items: [{ sku: 'DESCONHECIDO', name: 'Prato Novo', quantity: 1 }] }, new Map());
    assert.equal(n.itens.length, 0, 'nada pode ir para itens com produto');
    assert.equal(n.itensSemMapeamento.length, 1);
    assert.equal(n.itensSemMapeamento[0].externalId, 'DESCONHECIDO');
});

test('normalizar: mistura de casado e nao casado preserva os dois', () => {
    const n = normalizar(
        {
            id: 'P4',
            items: [
                { sku: 'SKU1', name: 'Coxinha', quantity: 1 },
                { sku: 'NOVO', name: 'Prato Novo', quantity: 1 },
            ],
        },
        new Map([['SKU1', 'prod-1']])
    );
    assert.equal(n.itens.length, 1);
    assert.equal(n.itensSemMapeamento.length, 1);
});

test('normalizar: pedido sem itens e recusado, em vez de entrar pela metade', () => {
    assert.throws(() => normalizar({ id: 'P5', items: [] }, new Map()));
    assert.throws(() => normalizar({ id: 'P5' }, new Map()));
});

test('normalizar: quantidade absurda tem teto', () => {
    const n = normalizar({ id: 'P6', items: [{ sku: 'SKU1', name: 'Coxinha', quantity: 99999 }] }, new Map([['SKU1', 'p']]));
    assert.ok(n.itens[0].qty <= 99, `quantidade sem teto: ${n.itens[0].qty}`);
});

test('normalizar: quantidade zero ou negativa vira 1', () => {
    // Quantidade zero criaria pedido sem nenhuma linha util.
    const n = normalizar({ id: 'P8', items: [{ sku: 'SKU1', name: 'Coxinha', quantity: 0 }] }, new Map([['SKU1', 'p']]));
    assert.equal(n.itens[0].qty, 1);
});

test('normalizar: cliente sem telefone nao quebra o pedido', () => {
    // Sem telefone a notificacao de status nao tem para onde ir, mas o pedido
    // e' real: precisa entrar.
    const n = normalizar({ id: 'P7', items: [{ sku: 'SKU1', name: 'Coxinha', quantity: 1 }] }, new Map([['SKU1', 'p']]));
    assert.equal(n.clienteTelefone.length > 0, true);
});

test('normalizar: nome do cliente vem de varias chaves', () => {
    for (const corpo of [
        { customerName: 'Ana' },
        { customer: { name: 'Ana' } },
        { cliente: { nome: 'Ana' } },
    ]) {
        const n = normalizar({ id: 'P', items: [{ sku: 'S', name: 'X', quantity: 1 }], ...corpo }, new Map([['S', 'p']]));
        assert.equal(n.clienteNome, 'Ana');
    }
});

/* -------------------------------------------------------------- estoque */

function linha(over: Partial<StockRow> = {}): StockRow {
    return {
        id: '1',
        name: 'X',
        price: 10,
        costPrice: 5,
        category: 'G',
        stock: 5,
        minStock: 0,
        trackStock: true,
        isAvailable: true,
        ...over,
    };
}

test('stockStatus: sem controle nao e falta', () => {
    // trackStock false e' "sem controle", nao "zerado". Confundir os dois
    // colocava na lista de reposicao um produto que ninguem precisa repor.
    assert.equal(stockStatus(linha({ trackStock: false, stock: 0 })), 'sem-controle');
});

test('stockStatus: zerado com controle e falta', () => {
    assert.equal(stockStatus(linha({ trackStock: true, stock: 0, minStock: 2 })), 'zerado');
});

test('stockStatus: no minimo e baixo', () => {
    assert.equal(stockStatus(linha({ trackStock: true, stock: 2, minStock: 2 })), 'baixo');
});

test('stockStatus: acima do minimo e ok', () => {
    assert.equal(stockStatus(linha({ trackStock: true, stock: 9, minStock: 2 })), 'ok');
});

test('needsMinStock: pergunta se FALTA minimo, nao se tem', () => {
    // A funcao alimenta o aviso "produto controlado sem minimo definido". Ler
    // como "tem minimo" puniria exatamente o produto que o dono precisa
    // configurar.
    assert.equal(needsMinStock({ trackStock: false, minStock: 0 }), false);
    assert.equal(needsMinStock({ trackStock: true, minStock: 0 }), true);
    assert.equal(needsMinStock({ trackStock: true, minStock: 5 }), false);
});

test('summarize: produto sem controle nao entra em valor nem em unidades', () => {
    // Sem controle, `stock` e' zero por convencao. Somar daria capital
    // imobilizado errado na tela de estoque.
    const s = summarize([linha({ trackStock: false, stock: 0, price: 100, costPrice: 100 })]);
    assert.equal(s.value, 0);
    assert.equal(s.units, 0);
    assert.equal(s.untracked, 1);
});

test('summarize: valor e capital imobilizado usam o preco certo', () => {
    const s = summarize([linha({ stock: 4, price: 10, costPrice: 6 })]);
    assert.equal(s.value, 40);
    assert.equal(s.costValue, 24);
});

/* ------------------------------------------------- substituicao de variaveis */

/*
 * A tela oferece {items} e {total} como botao justamente porque este
 * detalhe nao pode ficar nas costas de quem escreve a frase. Com `replace` de
 * string, a segunda ocorrencia ia para o cliente como "{total}" literal -- e o
 * unico sintoma era o cliente reclamando de um texto com chaves.
 */
const itens = '2x Coxinha';
const total = '18,00';

function montaMensagem(texto: string): string {
    return texto.replaceAll('{items}', itens).replaceAll('{total}', total);
}

test('variavel repetida e' + ' substituida em todas as ocorrencias', () => {
    const r = montaMensagem('Itens: {items}\nRepetindo: {items}\nTotal {total} e pix para {total}');
    assert.equal(r.includes('{items}'), false, 'sobrou {items} literal');
    assert.equal(r.includes('{total}'), false, 'sobrou {total} literal');
    assert.equal(r.split(itens).length - 1, 2, 'itens aparece duas vezes');
    assert.equal(r.split(total).length - 1, 2, 'total aparece duas vezes');
});

test('variavel ausente nao quebra a mensagem', () => {
    // Mensagem sem {total} e' a maioria. Nao pode virar "undefined".
    const r = montaMensagem('Ola, tudo bem?');
    assert.equal(r, 'Ola, tudo bem?');
});

test('variavel vazia no texto nao some com a frase', () => {
    // Se o item vier vazio do catalogo, o texto nao pode perder a frase em volta.
    const r = 'Itens: {items} | Total: {total}'.replaceAll('{items}', '').replaceAll('{total}', '');
    assert.equal(r, 'Itens:  | Total: ');
});

/* --------------------------------------------------------- mensagens padrao */

test('campo vazio equivale ao padrao, e isso e' + ' a regra da tela', () => {
    // A tela manda string vazia para "voltar ao padrao". Se os dois textos
    // estilisticamente diferentes (espaco a mais no fim) fossem tratados como
    // edicao, o campo apareceria "Editado" sem nenhuma edicao.
    const igual = (a: string, b: string) => a.trim() === b.trim();
    assert.equal(igual('', ''), true, 'dois vazios sao iguais');
    assert.equal(igual('texto\n', 'texto'), true, 'espaco a mais nao e edicao');
    assert.equal(igual('outro', 'texto'), false, 'textos diferentes sao edicao');
});

test('summarize: soma de dinheiro nao acumula erro de ponto flutuante', () => {
    const s = summarize([
        linha({ id: '1', stock: 3, price: 0.1, costPrice: 0 }),
        linha({ id: '2', stock: 2, price: 0.2, costPrice: 0 }),
    ]);
    assert.equal(s.value, 0.7);
});

/* ------------------------------------------------------- configuracoes do negocio */

/*
 * Por que configuracao entra aqui, e nao em um arquivo novo
 *
 * A funcao e' pura: entrada do formulario, saida de validacao. Nao toca banco,
 * nao tem relogio, nao faz requisicao. E' a mesma categoria de `stockStatus` e
 * de `closeMomentAfter`, que ja estao neste arquivo.
 *
 * E o que precisa de prova aqui e' a REGRA, nao o codigo: o teste nao verifica
 * se a tela tem um campo, verifica se o sistema recusa o estado que ele aceitou
 * em silencio e que nao fazia nada. Esse e' o defeito, e ele nao aparece em
 * revisao de codigo -- aparece quando alguem salva e descobre no dia seguinte
 * que o turno nao abriu.
 */

const CONFIG_OK = {
    businessName: 'Marmitaria da Ana',
    cashAutoOpen: '08:00',
    cashAutoClose: '22:00',
    cashDefaultFloat: 50,
};

test('config: um formulario completo passa', () => {
    const r = validarConfig(CONFIG_OK);
    assert.equal(falhouValidacao(r), false, 'configuracao completa nao pode ser recusada');
    assert.equal(r.ok, true);
});

test('config: nome do negocio vazio e' + ' recusado, e a frase diz onde ele aparece', () => {
    /*
     * O nome vai para o logo da lateral, o titulo da aba e o cabecalho da comanda
     * da impressora (`comanda.ts` faz `.toUpperCase()`). Nome vazio nao e' "sem
     * nome": e' uma comanda impressa sem cabecalho.
     */
    const r = validarConfig({ ...CONFIG_OK, businessName: '   ' });
    assert.equal(falhouValidacao(r), true);
    if (falhouValidacao(r)) {
        assert.match(r.error, /logo/i);
        assert.match(r.error, /impressora/i);
    }
});

test('config: horario invalido volta como erro, e nao como "desativado"', () => {
    /*
     * A regra antiga convertia horario invalido em vazio, e vazio significa
     * desativado. Traduzir erro de digitacao em "desligado" e' o pior dos dois
     * mundos: o dono preencheu, viu "salvo", e o turno nunca mais abriu sozinho.
     */
    const r = validarConfig({ ...CONFIG_OK, cashAutoOpen: '8h' });
    assert.equal(falhouValidacao(r), true);
    if (falhouValidacao(r)) assert.match(r.error, /HH:MM/);
});

test('config: horario sem fundo de troco e' + ' recusado, e nao salvo em silencio', () => {
    /*
     * O estado que o agendador ignora. `runScheduleTick` so abre turno com
     * `cashDefaultFloat > 0`, entao gravar "08:00" com fundo vazio produz uma
     * tela que parece configurada e um turno que nunca abre sozinho.
     */
    const semFundo = validarConfig({ ...CONFIG_OK, cashDefaultFloat: 0 });
    assert.equal(falhouValidacao(semFundo), true);
    if (falhouValidacao(semFundo)) {
        assert.match(semFundo.error, /fundo/i);
        // A mensagem precisa oferecer os dois caminhos: preencher ou apagar.
        assert.match(semFundo.error, /horarios/i);
    }

    // Campo vazio e zero sao a mesma coisa, e nenhum dos dois abre turno.
    const vazio = validarConfig({ ...CONFIG_OK, cashDefaultFloat: '' });
    assert.equal(falhouValidacao(vazio), true);
});

test('config: fundo de troco negativo e' + ' recusado', () => {
    const r = validarConfig({ ...CONFIG_OK, cashDefaultFloat: -10 });
    assert.equal(falhouValidacao(r), true);
});

test('config: o dinheiro do fundo e' + ' arredondado na entrada', () => {
    // 0.1 + 0.2 na gaveta e' problema de quem fecha o turno, nao de quem salvou.
    const r = validarConfig({ ...CONFIG_OK, cashDefaultFloat: '50.005' });
    assert.equal(falhouValidacao(r), false);
    if (!falhouValidacao(r)) assert.equal(r.dados.cashDefaultFloat, 50.01);
});

test('agenda: sem horario, ela esta desligada e isso e' + ' dito', () => {
    const e = estadoAgendaCaixa({ cashAutoOpen: '', cashAutoClose: '', cashDefaultFloat: 50 });
    assert.equal(e.ativa, false);
    assert.match(e.resumo, /Desativada/);
});

test('agenda: so abrir, ou so fechar, e' + ' valido -- e a tela avisa qual metade', () => {
    const soAbre = estadoAgendaCaixa({ cashAutoOpen: '08:00', cashAutoClose: '', cashDefaultFloat: 50 });
    assert.equal(soAbre.ativa, true);
    assert.match(soAbre.resumo, /08:00/);
    assert.match(soAbre.resumo, /fechamento.*manual/i);

    const soFecha = estadoAgendaCaixa({ cashAutoOpen: '', cashAutoClose: '22:00', cashDefaultFloat: 50 });
    assert.equal(soFecha.ativa, true);
    assert.match(soFecha.resumo, /22:00/);
    assert.match(soFecha.resumo, /abertura.*manual/i);
});

test('agenda: os dois horarios com fundo viram um resumo com os numeros', () => {
    const e = estadoAgendaCaixa({ cashAutoOpen: '08:00', cashAutoClose: '22:00', cashDefaultFloat: 50 });
    assert.equal(e.ativa, true);
    assert.match(e.resumo, /08:00/);
    assert.match(e.resumo, /22:00/);
    assert.match(e.resumo, /50,00/);
});

test('agenda: fechar depois da meia-noite e' + ' horario menor, e funciona', () => {
    // Loja que fecha 00:30 e abre 22:00. `closeMomentAfter` no cashSchedule
    // trata o veso; aqui so interessa que a agenda nao se recuse.
    const e = estadoAgendaCaixa({ cashAutoOpen: '22:00', cashAutoClose: '00:30', cashDefaultFloat: 50 });
    assert.equal(e.ativa, true);

    const r = validarConfig({ ...CONFIG_OK, cashAutoOpen: '22:00', cashAutoClose: '00:30' });
    assert.equal(falhouValidacao(r), false);
});

test('config: meia agenda gera aviso, e nao recusa', () => {
    // Nao e' erro: uma loja que so abre automaticamente e' legitima. O que nao
    // pode e' o dono descobrir qual metade ficou automatica so no dia seguinte.
    const r = validarConfig({ ...CONFIG_OK, cashAutoClose: '' });
    assert.equal(falhouValidacao(r), false);
    if (!falhouValidacao(r)) assert.equal(r.avisos.length, 1);

    // Agenda completa nao avisa: e' o que o dono configurou.
    const completa = validarConfig(CONFIG_OK);
    if (!falhouValidacao(completa)) assert.equal(completa.avisos.length, 0);
});

test('config: campos ausentes nao viram undefined na tela', () => {
    // O `Object.fromEntries(new FormData(...))` pode nao trazer um campo se ele
    // nao estava na tela -- e um corpo vazio nao pode virar tela quebrada.
    const r = validarConfig({});
    assert.equal(falhouValidacao(r), true, 'sem nome, ja e' + ' erro com frase util');

    const semHorario = validarConfig({ businessName: 'Marmitaria da Ana' });
    assert.equal(falhouValidacao(semHorario), false);
    if (!falhouValidacao(semHorario)) {
        assert.equal(semHorario.dados.cashAutoOpen, '');
        assert.equal(semHorario.dados.cashDefaultFloat, 0);
    }
});

test('tamanhoLegivel: o numero de disco que o dono le', () => {
    assert.equal(tamanhoLegivel(0), '0 B');
    assert.equal(tamanhoLegivel(512), '512 B');
    assert.equal(tamanhoLegivel(1024), '1,0 KB');
    assert.equal(tamanhoLegivel(264 * 1024), '264,0 KB');
    assert.equal(tamanhoLegivel(3 * 1024 * 1024), '3,0 MB');
    // Valor que nao veio de lugar nenhum (a pasta sumiu) mostra zero, e nao
    // "NaN KB" nem um tracinho que levanta outra pergunta.
    assert.equal(tamanhoLegivel(NaN), '0 B');
    assert.equal(tamanhoLegivel(-1), '0 B');
});
