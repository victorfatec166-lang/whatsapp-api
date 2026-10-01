/*
 * Categorias de produto: a lista canonica e a normalizacao do que a pessoa digita.
 * Sem lista, o campo vira texto livre e o catalogo ganha "Salgado", "salgados" e
 * "SALGADO" como tres categorias. A lista e' sugestao: quem vende "Cafes" escreve.
 */

/**
 * As categorias sugeridas. "Geral" vem do schema e fica na lista de proposito:
 * e' onde cai o produto sem classificacao, e sem aparecer no filtro do PDV ele
 * seria invisivel no balcao.
 */
export const CATEGORIAS: string[] = ['Bebidas', 'Salgados', 'Pastéis', 'Refeições', 'Geral'];

/** A que a categoria cai quando nao se informa nenhuma. */
export const CATEGORIA_PADRAO = 'Geral';

/**
 * Chave de comparacao: minuscula, sem acento e sem espaco.
 * E' o que faz "PASTEL", "pasteis" e "Pasteis" cairem no mesmo lugar. Nem acento
 * nem espaco mudam o grupo do produto: e' so o jeito de escrever.
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
 * Escritas a mao: um gerador tentaria adivinhar o plural e erraria os dois --
 * "Salgadas" e "Salgado" nao sao a mesma palavra em portugues.
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
 * Devolve o nome canonico quando reconhece, e devolve o que foi digitado quando
 * nao reconhece: reconhecer e' cortesia, o que a pessoa escreveu sempre vale.
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
 * As categorias do catalogo, mais as sugeridas que ainda nao aparecem.
 * A ordem e' a do balcao: canonicas primeiro, na ordem em que a loja as le, e
 * depois as inventadas em ordem alfabetica.
 */
export function categoriasDoCatalogo(existentes: string[]): string[] {
    const canonicas = CATEGORIAS.filter((c) => existentes.some((e) => chave(e) === chave(c)));
    const extras = [...new Set(existentes.filter((e) => !ehCategoriaSugerida(e)))]
        .filter((e) => e.trim() !== '')
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return [...canonicas, ...extras];
}
