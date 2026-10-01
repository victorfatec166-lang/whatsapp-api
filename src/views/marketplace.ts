import { escapeHtml } from './html';
import { cardVazio } from './ui/card';
import { currency, statusLabel } from '../services/stats';
import { renderModal } from './ui/modal';
import { credencialSpec, itemSpec, marketplaceModalsScript } from './marketplaceModals';
import { CANAIS, type Canal, type ContaResumo, type StatusConta } from '../services/marketplace';

/**
 * Nada aqui promete o que nao pode cumprir: status "conectado" que nao veio de comunicacao real
 * faz o dono descobrir no almoco que o pedido nao veio. Tres passos porque e' a ordem do
 * trabalho, e quem so tem a etapa 1 ve que os pedidos ainda nao terao baixa de estoque.
 */

export type ItemCasado = {
    externalId: string;
    lastPrice: number | null;
    lastSyncedAt: Date | null;
    product: { id: string; name: string; price: number };
};

export type PedidoExterno = {
    id: string;
    externalId: string | null;
    total: number;
    status: string;
    createdAt: Date;
};

export type MarketplaceData = {
    contas: ContaResumo[];
    itens: Record<Canal, ItemCasado[]>;
    pedidos: Record<Canal, PedidoExterno[]>;
    /** false quando CHANNEL_SECRET nao esta no ambiente. */
    temChaveDeCifra: boolean;
    /** Produtos do catalogo, para o seletor de casamento. */
    produtos: Array<{ id: string; name: string; price: number }>;
    /** URL publica do webhook, montada a partir do host da requisicao. */
    webhookBase: string;
};

const NOME_CANAL: Record<Canal, string> = {
    ifood: 'iFood',
    '99food': '99Food',
};

/**
 * Nenhum estado intermediario e' verde: homologacao nao e' estar no ar, e o pedido de verdade
 * so passa depois do credenciamento.
 */
const STATUS_APARENCIA: Record<StatusConta, { badge: string; label: string }> = {
    'sem-credencial': { badge: 'badge-neutral', label: 'Sem credencial' },
    homologacao: { badge: 'badge-info', label: 'Credencial guardada' },
    ativo: { badge: 'badge-success', label: 'Ativo' },
    erro: { badge: 'badge-danger', label: 'Com erro' },
};

function quando(d: Date | null): string {
    if (!d) return 'nunca';
    return escapeHtml(
        d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    );
}

function money(n: number): string {
    return escapeHtml(currency(n));
}

/**
 * O preco gravado e' o ultimo que o marketplace mandou: se o catalogo mudou depois, a loja vende
 * pelo preco velho e so percebe na conciliacao do mes. Por isso a diferenca aparece na linha,
 * e nao em um relatorio.
 */
function divergencia(item: ItemCasado): string {
    if (item.lastPrice === null) return '';
    const delta = item.lastPrice - item.product.price;
    if (Math.abs(delta) < 0.005) {
        return '<span class="badge badge-neutral">Preco em dia</span>';
    }
    const sobe = delta > 0;
    return `<span class="badge ${sobe ? 'badge-danger' : 'badge-warn'}" title="Ultimo preco visto no marketplace: ${money(item.lastPrice)}">
                ${sobe ? 'Marketplace mais caro' : 'Catalogo mais caro'} (${sobe ? '+' : ''}${delta
                    .toFixed(2)
                    .replace('.', ',')})
            </span>`;
}

/** Passos numerados: e' a ordem real do trabalho, nao uma lista de recursos. */
const passos = [
    {
        n: 1,
        titulo: 'Credencial',
        texto: 'Cole o token que o parceiro entregou. Sem isso nenhum pedido chega.',
    },
    {
        n: 2,
        titulo: 'Casamento de itens',
        texto: 'Ligue o id de cada item do marketplace a um produto do catalogo, para o estoque baixar certo.',
    },
    {
        n: 3,
        titulo: 'Acompanhar',
        texto: 'Acompanhe os pedidos que entraram e o ultimo teste de comunicacao.',
    },
];

