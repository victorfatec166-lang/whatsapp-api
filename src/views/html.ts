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
