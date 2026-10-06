/*
 * O carrinho do cliente, e as palavras que mudam o fluxo.
 * A regra de um pedido de WhatsApp mora aqui e nao em bot.ts: estas funcoes nao
 * conhecem WhatsApp, banco nem preco. Preco nao entra -- vem do banco, em priceCart.
 */

export type LinhaCarrinho = {
    id: string;
    nome: string;
    qtd: number;
    /** Opcoes de modificador, por grupo. */
    modificadores: Record<string, string[]>;
};

/** Quantas unidades somam as linhas. */
export function totalUnidades(carrinho: LinhaCarrinho[]): number {
    return carrinho.reduce((s, l) => s + l.qtd, 0);
}

/** Duas listas de ids sao a mesma combinacao? A ordem nao conta. */
export function mesmaCombinacao(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
    const chaves = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const g of chaves) {
        const x = [...(a[g] ?? [])].sort().join('|');
        const y = [...(b[g] ?? [])].sort().join('|');
        if (x !== y) return false;
    }
    return true;
}

/**
 * Junta o item ao que ja estava pedido: mesmo produto E mesma combinacao somam
 * quantidade; qualquer outra coisa vira linha nova.
 * Qtd zero remove a linha -- "0 coxinha" para desfazer nao pode virar "0x" no total.
 */
export function juntaItem(carrinho: LinhaCarrinho[], novo: LinhaCarrinho): LinhaCarrinho[] {
    if (novo.qtd <= 0) return carrinho;

    const indice = carrinho.findIndex(
        (l) => l.id === novo.id && mesmaCombinacao(l.modificadores, novo.modificadores)
    );

    if (indice >= 0) {
        /*
         * Substitui a linha em vez de somar nela: somar mutaria um objeto que pode
         * ser compartilhado com quem chamou, e a mutacao apareceria dobrada em
         * outro lugar sem dar erro.
         */
        const existente = carrinho[indice];
        carrinho[indice] = { ...existente, qtd: existente.qtd + novo.qtd };
        return carrinho;
    }

    carrinho.push(novo);
    return carrinho;
}

/**
 * Texto do pedido em aberto, mostrado DEPOIS de cada adicao -- e' o que permite
 * ver o erro antes de fechar. Sem desconto: dinheiro so aparece no servidor, com o
 * preco do banco.
 */
export function textoDoCarrinho(carrinho: LinhaCarrinho[]): string {
    if (carrinho.length === 0) {
        return '🧾 Seu pedido está vazio. Diga o que você quer ou mande *cardápio* para ver a lista.';
    }

    let texto = '🧾 *Seu pedido até agora:*\n\n';
    for (const l of carrinho) {
        const extra = rotuloDosModificadores(l);
        texto += `• ${l.qtd}x ${l.nome}${extra ? ` (${extra})` : ''}\n`;
    }
    texto += `\n_${totalUnidades(carrinho)} item(ns) no pedido._`;
    /*
 * Aqui "1" e' o produto numero um da lista, e nao o atalho do cardapio: este
 * texto so aparece com a lista na tela, e mandar "1" para rever o cardapio
 * acrescentava o primeiro prato de novo.
 */
    texto += '\n\nMais alguma coisa? Diga o nome. Quando terminar, mande *finalizar*. Para rever o cardápio, *cardápio*.';
    return texto;
}

/**
 * Rotulo legivel dos modificadores escolhidos.
 * Os ids que chegam nao dizem nada para a pessoa, entao a funcao recebe os NOMES
 * ja resolvidos: descobrir sozinha exigiria o catalogo inteiro para uma frase.
 */
export function rotuloDosModificadores(linha: LinhaCarrinho, nomes?: string[]): string {
    const ids: string[] = [];
    for (const grupo of Object.keys(linha.modificadores ?? {})) {
        for (const opcao of linha.modificadores[grupo] ?? []) ids.push(opcao);
    }
    if (ids.length === 0) return '';
    return nomes && nomes.length >= ids.length ? nomes.join(', ') : ids.join(', ');
}

/* ------------------------------------------------------------- os comandos */

/*
 * Saudeacao e' outra coisa: a pessoa cumprimenta, nao pede. Reconhecer antes do
 * resto e' o que impede que um "oi" no meio da escolha apague o item com
 * modificador pendente e mande a pessoa para o menu principal.
 */
export function ehSaudacao(t: string): boolean {
    return ['oi', 'ola', 'olá', 'opa', 'eai', 'e ai', 'bom dia', 'boa tarde', 'boa noite'].includes(t);
}

/*
 * Pedido explicito do menu, e nao saudacao: quem pede o menu esta recomecando.
 * O passo entra so para o "0": no meio dos modificadores ele quer dizer "nenhum",
 * e tratar como "voltar" apagaria o item que a pessoa estava escolhendo.
 */
export function ehComandoMenu(t: string, step?: string): boolean {
    if (t === '0' && step === 'ESCOLHENDO_MOD') return false;
    return ['menu', 'inicio', 'início', '0', 'cardapio', 'cardápio', 'opcoes', 'opções', 'voltar'].includes(t);
}

/*
 * Varias palavras para o mesmo comando: um bot que so conhece uma delas perde a
 * venda na hora de fechar. A comparacao e' por IGUALDADE -- "finalizando" e' a
 * pessoa pensando em voz alta, e nao deve fechar um pedido por acidente.
 */
export function ehComandoFechar(t: string): boolean {
    return [
        'finalizar', 'finaliza', 'finalizado',
        'fechar', 'fechar pedido', 'fechar o pedido',
        'pode enviar', 'pode mandar', 'manda', 'enviar', 'envia',
        'confirmar', 'confirmar pedido', 'confirmar o pedido',
        'isso e tudo', 'e so isso', 'so isso', 'acabou',
    ].includes(t);
}

export function ehComandoLimpar(t: string): boolean {
    return ['limpar', 'apagar', 'cancelar', 'cancelar pedido', 'descartar', 'comecar de novo', 'zerar'].includes(t);
}

export function ehComandoVerCarrinho(t: string): boolean {
    return ['carrinho', 'meu carrinho', 'ver carrinho', 'meu pedido', 'o que eu pedi', 'o que pedi', 'pedido'].includes(t);
}