function cardCanal(d: MarketplaceData, channel: Canal): string {
    const conta = d.contas.find((c) => c.channel === channel);
    const ap = STATUS_APARENCIA[conta?.status ?? 'sem-credencial'];
    const itens = d.itens[channel] ?? [];
    const pedidos = d.pedidos[channel] ?? [];
    const temCredencial = conta?.temCredencial ?? false;
    const temToken = conta?.temWebhookSecret ?? false;

    // A URL do webhook so aparece com token configurado. Sem token, o
    // marketplace apontando para cá nao passa em nada, e mostrar o endereco
    // seria sugerir que bastaria colar la.
    const urlWebhook = d.webhookBase + '/webhook/marketplace/' + channel;

    return `            <div class="card">
                <div class="flex flex-wrap items-center justify-between gap-3 card-pad pb-3 border-b border-line">
                    <div>
                        <h3 class="text-title flex items-center gap-2">
                            <i class="fa-solid fa-store text-accent"></i> ${escapeHtml(NOME_CANAL[channel])}
                        </h3>
                        <p class="text-caption text-ink-3">
                            Ultimo pedido: ${quando(conta?.lastOrderAt ?? null)} &middot;
                            ultima checagem: ${quando(conta?.lastCheckAt ?? null)}
                        </p>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="badge ${ap.badge}">${escapeHtml(ap.label)}</span>
                        <button type="button" onclick="mkCredencial_${channel}Open()" class="btn ${temCredencial ? 'btn-ghost' : 'btn-primary'} btn-sm">
                            <i class="fa-solid ${temCredencial ? 'fa-pen' : 'fa-key'}"></i> ${temCredencial ? 'Trocar' : 'Credenciar'}
                        </button>
                    </div>
                </div>

                <div class="px-5 pb-5 pt-4 space-y-3">
                    ${
                        conta?.lastError
                            ? `                    <div class="flex items-start gap-2 text-caption text-ink-2 bg-surface-2 border border-line rounded-card p-3">
                        <i class="fa-solid fa-circle-info text-accent mt-0.5 shrink-0"></i>
                        <span>${escapeHtml(conta.lastError)}</span>
                    </div>`
                            : ''
                    }

                    <div class="grid grid-cols-2 gap-3">
                        ${metrica('Credencial', temCredencial ? 'Guardada' : 'Falta', temCredencial)}
                        ${metrica('Token de webhook', temToken ? 'Guardado' : 'Falta', temToken)}
                        ${metrica('Itens casados', String(itens.length), itens.length > 0)}
                        ${metrica('Pedidos recebidos', String(pedidos.length), pedidos.length > 0)}
                    </div>

                    ${
                        !d.temChaveDeCifra
                            ? `                    <div class="flex items-start gap-2 text-caption text-ink-2 bg-warning-bg border border-accent-orange rounded-card p-3">
                        <i class="fa-solid fa-triangle-exclamation text-accent-orange mt-0.5 shrink-0"></i>
                        <span>
                            Sem <code class="font-mono">CHANNEL_SECRET</code> no <code class="font-mono">.env</code>.
                            A credencial nao e guardada sem essa chave, e guardar em claro seria o mesmo que nao guardar.
                        </span>
                    </div>`
                            : ''
                    }

                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" data-mk-testar="${channel}" class="btn btn-ghost btn-sm">
                            <i class="fa-solid fa-plug-circle-check"></i> Testar comunicacao
                        </button>
                        <button type="button" onclick="mkItem_${channel}Open()" class="btn btn-ghost btn-sm">
                            <i class="fa-solid fa-link"></i> Casar item
                        </button>
                        ${
                            temCredencial
                                ? `                        <button type="button" data-mk-apagar="${channel}" class="btn btn-ghost btn-sm">
                            <i class="fa-solid fa-trash"></i> Apagar credencial
                        </button>`
                                : ''
                        }
                    </div>

                    ${
                        temToken
                            ? `                    <div>
                        <p class="text-caption text-ink-3 mb-1">Endereco do webhook para cadastrar no ${escapeHtml(NOME_CANAL[channel])}</p>
                        <code class="input font-mono text-caption block cursor-default">${escapeHtml(urlWebhook)}</code>
                        <p class="text-caption text-ink-3 mt-1">
                            A plataforma assina o corpo com o token guardado no passo 1. Sem assinatura valida o pedido e' recusado.
                        </p>
                    </div>`
                            : ''
                    }

                    ${
                        itens.length === 0
                            ? `                    <p class="text-caption text-ink-3">
                        Nenhum item casado. Enquanto for assim, o pedido entra no Kanban mas <strong>nao baixa estoque</strong>.
                    </p>`
                            : `                    <div class="border border-line rounded-card overflow-x-auto max-h-[calc(100vh-46rem)] overflow-y-auto">
                        <table class="w-full text-body">
                            <thead class="sticky top-0 bg-surface-2">
                                <tr class="text-left text-caption text-ink-3">
                                    <th class="px-3 py-2 font-semibold">Id no marketplace</th>
                                    <th class="px-3 py-2 font-semibold">Produto do catalogo</th>
                                    <th class="px-3 py-2 font-semibold text-right">Preco</th>
                                    <th class="px-3 py-2 font-semibold">Divergencia</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${itens
                                    .map(
                                        (i) => `                                <tr class="border-b border-line last:border-0">
                                    <td class="px-3 py-2 font-mono text-caption text-ink-2">${escapeHtml(i.externalId)}</td>
                                    <td class="px-3 py-2 text-ink">${escapeHtml(i.product.name)}</td>
                                    <td class="px-3 py-2 text-right text-ink">${money(i.product.price)}</td>
                                    <td class="px-3 py-2">${divergencia(i)}</td>
                                </tr>`
                                    )
                                    .join('\n')}
                            </tbody>
                        </table>
                    </div>`
                    }
                </div>
            </div>`;
}

