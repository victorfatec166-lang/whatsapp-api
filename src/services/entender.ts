/*
 * Entender o que o cliente escreveu, sem modelo de linguagem.
 *
 * POR QUE ISTO EXISTE, E POR QUE NAO E' IA
 *
 * O bot falava com a pessoa em numeros: "1" para o cardapio, o numero do item,
 * "pular" para pular modificador. O vocabulario todo cabia em doze palavras, e
 * qualquer outra coisa recebia "Opcao invalida". Cliente que escreve "quero 3
 * coxinhas" -- que e' como gente pede comida -- simplesmente nao conseguia pedir.
 *
 * A solucao obvia seria um modelo de linguagem. Aqui nao e', por tres motivos
 * concretos, e nao por ser contra IA:
 *
 * 1. PRECO NUNCA VEM DO LADO DO CLIENTE. E' a regra mais antiga e mais
 *    importante deste sistema: o preco e' lido do banco e recalculado, em
 *    priceCart. Se um modelo decide o que foi pedido, existe um caminho em que
 *    o valor gravado nao passou pelo servidor -- e e' exatamente o que um
 *    cliente malicioso procuraria.
 * 2. A loja nao pode depender de rede nem de terceiro para atender o balcao.
 *    O sistema roda numa maquina de loja, as vezes com internet ruim.
 * 3. O texto do cliente nao precisa sair da maquina. A virada do dia existe
 *    justamente para o dado nao ficar guardado; mandar a conversa para um
 *    provedor seria o contrario disso.
 *
 * Entao o que este modulo faz: le a frase, separa, casa com o catalogo e
 * devolve INTENCAO -- estes produtos, estas quantidades, estes modificadores.
 * Quem valida, calcula e grava continua sendo o servidor. Este arquivo nao tem
 * acesso a preco, a estoque nem a pedido: ele so transforma texto em id de
 * produto.
 *
 * A TOLERANCIA A ERRO DE DIGITACAO E' O QUE FAZ DIFERENCA
 *
 * No balcao o cliente digita com um dedo, no celular, as vezes andando. "coxina"
 * tem de virar "Coxinha" -- e nao por um modelo, mas por distancia de edicao.
 * E' um calculo de tres linhas que roda em microssegundos, nao depende de
 * ninguem, e nunca inventa: se a distancia for grande demais, o produto nao
 * casa e o bot pergunta.
 */

/** Item lido da frase, ja casado com o catalogo. */
export type IntencaoItem = {
    id: string;
    nome: string;
    qtd: number;
    /** Opcoes de modificador casadas por nome, quando a frase traz. */
    modificadores: Record<string, string[]>;
    /** De onde saiu o nome. */
    origem: 'numero' | 'nome-exato' | 'nome-aproximado';
    /** Confianca da aproximacao, de 0 a 1. */
    confianca: number;
};

export type Intencao = {
    itens: IntencaoItem[];
    /** Coisa que o cliente pediu e nao deu para casar com nada do catalogo. */
    naoEntendidos: string[];
};

/* ------------------------------------------------------------- texto basico */

/**
 * Tira acento, baixa a caixa e aperta espacos.
 *
 * A chave de comparacao e' esta. "ARROZ, FEIJAO E SALADA" e "arroz feijao e
 * salada" precisam dar a mesma string, senao o cliente que escreve do mesmo
 * jeito que o cardapio nao acha o produto que ele mesmo escreveu.
 */
export function chave(valor: string): string {
    return valor
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** "coxa de frango 2" -> ["coxa de frango", 2] */
export function separaNumero(texto: string): { nome: string; numero: number | null } {
    const m = texto.trim().match(/^(.*?)\s+(\d{1,2})$/);
    if (!m) return { nome: texto.trim(), numero: null };
    const n = parseInt(m[2], 10);
    return n > 0 && n <= 99 ? { nome: m[1].trim(), numero: n } : { nome: texto.trim(), numero: null };
}

/**
 * Distancia de edicao entre duas palavras, com corte cedo.
 *
 * E' Damerau-Levenshtein, e nao o Levenshtein puro, por causa de um motivo que
 * so aparece na digitacao real: a troca de duas letras vizinhas. "pastel" em vez
 * de "pastel" e' o erro mais comum de dedo em celular, e no Levenshtein conta
 * como DUAS substituicoes -- "patsel" e "pastel" dariam distancia 2, que e' o
 * mesmo que "pastel" e "pastel". O cliente que digitou o nome certo seria
 *recusado, e a loja receberia um pedido de outro prato. Aqui a troca vale 1.
 *
 * O corte por tamanho e' o que segura o custo: se a diferenca de comprimento ja
 * passa do limite, nao ha troca de letra que salve, e comparar letra por letra
 * seria desperdicio. O corte por "minimo da linha" sai mais cedo ainda: assim
 * que uma linha inteira esta acima do limite, o resto so pode piorar.
 */
export function distancia(a: string, b: string, limite: number): number {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > limite) return limite + 1;

    const m = a.length;
    const n = b.length;

    // Matriz com uma linha a mais para as colunas de dois passos atras, que e'
    // o que permite enxergar a transposicao.
    const d: number[][] = [];
    for (let i = 0; i <= m; i++) d.push(new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;

    for (let i = 1; i <= m; i++) {
        let minimo = i;
        for (let j = 1; j <= n; j++) {
            const custo = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(d[i][j - 1] + 1, d[i - 1][j] + 1, d[i - 1][j - 1] + custo);

            // Transposicao: "ab" virando "ba" e' uma operacao, nao duas.
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                v = Math.min(v, d[i - 2][j - 2] + 1);
            }

            d[i][j] = v;
            if (v < minimo) minimo = v;
        }
        // Nenhuma disposicao a partir da linha i chega em menos que `minimo`.
        if (minimo > limite) return limite + 1;
    }

    return d[m][n];
}

