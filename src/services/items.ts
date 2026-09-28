/**
 * Formato do campo `items` de um pedido.
 *
 * Linha:  2x X-Burguer [P; Bacon extra]
 * Pedido: linha1 | linha2 | linha3
 *
 * O separador "| " e as opcoes entre [] existem porque o formato antigo
 * separava por ", " e um nome de produto com virgula quebrava o relatorio.
 * parseItems() continua aceitando o formato antigo (virgem ", ") para os
 * pedidos ja gravados.
 */

export type ParsedItem = {
    qty: number;
    /** Nome sem os modificadores. */
    name: string;
    /** Modificadores como foram escolhidos, ja com prefixo. */
    mods: string[];
};

const LEGACY_SEPARATOR = ', ';
const SEPARATOR = ' | ';

export function serializeItems(lines: Array<{ qty: number; name: string; mods?: string[] }>): string {
    return lines
        .map((l) => {
            const mods = (l.mods ?? []).filter(Boolean);
            const suffix = mods.length ? ` [${mods.join('; ')}]` : '';
            return `${l.qty}x ${l.name}${suffix}`;
        })
        .join(SEPARATOR);
}

export function parseItems(items: string): ParsedItem[] {
    if (!items) return [];
    const parts = items.includes(SEPARATOR) ? items.split(SEPARATOR) : items.split(LEGACY_SEPARATOR);

    const out: ParsedItem[] = [];
    for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;

        // Separa a parte de modificadores entre colchetes.
        const bracket = line.match(/^(.*?)\s*\[([^\]]*)\]$/);
        const head = bracket ? bracket[1] : line;
        const mods = bracket && bracket[2].trim() ? bracket[2].split(';').map((m) => m.trim()).filter(Boolean) : [];

        const m = head.match(/^(\d+)\s*x\s*(.+)$/i);
        if (m) {
            out.push({ qty: parseInt(m[1], 10) || 1, name: m[2].trim(), mods });
        } else {
            out.push({ qty: 1, name: head, mods });
        }
    }
    return out;
}

/** Linha legivel, ja com os modificadores, para exibir em listas. */
export function formatItemLine(item: ParsedItem): string {
    return `${item.qty}x ${item.name}` + (item.mods.length ? ` (${item.mods.join(', ')})` : '');
}
