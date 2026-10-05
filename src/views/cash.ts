import { escapeHtml } from './html';
import { currency } from '../services/stats';
import type { OpenShift, ShiftHistoryRow } from '../services/cash';
import { renderModal } from './ui/modal';
import { kpi, faixaKpi } from './ui/card';
import {
    ENDPOINT_ABRIR,
    ENDPOINT_FECHAR,
    ENDPOINT_MOVIMENTO,
    cashCloseSpec,
    cashMovementSpec,
} from './cashModals';

function money(n: number): string {
    return escapeHtml(currency(n));
}

export type CashData = {
    shift: OpenShift | null;
    history: ShiftHistoryRow[];
    /** Turnos fechados pela agenda que ainda nao tiveram contagem informada. */
    pending: ShiftHistoryRow[];
    scheduleOn: boolean;
    autoOpen: string;
    autoClose: string;
    hasFloat: boolean;
    todayRevenue: number;
    todayOrders: number;
};



/**
 * Reune o que estava em tres lugares -- turno no PDV, Z report em Relatorios, agenda em
 * Configuracoes. Inclui a conferencia de turno fechado: o endpoint ja existia sem tela, e a
 * Home avisava "aguardando conferencia" sem oferecer caminho para faze-la.
 */
export function renderCash(d: CashData): string {
    /* ---------------------------------------------------- turno aberto */
    const turno = d.shift
        ? `        <div class="card card-pad">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 class="text-title flex items-center gap-2"><i class="fa-solid fa-lock-open text-accent"></i> Turno aberto</h2>
                <span class="badge badge-success">aberto ${escapeHtml(d.shift.openedAt)}</span>
            </div>

            <div class="rounded-card bg-accent-soft px-4 py-5 text-center mb-4">
                <p class="kpi-label">Esperado na gaveta</p>
                <p class="text-4xl font-extrabold text-accent-strong tracking-tight">${money(d.shift.totals.expected)}</p>
                <p class="kpi-sub mt-1">${d.shift.totals.orders} pedido(s) no turno</p>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                <div class="kpi !p-3">
                    <p class="kpi-label">Troco inicial</p>
                    <p class="text-body font-semibold text-ink">${money(d.shift.openingFloat)}</p>
                </div>
                <div class="kpi !p-3">
                    <p class="kpi-label">Vendas em dinheiro</p>
                    <p class="text-body font-semibold text-ink">${money(d.shift.totals.cashSales)}</p>
                </div>
                <div class="kpi !p-3">
                    <p class="kpi-label">Entradas</p>
                    <p class="text-body font-semibold text-accent-emerald">${money(d.shift.totals.cashIn)}</p>
                </div>
                <div class="kpi !p-3">
                    <p class="kpi-label">Sangrias</p>
                    <p class="text-body font-semibold text-accent-red">${money(d.shift.totals.cashOut)}</p>
                </div>
            </div>

            ${
                d.shift.movements.length > 0
                    ? `<div class="mb-4">
                <p class="label">Movimentos do turno</p>
                <div class="space-y-1">
                    ${d.shift.movements
                        .map(
                            (m) => `                    <div class="flex items-center justify-between gap-3 py-1.5 border-b border-line last:border-0">
                        <span class="text-small text-ink truncate">${escapeHtml(m.note || (m.type === 'entrada' ? 'Deposito' : 'Sangria'))}</span>
                        <span class="text-small font-semibold ${m.type === 'entrada' ? 'text-accent-emerald' : 'text-accent-red'} shrink-0">${m.type === 'entrada' ? '+' : '-'} ${money(m.amount)}</span>
                    </div>`
                        )
                        .join('\n')}
                </div>
            </div>`
                    : ''
            }

            <div class="flex flex-wrap gap-2">
                <button type="button" onclick="cashSangriaModalOpen()" class="btn btn-danger flex-1">
                    <i class="fa-solid fa-arrow-up"></i> Sangria
                </button>
                <button type="button" onclick="cashDepositoModalOpen()" class="btn btn-ghost flex-1">
                    <i class="fa-solid fa-arrow-down"></i> Deposito
                </button>
                <button type="button" onclick="cashCloseModalOpen()" class="btn btn-primary w-full">
                    <i class="fa-solid fa-lock"></i> Fechar turno e contar
                </button>
            </div>
        </div>`
        : `        <div class="card card-pad">
            <h2 class="text-title mb-1 flex items-center gap-2"><i class="fa-solid fa-lock text-ink-3"></i> Nenhum turno aberto</h2>
            <p class="text-body text-ink-3 mb-4">Sem turno aberto, as vendas em dinheiro nao entram no controle de caixa.</p>
            ${
                d.scheduleOn && !d.hasFloat
                    ? '<p class="text-caption text-accent-orange mb-3"><i class="fa-solid fa-triangle-exclamation"></i> A abertura automatica esta desativada porque falta o fundo de troco. Defina em <a href="/admin?tab=config" class="underline">Configuracoes</a>.</p>'
                    : ''
            }
            <div class="flex flex-col sm:flex-row gap-2">
                <label class="sr-only" for="cashFloat">Troco inicial</label>
                <input id="cashFloat" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Troco inicial (R$)" class="input flex-1">
                <button type="button" onclick="cashAbrirTurno()" class="btn btn-primary">
                    <i class="fa-solid fa-play"></i> Abrir turno
                </button>
            </div>
        </div>`;

    /* ------------------------------------------ conferencia pendente */
    const conferencia =
        d.pending.length === 0
            ? ''
            : `        <div class="card card-pad border-l-4 mb-5" style="border-left-color: var(--warning)">
            <h2 class="text-title mb-1 flex items-center gap-2"><i class="fa-solid fa-clipboard-check text-accent-orange"></i> Conferir turno</h2>
            <p class="text-caption text-ink-3 mb-4">
                ${d.pending.length === 1 ? 'Um turno foi encerrado' : `${d.pending.length} turnos foram encerrados`} sem contagem.
                Informe o dinheiro da gaveta para registrar a diferenca.
            </p>
            <div class="space-y-3">
                ${d.pending
                    .map(
                        (s) => `                <div class="rounded-card border border-line p-3" data-pending="${escapeHtml(s.id)}">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span class="text-small text-ink">${escapeHtml(s.openedAt)} &rarr; ${escapeHtml(s.closedAt)}</span>
                        <span class="badge badge-warn">esperado ${money(s.expectedCash ?? 0)}</span>
                    </div>
                    <div class="flex flex-col sm:flex-row gap-2">
                        <input type="number" step="0.01" min="0" inputmode="decimal" placeholder="Dinheiro contado (R$)"
                            data-counted="${escapeHtml(s.id)}" class="input flex-1">
                        <input type="text" maxlength="60" placeholder="Observacao (opcional)"
                            data-note="${escapeHtml(s.id)}" class="input flex-1">
                        <button type="button" onclick="cashReconcile('${escapeHtml(s.id)}')" class="btn btn-primary shrink-0">
                            Conferir
                        </button>
                    </div>
                </div>`
                    )
                    .join('\n')}
            </div>
        </div>`;

    /* ------------------------------------------------------ historico */
    const historico =
        d.history.length === 0
            ? '<p class="text-body text-ink-3 text-center py-8">Nenhum turno fechado ainda.</p>'
            : `<div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Aberto</th><th>Fechado</th><th>Troco</th><th>Vendas</th>
                            <th>Pedidos</th><th>Esperado</th><th>Contado</th><th>Resultado</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${d.history
                            .map((s) => {
                                const diff = s.difference;
                                const bateu = diff !== null && Math.abs(diff) < 0.01;
                                const pendente = diff === null;
                                const tone = pendente ? 'badge-warn' : bateu ? 'badge-success' : (diff ?? 0) > 0 ? 'badge-neutral' : 'badge-danger';
                                const label = pendente ? 'Sem conferencia' : bateu ? 'Bateu' : (diff ?? 0) > 0 ? 'Sobrou' : 'Faltou';
                                return `                        <tr>
                            <td class="text-caption text-ink-3">${escapeHtml(s.openedAt)}</td>
                            <td class="text-caption text-ink-3">${escapeHtml(s.closedAt)}</td>
                            <td>${money(s.openingFloat)}</td>
                            <td>${money(s.revenue)}</td>
                            <td>${s.orders}</td>
                            <td>${money(s.expectedCash ?? 0)}</td>
                            <td>${pendente ? '<span class="text-ink-3">--</span>' : `${money(s.countedCash ?? 0)}`}</td>
                            <td><span class="badge ${tone}">${label}${!pendente && !bateu ? ` ${money(Math.abs(diff ?? 0))}` : ''}</span></td>
                        </tr>`;
                            })
                            .join('\n')}
                    </tbody>
                </table>
            </div>`;

    const agenda = d.scheduleOn
        ? `Abre ${d.autoOpen || '--:--'} e fecha ${d.autoClose || '--:--'}${d.hasFloat ? '' : ' (abertura desativada: falta o fundo de troco)'}`
        : 'Agenda automatica desativada';

    return `${faixaKpi([
        kpi('Turno', d.shift ? 'Aberto' : 'Fechado', agenda, d.shift ? 'success' : 'default'),
        kpi('Esperado na gaveta', d.shift ? money(d.shift.totals.expected) : '--', 'troco + vendas em dinheiro'),
        kpi('Faturamento hoje', money(d.todayRevenue), d.todayOrders + ' pedido(s)', 'accent'),
        kpi('A conferir', String(d.pending.length), d.pending.length === 1 ? 'turno sem contagem' : 'turnos sem contagem', d.pending.length > 0 ? 'warning' : 'default'),
    ])}

        ${conferencia}

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start mb-6">
            ${turno}
            <div class="card card-pad">
                <h2 class="text-title mb-1 flex items-center gap-2"><i class="fa-solid fa-gear text-accent"></i> Agenda do caixa</h2>
                <p class="text-caption text-ink-3 mb-4">
                    ${escapeHtml(agenda)}
                </p>
                <p class="text-body text-ink-2">
                    O fechamento automatico encerra o turno e registra o valor esperado, mas nao conta o dinheiro:
                    a gaveta e conferida por voce e o resultado aparece em <strong>Conferir turno</strong>.
                </p>
                <div class="flex flex-wrap gap-2 mt-4">
                    <a href="/admin?tab=config" class="btn btn-ghost btn-sm">
                        <i class="fa-solid fa-sliders"></i> Ajustar horarios
                    </a>
                    <a href="/admin/reports.csv" class="btn btn-ghost btn-sm">
                        <i class="fa-solid fa-file-csv"></i> Backup CSV
                    </a>
                </div>
            </div>
        </div>

        <div class="card overflow-hidden">
            <div class="p-4 border-b border-line">
                <h2 class="text-title flex items-center gap-2"><i class="fa-solid fa-receipt text-accent"></i> Historico de turnos</h2>
            </div>
            ${historico}
        </div>

        <script>
            document.addEventListener('DOMContentLoaded', function () {
                modalBind('cashCloseModal', '${ENDPOINT_FECHAR}', 'Fechando...', 'Turno fechado.', 'cashAposFechar');
                modalBind('cashSangriaModal', '${ENDPOINT_MOVIMENTO}', 'Registrando...', 'Sangria registrada.', 'cashAposSalvar');
                modalBind('cashDepositoModal', '${ENDPOINT_MOVIMENTO}', 'Registrando...', 'Deposito registrado.', 'cashAposSalvar');
            });

            function cashAbrirTurno() {
                var input = document.getElementById('cashFloat');
                var value = parseFloat(String((input && input.value) || '0').replace(',', '.')) || 0;
                postJSON('${ENDPOINT_ABRIR}', { openingFloat: value }).then(function (r) {
                    if (!r.ok) { flash('err', (r.data && r.data.error) || 'Erro ao abrir turno'); return; }
                    flash('ok', 'Turno aberto.');
                    setTimeout(function () { location.reload(); }, 700);
                });
            }

            function cashAposSalvar() {
                setTimeout(function () { location.reload(); }, 700);
            }

            function cashAposFechar(res) {
                var d = (res && res.data && res.data.report && res.data.report.difference) || 0;
                var texto = d === 0
                    ? 'Turno fechado. O caixa bateu.'
                    : (d > 0
                        ? 'Turno fechado. Sobrou ' + d.toFixed(2) + ' na gaveta.'
                        : 'Turno fechado. Faltou ' + Math.abs(d).toFixed(2) + ' na gaveta.');
                flash(d === 0 ? 'ok' : 'err', texto);
                setTimeout(function () { location.reload(); }, 1400);
            }

            async function cashReconcile(shiftId) {
                var countedEl = document.querySelector('[data-counted="' + shiftId + '"]');
                var noteEl = document.querySelector('[data-note="' + shiftId + '"]');
                var counted = parseFloat(String(countedEl ? countedEl.value : '').replace(',', '.'));
                if (!isFinite(counted) || counted < 0) { flash('err', 'Informe o valor contado.'); return; }
                var r = await postJSON('/api/admin/cash/shift/reconcile', {
                    shiftId: shiftId,
                    countedCash: counted,
                    note: noteEl ? noteEl.value : ''
                });
                if (!r.ok) { flash('err', (r.data && r.data.error) || 'Erro ao conferir'); return; }
                var diff = r.data.difference || 0;
                flash('ok', diff === 0 ? 'Conferencia OK: o caixa bateu.'
                    : (diff > 0 ? 'SOBROU ' + diff.toFixed(2) : 'FALTOU ' + Math.abs(diff).toFixed(2)));
                setTimeout(function () { location.reload(); }, 1000);
            }
        </script>

        ${renderModal(cashCloseSpec(d.shift ? d.shift.totals.expected : undefined))}
        ${renderModal(cashMovementSpec('saida'))}
        ${renderModal(cashMovementSpec('entrada'))}`;
}
