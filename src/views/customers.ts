import { escapeHtml } from './html';
import { currency } from '../services/stats';
import type { CustomerRow, CustomersSummary } from '../services/customers';
import { kpi, faixaKpi } from './ui/card';

function money(n: number): string {
    return escapeHtml(currency(n));
}



/** Iniciais para o avatar, a partir do nome ou do telefone. */
function initials(row: CustomerRow): string {
    const base = row.name && row.name.trim() ? row.name.trim() : row.phone;
    const partes = base.split(/[\s-]+/).filter(Boolean);
    if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
    return base.replace(/\D/g, '').slice(-2);
}

export type CustomersData = { rows: CustomerRow[]; summary: CustomersSummary };

export function renderCustomers(d: CustomersData): string {
    const body =
        d.rows.length === 0
            ? '<p class="text-body text-ink-3 text-center py-10">Nenhum cliente ainda. Os clientes aparecem aqui apos o primeiro pedido pelo WhatsApp.</p>'
            : `<div class="table-wrap">
                <table id="custTable">
                    <thead>
                        <tr>
                            <th>Cliente</th><th>Pedidos</th><th>Total gasto</th>
                            <th>Ticket medio</th><th>Mais pedido</th><th>Ultimo pedido</th><th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${d.rows
                            .map(
                                (r) => `                        <tr data-cust="${escapeHtml(((r.name || '') + ' ' + r.phone).toLowerCase())}">
                            <td>
                                <div class="flex items-center gap-2.5">
                                    <span class="w-8 h-8 rounded-full bg-accent-soft text-accent-strong text-caption font-bold flex items-center justify-center shrink-0">${escapeHtml(initials(r))}</span>
                                    <div class="min-w-0">
                                        <div class="text-body font-medium text-ink truncate">${escapeHtml(r.name || r.phone)}</div>
                                        ${
                                            r.semTelefone
                                                ? `<div class="text-caption text-ink-3" title="O WhatsApp ainda nao entregou o telefone deste cliente">numero nao identificado</div>`
                                                : `<div class="text-caption text-ink-3 font-mono">${escapeHtml(r.phone)}</div>`
                                        }
                                    </div>
                                </div>
                            </td>
                            <td>
                                ${r.orders > 1 ? `<span class="badge badge-success">${r.orders} pedidos</span>` : `<span class="badge badge-neutral">${r.orders}</span>`}
                            </td>
                            <td class="font-semibold text-ink">${money(r.spent)}</td>
                            <td class="text-ink-2">${money(r.averageTicket)}</td>
                            <td class="max-w-[14rem] truncate text-ink-2" title="${escapeHtml(r.favorite ?? '')}">${r.favorite ? `${escapeHtml(r.favorite)} <span class="text-ink-3">(${r.favoriteQty})</span>` : '<span class="text-ink-3">--</span>'}</td>
                            <td class="text-caption text-ink-3">${escapeHtml(r.lastOrderAt)}</td>
                            <td>
                                ${
                                    r.semTelefone
                                        ? `<span class="btn btn-ghost btn-sm opacity-50" title="Sem telefone, nao da para abrir conversa pelo WhatsApp Web">
                                    <i class="fa-brands fa-whatsapp"></i> Falar
                                </span>`
                                        : `<a href="https://wa.me/${escapeHtml(r.phone)}" target="_blank" rel="noopener"
                                    class="btn btn-ghost btn-sm" title="Abrir conversa no WhatsApp">
                                    <i class="fa-brands fa-whatsapp"></i> Falar
                                </a>`
                                }
                            </td>
                        </tr>`
                            )
                            .join('\n')}
                    </tbody>
                </table>
            </div>
            <p id="custEmpty" class="hidden text-body text-ink-3 text-center py-8">Nenhum cliente com esse filtro.</p>`;

    const pct = d.summary.total > 0 ? Math.round((d.summary.repeat / d.summary.total) * 100) : 0;

    return `${faixaKpi([
        kpi('Clientes', String(d.summary.total), 'com pelo menos um pedido'),
        kpi('Compradores recorrentes', String(d.summary.repeat), pct + '% do total', 'success'),
        kpi('Receita da base', money(d.summary.revenue), 'somando todos os clientes', 'accent'),
        kpi('Ticket medio', money(d.summary.averageTicket), 'por cliente', 'warning'),
    ])}

        <div class="card overflow-hidden">
            <div class="p-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 class="text-title">Base de clientes</h2>
                    <p class="text-caption text-ink-3 mt-0.5">Montada a partir dos pedidos do WhatsApp. Um cliente e o telefone que pediu.</p>
                </div>
                <input id="custSearch" type="search" placeholder="Buscar por nome ou telefone..." oninput="custFilter()"
                    class="input max-w-xs py-1.5">
            </div>
            ${body}
        </div>

        <script>
            function custFilter() {
                var q = (document.getElementById('custSearch').value || '').toLowerCase();
                var visiveis = 0;
                document.querySelectorAll('#custTable [data-cust]').forEach(function (tr) {
                    var ok = (tr.dataset.cust || '').indexOf(q) !== -1;
                    tr.style.display = ok ? '' : 'none';
                    if (ok) visiveis++;
                });
                var vazio = document.getElementById('custEmpty');
                if (vazio) vazio.classList.toggle('hidden', visiveis > 0);
            }
        </script>`;
}
