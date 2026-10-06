/*
 * Entender o que o cliente escreveu, sem modelo de linguagem. Nao e' IA por tres motivos:
 * preco nunca vem do cliente (se um modelo decide o pedido, o valor gravado pode nao ter
 * passado pelo servidor); a loja nao depende de rede nem de terceiro; o texto nao sai da maquina.
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
 * A chave de comparacao e' esta: "ARROZ, FEIJAO E SALADA" e "arroz feijao e
 * salada" precisam dar a mesma string, senao quem escreve como o cardapio nao
 * acha o produto que ele mesmo escreveu.
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
 * Damerau-Levenshtein, e nao o puro: trocar duas letras vizinhas e' o erro mais
 * comum de dedo em celular, e no Levenshtein puro conta como duas substituicoes.
 * O corte por tamanho segura o custo -- passado o limite, nao ha troca que salve.
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

/*
 * Conectores que separam um item do seguinte. "com" NAO esta aqui: ele liga
 * MODIFICADOR, nao produto. Cortando ali, "coxinha com bacon" virava "coxinha" +
 * "bacon", e o bot respondia "nao encontrei bacon" tendo o item inteiro na frase.
 */
const CONECTORES = new Set(['e', 'mais', 'e mais', 'e depois']);

/**
 * Ingenua de proposito: corta no conector "e"/"mais" e nao sabe o que e' um produto.
 * A inteligencia esta em interpreta, que tenta casar a frase INTEIRA antes das partes --
 * e' o unico jeito de acertar "coxinha e refrigerante" (dois) e "arroz, feijao e salada" (um).
 */
export function quebraEmPedacos(frase: string): string[] {
    const texto = chave(frase);
    if (texto === '') return [];

    /*
     * A virgula NAO separa e nao e' falha: chave ja a trocou por espaco. Ela e' usada
     * dentro do nome do produto, e o conector "e" e' o sinal mais forte de lista --
     * quem sabe a diferenca e' interpreta, que tenta a frase inteira primeiro.
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
 * Quando nao achou, quais produtos do cardapio a pessoa PROVAVAM dizer.
 *
 * E' o item 3 do ABC: sem isto o bot diz "nao encontrei X" e a pessoa reescreve do
 * zero. Com isto ele pergunta "voce quis dizer Coxinha?" e o cliente confirma.
 */
export function maisProximos(pedaco: string, catalogo: ItemCatalogo[], quantos = 3): ItemCatalogo[] {
    const chavePedaco = chave(pedaco);
    if (chavePedaco.length < 3) return [];

    const candidatos: Array<{ item: ItemCatalogo; d: number }> = [];
    for (const p of catalogo) {
        const cn = chave(p.nome);
        if (cn.length < 3) continue;
        // Metade do nome ja escrito e' a barra: "pastel" chegou perto de "Pastel
        // de Queijo" e longe de "Coxinha", e o limite segue a distancia real.
        const limite = Math.max(2, Math.floor(cn.length / 3));
        const d = distancia(chavePedaco, cn, limite);
        if (d <= limite) candidatos.push({ item: p, d });
    }

    return candidatos
        .sort((a, b) => a.d - b.d || a.item.nome.localeCompare(b.item.nome, 'pt-BR'))
        .slice(0, quantos)
        .map((c) => c.item);
}

/**
 * Do mais confiavel para o menos, cada passo so se o anterior falhou: chave exata, nome
 * contido na frase, distancia de edicao no nome e nos apelidos. O piso e' o que impede
 * o estrago: "v942" casado com "Coxinha" so apareceria como erro no preco.
 */
export function achaProduto(pedaco: string, catalogo: ItemCatalogo[]): Casamento | null {
    const chavePedaco = chave(pedaco);
    if (chavePedaco === '') return null;

    // 1. exato
    for (const p of catalogo) {
        if (chave(p.nome) === chavePedaco) return { item: p, confianca: 1, origem: 'nome-exato' };
    }

    /*
     * A) Nome dentro da frase: ganha o nome mais LONGO, o mais especifico ("Arroz, feijao
     *    e salada", nao o "Arroz" que e' prefixo dele). B) Frase dentro do nome: o mais
     *    CURTO -- "coxinha" para "Coxinha de frango". Piso de 4: "ar" em "arroz" nao e' arroz.
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

            /*
 * Limite bem mais largo que antes (1/2/3 -> 3/4/5): quem pede pelo celular erra
 * mais, e o proporcional evita que a letra "a" case com um produto de 4.
 */
            const limite = Math.max(
                cn.length <= 5 ? 3 : cn.length <= 10 ? 4 : 5,
                Math.floor(Math.min(chavePedaco.length, cn.length) / 2)
            );
            if (chavePedaco.length < Math.min(cn.length, 4)) continue;
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
 * Vale para o "sem cebola" e o "com bacon", que e' como a pessoa fala. O
 * modificador precisa estar ligado a este produto: casar a palavra sem ligacao
 * seria inventar um item que a cozinha nao pediu.
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
             * Palavra INTEIRA, com limites dos dois lados: includes sozinho casava
             * "bacon" em "baconete", "mal" em "malte", "ao" em "aovo" -- e o item
             * que a cozinha produz nao e' o mesmo, nem o preco do modificador.
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
 * E' o que faz "xburguer ao ponto com bacon" virar um item com dois modificadores: o
 * produto sao as primeiras palavras e o que sobra sao as opcoes. Sem isso a frase
 * inteira nao casa com nome nenhum e o cliente recebia opcao invalida num pedido claro.
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
 * A ordem das tentativas e' o que resolve o caso mais comum: "coxinha", "3 coxinhas",
 * "coxinha e refrigerante" e "xburguer ao ponto com bacon" sao a mesma coisa vista de
 * quatro jeitos. O que nao casa vai para naoEntendidos, para o bot dizer em vez de fingir.
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
