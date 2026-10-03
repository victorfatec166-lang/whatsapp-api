/**
 * A marca do produto: os arquivos ficam em `marca/` e sao servidos em `/marca`.
 *
 * Nao virou string no codigo de proposito -- reexportar a arte atualiza todas as
 * telas de uma vez, e um SVG repetido em quatro views e' o mesmo arquivo em quatro.
 */
const BASE = '/marca';

/**
 * Os `<link>` do icone da aba.
 *
 * O `sizes="any"` conta: sem ele o navegador desce para a entrada de 16px do
 * `.ico`. O `apple-touch-icon` e' para o iPhone, que ignora `.ico` e fotografa a tela.
 */
export function iconeDaAba(): string {
    return `<link rel="icon" href="${BASE}/favicon.ico" sizes="any">
    <link rel="apple-touch-icon" href="${BASE}/tile-vermelho.png">`;
}

/**
 * O bloco vermelho da marca, ao lado do nome.
 *
 * `alt=""` de verdade: o nome ja esta do lado e o leitor de tela leria o nome duas
 * vezes. `width`/`height` evitam o cabecalho pular quando a imagem chega.
 */
export function tileDaMarca(px: number): string {
    return `<img src="${BASE}/tile-vermelho.svg" alt="" width="${px}" height="${px}" class="shrink-0">`;
}

/**
 * A marca em tamanho grande, para a metade esquerda da tela de entrada.
 *
 * Sao dois arquivos em vez de `<picture>`: ele so troca por `prefers-color-scheme`,
 * e aqui quem troca o tema e' o botao da tela (classe `dark` no html).
 */
export function lockupDaMarca(): string {
    // O PNG, e nao o SVG: o lockup e' um `<text>` em Segoe UI, que nao existe no
    // servidor Linux -- la o navegador cairia no Arial e a palavra-marca saia do lugar.
    const img = (arquivo: string, tema: string) =>
        `<img src="${BASE}/${arquivo}" alt="" width="402" height="250" class="h-28 w-auto ${tema}">`;

    return `${img('lockup-empilhado-claro.png', 'dark:hidden')}
                ${img('lockup-empilhado-escuro.png', 'hidden dark:block')}`;
}