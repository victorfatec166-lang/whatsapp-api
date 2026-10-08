import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { currency } from './stats';
import { exigeLoja } from './loja';

const round = (n: number) => Math.round(n * 100) / 100;

/** A chave que a extensao de loja exige: `where: { id }` sozinho e' recusado. */

/**
 * Gera um SKU curto e legivel a partir do nome. Tenta deriva das iniciais
 * primeiro (ex: "X-Burguer" -> "XBUR-A7K2") e cai para aleatorio se colidir.
 */
export async function generateSku(name: string): Promise<string> {
    const base =
        name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 4) || 'ITEM';

    for (let attempt = 0; attempt < 12; attempt++) {
        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
        const candidate = `${base}-${suffix}`;
        const exists = await prisma.product.findFirst({ where: { sku: candidate }, select: { id: true } });
        if (!exists) return candidate;
    }
    //Fallback final: prefixo curto + timestamp, praticamente sem colisao.
    return `SKU${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

export async function ensureSku(productId: string, name: string): Promise<string | null> {
    const current = await prisma.product.findUnique({
        where: { tenantId_id: { tenantId: exigeLoja(), id: productId } },
        select: { sku: true },
    });
    if (current?.sku) return current.sku;
    const sku = await generateSku(name);
    try {
        await prisma.product.update({ where: { tenantId_id: { tenantId: exigeLoja(), id: productId } }, data: { sku } });
        return sku;
    } catch {
        return null;
    }
}

/* ------------------------------------------------------------------ CSV */

const CSV_HEADER = ['sku', 'nome', 'preco', 'custo', 'categoria', 'estoque', 'minimo', 'controlar_estoque', 'disponivel', 'descricao'];

function csvCell(v: unknown): string {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export type ProductCsvRow = {
    sku: string;
    name: string;
    price: number;
    costPrice: number;
    category: string;
    stock: number;
    minStock: number;
    trackStock: boolean;
    isAvailable: boolean;
    description: string;
};

export function productsToCsv(rows: ProductCsvRow[]): string {
    const lines = [CSV_HEADER.join(';')];
    for (const r of rows) {
        lines.push(
            [
                csvCell(r.sku),
                csvCell(r.name),
                r.price.toFixed(2),
                r.costPrice.toFixed(2),
                csvCell(r.category),
                String(r.stock),
                String(r.minStock),
                r.trackStock ? 'sim' : 'nao',
                r.isAvailable ? 'sim' : 'nao',
                csvCell(r.description),
            ].join(';')
        );
    }
    return lines.join('\r\n');
}

/** Parser de CSV que respeita aspas duplicadas e quebras de linha dentro do campo. */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < src.length; i++) {
        const ch = src[i];

        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
        } else if (ch === ';') {
            row.push(field);
            field = '';
        } else if (ch === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }

    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const truthy = (v: string) => ['sim', 's', 'true', '1', 'x', 'yes', 'verdadeiro'].includes(v.trim().toLowerCase());

export type ImportResult = {
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
};

/**
 * Importa produtos do CSV. Quando o SKU (ou o nome, se nao houver SKU) ja
 * existe, atualiza em vez de duplicar.
 */
export async function importProductsFromCsv(text: string): Promise<ImportResult> {
    const rows = parseCsv(text);
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    if (rows.length < 2) {
        result.errors.push('CSV sem linhas de dados.');
        return result;
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);

    const iSku = idx('sku');
    const iNome = idx('nome') >= 0 ? idx('nome') : idx('name');
    const iPreco = idx('preco') >= 0 ? idx('preco') : idx('price');
    const iCusto = idx('custo') >= 0 ? idx('custo') : idx('costprice') >= 0 ? idx('costprice') : idx('cost');
    const iCategoria = idx('categoria') >= 0 ? idx('categoria') : idx('category');
    const iEstoque = idx('estoque') >= 0 ? idx('estoque') : idx('stock');
    const iMinimo = idx('minimo') >= 0 ? idx('minimo') : idx('minstock');
    const iControla = idx('controlar_estoque') >= 0 ? idx('controlar_estoque') : idx('trackstock');
    const iDisponivel = idx('disponivel') >= 0 ? idx('disponivel') : idx('isavailable');
    const iDescricao = idx('descricao') >= 0 ? idx('descricao') : idx('description');

    if (iNome < 0 || iPreco < 0) {
        result.errors.push('Cabecalho invalido: sao obrigatorias as colunas "nome" e "preco".');
        return result;
    }

    const num = (row: string[], i: number, fallback = 0) => {
        if (i < 0) return fallback;
        const n = parseFloat(String(row[i] ?? '').replace(',', '.').replace(/[^0-9.-]/g, ''));
        return Number.isFinite(n) ? n : fallback;
    };
    const int = (row: string[], i: number, fallback = 0) => {
        if (i < 0) return fallback;
        const n = parseInt(String(row[i] ?? '').trim(), 10);
        return Number.isFinite(n) ? Math.max(0, n) : fallback;
    };
    const flag = (row: string[], i: number, fallback: boolean) => (i < 0 ? fallback : truthy(row[i] ?? ''));

    const seen = new Set<string>();

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const name = String(row[iNome] ?? '').trim();
        if (!name) {
            result.skipped++;
            continue;
        }

        const price = num(row, iPreco, NaN);
        if (!Number.isFinite(price) || price < 0) {
            result.errors.push(`Linha ${r + 1}: preco invalido para "${name}".`);
            result.skipped++;
            continue;
        }

        const sku = iSku >= 0 ? String(row[iSku] ?? '').trim() : '';
        const category = (iCategoria >= 0 ? String(row[iCategoria] ?? '').trim() : '') || 'Geral';
        const track = flag(row, iControla, false);
        const stock = track ? int(row, iEstoque, 0) : 0;
        const minStock = track ? int(row, iMinimo, 0) : 0;
        const available = flag(row, iDisponivel, true);
        const description = (iDescricao >= 0 ? String(row[iDescricao] ?? '').trim() : '') || '';
        const cost = Math.max(0, num(row, iCusto, 0));
        if (cost > price) {
            result.errors.push(`Linha ${r + 1}: custo maior que o preco em "${name}".`);
            result.skipped++;
            continue;
        }

        try {
            // Chave de coincidencia: SKU preenchido; sem SKU, cai para o nome.
            const existing = sku
                ? await prisma.product.findFirst({ where: { sku } })
                : await prisma.product.findFirst({ where: { name } });

            if (existing) {
                await prisma.product.update({
                    where: { tenantId_id: { tenantId: exigeLoja(), id: existing.id } },
                    data: {
                        name,
                        price: round(price),
                        costPrice: round(cost),
                        category,
                        description,
                        isAvailable: available,
                        trackStock: track,
                        stock,
                        minStock,
                        ...(sku && !existing.sku ? { sku } : {}),
                    },
                });
                result.updated++;
            } else {
                const finalSku = sku || (await generateSku(name));
                await prisma.product.create({
                    data: {
                        tenantId: exigeLoja(),
                        sku: finalSku,
                        name,
                        price: round(price),
                        costPrice: round(cost),
                        category,
                        description,
                        isAvailable: available,
                        trackStock: track,
                        stock,
                        minStock,
                    },
                });
                result.created++;
            }
            seen.add(name);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            result.errors.push(`Linha ${r + 1} ("${name}"): ${msg}`);
            result.skipped++;
        }
    }

    return result;
}

export async function exportProductsCsv(): Promise<string> {
    const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
    const rows: ProductCsvRow[] = products.map((p) => ({
        sku: p.sku ?? '',
        name: p.name,
        price: p.price,
        costPrice: p.costPrice,
        category: p.category,
        stock: p.stock,
        minStock: p.minStock,
        trackStock: p.trackStock,
        isAvailable: p.isAvailable,
        description: p.description ?? '',
    }));
    return productsToCsv(rows);
}

export { currency };