/* ------------------------------------------------------------------ o catalogo */

/** Como o modulo enxerga o catalogo. Quem monta e' o bot, que ja tem a lista. */
export type ItemCatalogo = {
    id: string;
    nome: string;
    /** Outras palavras que tambem servem para achar este produto. */
    apelidos?: string[];
    grupos?: Array<{
        id: string;
        nome: string;
        maxSelect: number;
        opcoes: Array<{ id: string; nome: string; prefixo?: string }>;
    }>;
};

/* ------------------------------------------------------- quebra da frase */

/** Conectores que separam um item do seguinte. */
const CONECTORES = new Set(['e', 'mais', 'e mais', 'com', 'e depois']);

/**
 * Quebra a frase em pedacos, de forma ingenua.
 *
 * Corta em virgula e no conector "e" / "mais", com limites de palavra para nao
 * cortar o "e" de dentro de um nome. "Arroz, feijao e salada" vira tres pedacos
 * aqui -- e a funcao esta CORRETA nisso, porque ela nao sabe o que e' um
 * produto.
 *
 * A inteligencia esta em `interpreta`: ele tenta casar a frase INTEIRA antes de
 * tentar as partes. E' a unica forma de acertar os dois casos com a mesma
 * quebra -- "coxinha e refrigerante" e' dois produtos, "arroz, feijao e salada"
 * e' um so, e nenhuma das duas formas se distingue olhando a virgula.
 */
export function quebraEmPedacos(frase: string): string[] {
    const texto = chave(frase);
    if (texto === '') return [];

    /*
     * A virgula NAO separa, e nao e' falha: `chave` ja a trocou por espaco.
     *
     * Isso e' deliberado. A virgula e' usada dentro do nome do produto --
     * "Arroz, feijao e salada" -- e o conector "e" e' o sinal mais forte de que
     * a pessoa esta listando duas coisas. Quem sabe a diferenca entre um nome
     * e uma lista e' `interpreta`, que tenta a frase inteira primeiro.
     */
    const pedacos = texto
        .split(/\s*(?:\be\b|\bmais\b)\s*/g)
        .map((p) => p.trim())
        .filter((p) => p !== '' && !CONECTORES.has(p));

    return pedacos.length > 0 ? pedacos : [texto];
}

