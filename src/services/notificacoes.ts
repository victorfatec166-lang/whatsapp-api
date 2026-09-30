import { prisma } from '../database/prisma';
import { inicioDoDia } from './retencao';
import { listarDoMes, type LembreteView } from './lembretes';
import { listarContas, type Canal, type StatusConta } from './marketplace';
import { reorderList, type StockRow } from './stock';

/**
 * O sino do topo: tudo que pede uma acao, em um lugar so.
 *
 * As cinco fontes nao sao cinco tipos de aviso -- sao cinco jeitos de a mesma
 * pergunta passar despercebida:
 *
 * 1. PEDIDO NOVO. Chegou pedido e a pessoa nao viu. Antes isso aparecia como um
 *    numero em duas abas da barra lateral, que e' exatamente o tipo de aviso que
 *    ninguem nota. Aqui e' uma linha, e o numero no sino e' a soma de tudo.
 *
 * 2. LEMBRETE COM ANTECEDENCIA. "Ligar para o fornecedor" anotado para amanha e'
 *    uma pendencia hoje -- e a unica forma de transformar isso em aviso e' o
 *    proprio texto, que nao diz para quem nem quando.
 *
 * 3. PRODUTO QUE FALTA. Zerado e abaixo do minimo apareciam so em "Precisa de
 *    atencao", na Home. Quem trabalha no PDV e' a pessoa que descobre a falta
 *    quando o cliente ja esta na fila, entao o aviso precisa estar onde ela olha
 *    sem trocar de tela.
 *
 * 4. DESCONEXAO. Bot parado e canal com erro. As duas coisas calavam: nenhum
 *    pedido de WhatsApp chegava, nenhum aviso de marketplace chegava, e a tela
 *    seguia mostrando "online" ate alguem tentar falar com um cliente.
 *
 * 5. VENDA DE CANAL. Pedido que entrou pelo iFood ou 99Food. Precisa do canal na
 *    linha: esse pedido demora mais e sai por outro caminho, e a pessoa precisa
 *    saber de onde veio antes de sair para entregar.
 *
 * DECISAO QUE PRECISA SER DITA: "novo" e' por TEMPO, nao por "nao visto".
 *
 * O sino precisa saber o que a pessoa ainda nao viu, e o unico jeito de saber
 * isso sem sessao seria marcar cada pedido como lido -- que depende de login, que
 * nao existe ainda. Marcar por tempo erra nas duas direcoes: mostra como novo um
 * pedido que a cozinha ja pegou, e deixa de mostrar um pedido novo se o sino
 * estiver fechado ha horas.
 *
 * O meio-termo e' o recorte de duas horas MAIS o filtro de status: um pedido so e'
 * novo enquanto esta `pendente`. Depois que a cozinha pegou, ele deixa de ser
 * noticia, mesmo que ninguem tenha olhado -- porque a informacao que importava
 * (ele chegou) ja foi atendida. Sem login, e' o que da para ser honesto.
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
 * Data local em "AAAA-MM-DD".
 *
 * Nao e' `toISOString().slice(0, 10)`: isso e' meia-noite UTC, que no Brasil e'
 * as 21h do dia anterior -- o mesmo bug que ja jogou pedido para o dia errado no
 * grafico. Aqui a data e' sempre a de quem esta olhando a tela.
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
             * O mesmo `agora` dos outros, e nao um Date.now() proprio. Dois
             * avisos da mesma gravidade que empatam sao desempatados pela ordem
             * em que foram montados -- que e' a ordem de urgencia declarada
             * aqui. Com um relogio lido em instantes diferentes, quem fosse lido
             * um milissegundo depois passava a frente: bot parado e produto
             * zerado trocavam de lugar conforme o dia, e nenhum dos dois estava
             * errado. Era o `ordem` da lista virando sorte.
             */
            quando: agora,
        },
    ];
}

/**
 * Canal de marketplace: desconexao e venda.
 *
 * As duas nao podem ser a mesma linha. Quem tem iFood em homologacao precisa
 * saber que as vendas que ve NAO estao indo para a producao, e isso e' mais
 * urgente do que qualquer venda do dia.
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
         * Vendas do dia, por canal.
         *
         * `externalId` preenchido e' o que separa "pedido entrou pelo canal" de
         * "pedido feito no balcao". Sem esse filtro, todo pedido do dia
         * apareceria em cada canal configurado.
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
 * Lembretes que pedem atencao, em duas formas.
 *
 * HOJE E AMANHA sao uma linha cada. Sao os unicos que mudam o que a pessoa faz
 * hoje, e uma linha por lembrete e' o que faz o sino valer a pena abrir.
 *
 * DEPOIS DISSO VEM AGRUPADO. Uma semana de antecedencia e' o limite, e o
 * agrupamento e' o que permite esse limite sem virar barulho: sete lembretes
 * soltos empurrariam para baixo os avisos de bot parado e de estoque zerado,
 * que sao os que custam dinheiro. Uma linha dizendo "3 lembretes nos proximos
 * dias" ocupa o mesmo espaco que uma e ainda mostra o que sao.
 *
 * O que fica DEPOIS de uma semana nao entra no sino, e o Calendario avisa isso
 * no momento em que a pessoa anota -- silenciar a regra e' o que faz a pessoa
 * concluir que o sistema esqueceu.
 */
async function deLembretes(): Promise<Notificacao[]> {
    const hojeIso = dataIso(new Date());
    const amanhaIso = dataIso(diasAFrente(1));
    const horizonte = dataIso(diasAFrente(DIAS_DE_ANTECEDENCIA));

    // Os dois meses, e nao so o corrente: o lembrete do dia 31 lido no dia 30
    // pertence ao mes que vem, e perder esse aviso e' perder o aviso no caso em
    // que ele mais importa.
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
 * Todas as notificacoes, da mais urgente para a menos.
 *
 * A ordem nao e' a de chegada: e' a de quem doi mais. Um bot parado vem antes de
 * um canal em homologacao, que vem antes de um produto abaixo do minimo, que vem
 * antes de um lembrete de amanha. `quando` desempata dentro de uma mesma faixa --
 * nunca decide a ordem principal, que e' o que a pessoa precisa fazer agora.
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
         * Pedido novo e' lido do banco direto, e nao da lista que a tela ja
         * carregou. Aquela lista e' a do boot do processo: um pedido que chegou
         * ha dois minutos nao estaria nela, e o sino ficaria mudo justo quando
         * ele deveria gritar.
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