function metrica(label: string, valor: string, ok: boolean): string {
    return `                        <div class="bg-surface-2 border border-line rounded-card p-3">
                            <p class="text-caption text-ink-3">${escapeHtml(label)}</p>
                            <p class="text-body font-bold mt-0.5 ${ok ? 'text-accent-emerald' : 'text-ink-3'}">${escapeHtml(valor)}</p>
                        </div>`;
}

/**
 * Com teto. A lista estava sem limite, e a tela crescia conforme a entrada do canal em vez de
 * conforme a quantidade. A rolagem e' aqui dentro, que e' a unica regiao desta tela que cresce
 * com dado.
 */
function listaPedidos(pedidos: PedidoExterno[]): string {
    if (pedidos.length === 0) {
        return cardVazio('Nenhum pedido recebido por marketplace ate agora.', 'fa-store');
    }
    return `                <div class="max-h-[calc(100vh-34rem)] overflow-y-auto">
                    <ul class="space-y-1">
                    ${pedidos
                        .map(
                            (p) => `                    <li class="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0">
                        <div class="min-w-0">
                            <p class="text-body text-ink truncate">${money(p.total)}</p>
                            <p class="text-caption text-ink-3 font-mono">${escapeHtml(p.externalId ?? '')}</p>
                        </div>
                        <div class="text-right shrink-0">
                            <p class="text-caption text-ink-3">${quando(p.createdAt)}</p>
                            <p class="text-caption text-ink-2">${escapeHtml(statusLabel(p.status))}</p>
                        </div>
                    </li>`
                        )
                        .join('\n')}
                    </ul>
                </div>`;
}

