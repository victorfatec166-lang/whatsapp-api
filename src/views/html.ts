function toStr(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escapa valores interpolados no HTML do painel. Sem isso, o nome de um
 * produto ou o nome de um cliente injetado no banco quebraria o layout
 * (ou executaria script) no navegador de quem esta logado no admin.
 */
export function escapeHtml(value: unknown): string {
    return toStr(value);
}

/**
 * Bytes em uma unidade que o dono le.
 *
 * Vive aqui, e nao dentro de uma view, porque e' o mesmo numero aparecendo em
 * telas diferentes -- a configuracao mostra hoje, e qualquer outra tela de
 * "saude do sistema" vai mostrar amanha. Duas copias divergem na primeira vez
 * que uma arredondar de um jeito e a outra de outro, e o dono ve dois numeros
 * para a mesma coisa.
 *
 * Uma casa decimal, e virgula: e' numero lido por pessoa, nao por maquina. Zero
 * e' "0 B" e nao "-", porque "0 B" responde a pergunta que o dono esta fazendo
 * e o tracinho so levanta outra.
 */
export function tamanhoLegivel(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
