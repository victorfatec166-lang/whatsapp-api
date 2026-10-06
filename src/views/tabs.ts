import { escapeHtml, tamanhoLegivel } from './html';
import { currency, statusLabel, type OrderWithProductless } from '../services/stats';
import type { DashboardStats } from '../services/stats';
import { renderComandaModal, COMANDA_SCRIPT } from './comandaModal';
import { kpi, faixaKpi, cardVazio } from './ui/card';

type Product = {
    id: string;
    name: string;
    price: number;
    description: string | null;
    category: string;
    isAvailable: boolean;
};

function money(n: number): string {
    return escapeHtml(currency(n));
}

function phone(p: string): string {
    return escapeHtml(p.replace('@s.whatsapp.net', ''));
}

function timeOf(d: Date): string {
    return escapeHtml(d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
}

/* ------------------------------------------------------------------ Kanban */

type KanbanData = {
    pendentes: OrderWithProductless[];
    preparando: OrderWithProductless[];
    entrega: OrderWithProductless[];
    concluido: OrderWithProductless[];
    /** Concluidos de dias anteriores, ocultos da coluna (mantidos no historico). */
    ocultosConcluidos: number;
    totalAguardando: number;
};

function orderCard(o: OrderWithProductless, next: string | null, cor: string, icon: string): string {
    /*
     * Um botao so, o primario, nas quatro colunas. A cor repetida na tela transformava a cor da
     * coluna em mais uma coisa a decodificar -- quem com pressa lia "laranja" e pensava "esta em
     * preparo" quando o que importava era que o cartao era acionavel. A cor fica na borda.
     */
    const action = next
        ? `<button type="button" data-order-status data-id="${escapeHtml(o.id)}" data-next="${next}"
                     class="btn btn-primary btn-sm w-full mt-1.5">
                     ${statusLabel(next)} <i class="${icon}"></i>
                 </button>`
        : '';

    // Venda de balcao nao tem WhatsApp: mostra o canal para nao confundir.
    const channel =
        o.channel === 'pdv'
            ? '<span class="badge badge-neutral">PDV</span>'
            : '';

    // Comanda da cozinha. Fica ao lado do botao de status, e nao dentro dele:
    // imprimir e avancar o status sao acoes diferentes, e quem monta o pedido
    // as vezes precisa reimprimir sem ter chegado na cozinha ainda.
    const comanda = `<button type="button" data-comanda="${escapeHtml(o.id)}"
                         class="btn btn-ghost btn-sm w-full mt-1.5"
                         title="Ver a comanda da cozinha">
                     <i class="fa-solid fa-print"></i> Comanda
                 </button>`;

    return `                        <div class="bg-sunken border border-line rounded-card p-3 border-l-2" style="border-left-color: var(--${cor})">
                            <div class="flex justify-between items-start gap-2 font-semibold text-body text-ink mb-1">
                                <span class="truncate">${escapeHtml(o.clientName || 'Cliente')}</span>
                                <span class="text-accent-strong shrink-0">${money(o.total)}</span>
                            </div>
                            <p class="text-caption text-ink-3 mb-2 break-words">${escapeHtml(o.items)}</p>
                            <p class="text-caption text-ink-3 mb-1 flex items-center gap-2 flex-wrap">
                                <span><i class="fa-solid fa-clock text-micro"></i> ${timeOf(o.createdAt)}</span>
                                ${
                                    o.channel === 'pdv'
                                        ? `<span title="Pago com ${escapeHtml(o.paymentMethod ?? 'nao informado')}"><i class="fa-solid fa-money-bill-wave text-micro"></i> ${escapeHtml(o.paymentMethod ?? 'balcao')}</span>`
                                        : `<span><i class="fa-solid fa-phone text-micro"></i> ${phone(o.clientPhone)}</span>`
                                }
                                ${channel}
                            </p>
                            ${action}
                            ${comanda}
                        </div>`;
}

/**
 * next nulo e' a coluna de chegada, onde o card e' so leitura. E a unica regiao da tela que
 * rola por dentro: o quadro precisa de altura propria, que nao e' a altura da tela, e' a de quem
 * esta vendendo na frente do balcao.
 */
function colKanban(
    title: string,
    icon: string,
    items: OrderWithProductless[],
    badge: string,
    next: string | null,
    cor: string,
    btnIcon: string,
    empty: string,
    footnote = ''
): string {
    return `                    <div class="card flex flex-col min-h-[16rem]">
                        <div class="flex items-start justify-between gap-2 card-pad pb-3 border-b border-line">
                            <div>
                                <h3 class="text-title flex items-center gap-2"><i class="fa-solid ${icon}"></i> ${title}</h3>
                                <p class="text-caption text-ink-3">${next ? 'pronto para avancar' : 'encerrados hoje'}</p>
                            </div>
                            <span class="badge ${badge}">${items.length}</span>
                        </div>
                        <div class="px-5 py-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
                            ${items.length === 0 ? cardVazio(empty, icon) : ''}
                            ${items.map((o) => orderCard(o, next, cor, btnIcon)).join('')}
                        </div>
                        ${footnote ? `<div class="px-5 pb-4 pt-1 border-t border-line">${footnote}</div>` : ''}
                    </div>`;
}

export function renderKanban(d: KanbanData): string {
    return `${faixaKpi([
        kpi('Aguardando', String(d.totalAguardando), 'pedidos que ainda nao entraram no quadro', 'warning'),
        kpi('No quadro', String(d.pendentes.length + d.preparando.length + d.entrega.length), 'em preparo ou em entrega', 'accent'),
        kpi('Concluidos', String(d.concluido.length), 'finalizados hoje', 'success'),
    ])}

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
            ${colKanban('Pendentes', 'fa-clock', d.pendentes, 'badge-warn', 'preparando', 'warning', 'fa-arrow-right', 'Nenhum pedido aguardando')}
            ${colKanban('Na cozinha', 'fa-fire-burner', d.preparando, 'badge-warn', 'entrega', 'warning', 'fa-arrow-right', 'Nenhum pedido em preparo')}
            ${colKanban('Em entrega', 'fa-motorcycle', d.entrega, 'badge-success', 'concluido', 'success', 'fa-check', 'Nenhuma entrega em andamento')}
            ${colKanban('Concluidos', 'fa-circle-check', d.concluido, 'badge-neutral', null, 'neutral-ink', '', 'Nenhum pedido concluido hoje', d.ocultosConcluidos > 0
                ? `<p class="text-caption text-ink-3 pt-3">
                       <i class="fa-solid fa-clock-rotate-left"></i>
                       ${d.ocultosConcluidos} concluído${d.ocultosConcluidos > 1 ? 's' : ''} de dias anteriores fora${d.ocultosConcluidos > 1 ? 'm' : ''} desta coluna. Continuam no histórico.
                   </p>`
                : '')}
        </div>

        <p class="text-caption text-ink-3 mt-4">
            <i class="fa-solid fa-circle-info"></i>
            O botao do card avança o status e avisa o cliente no WhatsApp.
        </p>

        <script>
            document.addEventListener('click', function (ev) {
                var alvo = ev.target;
                if (!alvo || !alvo.closest) return;

                var status = alvo.closest('[data-order-status]');
                if (status) { avancaStatus(status.dataset.id, status.dataset.next); return; }

                var comanda = alvo.closest('[data-comanda]');
                if (comanda && window.comandaAbrir) comandaAbrir(comanda.dataset.comanda);
            });

            async function avancaStatus(orderId, newStatus) {
                if (!orderId || !newStatus) return;
                try {
                    var r = await postJSON('/admin/order/' + encodeURIComponent(orderId) + '/status', { status: newStatus });
                    if (!r.ok) { flash('err', r.data.error || 'Erro ao atualizar pedido'); return; }
                    location.reload();
                } catch (e) { flash('err', 'Erro de conexao'); }
            }
        </script>

        ${renderComandaModal()}
${COMANDA_SCRIPT}`;
}

/* ----------------------------------------------------------- Configuracoes */

/*
 * A lista e' curta porque e' a lista do que funciona. "Pedido minimo", "Tempo de preparo" e
 * "Chave PIX" gravaram sem ninguem ler (ver renderConfig): nao voltaram porque o tipo e' o que
 * impede a tela de crescer -- campo novo precisa de leitura, e nao so de gravacao.
 */
type ConfigData = {
    businessName: string;
    /** Agenda automatica do caixa. Horarios em "HH:MM", vazio = desativado. */
    cashAutoOpen: string;
    cashAutoClose: string;
    cashDefaultFloat: number;
    /** O que a agenda vai fazer com esses valores, derivado no servico. */
    agenda: import('../services/config').EstadoAgenda;
    /** Números medidos do disco e do banco. Ver services/armazenamento. */
    dados: import('../services/armazenamento').ResumoArmazenamento;
};

export function renderConfig(c: ConfigData): string {
    /*
     * Controle que nao muda nada e' pior que a ausencia dele: o dono acredita que esta protegido.
     * "Nome do negocio" sai no logo, no titulo da aba e no cabecalho da impressora, e a agenda
     * do caixa aceitou horario sem fundo de troco -- estado que o agendador ignora.
     */
    const agendaAtiva = c.agenda.ativa;
    const dados = c.dados;
    const ultimo = dados.ultimoBackup;

    /*
     * Negocio, agenda e armazenamento ocupavam a altura toda de uma vez, e o formulario -- o que
     * se abre para mudar alguma coisa -- ficava abaixo da dobra. Em tela estreita as colunas viram
     * uma, e a ordem continua a de uso: o que se ajusta todo dia primeiro.
     */
    return `        <form onsubmit="return saveConfig(event)" id="cfgForm" class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <div class="card card-pad">
                <h3 class="text-title flex items-center gap-2">
                    <i class="fa-solid fa-store text-accent"></i> Negocio
                </h3>
                <p class="text-caption text-ink-3 mb-4">Aparece no nome da aba, no topo do painel e no rodape do cardapio do WhatsApp</p>
                <div>
                    <label class="label" for="cfg-businessName">Nome do negocio <span class="text-accent" title="Obrigatorio">*</span></label>
                    <input id="cfg-businessName" type="text" name="businessName" value="${escapeHtml(c.businessName)}"
                           maxlength="60" required class="input" placeholder="Como o cliente ve o nome">
                    <p class="text-caption text-ink-3 mt-1">
                        Vai impresso no cabecalho da comanda da impressora. Nao pode ficar vazio.
                    </p>
                </div>
            </div>


            <div class="card card-pad">
                <h3 class="text-title flex items-center gap-2">
                    <i class="fa-solid fa-clock text-accent"></i> Agenda do caixa
                </h3>
                <p class="text-caption text-ink-3 mb-4">
                    Abre e fecha o turno sozinho. O fechamento automatico nao conta o dinheiro da gaveta:
                    registra o valor esperado e deixa a conferencia para depois.
                </p>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="label" for="cfg-cashAutoOpen">Abre as</label>
                        <input id="cfg-cashAutoOpen" type="time" name="cashAutoOpen" value="${escapeHtml(c.cashAutoOpen)}" class="input">
                        <p class="text-caption text-ink-3 mt-1">Vazio = desativado</p>
                    </div>
                    <div>
                        <label class="label" for="cfg-cashAutoClose">Fecha as</label>
                        <input id="cfg-cashAutoClose" type="time" name="cashAutoClose" value="${escapeHtml(c.cashAutoClose)}" class="input">
                        <p class="text-caption text-ink-3 mt-1">Vazio = desativado</p>
                    </div>
                </div>

                <div class="mt-3">
                    <label class="label" for="cfg-cashDefaultFloat">Fundo de troco</label>
                    <div class="flex items-center gap-2">
                        <span class="text-body text-ink-3 shrink-0" aria-hidden="true">R$</span>
                        <input id="cfg-cashDefaultFloat" type="number" name="cashDefaultFloat" step="0.01" min="0"
                               inputmode="decimal" value="${escapeHtml(c.cashDefaultFloat)}" class="input">
                    </div>
                    <p class="text-caption text-ink-3 mt-1">
                        A abertura so fica ativa com este valor preenchido: um fundo estimado contaminaria a
                        diferenca de caixa de todo fechamento.
                    </p>
                </div>

                <div id="cfgAgenda" class="flex items-start gap-2 text-caption border border-line rounded-card p-3 mt-3 bg-surface-2 text-ink-2">
                    <i class="fa-solid ${agendaAtiva ? 'fa-circle-check text-accent-emerald' : 'fa-circle-info text-accent'} mt-0.5 shrink-0"></i>
                    <span id="cfgAgendaTexto">${escapeHtml(c.agenda.resumo)}</span>
                </div>

                <p class="text-caption text-ink-3 mt-2">
                    Para fechar depois da meia-noite, use um horario menor que o de abertura (ex.: abre 22:00, fecha 00:30).
                </p>
            </div>

            <div class="card xl:col-span-2">
                <div class="card-pad pb-3">
                    <h3 class="text-title flex items-center gap-2">
                        <i class="fa-solid fa-hard-drive text-accent"></i> Dados e armazenamento
                    </h3>
                    <p class="text-caption text-ink-3">
                        Onde o sistema guarda o que ele guarda. Os numeros sao medidos agora, a cada visita a esta tela.
                    </p>
                </div>
                <div class="px-5 pb-5">
                    ${faixaKpi([
                        kpi(
                            'Banco de dados',
                            escapeHtml(tamanhoLegivel(dados.bancoBytes)),
                            dados.bancoArquivos.length > 0
                                ? escapeHtml(dados.bancoArquivos.map((f) => f.nome).join(', '))
                                : 'arquivo nao encontrado'
                        ),
                        kpi(
                            'Backups',
                            escapeHtml(tamanhoLegivel(dados.backupBytes)),
                            `${dados.backupQuantidade} ${dados.backupQuantidade === 1 ? 'copia' : 'copias'}`
                        ),
                        kpi('Sessao do WhatsApp', escapeHtml(tamanhoLegivel(dados.sessaoBytes)), `${dados.sessaoArquivos} arquivos`),
                        kpi('Logs', escapeHtml(tamanhoLegivel(dados.logBytes)), `${dados.logQuantidade} ${dados.logQuantidade === 1 ? 'dia' : 'dias'}`),
                    ], 4)}

                    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                        <div class="bg-surface-2 border border-line rounded-card p-3">
                            <p class="text-caption text-ink-3">Mensagens hoje</p>
                            <p class="kpi-value">${dados.mensagensHoje}</p>
                            <p class="kpi-sub">guardadas ate a virada do dia</p>
                        </div>
                        <div class="bg-surface-2 border border-line rounded-card p-3">
                            <p class="text-caption text-ink-3">Pedidos hoje</p>
                            <p class="kpi-value">${dados.pedidosHoje}</p>
                            <p class="kpi-sub">no historico</p>
                        </div>
                        <div class="bg-surface-2 border border-line rounded-card p-3">
                            <p class="text-caption text-ink-3">Conversas na lista</p>
                            <p class="kpi-value">${dados.conversasAtivas}</p>
                            <p class="kpi-sub">com janela aberta</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 text-caption text-ink-2">
                        <div class="flex items-start gap-2 bg-surface-2 border border-line rounded-card p-3">
                            <i class="fa-solid fa-broom text-accent mt-0.5 shrink-0"></i>
                            <div class="min-w-0">
                                <p class="font-medium text-ink">O que o sistema esquece</p>
                                <p class="mt-0.5">${escapeHtml(dados.retencao)}</p>
                                <p class="text-ink-3 mt-1">Proxima virada: ${escapeHtml(dados.proximaVirada.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</p>
                            </div>
                        </div>

                        <div class="flex items-start gap-2 bg-surface-2 border border-line rounded-card p-3">
                            <i class="fa-solid fa-clock-rotate-left text-accent mt-0.5 shrink-0"></i>
                            <div class="min-w-0 flex-1">
                                <p class="font-medium text-ink">Ultimo backup</p>
                                ${
                                    ultimo
                                        ? `<p class="mt-0.5">${escapeHtml(ultimo.arquivo)} &middot; ${escapeHtml(ultimo.quando.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</p>`
                                        : '<p class="mt-0.5">Nenhuma copia ainda. A primeira e' + ' feita quando o servidor sobe.</p>'
                                }
                                <p class="text-ink-3 mt-1 break-all">Pasta: ${escapeHtml(dados.pastaBackup)}</p>
                                <div class="flex items-center gap-2 mt-3 flex-wrap">
                                    <button type="button" id="btnBackupAgora" onclick="fazBackupAgora()"
                                        class="btn btn-secondary btn-sm">
                                        <i class="fa-solid fa-camera-retro"></i> Fazer agora
                                    </button>
                                    <span id="backupAviso" class="text-caption text-ink-3"></span>
                                </div>
                            </div>
                        </div>

                        <div class="flex items-start gap-2 rounded-card p-3 border ${dados.exposicao.aberta ? 'bg-warning-bg border-accent-orange text-ink-2' : 'bg-surface-2 border-line text-ink-2'}">
                            <i class="fa-solid ${dados.exposicao.aberta ? 'fa-triangle-exclamation text-accent-orange' : 'fa-lock text-accent-emerald'} mt-0.5 shrink-0"></i>
                            <div class="min-w-0">
                                <p class="font-medium text-ink">
                                    ${dados.exposicao.aberta ? 'O painel esta aberto para a rede local' : 'O painel so responde nesta maquina'}
                                </p>
                                <p class="mt-0.5">
                                    Escuta em <span class="font-mono">${escapeHtml(dados.exposicao.host)}</span>${
                                        dados.exposicao.aberta
                                            ? ', entao qualquer computador da mesma rede que saiba a porta chega no faturamento, no caixa e nas conversas -- e o painel ainda nao tem senha.'
                                            : '. Quem so usa nesta maquina nao alcanca o painel de fora.'
                                    }
                                </p>
                                ${
                                    dados.exposicao.aberta
                                        ? '<p class="text-ink-3 mt-1">Para fechar: defina <span class="font-mono">HOST=127.0.0.1</span> no arquivo .env e reinicie o servidor.</p>'
                                        : ''
                                }
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="xl:col-span-2 flex items-center gap-2">
                <button type="submit" class="btn btn-primary">
                    <i class="fa-solid fa-save"></i> Salvar
                </button>
                <span class="text-caption text-ink-3">As alteracoes valem para o proximo pedido e para a proxima virada de turno.</span>
            </div>
        </form>

        <script>
            function fazBackupAgora() {
                var botao = document.getElementById('btnBackupAgora');
                var aviso = document.getElementById('backupAviso');
                if (!botao || !aviso) return;
                if (botao.disabled) return;

                botao.disabled = true;
                aviso.textContent = 'Copiando...';
                aviso.className = 'text-caption text-ink-3';

                postJSON('/api/admin/backup', {}).then(function (r) {
                    if (!r.ok) {
                        aviso.textContent = r.data.error || 'Nao foi possivel fazer a copia.';
                        aviso.className = 'text-caption text-accent-red';
                        botao.disabled = false;
                        return;
                    }
                    esperaBackup();
                }).catch(function () {
                    aviso.textContent = 'Nao foi possivel falar com o servidor.';
                    aviso.className = 'text-caption text-accent-red';
                    botao.disabled = false;
                });
            }

            function esperaBackup(tentativa) {
                var aviso = document.getElementById('backupAviso');
                var botao = document.getElementById('btnBackupAgora');
                if (!aviso || !botao) return;

                var n = tentativa || 0;
                var desistir = function () {
                    if (n >= 20) finaliza('A copia nao apareceu. Olhe o log.', false);
                    else setTimeout(function () { esperaBackup(n + 1); }, 1500);
                };

                postJSON('/api/admin/backup/listar', {}).then(function (r) {
                    if (!r.ok) return desistir();
                    var lista = r.data.copias || [];
                    if (lista.length > 0) {
                        var quando = new Date(lista[0].quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
                        return finaliza('Copia de ' + quando + ' pronta (' + tamanhoLegivelJs(lista[0].bytes) + ').', true);
                    }
                    desistir();
                }).catch(desistir);
            }

            function finaliza(mensagem, deuCerto) {
                var aviso = document.getElementById('backupAviso');
                var botao = document.getElementById('btnBackupAgora');
                if (aviso) {
                    aviso.textContent = mensagem;
                    aviso.className = 'text-caption ' + (deuCerto ? 'text-accent-emerald' : 'text-accent-red');
                }
                if (botao) botao.disabled = false;
            }

            function tamanhoLegivelJs(bytes) {
                if (!bytes) return '0 KB';
                if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
                return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
            }

            function cfgEstadoAgenda() {
                var abre = document.getElementById('cfg-cashAutoOpen').value;
                var fecha = document.getElementById('cfg-cashAutoClose').value;
                var fundo = parseFloat(document.getElementById('cfg-cashDefaultFloat').value) || 0;

                if (abre === '' && fecha === '') {
                    return { ativa: false, texto: 'Desativada. O turno e' + ' aberto e fechado a mao.' };
                }
                if (!(fundo > 0)) {
                    return { ativa: false, texto: 'Nao vai funcionar ainda: falta o fundo de troco. Sem ele o turno nao abre sozinho.' };
                }
                var dinheiro = 'R$ ' + fundo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                if (abre !== '' && fecha === '') {
                    return { ativa: true, texto: 'Abre sozinho as ' + abre + ' com ' + dinheiro + ' de fundo. O fechamento continua sendo manual.' };
                }
                if (fecha !== '' && abre === '') {
                    return { ativa: true, texto: 'Fecha sozinho as ' + fecha + ', conferindo o dinheiro da gaveta. A abertura continua sendo manual.' };
                }
                return { ativa: true, texto: 'Abre as ' + abre + ' com ' + dinheiro + ' de fundo e fecha as ' + fecha + '.' };
            }

            function cfgAtualizaAgenda() {
                var e = cfgEstadoAgenda();
                document.getElementById('cfgAgendaTexto').textContent = e.texto;
                var icone = document.querySelector('#cfgAgenda i');
                icone.className = 'fa-solid ' + (e.ativa ? 'fa-circle-check text-green-600' : 'fa-circle-info text-accent') + ' mt-0.5 shrink-0';
            }

            ['cfg-cashAutoOpen', 'cfg-cashAutoClose', 'cfg-cashDefaultFloat'].forEach(function (id) {
                var el = document.getElementById(id);
                el.addEventListener('input', cfgAtualizaAgenda);
            });

            async function saveConfig(event) {
                event.preventDefault();
                var btn = event.target.querySelector('button[type="submit"]');
                var original = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
                try {
                    var r = await postJSON('/admin/config/save', Object.fromEntries(new FormData(event.target).entries()));
                    if (!r.ok) {
                        flash('err', r.data.error || 'Erro ao salvar');
                        return;
                    }
                    flash('ok', 'Configuracoes salvas.');
                    setTimeout(function () { window.location.reload(); }, 700);
                } catch (e) {
                    flash('err', 'Erro de conexao');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = original;
                }
            }
        </script>`;
}

/* ------------------------------------------------------------ Calendario */

/**
 * Nao mostra faturamento: responde "quantos pedidos houve", pergunta de operacao. Quanto
 * entrou em dinheiro e' da aba Faturamento.
 */
type CalendarData = { totalOrders: number; totalRevenue: number; daysInPeriod: number };

export function renderCalendar(d: CalendarData): string {
    /*
     * Largura propria, e nao a do container: o main aceita 88rem, e uma grade de 7 colunas nisso
     * da um bloco vazio de 200px por dia. Calendario e' tabela, e tabela fica melhor apertada.
     * E os blocos vao em card: soltos, pareciam quatro telas diferentes em vez de uma.
     */
    return `        <div class="max-w-6xl">
            ${faixaKpi([
                kpi('Pedidos no periodo', String(d.totalOrders), `de ${d.daysInPeriod} dia(s) em vista`),
                kpi('Media por dia', (d.totalOrders / Math.max(1, d.daysInPeriod)).toFixed(1).replace('.', ','), 'ritmo do periodo'),
            ], 2)}

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            <div class="lg:col-span-2 space-y-5">

            <div class="card">
                <div class="card-pad flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <span class="text-micro uppercase text-ink-3">Em vista</span>
                        <select id="calMonth" onchange="irPara(parseInt(this.value,10), currentYear)" class="input w-auto py-1.5" aria-label="Mes em vista"></select>
                        <select id="calYear" onchange="irPara(currentMonth, parseInt(this.value,10))" class="input w-auto py-1.5" aria-label="Ano em vista"></select>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="mudaMes(-1)" class="btn btn-ghost w-9 h-9 p-0" aria-label="Mes anterior">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <button type="button" onclick="mudaMes(1)" class="btn btn-ghost w-9 h-9 p-0" aria-label="Proximo mes">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                </div>

                <div class="px-5 pb-5">
                    <div class="grid grid-cols-7 gap-1 mb-2 text-center text-caption font-semibold text-ink-3 uppercase">
                        <div>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div>
                    </div>
                    <div class="grid grid-cols-7 gap-1" id="calendarGrid" style="min-height: 28rem"></div>
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-caption text-ink-3">
                        <span class="flex items-center gap-1.5">
                            <span class="w-3 h-3 rounded-sm border border-success bg-success-bg"></span>
                            Dia com pedido
                        </span>
                        <span class="flex items-center gap-1.5">
                            <span class="w-3 h-3 rounded-sm border-2 border-accent"></span>
                            Dia selecionado
                        </span>
                        <span class="flex items-center gap-1.5">
                            <span class="w-3 h-3 rounded-sm border border-accent-orange"></span>
                            Hoje
                        </span>
                    </div>
                </div>
            </div>

            <div class="card flex flex-col overflow-hidden">
                <div class="card-pad pb-2">
                    <h3 class="text-title" id="dayOrdersTitle">Pedidos do dia selecionado</h3>
                    <div id="diaForaDaVista" class="hidden mt-1 text-caption text-accent-orange"></div>
                </div>
                <div class="px-5 pb-5 min-h-0 flex-1 overflow-y-auto">
                    <div id="dayOrders">${cardVazio('Clique em um dia no calendario para ver os pedidos.', 'fa-calendar-day')}</div>
                </div>
            </div>
            </div>


            <div class="card flex flex-col overflow-hidden max-h-[calc(100vh-13rem)]">
                <div class="card-pad pb-2 shrink-0">
                    <h3 class="text-title flex items-center gap-2">
                        <i class="fa-solid fa-bell text-accent"></i> Lembretes
                    </h3>
                    <p class="text-caption text-ink-3">O que precisa ser feito em cada dia</p>
                </div>
                <div class="px-5 pb-5 min-h-0 flex-1 overflow-y-auto">
                    <form id="lembreteForm" onsubmit="return lembreteSalva(event)" class="space-y-2">
                        <label class="label" for="lembreteTexto">Novo lembrete</label>
                        <textarea id="lembreteTexto" rows="2" maxlength="160" class="input" placeholder="Ligar para o fornecedor de pao"></textarea>
                        <p class="text-caption text-ink-3" id="lembretePara">Vai para hoje. Clique em um dia no calendario para escolher outro.</p>
                        <button type="submit" class="btn btn-primary w-full">
                            <i class="fa-solid fa-plus"></i> Anotar
                        </button>
                    </form>
                    <div id="lembreteLista" class="mt-4 space-y-2">
                        <p class="text-body text-ink-3">Nenhum lembrete neste mes.</p>
                    </div>
                </div>
            </div>
        </div>

        <script src="/api/calendar.js"></script>`;
}

/* ----------------------------------------------------------- Estatisticas */

export function renderStats(s: DashboardStats): string {
    const maxHour = Math.max(...s.byHour.map((h) => h.orders), 1);
    const maxDow = Math.max(...s.byDayOfWeek.map((d) => d.orders), 1);
    const maxProd = Math.max(...s.topProducts.map((p) => p.qty), 1);
    const maxDay = Math.max(...s.revenueByDay.map((d) => d.revenue), 1);

    /*
     * Tres faixas e nao uma com nove cartoes: nove numeros juntos sao uma parede sem ordem de
     * leitura, e separado em receita, operacao e ajuste cada faixa responde a uma pergunta. As
     * faixas usavam um cartao proprio, escrito a mao: agora vem do mesmo lugar que a Home.
     */
    return `${faixaKpi([
        kpi('Receita hoje', money(s.today.revenue), `${s.today.orders} pedido(s) hoje`, 'accent'),
        kpi('Receita 7 dias', money(s.week.revenue), `${s.week.orders} pedido(s)`, 'accent'),
        kpi('Receita 30 dias', money(s.month.revenue), `${s.month.orders} pedido(s)`, 'success'),
        kpi('Ticket medio', money(s.averageTicket), `${s.allTime.orders} pedido(s) no total`, 'warning'),
    ])}

        ${faixaKpi([
            kpi('Pedidos pendentes', String(s.byStatus.pendente ?? 0), 'aguardando preparacao', 'warning'),
            kpi('Em producao', String((s.byStatus.preparando ?? 0) + (s.byStatus.entrega ?? 0)), 'preparando + em entrega', 'warning'),
            kpi('Concluidos', String(s.byStatus.concluido ?? 0), 'finalizados', 'success'),
        ])}

        ${faixaKpi([
            kpi('Descontos hoje', money(s.todayAdjustments.discounts), 'concedidos no PDV', 'danger'),
            kpi('Gorjetas hoje', money(s.todayAdjustments.tips), 'repassadas a equipe', 'success'),
            kpi(
                s.byChannel.length ? s.byChannel[0].label : 'PDV / Balcao',
                s.byChannel.length ? String(s.byChannel[0].orders) + ' pedidos' : '0',
                s.byChannel.length ? money(s.byChannel[0].revenue) : 'sem dados'
            ),
        ])}

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div class="card">
                <div class="card-pad pb-2">
                    <h3 class="text-title">Mais vendidos</h3>
                    <p class="text-caption text-ink-3">Quantidade de unidades por item</p>
                </div>
                <div class="px-5 pb-5">
                    ${s.topProducts.length === 0 ? cardVazio('Sem dados ainda.', 'fa-chart-simple') : ''}
                    ${s.topProducts.map((p) => `                <div class="mb-3">
                    <div class="flex justify-between text-body mb-1">
                        <span class="text-ink truncate">${escapeHtml(p.name)}</span>
                        <span class="text-caption text-ink-3 shrink-0 ml-2">${p.qty} un.</span>
                    </div>
                    <div class="bar-track h-2"><div class="bar-fill" style="width:${Math.round((p.qty / maxProd) * 100)}%"></div></div>
                </div>`).join('')}
                </div>
            </div>

            <div class="card">
                <div class="card-pad pb-2">
                    <h3 class="text-title">Faturamento por dia</h3>
                    <p class="text-caption text-ink-3">Ultimos ${s.revenueByDay.length} dia(s) com pedidos</p>
                </div>
                <div class="px-5 pb-5">
                    ${s.revenueByDay.length === 0 ? cardVazio('Sem dados ainda.', 'fa-chart-column') : ''}
                    <div class="flex items-end gap-2 h-40">
                        ${s.revenueByDay.map((d) => `                    <div class="flex-1 flex flex-col items-center gap-1" title="${d.label}: ${money(d.revenue)} (${d.orders} pedidos)">
                        <div class="w-full bar-track flex items-end" style="height:100%">
                            <div class="bar-fill-emerald w-full" style="height:${Math.round((d.revenue / maxDay) * 100)}%"></div>
                        </div>
                        <span class="text-micro text-ink-3">${escapeHtml(d.label)}</span>
                    </div>`).join('')}
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-pad pb-2">
                    <h3 class="text-title">Pedidos por hora</h3>
                    <p class="text-caption text-ink-3">${s.busiestHour ? 'Pico as ' + String(s.busiestHour.hour).padStart(2, '0') + 'h' : 'Sem dados'}</p>
                </div>
                <div class="px-5 pb-5">
                    <div class="flex items-end gap-1 h-32">
                        ${s.byHour.map((h) => `                    <div class="flex-1 bar-track flex items-end" style="height:100%" title="${String(h.hour).padStart(2, '0')}h: ${h.orders} pedido(s)">
                        <div class="bar-fill-orange w-full" style="height:${Math.round((h.orders / maxHour) * 100)}%"></div>
                    </div>`).join('')}
                    </div>
                    <div class="flex justify-between text-micro text-ink-3 mt-1"><span>00h</span><span>12h</span><span>23h</span></div>
                </div>
            </div>

            <div class="card">
                <div class="card-pad pb-2">
                    <h3 class="text-title">Pedidos por dia da semana</h3>
                    <p class="text-caption text-ink-3">Distribuicao da semana</p>
                </div>
                <div class="px-5 pb-5">
                    ${s.byDayOfWeek.map((d) => `                <div class="mb-2">
                    <div class="flex justify-between text-body mb-1">
                        <span class="text-ink">${d.label}</span>
                        <span class="text-caption text-ink-3">${d.orders} pedido(s)</span>
                    </div>
                    <div class="bar-track h-2"><div class="bar-fill-slate" style="width:${Math.round((d.orders / maxDow) * 100)}%"></div></div>
                </div>`).join('')}
                </div>
            </div>
        </div>`;
}

/* ------------------------------------------------------------- Relatorios */

export type ReportData = {
    rowsHtml: string;
    count: number;
    total: number;
    from: string;
    to: string;
    /** Turnos fechados: mantidos no tipo, mas o Z report foi para o item Caixa. */
    shifts: Array<{
        id: string;
        openedAt: string;
        closedAt: string;
        openingFloat: number;
        expectedCash: number | null;
        countedCash: number | null;
        difference: number | null;
        revenue: number;
        orders: number;
    }>;
};

/* -------------------------------------------------------------------- Bot */

/*
 * A tela precisa responder tres perguntas, e antes nao respondia nenhuma: o que o bot manda
 * agora (o campo vem com o texto efetivo, e antes abria vazio para quem nunca editou), o que e'
 * o padrao (botao em cada campo editado) e quais eu ja mexi (selo por campo e contador no topo).
 */

type EstadoMensagem = {
    /** Texto que o bot manda agora: o editado, ou o padrao se nao houver. */
    texto: string;
    /** Texto padrao, do codigo. */
    padrao: string;
    /** true quando o texto atual difere do padrao. */
    editado: boolean;
};

export type BotData = {
    mensagens: Record<string, EstadoMensagem>;
    /** `false` quando o dono pausou o bot desta loja. Ausente = ligado. */
    ligado?: boolean;
    /** Texto que o cliente recebe enquanto pausado. Vazio = o padrao do servico. */
    avisoPausado?: string;
};

/**
 * Viram botao em vez de texto solto na ajuda porque ninguem deveria ter que lembrar de um
 * detalhe de sintaxe para escrever "Total {total}". Erro de digitacao aqui mandava a variavel
 * literal para o cliente, e o unico sintoma era o cliente reclamando de um texto com chaves.
 */
const VARIAVEIS: Array<{ token: string; exemplo: string }> = [
    { token: '{items}', exemplo: '2x Coxinha' },
    { token: '{total}', exemplo: '18,00' },
];

type CampoBot = {
    key: string;
    label: string;
    rows: number;
    hint?: string;
    /** Esta mensagem recebe itens e total. So nestas aparecem os botoes. */
    comValores?: boolean;
};

/**
 * A ordem anterior era a do codigo, que e' a ordem em que as mensagens foram escritas -- nao a
 * em que alguem precisa delas: quem mudava "status: em entrega" procurava no meio de quinze
 * caixas iguais. Agrupar por momento reduz a tela a quatro perguntas que a pessoa tem.
 */
const GRUPOS_BOT: Array<{ titulo: string; descricao: string; campos: CampoBot[] }> = [
    {
        titulo: 'Primeiro contato',
        descricao: 'O que o cliente recebe antes de qualquer coisa.',
        campos: [
            {
                key: 'mainMenu',
                label: 'Menu inicial',
                rows: 8,
                hint: 'Enviada quando o cliente manda "oi", "menu" ou "0".',
            },
            { key: 'menuEmpty', label: 'Cardapio vazio', rows: 2, hint: 'Nao ha produto cadastrado.' },
        ],
    },
    {
        titulo: 'Cardapio',
        descricao: 'Titulos e rodape que emolduram a lista de produtos.',
        campos: [
            { key: 'menuHeader', label: 'Cabecalho', rows: 1 },
            { key: 'dailyMenuTitle', label: 'Titulo do menu do dia', rows: 1, hint: 'Secao no topo do cardapio.' },
            { key: 'regularMenuTitle', label: 'Titulo do cardapio', rows: 1, hint: 'Abaixo do menu do dia, quando existe um.' },
            { key: 'menuFooter', label: 'Rodape', rows: 2, hint: 'Fecha a lista e diz como pedir.' },
        ],
    },
    {
        titulo: 'Pedido',
        descricao: 'O que o cliente recebe ao fechar o pedido, e o que recebe quando algo da errado.',
        campos: [
            {
                key: 'orderReceived',
                label: 'Pedido recebido',
                rows: 6,
                comValores: true,
                hint: 'Primeira confirmacao. Se o cliente pedir para cancelar, sair da loja.',
            },
            { key: 'noOrders', label: 'Cliente sem pedidos', rows: 2, hint: 'Quando ele consulta e nao ha nada.' },
            { key: 'invalidOption', label: 'Opcao invalida', rows: 2, hint: 'Ele digitou algo fora do menu.' },
            { key: 'invalidProduct', label: 'Produto invalido', rows: 2, hint: 'Numero que nao existe no cardapio.' },
        ],
    },
    {
        titulo: 'Andamento do pedido',
        descricao: 'Enviadas por voce, ao mudar o status na tela de Pedidos.',
        campos: [
            {
                key: 'statusPreparando',
                label: 'Preparando',
                rows: 6,
                comValores: true,
                hint: 'Assim que a cozinha comeca.',
            },
            {
                key: 'statusEntrega',
                label: 'Saiu para entrega',
                rows: 6,
                comValores: true,
                hint: 'Quando o pedido e' + ' marcado como em entrega.',
            },
            { key: 'statusConcluido', label: 'Entregue', rows: 4, hint: 'Quando voce marca como concluido.' },
        ],
    },
    {
        titulo: 'Atendimento',
        descricao: 'O que o bot responde quando o cliente pede para falar com uma pessoa.',
        campos: [
            {
                key: 'attendantMessage',
                label: 'Atendente solicitado',
                rows: 3,
                hint: 'O bot fica calado nessa conversa. Para voltar ao automatico, o proprio cliente escreve *menu*.',
            },
        ],
    },
];

const TODOS_OS_CAMPOS = GRUPOS_BOT.flatMap((g) => g.campos);

function campoBot(f: CampoBot, e: EstadoMensagem): string {
    const id = 'msg-' + f.key;
    const selaoVariavel = f.comValores
        ? `
                            <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                                <span class="text-caption text-ink-3">Inserir:</span>
                                ${VARIAVEIS.map(
                                    (v) => `<button type="button" onclick="msgInserir('${v.token}')" class="badge badge-neutral font-mono hover:bg-surface-2 transition" title="Vira, por exemplo: ${escapeHtml(v.exemplo)}">${escapeHtml(v.token)}</button>`
                                ).join('')}
                                <span class="text-caption text-ink-3 ml-1">Pode usar varias vezes no mesmo texto.</span>
                            </div>`
        : '';

    return `                    <div class="bg-surface-2 border border-line rounded-card p-4">
                        <div class="flex items-start justify-between gap-3 mb-1.5">
                            <label class="label mb-0" for="${id}">${escapeHtml(f.label)}</label>
                            <span class="flex items-center gap-2 shrink-0">
                                <span data-selo="${escapeHtml(f.key)}" class="badge ${e?.editado ? 'badge-warn' : 'badge-neutral'}">${e?.editado ? 'Editada' : 'Padrao'}</span>
                                <button type="button" data-restaurar="${escapeHtml(f.key)}" class="btn btn-ghost btn-sm ${e?.editado ? '' : 'hidden'}" title="Voltar este texto ao padrao">
                                    <i class="fa-solid fa-rotate-left"></i> Padrao
                                </button>
                            </span>
                        </div>
                        ${f.hint ? `<p class="text-caption text-ink-3 mb-2">${escapeHtml(f.hint)}</p>` : ''}
                        <textarea id="${id}" name="${escapeHtml(f.key)}" rows="${f.rows}" spellcheck="false"
                                  class="input font-mono leading-relaxed resize-y">${escapeHtml(e?.texto ?? '')}</textarea>${selaoVariavel}
                    </div>`;
}

export function renderBot(d: BotData): string {
    const editadas = TODOS_OS_CAMPOS.filter((f) => d.mensagens[f.key]?.editado).length;

    /*
     * Sem botao de "voltar tudo ao padrao" aqui dentro: ele subiu para o topo da aba, no
     * WhatsApp, onde aparece sempre. Repetido aqui, so aparecia com a secao aberta -- e a secao
     * abre recolhida. Fica o contador, que e' o que faz sentido neste nivel.
     */
    return `        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p class="text-body text-ink-3 max-w-2xl">
                O que o bot responde. O campo vazio usa o texto padrao.
            </p>
            <span class="badge ${editadas > 0 ? 'badge-warn' : 'badge-neutral'}" data-contador>
                ${editadas === 0 ? 'Tudo no padrao' : editadas + ' de ' + TODOS_OS_CAMPOS.length + ' editadas'}
            </span>
        </div>

        <form onsubmit="return saveBotMessages(event)" class="space-y-6 max-w-4xl" data-form-mensagens>
${GRUPOS_BOT.map(
    (g) => `            <details class="card" ${g.campos.some((f) => d.mensagens[f.key]?.editado) ? 'open' : ''}>
                <summary class="cursor-pointer text-title flex items-center gap-2 select-none card-pad">
                    ${escapeHtml(g.titulo)}
                    <span class="text-caption text-ink-3 truncate hidden sm:inline">${escapeHtml(g.descricao)}</span>
                    <i class="fa-solid fa-chevron-down ml-auto text-caption text-ink-3 shrink-0"></i>
                </summary>
                <div class="px-5 pb-5 space-y-4">
${g.campos.map((f) => campoBot(f, d.mensagens[f.key])).join('\n')}
                </div>
            </details>`
).join('\n')}

            <div class="flex items-center gap-3">
                <button type="submit" class="btn btn-primary">
                    <i class="fa-solid fa-save"></i> Salvar mensagens
                </button>
                <span class="text-caption text-ink-3">Valem para a proxima mensagem enviada. O bot pode estar falando com um cliente agora.</span>
            </div>
        </form>

        <script>
            function msgInserir(token) {
                var area = document.activeElement;
                if (!area || area.tagName !== 'TEXTAREA') {
                    area = document.querySelector('textarea:focus') || document.querySelector('textarea[name="' + token + '"]');
                }
                if (!area || area.tagName !== 'TEXTAREA') return;

                var inicio = area.selectionStart;
                var fim = area.selectionEnd;
                var antes = area.value.slice(0, inicio);
                var depois = area.value.slice(fim);
                area.value = antes + token + depois;
                area.focus();
                var cursor = inicio + token.length;
                area.setSelectionRange(cursor, cursor);
                msgMarcaEditada(area.name);
            }

            function msgMarcaEditada(key) {
                var selo = document.querySelector('[data-selo="' + key + '"]');
                if (selo) selo.textContent = 'Nao salvo';
                msgConta();
            }

            function msgConta() {
                var areas = document.querySelectorAll('[data-form-mensagens] textarea');
                var mudados = 0;
                for (var i = 0; i < areas.length; i++) {
                    if (areas[i].getAttribute('data-original') !== null &&
                        areas[i].value.trim() !== areas[i].getAttribute('data-original').trim()) mudados++;
                }
                var contador = document.querySelector('[data-contador]');
                if (contador && mudados > 0) {
                    contador.textContent = mudados + ' nao salva(s)';
                    contador.className = 'badge badge-amber';
                }
            }

            document.addEventListener('DOMContentLoaded', function () {
                var areas = document.querySelectorAll('[data-form-mensagens] textarea');
                for (var i = 0; i < areas.length; i++) {
                    areas[i].setAttribute('data-original', areas[i].value);
                    areas[i].addEventListener('input', msgConta);
                }
            });

            function msgRestaurar(key) {
                var area = document.querySelector('textarea[name="' + key + '"]');
                if (!area) return;
                confirmThen(
                    'A area volta a ficar vazia, como o programa entrega essa mensagem. Nada e gravado ainda: ' +
                        'o que vale e o que estiver na tela quando voce salvar.',
                    function () {
                        area.value = '';
                        area.setAttribute('data-original', '');
                        var selo = document.querySelector('[data-selo="' + key + '"]');
                        if (selo) { selo.textContent = 'Padrao'; selo.className = 'badge badge-neutral'; }
                        var botao = document.querySelector('[data-restaurar="' + key + '"]');
                        if (botao) botao.classList.add('hidden');
                        msgConta();
                    },
                    { titulo: 'Voltar ao texto padrao', confirmar: 'Voltar ao padrao' }
                );
            }

            async function msgRestaurarTodas() {
                confirmThen(
                    'Todos os textos que voce alterado serao apagados e o bot volta a falar do jeito que veio com o programa. ' +
                        'O que foi digitado aqui nao tem como recuperar depois.',
                    async function () {
                        var r = await postJSON('/admin/bot-messages/restaurar-todas', {});
                        if (!r.ok) { flash('err', r.data.error || 'Erro ao restaurar'); return; }
                        var quantas = r.data.restauradas || 0;
                        flash('ok', quantas === 1 ? '1 texto voltou ao padrao.' : quantas + ' textos voltaram ao padrao.');
                        setTimeout(function () { window.location.reload(); }, 900);
                    },
                    { titulo: 'Descartar as alteracoes?', confirmar: 'Descartar', cancelar: 'Manter' }
                );
            }

            async function saveBotMessages(event) {
                event.preventDefault();
                var btn = event.target.querySelector('button[type="submit"]');
                var original = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

                var areas = document.querySelectorAll('[data-form-mensagens] textarea');
                var payload = {};
                for (var i = 0; i < areas.length; i++) {
                    var original_ = areas[i].getAttribute('data-original') || '';
                    if (areas[i].value.trim() !== original_.trim()) payload[areas[i].name] = areas[i].value;
                }

                if (Object.keys(payload).length === 0) {
                    btn.disabled = false;
                    btn.innerHTML = original;
                    flash('ok', 'Nada mudou.');
                    return;
                }

                try {
                    var r = await postJSON('/admin/bot-messages/save', payload);
                    if (!r.ok) {
                        flash('err', r.data.error || 'Erro ao salvar');
                        return;
                    }
                    var quantas = (r.data.salvas || []).length + (r.data.restauradas || []).length;
                    flash('ok', quantas + ' mensagem(ns) salva(s).');
                    setTimeout(function () { window.location.reload(); }, 700);
                } catch (e) {
                    flash('err', 'Erro de conexao');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = original;
                }
            }
        </script>`;
}

/* ---------------------------------------------------------------- Sistema */
