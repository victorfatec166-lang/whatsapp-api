/*
 * Categorias de produto: a lista canonica e a normalizacao do que a pessoa digita.
 *
 * POR QUE ISTO EXISTE, E POR QUE A LISTA FICA AQUI
 *
 * "Categoria" ja existia em tudo -- no filtro do Catalogo, no do Estoque, no do
 * PDV, no formulario do produto com uma datalist de sugestao. O que nao existia
 * era a lista. E sem lista, o campo vira texto livre, texto livre vira
 * proliferacao: alguem digita "Salgado", alguem digita "salgados", alguem digita
 * "SALGADO", e o catalogo ganha tres categorias que sao a mesma coisa -- com
 * tres entradas no filtro e tres grupos no PDV.
 *
 * Esse e' o defeito real, e ele nao aparece olhando a tela: aparece quando a
 * pessoa procura "salgado" no PDV e o produto esta em "Salgados". O filtro
 * compara com `toLowerCase()`, que resolve caixa mas naoresolve plural nem
 * acento.
 *
 * POR QUE A CANONICA E' FEITA AQUI E NAO NA TELA
 *
 * A lista aparece em quatro lugares: formulario do produto, filtro do Catalogo,
 * filtro do Estoque e navegacao do PDV. Se cada tela mantivesse a sua propria
 * copia, a primeira delas a mudar seria a errada, e o sintoma seria "o produto
 * aparece no filtro de uma tela e nao na outra". Uma lista so, usada por todas.
 *
 * A LISTA E' SUGESTAO, NAO TRAVA
 *
 * A datalist do formulario sugere e o campo aceita o que vier. Uma loja que
 * vende "Cafes" e nao "Bebidas" precisa poder escrever "Cafes" -- travar a lista
 * seria trocar um problema pequeno (proliferacao) por um maior (nao da para
 * cadastrar o que a loja vende). O que a normalizacao garante e' que a
 * proliferacao pare nas categorias que CONHECEMOS, e que o resto continue
 * funcionando como hoje.
 *
 * Alem disso: o filtro de tela ja compara sem diferenciar caixa, entao duas
 * categorias escritas de formas diferentes nao quebram o filtro -- elas so
 * aparecem separadas na lista. Por isso a normalizacao e' o comfy e nao o
 * obrigatorio.
 */

/**
 * As categorias sugeridas.
 *
 * As quatro sao as que a loja pediu. "Geral" vem do schema como padrao e fica
 * na lista de proposito: e' onde cai o produto sem classificacao, e ela precisa
 * aparecer no filtro do PDV -- um produto sem categoria que nao aparece em
 * lugar nenhum e' um produto invisivel no balcao.
 */
export const CATEGORIAS: string[] = ['Bebidas', 'Salgados', 'Pastéis', 'Refeições', 'Geral'];

/** A que a categoria cai quando nao se informa nenhuma. */
export const CATEGORIA_PADRAO = 'Geral';

/**
 * Chave de comparacao: minuscula, sem acento e sem espaco.
 *
 * E' o que faz "PASTEL", "pasteis" e "Pastéis" cairem no mesmo lugar, e o que
 * faz o filtro de tela e a normalizacao concordarem sobre o que e' "a mesma
 * categoria". Nao ha acentos e nao ha espaco porque nenhum dos dois muda o
 * grupo do produto: e' so o jeito de escrever.
 */
function chave(valor: string): string {
    return valor
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * As variantes aceitas de cada categoria canonica, ja em chave.
 *
 * Escritas a mao de proposito. Um gerador de variantes tentaria adivinhar o
 * plural e o genero do portugues, e errar os dois -- "Salgadas" e "Salgado" nao
 * sao a mesma palavra em portugues. A lista e' curta e e' conferida a olho.
 */
const VARIANTES: Record<string, string[]> = {
    bebidas: ['bebida', 'bebidas', 'drinks', 'refri', 'refrigerante', 'refrigerantes', 'sucos', 'suco'],
    salgados: ['salgado', 'salgados', 'lanches', 'lanchonete', 'porcao', 'porcoes', 'salgados e pasteis'],
    pasteis: ['pastel', 'pasteis', 'pasta', 'salgados e pasteis'],
    refeicoes: ['refeicao', 'refeicoes', 'almoco', 'almocos', 'jantar', 'prato', 'pratos', 'refeicao completa'],
    geral: ['geral', 'outros', 'outras', 'sem categoria', 'sem categoria definida'],
};

/** Indice pronto: chave -> nome canonico. Montado uma vez, no carregamento. */
const POR_CHAVE: Map<string, string> = (() => {
    const mapa = new Map<string, string>();
    for (const canonica of CATEGORIAS) {
        const k = chave(canonica);
        mapa.set(k, canonica);
        for (const v of VARIANTES[k] ?? []) mapa.set(chave(v), canonica);
    }
    return mapa;
})();

/**
 * Normaliza o que a pessoa digitou no campo de categoria.
 *
 * Devolve o nome canonico quando reconhece, e devolve o que foi digitado --
 * limpo -- quando nao reconhece. Reconhecer e' cortesia; o que a pessoa escreveu
 * sempre vale.
 */
export function normalizarCategoria(valor: unknown): string {
    const texto = String(valor ?? '').trim();
    if (texto === '') return CATEGORIA_PADRAO;
    return POR_CHAVE.get(chave(texto)) ?? texto;
}

/** O valor e' uma das categorias canonicas? Serve para destacar no filtro. */
export function ehCategoriaSugerida(valor: string): boolean {
    return POR_CHAVE.has(chave(valor));
}

/**
 * As categorias que existem no catalogo, mais as sugeridas que ainda nao
 * aparecem.
 *
 * A ordem e' a que importa no PDV: as canonicas primeiro, na ordem em que a
 * loja as le (bebida, salgado, pastel, refeicao), e depois as que a loja
 * inventou, em ordem alfabetica. Um filtro que lista "Salgados" entre
 * "Graos" e "Pao de queijo" obriga a pessoa a ler a lista inteira; na ordem dos
 * grupos do balcao, ela le ate o que procura.
 */
export function categoriasDoCatalogo(existentes: string[]): string[] {
    const canonicas = CATEGORIAS.filter((c) => existentes.some((e) => chave(e) === chave(c)));
    const extras = [...new Set(existentes.filter((e) => !ehCategoriaSugerida(e)))]
        .filter((e) => e.trim() !== '')
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return [...canonicas, ...extras];
}