export function renderMarketplace(d: MarketplaceData): string {
    const canaisPresentes = CANAIS;

    return `        <p class="text-body text-ink-2 max-w-3xl mb-4">
            Pedidos do iFood e do 99Food entram no mesmo Kanban dos demais, e a baixa de estoque acontece
            junto com a gravacao. O que o sistema <strong>nao</strong> faz e' dizer que um canal esta
            conectado sem ter falado com ele: o status abaixo so vira "Ativo" depois de uma comunicacao
            que deu certo.
        </p>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            ${passos
                .map(
                    (p) => `                <div class="bg-surface-2 border border-line rounded-card p-3">
                    <p class="text-caption font-semibold text-accent">Passo ${p.n}</p>
                    <p class="text-body font-semibold text-ink">${escapeHtml(p.titulo)}</p>
                    <p class="text-caption text-ink-3 mt-1">${escapeHtml(p.texto)}</p>
                </div>`
                )
                .join('\n')}
        </div>

        <!--
            Os dois canais lado a lado, e nao um embaixo do outro.

            Empilhados, o segundo canal empurrava a lista de pedidos recentes
            para fora da tela -- e essa lista e' o que a pessoa abre a aba para
            ver: os pedidos que chegaram de fora. Lado a lado, cada canal ocupa
            metade da largura e a lista fica visivel embaixo, que e' onde a
            leitura comeca.
        -->
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
${canaisPresentes.map((c) => cardCanal(d, c)).join('\n')}
        </div>

        <div class="card mt-4">
            <div class="card-pad pb-3 border-b border-line">
                <h3 class="text-title">Pedidos recentes</h3>
                <p class="text-caption text-ink-3">Ultimos 20 pedidos de cada canal</p>
            </div>
            <div class="px-5 pb-5 pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                ${canaisPresentes
                    .map(
                        (c) => `                <div class="min-w-0">
                    <p class="text-body font-semibold text-ink mb-2">${escapeHtml(NOME_CANAL[c])}</p>
${listaPedidos(d.pedidos[c] ?? [])}
                </div>`
                    )
                    .join('\n')}
            </div>
        </div>

${canaisPresentes.map((c) => renderModal(credencialSpec(c))).join('\n')}
${canaisPresentes.map((c) => renderModal(itemSpec(c, d.produtos))).join('\n')}

        <script>
            /*
             * Testar comunicacao e' o unico botao que pode falhar sem culpa:
             * quando ainda falta o contrato do parceiro, ele devolve o motivo.
             * Isso e' melhor que um "conectado" falso, entao o aviso sai na
             * propria tela em vez de ser escondido.
             */
            async function mkTestar(channel) {
                var r = await postJSON('/api/admin/marketplace/' + channel + '/testar');
                if (r.ok) {
                    flash('ok', r.data.erro || 'Comunicacao verificada.');
                } else {
                    flash('err', r.data.erro || 'Nao foi possivel testar a comunicacao.');
                }
                setTimeout(function () { window.location.reload(); }, 1600);
            }

            async function mkApagarCredencial(channel) {
                confirmThen(
                    'Apagar a credencial de ' + channel + ': o sistema esquece o pareamento e o canal volta a pedir. ' +
                        'Os pedidos ja recebidos continuam no historico.',
                    async function () {
                        var r = await postJSON('/api/admin/marketplace/' + channel + '/apagar-credencial');
                        if (!r.ok) { flash('err', r.data.error || 'Nao foi possivel apagar.'); return; }
                        flash('ok', 'Credencial apagada.');
                        setTimeout(function () { window.location.reload(); }, 700);
                    },
                    { titulo: 'Apagar credencial', confirmar: 'Apagar' }
                );
            }

            /*
             * Os dois botoes de canal por delegacao, e nao por onclick.
             *
             * Sao os mesmos dois botoes em duas colunas, e o onclick repetia o
             * nome da funcao com o canal escrito dentro do atributo. Um id ou um
             * slug interpolado em codigo e' uma string montada no servidor: se um
             * deles trouxer uma aspa, o bloco de script para de fazer sentido e a
             * pagina perde todos os ouvintes de uma vez. O canal viaja em
             * data-mk-testar e data-mk-apagar, que sao dado e nao codigo.
             */
            document.addEventListener('click', function (ev) {
                var alvo = ev.target;
                if (!alvo || !alvo.closest) return;

                var testar = alvo.closest('[data-mk-testar]');
                if (testar) { mkTestar(testar.dataset.mkTestar); return; }

                var apagar = alvo.closest('[data-mk-apagar]');
                if (apagar) { mkApagarCredencial(apagar.dataset.mkApagar); return; }
            });
        </script>
${marketplaceModalsScript(canaisPresentes)}`;
}
