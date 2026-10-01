import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { inicioDoDia } from './retencao';
import { listarDoMes, type LembreteView } from './lembretes';
import { listarContas, type Canal, type StatusConta } from './marketplace';
import { reorderList, type StockRow } from './stock';

/**
 * Estoque e desconexao, as duas fora do PDV, entram porque no balcao o problema so
 * aparece quando o cliente ja esta na fila. "Novo" e' por TEMPO, nao por "nao visto":
 * nao ha sessao para marcar o que a pessoa leu, e com a cozinha pegou deixa de ser noticia.
 */

/** Duas horas. Ver a decisao sobre "novo" no comentario do modulo. */
const JANELA_NOVO_MS = 2 * 60 * 60 * 1000;

/**
 * Uma semana. Ver a decisao sobre o agrupamento no comentario de `deLembretes`.
 */
export const DIAS_DE_ANTECEDENCIA = 7;

const CANAL_NOME: Record<Canal, string> = {
    ifood: 'iFood',
    '99food': '99Food',
};

/**
 * Data local, nunca toISOString: UTC no Brasil e' as 21h do dia anterior -- o
 * mesmo bug que ja jogou pedido para o dia errado no grafico.
 */
function dataIso(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function diasAFrente(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
}

/** A janela do lembrete e' o que a pessoa precisa ler, nao a data crua. */
function quandoTexto(iso: string): string {
    if (iso === dataIso(new Date())) return 'hoje';
    if (iso === dataIso(diasAFrente(1))) return 'amanha';
    const [, mes, dia] = iso.split('-');
    return `dia ${dia}/${mes}`;
}

export type NotificacaoTom = 'vermelho' | 'ambar' | 'info' | 'verde';

export type Notificacao = {
    id: string;
    tom: NotificacaoTom;
    /** "3 pedido(s) novo(s)" */
    titulo: string;
    /** Quem chegou, quem faltou, de onde veio. */
    detalhe: string;
    /** Para onde levar ao clicar. */
    href: string;
    /** Texto do botao. */
    cta: string;
    /** Epoch ms, so para desempatar dentro de uma mesma faixa. */
    quando: number;
};

/** Bot parado: nenhum pedido de WhatsApp chega, e nada avisa que parou. */
function deBot(botOnline: boolean, agora: number): Notificacao[] {
    if (botOnline) return [];
    return [
        {
            id: 'bot-offline',
            tom: 'vermelho',
            titulo: 'WhatsApp desconectado',
            detalhe: 'Nenhum cliente consegue fazer pedido enquanto isso.',
            href: '/admin?tab=whatsapp',
            cta: 'Reconectar',
            /*
             * O mesmo `agora` dos outros, e nao um Date.now() proprio: com o
             * relogio lido em instantes diferentes, dois avisos da mesma gravidade
             * empatavam pela ordem de montagem, e a urgencia virava sorte.
             */
            quando: agora,
        },
    ];
}

/**
 * Desconexao e venda nao podem ser a mesma linha: quem tem canal em homologacao
 * precisa saber que as vendas que ve NAO estao indo para a producao, e isso e'
 * mais urgente do que qualquer venda do dia.
 */
async function deCanais(): Promise<Notificacao[]> {
    const contas = await listarContas();
    const hoje = inicioDoDia(new Date());
    const saida: Notificacao[] = [];

    for (const conta of contas) {
        const nome = CANAL_NOME[conta.channel];
        const quandoCheca = conta.lastCheckAt?.getTime() ?? Date.now();

        if (conta.status === 'erro') {
            saida.push({
                id: `canal-erro-${conta.channel}`,
                tom: 'vermelho',
                titulo: `${nome} parou de funcionar`,
                detalhe: conta.lastError ?? 'Erro na ultima checagem do canal.',
                href: '/admin?tab=marketplace',
                cta: 'Ver canal',
                quando: quandoCheca,
            });
            continue;
        }

        if (conta.status === 'homologacao') {
            saida.push({
                id: `canal-homologacao-${conta.channel}`,
                tom: 'ambar',
                titulo: `${nome} em teste`,
                detalhe: 'Pedidos deste canal sao de teste e nao vao para a producao.',
                href: '/admin?tab=marketplace',
                cta: 'Ver canal',
                quando: quandoCheca,
            });
            continue;
        }

        // Canal sem credencial nao e' novidade: e' o estado inicial dele.
        if (conta.status === 'sem-credencial') continue;

        /*
         * externalId preenchido separa "pedido entrou pelo canal" de "pedido feito
         * no balcao": sem esse filtro todo pedido do dia aparece em cada canal.
         */
        const pedidos = await prisma.order.findMany({
            where: { channel: conta.channel, externalId: { not: null }, createdAt: { gte: hoje } },
            select: { status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });

        if (pedidos.length === 0) continue;

        const abertos = pedidos.filter((p) => p.status !== 'concluido').length;
        saida.push({
            id: `canal-venda-${conta.channel}`,
            tom: abertos > 0 ? 'verde' : 'info',
            titulo: `${pedidos.length} venda(s) pelo ${nome}`,
            detalhe:
                abertos > 0
                    ? `${abertos} ainda em aberto. Esse canal sai por entrega propria.`
                    : 'Todas concluidas hoje.',
            href: '/admin?tab=kanban',
            cta: 'Ver pedido',
            quando: pedidos[0]?.createdAt.getTime() ?? Date.now(),
        });
    }

    return saida;
}

/**
 * Hoje e amanha sao uma linha cada -- os unicos que mudam o que a pessoa faz hoje.
 * Apos isso vem agrupado, porque sete lembretes soltos empurrariam para baixo os
 * avisos que custam dinheiro. Passou de uma semana e' o Calendario que avisa, ao vivo.
 */
async function deLembretes(): Promise<Notificacao[]> {
    const hojeIso = dataIso(new Date());
    const amanhaIso = dataIso(diasAFrente(1));
    const horizonte = dataIso(diasAFrente(DIAS_DE_ANTECEDENCIA));

    // Os dois meses: o lembrete do dia 31 lido no dia 30 pertence ao mes que vem.
    const meses = [...new Set([hojeIso.slice(0, 7), horizonte.slice(0, 7)])];
    const todos: LembreteView[] = (await Promise.all(meses.map((m) => listarDoMes(m)))).flat();

    const pendentes = todos
        .filter((l) => !l.feito && l.iso >= hojeIso && l.iso <= horizonte)
        .sort((a, b) => a.iso.localeCompare(b.iso));

    const linhas: Notificacao[] = pendentes
        .filter((l) => l.iso <= amanhaIso)
        .map((l) => ({
            id: `lembrete-${l.id}`,
            tom: (l.iso === hojeIso ? 'ambar' : 'info') as NotificacaoTom,
            titulo: l.texto,
            detalhe: `Lembrete para ${quandoTexto(l.iso)}`,
            href: `/admin?tab=calendario&dia=${l.iso}`,
            cta: 'Abrir dia',
            // Sem horario: o lembrete e' do dia, nao da hora. A ordem vem do
            // `sort` acima, e o Epoch serve so para o desempate final.
            quando: new Date(`${l.iso}T00:00:00`).getTime() + 1000,
        }));

    const maisAdiante = pendentes.filter((l) => l.iso > amanhaIso);
    if (maisAdiante.length > 0) {
        linhas.push({
            id: 'lembretes-mais-adiante',
            tom: 'info',
            titulo: `${maisAdiante.length} lembrete(s) nos proximos dias`,
            detalhe:
                maisAdiante
                    .slice(0, 3)
                    .map((l) => `${quandoTexto(l.iso)}: ${l.texto}`)
                    .join(' · ') + (maisAdiante.length > 3 ? '...' : ''),
            href: '/admin?tab=calendario',
            cta: 'Ver agenda',
            // A data do mais proximo, para a linha agrupada nao subir acima de um
            // lembrete de amanha por causa de um Epoch sintetico.
            quando: new Date(`${maisAdiante[0].iso}T00:00:00`).getTime() + 1000,
        });
    }

    return linhas;
}

/** Produtos zerados e abaixo do minimo: o motivo de o cliente esperar no balcao. */
function deEstoque(produtos: StockRow[], agora: number): Notificacao[] {
    const reposicao = reorderList(produtos);
    if (reposicao.length === 0) return [];

    const linha = (id: string, tom: NotificacaoTom, titulo: string, itens: typeof reposicao): Notificacao => ({
        id,
        tom,
        titulo,
        detalhe:
            itens
                .slice(0, 3)
                .map((r) => r.name)
                .join(', ') + (itens.length > 3 ? '...' : ''),
        href: '/admin?tab=estoque',
        cta: 'Repor',
        // Mesmo instante dos demais: ver o comentario de `deBot`.
        quando: agora,
    });

    return [
        ...(reposicao.some((r) => r.stock <= 0)
            ? [linha('estoque-zerado', 'vermelho', `${reposicao.filter((r) => r.stock <= 0).length} produto(s) zerado(s)`, reposicao.filter((r) => r.stock <= 0))]
            : []),
        ...(reposicao.some((r) => r.stock > 0)
            ? [linha('estoque-baixo', 'ambar', `${reposicao.filter((r) => r.stock > 0).length} produto(s) abaixo do minimo`, reposicao.filter((r) => r.stock > 0))]
            : []),
    ];
}

/**
 * A ordem nao e' a de chegada, e' a de quem doi mais: bot parado antes de canal
 * em homologacao, antes de produto abaixo do minimo, antes de lembrete de amanha.
 * quando desempata dentro de uma mesma faixa, nunca decide a ordem principal.
 */
const ORDEM_TOM: Record<NotificacaoTom, number> = { vermelho: 0, ambar: 1, verde: 2, info: 3 };

export type PainelNotificacoes = {
    itens: Notificacao[];
    /** O que precisa de atencao agora: vermelho e ambar. */
    urgentes: number;
    /** Total de itens, que e' o numero no sino. */
    total: number;
};

export async function montarPainel(botOnline: boolean, produtos: StockRow[]): Promise<PainelNotificacoes> {
    // Um so relogio para a montage inteira. Ver o comentario de `deBot`.
    const agora = Date.now();
    const [canais, lembretes, novos] = await Promise.all([
        deCanais(),
        deLembretes(),
        /*
         * Lido do banco, e nao da lista que a tela ja carregou: aquela e' a do boot
         * do processo, e um pedido de dois minutos nao estaria nela -- o sino
         * ficaria mudo justo quando deveria gritar.
         */
        prisma.order.findMany({
            where: { createdAt: { gte: new Date(agora - JANELA_NOVO_MS) }, status: 'pendente' },
            select: { clientName: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        }),
    ]);

    const deNovos: Notificacao[] =
        novos.length > 0
            ? [
                  {
                      id: 'pedidos-novos',
                      tom: novos.length > 2 ? 'vermelho' : 'ambar',
                      titulo: `${novos.length} pedido(s) novo(s)`,
                      detalhe:
                          novos
                              .slice(0, 3)
                              .map((o) => o.clientName || 'Cliente')
                              .join(', ') + (novos.length > 3 ? '...' : ''),
                      href: '/admin?tab=kanban',
                      cta: 'Atender',
                      quando: novos[0]?.createdAt.getTime() ?? Date.now(),
                  },
              ]
            : [];

    const itens = [...deNovos, ...deBot(botOnline, agora), ...canais, ...deEstoque(produtos, agora), ...lembretes].sort(
        (a, b) => ORDEM_TOM[a.tom] - ORDEM_TOM[b.tom] || b.quando - a.quando
    );

    return {
        itens,
        urgentes: itens.filter((i) => i.tom === 'vermelho' || i.tom === 'ambar').length,
        total: itens.length,
    };
}
