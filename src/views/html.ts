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
 * Tira comentario do HTML que vai para o navegador: quem abre o "ver fonte" nao
 * deveria ler anotacao de quem mexe no codigo. So some linha INTEIRA -- `//` no meio
 * da linha e' o do protocolo de uma URL, e um filtro apressado quebraria o endereco.
 */
export function semComentarios(html: string): string {
    const semHtml = html.replace(new RegExp('<!--[\\s\\S]*?-->\\n?', 'g'), '');
    const tagScript = new RegExp('(<script\\b[^>]*>)([\\s\\S]*?)(</' + 'script>)', 'gi');
    return semHtml.replace(tagScript, (_todo, abre: string, corpo: string, fecha: string) => {
        const novas: string[] = [];
        let dentroDeBloco = false;
        for (const linha of corpo.split('\n')) {
            const t = linha.trim();
            if (dentroDeBloco) {
                if (t.includes('*/')) dentroDeBloco = false;
                continue;
            }
            if (t.startsWith('//')) continue;
            if (t.startsWith('/*')) {
                if (!t.includes('*/')) dentroDeBloco = true;
                continue;
            }
            if (t.startsWith('*')) continue;
            novas.push(linha);
        }
        return abre + novas.join('\n') + fecha;
    });
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
