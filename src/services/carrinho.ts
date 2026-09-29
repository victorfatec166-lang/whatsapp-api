/*
 * O carrinho do cliente, e os comandos de fecha-lo.
 *
 * POR QUE ESTE ARQUIVO EXISTE, SENDO QUE O BOT JA FAZ ISSO
 *
 * Porque este e' o unico lugar onde mora a regra de um pedido de WhatsApp, e a
 * regra precisa de prova. As funcoes aqui nao conhecem WhatsApp, nao conhecem
 * banco e nao conhecem preco -- sao a parte de verdade, e o `bot.ts` e' a parte
 * de entrega. Com essa separacao, "a pessoa pediu a mesma coisa duas vezes, vira
 * uma linha ou duas?" e' uma pergunta de teste, e nao uma coisa que se
 * descobre falando com um cliente de verdade.
 *
 * E PRECO NAO ENTRA AQUI, DE PROPÓSITO
 *
 * Este arquivo soma quantidade e agrupa linha. Ele nao sabe quanto custa nada.
 * O preco vem do banco, recalculado em `priceCart`, e o total do pedido sai de
 * la. Se um dia alguem precisar "corrigir" um total aqui, o comentario
 * abaixo e' o aviso.
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
 * Junta o item ao que ja estava pedido.
 *
 * Mesmo produto E mesma combinacao de modificadores somam quantidade. Qualquer
 * outra coisa vira linha nova.
 *
 * E' o que uma pessoa espera de um carrinho de verdade: pedir "coxinha" duas
 * vezes e' duas coxinhas numa linha so, e nao duas linhas iguais que o painel
 * mostra como dois produtos -- o que faria a cozinha preparar duas vezes sem
 * ninguem ter pedido duas vezes.
 *
 * Quantidade zero remove a linha em vez de deixar um "0x" na tela. E' o que
 * acontece quando o cliente escreve "0 coxinha" para desfazer, e uma linha com
 * zero e' pior que uma linha que nao existe: ela aparece no resumo e no total.
 */
export function juntaItem(carrinho: LinhaCarrinho[], novo: LinhaCarrinho): LinhaCarrinho[] {
    if (novo.qtd <= 0) return carrinho;

    const indice = carrinho.findIndex(
        (l) => l.id === novo.id && mesmaCombinacao(l.modificadores, novo.modificadores)
    );

    if (indice >= 0) {
        /*
         * Substitui a linha em vez de Somar nela.
         *
         * Somar mutaria o objeto que esta no array -- e esse objeto pode ser o
         * mesmo que o chamador passou, ou um objeto de verdade compartilhado. O
         * bug e' silencioso: o primeiro item pedido viraria "quantidade 2" em
         * qualquer outro lugar que usasse aquela mesma linha, inclusive no
         * resumo seguinte. Em teste isso apareceu na hora, com o fixture
         * compartilhado entre casos; em producao seria a segunda vez que a
         * pessoa pede a mesma coisa que aparece dobrada.
         */
        const existente = carrinho[indice];
        carrinho[indice] = { ...existente, qtd: existente.qtd + novo.qtd };
        return carrinho;
    }

    carrinho.push(novo);
    return carrinho;
}

/**
 * Texto do pedido em aberto, para a pessoa conferir.
 *
 * Aparece DEPOIS de cada adicao, e nao so no fim. E' o que permite perceber
 * que escreveu algo errado antes de fechar, e o que evita a surpresa de
 * receber tres pedidos em vez de um.
 *
 * O desconto nao existe aqui, e e' de proposito: o total mostrado e' a soma das
 * unidades, sem dinheiro. Quem mostra dinheiro para o cliente final e' o
 * servidor, no momento de fechar, com o preco do banco.
 */
export function textoDoCarrinho(carrinho: LinhaCarrinho[]): string {
    if (carrinho.length === 0) {
        return '🧾 Seu pedido está vazio. Diga o que você quer ou mande *1* para ver o cardápio.';
    }

    let texto = '🧾 *Seu pedido até agora:*\n\n';
    for (const l of carrinho) {
        const extra = rotuloDosModificadores(l);
        texto += `• ${l.qtd}x ${l.nome}${extra ? ` (${extra})` : ''}\n`;
    }
    texto += `\n_${totalUnidades(carrinho)} item(ns) no pedido._`;
    texto += '\n\nMais alguma coisa? Diga o nome. Quando terminar, mande *finalizar*. Para ver o cardápio, *1*.';
    return texto;
}

/**
 * Rotulo legivel dos modificadores escolhidos.
 *
 * Os ids que chegam aqui nao dizem nada para a pessoa -- "a3f9" e' o que o
 * navegador tem, nao o que o cliente leu. Por isso a funcao recebe os NOMES
 * ja resolvidos, em vez de tentar descobrir sozinha: descobrir exigiria o
 * catalogo inteiro carregado para formatar uma frase, e o catalogo e' grande
 * demais para o ganho.
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
 * Varias palavras para o mesmo comando.
 *
 * A pessoa digita "finalizar", "pode enviar", "fechar o pedido" ou "confirmar"
 * conforme o que lhe vem a cabeca. Um bot que so conhece uma delas volta a
 * dizer "nao entendi" justamente no momento em que a pessoa esta pronta a
 * fechar -- que e' onde custa mais caro perder a venda.
 *
 * A comparacao e' por IGUALDADE, e nao por "comeca com". "finalizar" e' o
 * comando; "finalizando" e' a pessoa pensando em voz alta, e nao deve fechar
 * um pedido por acidente. E a entrada ja vem normalizada do bot, em minuscula
 * e sem acento.
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