/** A palavra aparece inteira, com limites de palavra dos dois lados. */
function temPalavra(texto: string, palavra: string): boolean {
    const re = new RegExp(`(^|\\s)${palavra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    return re.test(texto);
}

/* ---------------------------------------------------------------- o casamento */

/** O que o casamento devolve, alem do produto. */
export type Casamento = {
    item: ItemCatalogo;
    confianca: number;
    origem: IntencaoItem['origem'];
};

/**
 * Acha o produto que a frase nomeia.
 *
 * A ordem das tentativas vai do mais confiavel para o menos, e cada passo so
 * roda se o anterior falhou:
 *
 * 1. Igualdade exata da chave. O cliente copiou do cardapio.
 * 2. O nome do produto esta contido no pedaco. "quero coxinha de frango" acha
 *    "Coxinha de frango" sem a pessoa escrever o nome inteiro.
 * 3. Distancia de edicao, no nome e nos apelidos.
 *
 * O piso e' o que impede o estrago: um produto so casa quando a melhor
 * distancia cabe no limite. Chamar "v942" de "Coxinha" seria pior do que
 * perguntar, porque a pessoa receberia um pedido errado e descobriria no preco.
 */
export function achaProduto(pedaco: string, catalogo: ItemCatalogo[]): Casamento | null {
    const chavePedaco = chave(pedaco);
    if (chavePedaco === '') return null;

    // 1. exato
    for (const p of catalogo) {
        if (chave(p.nome) === chavePedaco) return { item: p, confianca: 1, origem: 'nome-exato' };
    }

    /*
     * 2. Contido nos dois sentidos, e com criterios opostos de escolha.
     *
     * A) O NOME do produto esta dentro da frase. Ganha o nome mais LONGO: se a
     *    frase cita "Arroz, feijao e salada", e' aquele e' nao o "Arroz" que
     *    por acaso e' prefixo dele. Nome mais longo e' nome mais especifico.
     *
     * B) A frase esta dentro do NOME do produto. Ganha o nome mais CURTO: e' o
     *    caso de "coxinha" para "Coxinha de frango", que e' o mais comum de
     *    todos -- a pessoa digita o nome curto no chat. Aqui escolher o nome
     *    mais longo seria o contrario do que a pessoa pediu: ela pediu a
     *    coxinha e levaria um prato com nomeproprio.
     *
     * O piso de 4 letras vale para os dois: "ar" dentro de "arroz" e' curto
     * demais para dizer que a pessoa quis dizer arroz, e sem esse piso qualquer
     * pedido vira qualquer produto.
     */
    let contido: { item: ItemCatalogo; tamanho: number } | null = null;
    for (const p of catalogo) {
        const cp = chave(p.nome);
        if (cp.length < 4) continue;
        if (!chavePedaco.includes(cp)) continue;
        if (contido === null || cp.length > contido.tamanho) {
            contido = { item: p, tamanho: cp.length };
        }
    }
    if (contido) return { item: contido.item, confianca: 0.9, origem: 'nome-exato' };

    let dentro: { item: ItemCatalogo; tamanho: number } | null = null;
    for (const p of catalogo) {
        const cp = chave(p.nome);
        if (cp.length < 4) continue;
        if (chavePedaco.length < 4) continue;
        if (!cp.includes(chavePedaco)) continue;
        if (dentro === null || cp.length < dentro.tamanho) {
            dentro = { item: p, tamanho: cp.length };
        }
    }
    if (dentro) return { item: dentro.item, confianca: 0.85, origem: 'nome-exato' };

    // 3. distancia, sobre o nome e sobre os apelidos.
    let melhor: Casamento | null = null;

    for (const p of catalogo) {
        for (const nome of [p.nome, ...(p.apelidos ?? [])]) {
            const cn = chave(nome);
            if (cn.length < 3) continue;

            // Limite proporcional ao tamanho: nome curto nao aguenta dois erros
            // de digitacao sem virar outra palavra, e nome longo nao pode exigir
            // correspondencia perfeita.
            const limite = cn.length <= 5 ? 1 : cn.length <= 10 ? 2 : 3;
            const d = distancia(chavePedaco, cn, limite);
            if (d > limite) continue;

            const confianca = 1 - d / (cn.length + 1);
            if (melhor === null || confianca > melhor.confianca) {
                melhor = { item: p, confianca, origem: 'nome-aproximado' };
            }
        }
    }

    return melhor;
}

/**
 * Casa opcao de modificador por nome, e so deste produto.
 *
 * Vale para o "sem cebola" e o "com bacon", que e' como a pessoa fala. O
 * modificador precisa estar ligado ao produto: se nao estiver, casar a palavra
 * seria inventar um item que a cozinha nao pediu.
 *
 * Exige o nome INTEIRO da opcao no texto, e nao o pedaco. "bacon" dentro de
 * "baconete" e' outra coisa, e o cliente que pediu baconete receberia bacon.
 */
export function achaModificadores(
    pedaco: string,
    produto: ItemCatalogo,
    escolhidos: Record<string, string[]> = {}
): Record<string, string[]> {
    const texto = chave(pedaco);
    const saida: Record<string, string[]> = { ...escolhidos };

    for (const grupo of produto.grupos ?? []) {
        for (const op of grupo.opcoes) {
            const cn = chave(op.nome);
            if (cn.length < 3) continue;
            /*
             * Palavra INTEIRA, com limites dos dois lados.
             *
             * `includes` sozinho casava "bacon" dentro de "baconete" -- e a
             * pessoa que pediu baconete receberia bacon. E casava "mal" dentro
             * de "malte", "ao" dentro de "aovo". O item que a cozinha produz
             * nao e' o mesmo, e o preco do modificador tambem nao e'.
             */
            if (!temPalavra(texto, cn)) continue;

            const atual = saida[grupo.id] ?? [];
            if (atual.includes(op.id)) continue;

            // Grupo de escolha unica e' substituido: se a pessoa disse "sem
            // cebola" depois de ter escolhido "com cebola", e' o "sem" que vale.
            saida[grupo.id] = grupo.maxSelect <= 1 ? [op.id] : [...atual, op.id];
        }
    }

    return saida;
}

/* ------------------------------------------------------------ a frase inteira */

/** A frase so. Vira um item, ou nao vira nada. */
function casaInteira(
    frase: string,
    catalogo: ItemCatalogo[]
): { item: IntencaoItem; comNumero: number } | null {
    const texto = chave(frase);
    if (texto === '') return null;

    const comNumero = separaNumero(texto);
    const casamento = achaProduto(comNumero.nome, catalogo);
    if (!casamento) return null;

    return {
        comNumero: comNumero.numero ?? 1,
        item: {
            id: casamento.item.id,
            nome: casamento.item.nome,
            qtd: 1,
            modificadores: achaModificadores(texto, casamento.item),
            origem: casamento.origem,
            confianca: casamento.confianca,
        },
    };
}

/**
 * Casa o produto pelo PREFIXO mais longo da frase.
 *
 * E' o que faz "xburguer ao ponto com bacon" virar um item com dois
 * modificadores. O produto e' as primeiras palavras; o que sobra sao as
 * opcoes. Sem isso, a frase inteira nao casa com nome nenhum -- a distancia
 * entre "xburguer ao ponto com bacon" e "X-Burguer" passa do limite por causa do
 * comprimento -- e o cliente recebia "opcao invalida" para um pedido
 * perfeitamente claro.
 *
 * O prefixo mais longo ganha, e' o mais especifico: se o catalogo tem "Arroz" e
 * "Arroz, feijao e salada", e a pessoa disser "arroz feijao e salada", casa o
 * segundo.
 */
function casaPorPrefixo(
    pedaco: string,
    catalogo: ItemCatalogo[]
): { item: IntencaoItem; qtd: number } | null {
    const texto = chave(pedaco);
    if (texto === '') return null;

    const palavras = texto.split(' ').filter(Boolean);
    const comNumeroNoFim = separaNumero(texto);
    const qtd = comNumeroNoFim.numero ?? 1;

    for (let n = palavras.length; n >= 1; n--) {
        // A ultima palavra pode ser a quantidade, e nao parte do nome.
        const ultimo = n === palavras.length ? comNumeroNoFim.nome.split(' ').pop() : null;
        const nome = ultimo !== null && n === palavras.length
            ? comNumeroNoFim.nome
            : palavras.slice(0, n).join(' ');

        const casamento = achaProduto(nome, catalogo);
        if (!casamento) continue;

        return {
            qtd,
            item: {
                id: casamento.item.id,
                nome: casamento.item.nome,
                qtd: 1,
                modificadores: achaModificadores(texto, casamento.item),
                origem: casamento.origem,
                confianca: casamento.confianca,
            },
        };
    }

    return null;
}

/**
 * Interpreta a frase inteira: produtos, quantidades e modificadores.
 *
 * A ordem das tentativas e' o que resolve o caso mais comum de todos --
 * "coxinha", "3 coxinhas", "coxinha e refrigerante", "xburguer ao ponto com
 * bacon" -- e todos eles sao a mesma coisa vista de quatro jeitos:
 *
 * 1. A frase inteira como UM produto. E' o que acerta "arroz, feijao e salada",
 *    um prato cujo nome contem virgula e "e".
 * 2. A frase quebrada no conector "e", para virar dois produtos.
 * 3. Dentro de cada pedaco, o nome pelo prefixo mais longo, e o resto como
 *    modificador.
 *
 * A quantidade e' lida do fim do pedaco ("coxinha 3"). O que nao casa com nada
 * vai para `naoEntendidos`, que o bot usa para dizer o que nao entendeu em vez
 * de fingir que entendeu.
 *
 * Este arquivo nao grava nada, nao le preco e nao olha estoque. Quem faz isso
 * e' o servidor, depois, com o id que veio daqui.
 */
export function interpreta(frase: string, catalogo: ItemCatalogo[]): Intencao {
    const texto = chave(frase);
    const naoEntendidos: string[] = [];

    if (texto === '') return { itens: [], naoEntendidos };

    // 1. a frase inteira como um produto so
    const inteiro = casaInteira(texto, catalogo);
    if (inteiro) {
        inteiro.item.qtd = inteiro.comNumero;
        return { itens: [inteiro.item], naoEntendidos };
    }

    // 2. a frase quebrada
    const itens: IntencaoItem[] = [];

    for (const pedaco of quebraEmPedacos(texto)) {
        const achado = casaPorPrefixo(pedaco, catalogo);

        if (!achado) {
            if (pedaco.trim() !== '') naoEntendidos.push(pedaco.trim());
            continue;
        }

        achado.item.qtd = achado.qtd;
        itens.push(achado.item);
    }

    return { itens, naoEntendidos };
}
