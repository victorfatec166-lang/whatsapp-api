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
 * Vive aqui e nao em uma view porque e' o mesmo numero em telas diferentes: duas copias
 * divergem na primeira vez que uma arredonda de um jeito e a outra de outro. Uma casa e
 * virgula porque e' numero lido por pessoa -- e zero e' "0 B", nao o tracinho.
 */
export function tamanhoLegivel(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
