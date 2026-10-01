import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import adminRoutes from './routes/adminRoutes';
import authRoutes from './routes/authRoutes';
import usuariosRoutes from './routes/usuariosRoutes';
import calendarioRoutes from './routes/calendarioRoutes';
import sistemaRoutes from './routes/sistemaRoutes';
import backupRoutes from './routes/backupRoutes';
import comandaRoutes from './routes/comandaRoutes';
import marketplaceRoutes from './routes/marketplaceRoutes';
import { addClient, notifyClients, notifyConnection, getClientCount, fechaClientes } from './services/sse';
// QR_TTL_MS saiu daqui: era usado para expire o QR antigo, e a sessao do
// Baileys ja resolve isso sozinha. O import nao custava nada, mas deixava
// parecer que o TTL era configuravel por aqui.
import { initBot, sendOrderStatusNotification, isBotOnline, loadBotMessages, reconnectBot, logoutBot, desconectaBot, getConnectionState, onConnectionChange, AUTH_DIR } from './services/bot';
import { renderLayout, tabHint, isTabId, LEGACY_TABS, type TabId } from './views/layout';
import { PAIRING_CLIENT_SCRIPT } from './views/pairing';
import { renderWhatsApp } from './views/whatsapp';
import { renderPdv, PDV_PAYMENT_LABELS } from './views/pdv';
import {
    renderKanban,
    renderConfig,
    renderCalendar,
} from './views/tabs';
import { renderInventory } from './views/inventory';
import { renderHome } from './views/home';
// renderCash e renderCustomers saem daqui: as duas telas foram absorvidas como
// sub-abas de Faturamento, que chama as views por conta propria. Continuar
// importando dava a impressao de que o servidor ainda as desenhava.
import { renderFaturamento } from './views/faturamento';
import { renderMarketplace } from './views/marketplace';
import { renderUsuarios } from './views/usuarios';
import { listarContas, listarItensCasados, temChaveDeCifra, type Canal } from './services/marketplace';
import { totalNaoLidas } from './services/chat';
import { loadHomeData, estimateMargin } from './services/home';
import { validar, falhou, vendaPdv, mudancaStatus } from './services/validation';
import { customerList, summarizeCustomers } from './services/customers';
import {
    applyMovement,
    setStockTo,
    summarize,
    recentMovements,
    registerSale,
    reorderList,
    wasteSummary,
    stockStatus,
       type StockRow,
} from './services/stock';
import { createOrderWithStock } from './services/orders';
import {
    cashSummary,
    registerCashMovement,
    parkedSales,
    serializeParkedItems,
    computeTotals,
    openShift,
    startShift,
    closeShift,
    reconcileShift,
    shiftHistory,
} from './services/cash';
import { startCashScheduler } from './services/cashSchedule';
import { carregarConfig, salvarConfig, estadoAgendaCaixa, falhouSalvar } from './services/config';
import { resumoArmazenamento } from './services/armazenamento';
import { startBackupScheduler, backupDir, backupNow } from './services/backup';
import { startPodador } from './services/retencao';
import { ensureSku, exportProductsCsv, importProductsFromCsv } from './services/products';
import { categoriasDoCatalogo } from './services/categorias';
import { listarDoMes, anotar, alternarConcluido, apagar, falhouAnotar, falhouConcluir, falhouApagar } from './services/lembretes';
import { loadProductFull, priceCart, linesToItemsField } from './services/modifiers';
import { getDailyMenu, setDailyMenu, copyDailyMenu, previousDailyMenu } from './services/dailyMenu';
import { escapeHtml } from './views/html';
import {
    toCsv,
    toReportRows,
    currency,
    ORDER_STATUSES,
    type OrderWithProductless,
} from './services/stats';
import { computeStatsSql } from './services/statsSql';
import { DEFAULT_BOT_MESSAGES } from './services/botDefaults';
import {
    mapaParaTela,
    restaurarTodasMensagens,
    salvarMensagem,
} from './services/botMessages';
import { montarPainel, DIAS_DE_ANTECEDENCIA } from './services/notificacoes';
import { logDoModulo, pastaDeLogs } from './services/logger';
import { csrfDoRequest, exigeCsrf, exigeSessao, exigeSessaoApi, garanteAdministrador, limpaSessoes } from './services/auth';
import { limitador as limitePorJanela } from './services/rateLimit';
import { exigeLoja, lojaDoBoot } from './services/loja';
import { prisma } from './database/prisma';
import { publicaLoja } from './middleware/publica-loja';
import { cabecalhosDeSeguranca } from './middleware/cabecalhos-seguranca';
import { DIR_UPLOADS, DIR_UPLOADS_PRODUTOS, DATA_DIR, criaArvoreDeDados } from './services/paths';
const log = logDoModulo('server');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

/*
 * Antes de qualquer rota e antes de qualquer parser: um header ausente nao
 * depende do caminho, e o parser nao devolve nada em resposta a ele.
 */
app.use(cabecalhosDeSeguranca);


/*
 * Limite de escrita: 30 requisicoes por 10s, calibrado contra a rajada mais longa
 * do painel (cadastrar produto com foto e varios movimentos de estoque em
 * sequencia). Acima disso nao e' pessoa.
 */
const limiteEscrita = limitePorJanela({ max: 30, janelaMs: 10_000 });

/**
 * A partir de quantos pedidos o painel avisa: 2000, cerca de seis meses de uma
 * loja media. Antes disso a carga em memoria e' irrelevante; depois disso a
 * visita comeca a custar segundos. Ver o bloco em /admin.
 */
const AVISO_VOLUME_PEDIDOS = 2000;

const VALID_ORDER_STATUS: string[] = [...ORDER_STATUSES];

/*
 * Corpo cru do webhook, montado antes do express.json: o body-parser marca o corpo
 * como lido e o parser seguinte nao ve mais nada, e re-serializar muda a ordem das
 * chaves -- o HMAC deixa de bater. Sem `verify`: o 401 vem da rota, nao do parser.
 */
app.use(
    '/webhook/marketplace',
    express.raw({ type: ['application/json', 'application/*+json'], limit: '2mb' })
);

/* O raw acima so vale para o webhook; este json e' o parser geral e por isso vem depois. */
app.use(express.json({ limit: '2mb' }));
/*
 * O `limit` do urlencoded tambem e' preciso: o alcance real e' o login e o webhook, e o
 * login fica fora do `limiteEscrita`, que so cobre `/api/admin`.
 */
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

/*
 * Publica a loja antes de qualquer rota com base na sessao.
 * A leitura e' direta sem cache para refletir revogacoes de sessao de imediato.
 */
app.use(publicaLoja);

/*
 * Limite so no que escreve, montado aqui e nao em cada router, para a rota nova
 * nascer protegida. Ler nao tem limite: o painel atualiza Kanban, estoque e
 * caixa na mesma visita, e o limite derrubaria a tela no meio do expediente.
 */
app.use('/api/admin', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    return limiteEscrita(req, res, next);
});

// Fotos de produto: `DIR_UPLOADS`, que aponta para a pasta de dados, e nao para
// `public` do programa -- foto e' dado do dono e nao pode sumir numa atualizacao.
app.use('/uploads', express.static(DIR_UPLOADS, { maxAge: '7d' }));
// CSS compilado do design system. Sem maxAge longo: o arquivo nao tem hash no nome
// e um cache fixo serviria estilo velho; o ETag padrao resolve com 304.
app.use('/styles', express.static(path.join(process.cwd(), 'dist', 'styles'), { etag: true, lastModified: true }));

/*
 * Rotas de entrada ANTES do bloqueio: depois do `exigeSessao` elas responderiam 401
 * para sempre -- inclusive a propria tela de login, que e' o unico jeito de
 * conseguir uma sessao.
 */
app.use(authRoutes);

/*
 * Aqui comeca o painel fechado. `/admin` e' HTML: sem sessao, 303 para a tela de
 * entrada. `/api/admin` e' dado: sem sessao, 401 em JSON -- um fetch seguido de
 * 303 trocaria o painel por uma pagina de login. CSRF so onde muda estado.
 */
app.use('/admin', exigeSessao('/entrar'));
app.use('/api/admin', exigeSessaoApi());
app.use(['/admin', '/api/admin'], exigeCsrf());
app.use('/api/admin', adminRoutes);
// Comanda da cozinha: saida para a impressora, com vida propria. Ver o arquivo
// para por que a impressao em si nao acontece aqui.
app.use('/api/admin', comandaRoutes);
// Conversas do WhatsApp, em /api/admin porque quem chama e' o painel. As rotas do
// arquivo sao relativas a este prefixo.
/*
 * Usuarios, no prefixo completo. As rotas do arquivo sao `/` e `/:id/...`, entao em
 * `/api/admin` a tela recebia 403 do exigeAdmin em vez do 404 de
 * `/api/admin/usuarios` -- e 403 ali parece "voce nao e' admin".
 */
app.use('/api/admin/usuarios', usuariosRoutes);

/*
 * Calendario e estado atras da MESMA sessao das rotas acima. Trazem `/api/...` dentro
 * do arquivo, e sem estas linhas `apagar` de lembrete respondia 200 sem cookie --
 * qualquer aparelho da rede da loja apagava o lembrete de quem trabalhava.
 */
app.use(calendarioRoutes);
app.use(sistemaRoutes);
app.use(backupRoutes);

// Marketplace (iFood/99Food). O router traz o webhook publico junto; ver o
// arquivo para por que ele fica separado das rotas do painel.
app.use('/', marketplaceRoutes);

/* ------------------------------------------------------------------ Utils */

function toNumber(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : fallback;
}

function parseDateInput(value: unknown, fallback: Date): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? fallback : d;
}

function startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function endOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
}

/*
 * A configuracao corrente. Delegada ao servico, e nao lida aqui, porque a
 * gravacao ja foi para o mesmo lugar: duas leituras num lugar e uma escrita em
 * outro e' como os dois lados divergem.
 */
async function getConfig() {
    return carregarConfig();
}

/** Ultimos pedidos de um canal de marketplace, para a tela mostrar atividade. */
async function pedidosDoCanal(channel: Canal) {
    const pedidos = await prisma.order.findMany({
        where: { channel, externalId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
    });
    return pedidos.map((p) => ({
        id: p.id,
        externalId: p.externalId,
        total: p.total,
        status: p.status,
        createdAt: p.createdAt,
    }));
}

/** Normaliza um produto do Prisma para a linha usada na aba de estoque. */
function toStockRow(p: {
    id: string;
    name: string;
    price: number;
    costPrice: number;
    category: string | null;
    stock: number;
    minStock: number;
    trackStock: boolean;
    isAvailable: boolean;
}): StockRow {
    return {
        id: p.id,
        name: p.name,
        price: p.price,
        costPrice: p.costPrice,
        category: p.category || 'Geral',
        stock: p.stock,
        minStock: p.minStock,
        trackStock: p.trackStock,
        isAvailable: p.isAvailable,
    };
}

/* --------------------------------- Coluna de concluidos (reset visual diario) */

/* "Concluidos" e filtrado por dia na renderizacao (case 'kanban'), sem job de
   meia-noite: resetar o status contaminaria os relatorios e devolveria itens a
   pendentes. Para cortar o dia antes da meia-noite, ajuste `startOfToday`. */

/* ------------------------------------------------------- API do dashboard */

/*
 * Sino e estado do WhatsApp foram para `src/routes/sistemaRoutes.ts` por seguranca:
 * estavam em `/api/*`, fora do `/api/admin` que o `exigeSessaoApi()` protege -- nao
 * foi tamanho de arquivo. Mesmo caminho; o que protege agora e' o middleware do `app.use`.
 */

/**
 * Procura `creds.json` pelo nome exato, e nao "qualquer .json": a pasta ganha
 * outros arquivos ao lado das chaves (a marcacao de maquina), e "tem .json"
 * responderia verdadeiro sem sessao pareada -- a tela abriria um QR vazio.
 */
function hasSavedSession(): boolean {
    try {
        return fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).some((f) => f === 'creds.json');
    } catch {
        return false;
    }
}

app.get('/api/calendar.js', (_req, res) => {
    res.type('application/javascript').send(`
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let ordersByDate = {};
/**
 * O dia que a pessoa escolheu, em "AAAA-MM-DD".
 *
 * Vive aqui, e nao em atributo do HTML, por dois motivos. Primeiro, a grade e'
 * redesenhada a cada mudanca de mes e a cada busca de pedidos: se o estado
 * estivesse no HTML, ele se perderia na primeira redesenhada e a selecao
 * apagaria sozinha. Segundo, a selecao PRECISA sobreviver a mudanca de mes -- e
 * o que o painel de baixo mostra continua sendo o dia escolhido mesmo depois
 * que a grade passou a mostrar outro mes. Por isso o painel nomeia o dia, e nao
 * depende da grade para dizer qual e'.
 */
let selectedDate = null;
let remindersByDate = {};

const MONTHS = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const WEEKDAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];

function esc(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** "2026-09-25" -> "25/09/2026", que e' como a pessoa le a data no Brasil. */
function dataBr(iso) {
    if (!iso || iso.length < 10) return iso || '';
    return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
}

/**
 * Data local em "AAAA-MM-DD", o inverso de dataBr.
 *
 * Nao e' toISOString().slice(0, 10): essa e' meia-noite UTC, que no Brasil e'
 * as 21h do dia anterior. Uma loja que anota lembrete as 22h e' o caso em que
 * isso vira lembrete no dia errado.
 */
function dataIsoLocal(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/**
 * Anos que o seletor oferece.
 *
 * O ano corrente mais dois para tras e um para a frente e' o minimo, mas a lista
 * cresce para incluir todo ano que tem pedido -- e o motivo e' concreto: quem
 * abre o calendario para conferir marco do ano passado nao consegue achar marco
 * num seletor que so vai ate dois anos atras.
 *
 * Ordena e deduplica porque a mesma fonte alimenta o filtro e o valor corrente:
 * se o ano em vista estiver fora da faixa (por exemplo, quem abriu em marco de
 * 2027 e parou no servidor), ele e' incluido em vez de o seletor discordar do
 * que a grade esta mostrando.
 */
function anosDisponiveis() {
    const anoAtual = new Date().getFullYear();
    const anos = new Set([anoAtual, anoAtual - 1, anoAtual - 2, anoAtual + 1]);
    for (const iso of Object.keys(ordersByDate)) {
        const ano = parseInt(iso.slice(0, 4), 10);
        if (Number.isFinite(ano)) anos.add(ano);
    }
    anos.add(currentYear);
    return [...anos].sort((a, b) => a - b);
}

function pintaSeletores() {
    const selMes = document.getElementById('calMonth');
    const selAno = document.getElementById('calYear');
    if (!selMes || !selAno) return;

    selMes.innerHTML = MONTHS.map((nome, i) =>
        '<option value="' + i + '">' + esc(nome) + '</option>').join('');
    selAno.innerHTML = anosDisponiveis().map((ano) =>
        '<option value="' + ano + '">' + ano + '</option>').join('');

    selMes.value = String(currentMonth);
    selAno.value = String(currentYear);
}

/*
 * Lembretes.
 *
 * Ficam em memoria como os pedidos, e sao buscados junto. A lista do mes inteiro
 * cabe em uma tela; nao ha paginacao nem busca, e uma busca aqui custaria um
 * campo e uma fonte de confusao a mais em um painel que ja tem muitos filtros.
 *
 * O indice por dia existe para a grade: marcadorLembrete le do mapa direto, em
 * vez de varrer a lista a cada celula. Trinta celulas vezes uma lista e' o
 * suficiente para a grade comecar a engasgar, e o custo e' o mesmo de um objeto.
 */
function agrupaLembretes(lista) {
    const mapa = {};
    for (const l of lista) {
        if (!mapa[l.iso]) mapa[l.iso] = { total: 0, pendentes: 0 };
        mapa[l.iso].total += 1;
        if (!l.feito) mapa[l.iso].pendentes += 1;
    }
    return mapa;
}

/** Ponto de lembrete na celula do dia, e nada quando nao ha. */
function marcadorLembrete(iso) {
    const d = remindersByDate[iso];
    if (!d) return '';
    // Todos feitos: o ponto esmaece, porque o que a pessoa procura e' o que
    // ainda esta de pe.
    const cor = d.pendentes > 0 ? 'bg-accent' : 'bg-stone-300 dark:bg-stone-600';
    const texto = d.pendentes > 0
        ? d.pendentes + ' lembrete(s) a fazer'
        : d.total + ' lembrete(s), tudo concluído';
    return '<span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ' + cor + '" title="' + esc(texto) + '"></span>';
}

function desenhaLembretes() {
    const box = document.getElementById('lembreteLista');
    if (!box) return;

    const lista = (remindersDoMes || []).slice().sort(function (a, b) {
        if (a.feito !== b.feito) return a.feito ? 1 : -1;
        return a.dia === b.dia ? 0 : (a.dia < b.dia ? -1 : 1);
    });

    if (lista.length === 0) {
        box.innerHTML = '<p class="ink-3 text-sm">Nenhum lembrete neste mes.</p>';
        return;
    }

    let html = '';
    for (const l of lista) {
        html += '<div class="flex items-start gap-2 p-2 rounded-lg sunken' + (l.feito ? ' opacity-60' : '') + '">'
            + '<button type="button" onclick="lembreteConclui(\\'' + l.id + '\\')"'
            + ' class="w-4 h-4 mt-0.5 rounded border line shrink-0 flex items-center justify-center'
            + (l.feito ? ' bg-accent border-accent' : '') + '"'
            + ' aria-pressed="' + (l.feito ? 'true' : 'false') + '"'
            + ' aria-label="' + (l.feito ? 'Desmarcar lembrete: ' : 'Marcar lembrete como feito: ') + esc(l.texto) + '">'
            + (l.feito ? '<i class="fa-solid fa-check text-[9px]" style="color: var(--surface)"></i>' : '')
            + '</button>'
            + '<div class="min-w-0 flex-1">'
            + '<p class="text-sm ' + (l.feito ? 'ink-3 line-through' : 'ink') + ' break-words">' + esc(l.texto) + '</p>'
            + '<p class="text-[11px] ink-3">' + esc(l.dia) + '</p>'
            + '</div>'
            + '<button type="button" onclick="lembreteApaga(\\'' + l.id + '\\')"'
            + ' class="w-6 h-6 rounded badge-slate text-[10px] shrink-0 flex items-center justify-center"'
            + ' title="Apagar lembrete" aria-label="Apagar lembrete: ' + esc(l.texto) + '">'
            + '<i class="fa-solid fa-xmark"></i></button>'
            + '</div>';
    }
    box.innerHTML = html;
}

/**
 * Para onde o lembrete vai, em texto.
 *
 * A frase acompanha a selecao, e nao fica fixa: um texto que continua
 * verdadeiro depois da mudanca e' pior do que um texto ausente, porque a pessoa
 * le e acredita.
 */
function atualizaAvisoLembrete() {
    const aviso = document.getElementById('lembretePara');
    if (!aviso) return;
    if (selectedDate) {
        const quantos = remindersByDate[selectedDate];
        const extra = quantos ? ' Ja tem ' + quantos.pendentes + ' a fazer nesse dia.' : '';
        aviso.textContent = 'Vai para ' + dataBr(selectedDate) + '.' + extra;
    } else {
        aviso.textContent = 'Vai para hoje. Clique em um dia no calendario para escolher outro.';
    }
}

window.lembreteSalva = async function (ev) {
    ev.preventDefault();
    const campo = document.getElementById('lembreteTexto');
    if (!campo) return false;
    const texto = (campo.value || '').trim();
    if (texto === '') { flash('err', 'Escreva o lembrete antes de salvar.'); return false; }

    const botao = ev.target.querySelector('button[type="submit"]');
    const original = botao ? botao.innerHTML : '';
    if (botao) { botao.disabled = true; botao.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...'; }

    const dia = selectedDate || dataIsoLocal(new Date());
    const r = await postJSON('/api/calendar/lembretes', { texto: texto, dia: selectedDate || undefined }, avisoLembrete(texto, dia));
    if (botao) { botao.disabled = false; botao.innerHTML = original; }
    if (!r.ok) { flash('err', r.data.error || 'Nao foi possivel salvar o lembrete.'); return false; }

    campo.value = '';
    await carregaLembretes();
    flash('ok', avisoLembrete(texto, r.data && r.data.iso ? r.data.iso : dia));
    return false;
};

/**
 * O que a pessoa precisa saber depois de anotar.
 *
 * O sino so mostra uma semana de lembretes (ver DIAS_DE_ANTECEDENCIA em
 * notificacoes.ts). Dizer isso no momento da anotacao e' o que impede a pessoa
 * de anotar "comprar carne" para o dia 14, fechar o Calendario e esperar o
 * aviso -- e o que faz ela concluir, depois, que o sistema perdeu a anotacao.
 */
function avisoLembrete(texto, diaIso) {
    const dias = Math.round((new Date(diaIso + 'T00:00') - new Date(dataIsoLocal(new Date()) + 'T00:00')) / 86400000);
    if (dias <= DIAS_DE_ANTECEDENCIA) return 'Lembrete anotado.';
    return 'Lembrete anotado para ' + dataBr(diaIso) + '. Passada uma semana, ele some do sino e fica so no Calendario.';
}

/**
 * A gravacao repetida depois de uma pagina velha muda a lista sem ninguem pedir.
 *
 * postJSON refaz o que foi recusado por CSRF e avisa em painel:replay. Sem
 * esta escuta, o lembrete entraria no banco e a coluna da direita continuaria
 * mostrando a lista antiga -- o mesmo defeito que motivou a repeticao, so que
 * agora sem aviso nenhum.
 */
document.addEventListener('painel:replay', function (ev) {
    if (!ev.detail || !ev.detail.ok) return;
    if (String(ev.detail.url).indexOf('/api/calendar/lembretes') === -1) return;
    carregaLembretes();
});

window.lembreteConclui = async function (id) {
    const r = await postJSON('/api/calendar/lembretes/' + encodeURIComponent(id) + '/concluir', {});
    if (!r.ok) { flash('err', r.data.error || 'Nao foi possivel atualizar.'); return; }
    await carregaLembretes();
};

window.lembreteApaga = function (id) {
    confirmThen(
        'O lembrete sai do painel e nao volta. Concluir e melhor quando a ideia e so nao deixar pendente.',
        async function () {
            const r = await postJSON('/api/calendar/lembretes/' + encodeURIComponent(id) + '/apagar', {});
            if (!r.ok) { flash('err', r.data.error || 'Nao foi possivel apagar.'); return; }
            await carregaLembretes();
        },
        { titulo: 'Apagar lembrete', confirmar: 'Apagar' }
    );
};

var remindersDoMes = [];

async function carregaLembretes() {
    const mes = currentYear + '-' + String(currentMonth + 1).padStart(2, '0');
    try {
        const res = await fetch('/api/calendar/lembretes?mes=' + mes);
        if (!res.ok) return;
        remindersDoMes = await res.json();
        remindersByDate = agrupaLembretes(remindersDoMes);
        desenhaLembretes();
        atualizaAvisoLembrete();
        // A grade e' redesenhada para aparecer o ponto do lembrete no dia. Sao
        // trinta celulas: redesenhar e' mais barato que procurar o dia e trocar
        // uma classe, e o codigo de marcar fica em um lugar so.
        renderCalendar();
    } catch (e) {
        log.error('Erro ao buscar lembretes:', e);
    }
}

async function fetchOrdersForCalendar() {
    try {
        const res = await fetch('/api/calendar/orders');
        ordersByDate = await res.json();
        renderCalendar();
    } catch (e) {
        log.error('Erro ao buscar pedidos:', e);
    }
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;

    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();
    const startDay = new Date(currentYear, currentMonth, 1).getDay();
    const today = new Date();

    pintaSeletores();

    let html = '';
    for (let i = 0; i < startDay; i++) html += '<div class="p-1"></div>';

    for (let day = 1; day <= totalDays; day++) {
        const iso = currentYear + '-' + String(currentMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const data = ordersByDate[iso];
        const count = data ? data.count : 0;
        const revenue = data ? data.totalRevenue : 0;
        const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
        const isSelected = iso === selectedDate;

        /*
         * A celula do dia se ajusta a altura da tela.
         *
         * O calendario e' a grade mais alta da aba, e ela empurrava o resto
         * para fora da dobra. A altura fixa de 4,5 rem funciona na tela de
         * desenvolvimento e estoura na de 1366x768 do balcao, com a barra do
         * navegador aberta e o cabecalho ocupando 4 rem.
         *
         * A funcao clamp resolve os dois lados de uma vez: o minimo e' o que a
         * celula precisa para o numero e o ponto caberem, o maximo e' o que ela
         * tinha antes em monitor grande, e no meio a altura vem da tela. Sem
         * descer, e sem o dia ficar um quadrado minusculo em tela alta.
         */
        const base = 'p-2 min-h-[clamp(2.5rem,7.2vh,4.5rem)] rounded-card border cursor-pointer transition flex flex-col gap-0.5 text-left';
        const tone = count
            ? 'border-success bg-success-bg '
            : 'border-line ';

        /*
         * O anel e' do SELECIONADO, e o "hoje" e' da data. Sao duas informacoes
         * diferentes e por isso o anel nao acumula: se os dois entrassem juntos,
         * o navegador veria ring-1 e ring-2 no mesmo elemento -- a mesma
         * propriedade CSS, e o vencedor seria a ordem no arquivo de estilos, nao
         * a ordem no atributo. O resultado seria um dos dois sumindo em silencio.
         *
         * A cor e' o token de acento, e nao um amber solto: o anel de selecao
         * precisa de 3:1 contra o fundo da celula, e o fundo dela varia (branco
         * num dia sem pedido, verde num dia com). O token ja e' verificado pelo
         * check:contrast; um amber-500 escolhido a mao passaria em cima de
         * branco e reprovariam em cima do verde.
         */
        const anel = isSelected
            ? 'border-accent ring-2 ring-accent '
            : (isToday ? 'border-amber-500 ring-1 ring-amber-500 ' : '');

        /*
         * Button, e nao div com onclick.
         *
         * Um div clicavel nao entra na ordem do teclado: quem opera so com Tab
         * nao chega nos dias, e o Enter nao abre os pedidos do dia. Aqui cada
         * celula e' um botao de verdade, com aria-pressed dizendo se o dia esta
         * selecionado e um rotulo que o leitor de tela le como data -- "25 de
         * setembro de 2026, 6 pedidos" -- em vez de soletrar "2" e "R$ 7.794,00"
         * como duas coisas sem contexto.
         */
        const rotulo = dataBr(iso) + (count ? ', ' + count + ' pedido(s)' : ', sem pedidos')
            + (remindersByDate[iso] ? ', ' + (remindersByDate[iso].pendentes > 0
                ? remindersByDate[iso].pendentes + ' lembrete(s) a fazer'
                : 'lembretes concluidos') : '');

        /*
         * O dia vai em data-dia, e o clique em um unico listener delegando.
         *
 * Era onclick="showDayOrders('2026-09-25')", e isso exige dois níveis de
         * escape dentro do template literal do servidor -- \\' para virar \' no
         * JavaScript entregue, porque um \' solto no arquivo TypeScript vira uma
         * aspas no script e fecha a string. Ja quebrou duas vezes nesta sessao,
         * e o sintoma e' o mais caro de todos: o bloco inteiro deixa de fazer
         * parse, a tela abre e nao responde. Delegacao tira o problema pela raiz
         * -- o atributo nao tem aspas para escapar, e nao ha uma funcao por celula.
         */
        html += '<button type="button" class="' + base + tone + anel + ' relative"'
            + ' data-dia="' + iso + '"'
            + ' aria-pressed="' + (isSelected ? 'true' : 'false') + '"'
            + ' aria-label="' + esc(rotulo) + '"'
            + ' title="' + esc(rotulo) + '">'
            + marcadorLembrete(iso)
            + '<span class="text-sm font-bold ' + (isToday ? 'text-amber-600 dark:text-amber-400' : '') + '">' + day + '</span>';
        if (count) {
            html += '<span class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">' + count + ' ped.</span>';
            html += '<span class="text-[11px] text-stone-500 dark:text-stone-400">R$ ' + revenue.toFixed(2) + '</span>';
        }
        html += '</button>';
    }
    grid.innerHTML = html;
}

/*
 * Ir para um mes e um ano quaisquer.
 *
 * Os dois seletores e as duas setas chamam ISTA funcao, e nao cada uma a sua.
 * Um destino tem tres lugares de entrada -- seletor de mes, seletor de ano e
 * seta -- e o que eles fazem depois de chegar no mes precisa ser identico:
 * marcar o novo mes, redesenhar a grade e conferir se o dia escolhido ainda
 * esta na vista. Com tres funcoes, um desses passos esquotece em um caminho e o
 * sintoma e' "as setas funciona, o seletor nao marca o dia".
 *
 * Mes e ano sao argumentos separados, e nao um "periodo" so: trocar de mes
 * dentro do ano e trocar de ano mantendo o mes sao as duas operacoes que a pessoa
 * faz, e o seletor de mes continua util depois de mudar de ano (ver novembro de
 * 2025 depois de estar em dezembro de 2026).
 */
window.irPara = function (mes, ano) {
    if (Number.isFinite(mes)) currentMonth = Math.max(0, Math.min(11, mes));
    if (Number.isFinite(ano)) currentYear = ano;
    renderCalendar();
    avisaDiaForaDaVista();
    // Os lembretes sao do MES, entao mudar de mes e' o que torna a lista de
    // cima o que ela mostra. Sem esta chamada, a coluna da direita continuaria
    // com os lembretes do mes anterior embaixo de uma grade que ja mudou.
    void carregaLembretes();
};

/** Um mes a frente ou atras, atravessando a virada de ano. */
window.mudaMes = function (delta) {
    let m = currentMonth + delta;
    let a = currentYear;
    if (m < 0) { m = 11; a--; }
    if (m > 11) { m = 0; a++; }
    window.irPara(m, a);
};

/**
 * Clique no dia.
 *
 * Delegado no grid, e nao um handler por celula: a grade e' redesenhada a cada
 * mudanca de mes e a cada anotacao de lembrete, e ligar cada celula a cada
 * redesenho e' trabalho que se perde na primeira troca.
 */
document.addEventListener('click', function (ev) {
    var dia = ev.target.closest('#calendarGrid [data-dia]');
    if (dia) window.showDayOrders(dia.dataset.dia);
});

window.showDayOrders = function (iso) {    const box = document.getElementById('dayOrders');
    if (!box) return;

    selectedDate = iso;
    // A grade e' redesenhada para marcar o anel. Sao 30 celulas: redesenhar e'
// mais barato que caçar o elemento velho e trocar classe, e o codigo de
    // marcar fica em um lugar so -- o lugar que desenha o dia.
    renderCalendar();

    const titulo = document.getElementById('dayOrdersTitle');
    if (titulo) titulo.textContent = 'Pedidos de ' + dataBr(iso);
    // O formulario de lembrete escreve no dia escolhido. E' o mesmo estado que
    // pinta o anel e nomeia o titulo -- uma selecao so, lida por tres lugares.
    atualizaAvisoLembrete();

    const data = ordersByDate[iso];
    if (!data || !data.orders.length) {
        box.innerHTML = '<p class="ink-3 text-sm">Nenhum pedido em ' + dataBr(iso) + '.</p>';
        return;
    }
    const labels = { pendente: 'Pendente', preparando: 'Preparando', entrega: 'Em entrega', concluido: 'Concluido' };
    let html = '<div class="space-y-2">';
    for (const o of data.orders) {
        html += '<div class="surface p-3 rounded-lg border line">'
            + '<div class="flex justify-between gap-2">'
            + '<span class="font-semibold text-sm">' + esc(o.clientName || 'Cliente') + '</span>'
            + '<span class="badge-slate text-xs px-2 py-0.5 rounded">' + esc(labels[o.status] || o.status) + '</span>'
            + '</div>'
            + '<div class="text-xs ink-3">' + esc(o.items) + '</div>'
            + '<div class="text-sm font-bold accent-amber-strong">R$ ' + Number(o.total).toFixed(2) + '</div>'
            + '<div class="text-[11px] ink-3">' + esc(o.clientPhone.replace('@s.whatsapp.net', '')) + '</div>'
            + '</div>';
    }
    box.innerHTML = html + '</div>';
};

/**
 * Ao trocar de mes, o dia escolhido pode nao estar mais na grade.
 *
 * Sem este aviso, a tela mostra "Setembro de 2026" com pedidos listados de um
 * dia de agosto, e nada na tela diz que os dois nao combinam -- que e' a forma
 * exata de a pessoa conferir o total do dia errado achando que e' o dia de
 * hoje. O aviso diz qual dia o painel esta mostrando, e o painel ja diz o dia
 * no titulo; aqui a unica novidade e' o contraste com o mes em vista.
 */
function avisaDiaForaDaVista() {
    const aviso = document.getElementById('diaForaDaVista');
    if (!aviso) return;
    if (!selectedDate) { aviso.classList.add('hidden'); return; }

    const mesDoDia = selectedDate.slice(0, 7);
    const mesEmVista = currentYear + '-' + String(currentMonth + 1).padStart(2, '0');

    // Se o dia escolhido esta de volta na grade, o aviso some -- ele nao pode
    // ficar parado claiming que os pedidos sao de outro mes, quando a pessoa
    // acabou de voltar para o mes deles.
    if (mesDoDia === mesEmVista) { aviso.classList.add('hidden'); return; }

    aviso.classList.remove('hidden');
    aviso.textContent = 'Voce mudou para ' + MONTHS[currentMonth] + ' de ' + currentYear
        + '. Os pedidos abaixo sao de ' + dataBr(selectedDate) + '.';
}

fetchOrdersForCalendar();
carregaLembretes();
`);
});

/* ------------------------------------------------------------- PDV (balcao) */

/**
 * Cria um pedido de frente de caixa. O total e sempre recalculado aqui a
 * partir dos precos no banco: o navegador envia apenas id e quantidade, entao
 * um cliente malicioso nao consegue inventar o valor da venda.
 */
app.post('/api/admin/pdv/orders', async (req, res) => {
    try {
        /*
         * O schema confere a FORMA (items e' lista, cada linha tem id, quantidade
         * e' numero); a REGRA fica no priceCart logo abaixo (existe, disponivel,
         * modificador pertence, preco). O preco nunca veio do navegador.
         */
        const checado = validar(vendaPdv, req.body);
        if (falhou(checado)) return res.status(400).json({ error: checado.error });
        const body = checado.dados;

        // Preco, modificadores e estoque sao resolvidos AQUI, no servidor.
        // O navegador nunca envia valores trusted.
        const priced = await priceCart(body.items);
        if (priced.ok === false) {
            return res.status(400).json({ error: priced.error });
        }
        const { lines, subtotal, stockDeductions } = priced.result;
        const count = lines.reduce((a, l) => a + l.qty, 0);

        // Desconto e gorjeta vem do cliente, mas sao normalizados aqui:
        // desconto nunca passa do subtotal e gorjeta nunca e negativa.
        const totals = computeTotals(subtotal, body.discount, body.tip);

        // O schema ja garante que sao strings, entao aqui so normaliza.
        const notes = (body.notes ?? '').trim().slice(0, 300);
        const customer = (body.customer ?? '').trim().slice(0, 80);

        // Forma de pagamento desconhecida cai em pix, e nao em erro: o caixa
        // nao pode ficar travado por causa de um valor novo no seletor.
        const paymentRaw = body.paymentMethod ?? 'pix';
        const paymentMethod = PDV_PAYMENT_LABELS[paymentRaw] ? paymentRaw : 'pix';

        /*
         * Pedido e baixa de estoque no mesmo commit: separados, o pedido ficava
         * gravado e o sistema contava uma venda que nao baixou nada. O preco vem
         * de priceCart, acima; este bloco so grava.
         */
        const { order, shortfalls } = await createOrderWithStock(
            {
                // Balcao nao tem WhatsApp: identificamos pelo canal + nome.
                clientPhone: customer ? `pdv:${customer}` : 'pdv:balcao',
                clientName: customer || 'Cliente Balcao',
                items: linesToItemsField(lines),
                subtotal: totals.subtotal,
                discount: totals.discount,
                tip: totals.tip,
                total: totals.total,
                notes: notes || null,
                status: 'pendente',
                channel: 'pdv',
                paymentMethod,
            },
            // Em combo, o abate e' nos componentes (ja resolvido pelo priceCart).
            stockDeductions,
            'pdv'
        );

        notifyClients();

        /*
         * Saldo insuficiente nao derruba a venda: recusar no meio do almoço
         * custa mais caro do que vender e avisar. O caixa ve shortfalls na
         * resposta e pode repor na hora.
         */
        res.status(201).json({
            success: true,
            id: order.id,
            count,
            subtotal: currency(totals.subtotal),
            discount: currency(totals.discount),
            tip: currency(totals.tip),
            total: currency(totals.total),
            paymentLabel: PDV_PAYMENT_LABELS[paymentMethod],
            ...(shortfalls.length > 0
                ? {
                      semSaldo: shortfalls.map((s) => ({
                          nome: s.nome,
                          pediu: s.pediu,
                          tinha: s.tinha,
                      })),
                  }
                : {}),
        });
    } catch (error) {
        // Como pedido e estoque sao o mesmo commit, chegar aqui significa que
        // NADA foi gravado. O caixa pode tentar de novo sem duplicar nada.
        log.error('Erro ao registrar venda do PDV:', error);
        res.status(500).json({ error: 'Erro ao registrar venda' });
    }
});

/* --------------------------------------------- Modificadores e combos */

/** Todos os grupos com suas opcoes, para o gerenciador de cardapio. */
app.get('/api/admin/modifier-groups', async (_req, res) => {
    try {
        const groups = await prisma.modifierGroup.findMany({
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            include: {
                options: { orderBy: { sortOrder: 'asc' } },
                _count: { select: { products: true } },
            },
        });
        res.json(groups);
    } catch (error) {
        log.error('Erro ao listar grupos:', error);
        res.status(500).json({ error: 'Erro ao listar grupos' });
    }
});

app.post('/api/admin/modifier-groups', async (req, res) => {
    try {
        const b = (req.body ?? {}) as {
            name?: unknown;
            minSelect?: unknown;
            maxSelect?: unknown;
            required?: unknown;
            options?: unknown;
        };
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (!name) return res.status(400).json({ error: 'Informe o nome do grupo.' });

        const maxSelect = Math.max(1, Math.min(20, Math.round(toNumber(b.maxSelect, 1))));
        const minSelect = Math.max(0, Math.min(maxSelect, Math.round(toNumber(b.minSelect, 0))));

        const group = await prisma.modifierGroup.create({
            data: {
                tenantId: exigeLoja(),
                name,
                minSelect,
                maxSelect,
                required: b.required === true || b.required === 'true',
                sortOrder: await prisma.modifierGroup.count(),
            },
        });

        if (Array.isArray(b.options)) {
            for (let i = 0; i < b.options.length; i++) {
                const o = b.options[i] as { name?: unknown; price?: unknown; prefix?: unknown };
                const on = typeof o?.name === 'string' ? o.name.trim() : '';
                if (!on) continue;
                await prisma.modifierOption.create({
                    data: {
                        tenantId: exigeLoja(),
                        groupId: group.id,
                        name: on,
                        price: Math.max(0, toNumber(o.price, 0)),
                        prefix: typeof o.prefix === 'string' ? o.prefix.trim().slice(0, 8) : '',
                        sortOrder: i,
                    },
                });
            }
        }

        res.status(201).json({ success: true, groupId: group.id });
    } catch (error) {
        log.error('Erro ao criar grupo:', error);
        res.status(500).json({ error: 'Erro ao criar grupo' });
    }
});

app.post('/api/admin/modifier-groups/:id/options', async (req, res) => {
    try {
        const group = await prisma.modifierGroup.findUnique({ where: { id: req.params.id } });
        if (!group) return res.status(404).json({ error: 'Grupo nao encontrado.' });

        const b = (req.body ?? {}) as { name?: unknown; price?: unknown; prefix?: unknown };
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (!name) return res.status(400).json({ error: 'Informe o nome da opcao.' });

        const count = await prisma.modifierOption.count({ where: { groupId: group.id } });
        const option = await prisma.modifierOption.create({
            data: {
                tenantId: exigeLoja(),
                groupId: group.id,
                name,
                price: Math.max(0, toNumber(b.price, 0)),
                prefix: typeof b.prefix === 'string' ? b.prefix.trim().slice(0, 8) : '',
                sortOrder: count,
            },
        });
        res.status(201).json(option);
    } catch (error) {
        log.error('Erro ao criar opcao:', error);
        res.status(500).json({ error: 'Erro ao criar opcao' });
    }
});

app.delete('/api/admin/modifier-options/:id', async (req, res) => {
    try {
        await prisma.modifierOption.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch {
        res.status(400).json({ error: 'Opcao nao encontrada' });
    }
});

app.delete('/api/admin/modifier-groups/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const group = await prisma.modifierGroup.findUnique({ where: { id } });
        if (!group) return res.status(404).json({ error: 'Grupo nao encontrado.' });

        // Remove os vinculos em produtos antes do grupo.
        await prisma.productModifierGroup.deleteMany({ where: { groupId: id } });
        await prisma.modifierGroup.delete({ where: { id } });
        res.json({ success: true });
    } catch (error) {
        log.error('Erro ao remover grupo:', error);
        res.status(500).json({ error: 'Erro ao remover grupo' });
    }
});

/** Liga/desliga um grupo de modificadores em um produto. */
app.post('/api/admin/products/:id/modifier-groups', async (req, res) => {
    try {
        const productId = req.params.id;
        const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
        if (!product) return res.status(404).json({ error: 'Produto nao encontrado.' });

        const b = (req.body ?? {}) as { groupId?: unknown; attach?: unknown };
        const groupId = String(b.groupId ?? '');
        if (!groupId) return res.status(400).json({ error: 'Informe o grupo.' });

        if (b.attach === false || b.attach === 'false') {
            await prisma.productModifierGroup.deleteMany({ where: { productId, groupId } });
        } else {
            const count = await prisma.productModifierGroup.count({ where: { productId } });
            await prisma.productModifierGroup.upsert({
                where: { tenantId_productId_groupId: { tenantId: exigeLoja(), productId, groupId } },
                update: {},
                create: { tenantId: exigeLoja(), productId, groupId, sortOrder: count },
            });
        }
        res.json({ success: true, product: await loadProductFull(productId) });
    } catch (error) {
        log.error('Erro ao vincular grupo:', error);
        res.status(500).json({ error: 'Erro ao vincular grupo' });
    }
});

/** Substitui os componentes de um combo. */
app.post('/api/admin/products/:id/combo', async (req, res) => {
    try {
        const comboId = req.params.id;
        const combo = await prisma.product.findUnique({ where: { id: comboId }, select: { id: true } });
        if (!combo) return res.status(404).json({ error: 'Produto nao encontrado.' });

        const b = (req.body ?? {}) as { isCombo?: unknown; components?: unknown };
        const isCombo = b.isCombo === true || b.isCombo === 'true';
        const components = Array.isArray(b.components) ? b.components : [];

        if (!isCombo) {
            await prisma.comboItem.deleteMany({ where: { comboId } });
            await prisma.product.update({ where: { id: comboId }, data: { isCombo: false } });
            return res.json({ success: true, product: await loadProductFull(comboId) });
        }

        const ids = components
            .map((c) => String((c as { componentId?: unknown })?.componentId ?? ''))
            .filter((v) => v && v !== comboId);
        if (ids.length === 0) return res.status(400).json({ error: 'Combo precisa de ao menos um componente.' });

        const unique = [...new Set(ids)];
        const found = await prisma.product.findMany({ where: { id: { in: unique } }, select: { id: true } });
        if (found.length !== unique.length) {
            return res.status(400).json({ error: 'Um ou mais componentes nao existem.' });
        }

        await prisma.comboItem.deleteMany({ where: { comboId } });
        for (let i = 0; i < unique.length; i++) {
            const raw = components.find((c) => String((c as { componentId?: unknown })?.componentId) === unique[i]) as
                | { componentId?: unknown; quantity?: unknown }
                | undefined;
            const qty = Math.max(1, Math.min(99, Math.round(toNumber(raw?.quantity, 1))));
            await prisma.comboItem.create({
                data: { tenantId: exigeLoja(), comboId, componentId: unique[i], quantity: qty, sortOrder: i },
            });
        }
        await prisma.product.update({ where: { id: comboId }, data: { isCombo: true } });

        res.json({ success: true, product: await loadProductFull(comboId) });
    } catch (error) {
        log.error('Erro ao salvar combo:', error);
        res.status(500).json({ error: 'Erro ao salvar combo' });
    }
});

app.get('/api/admin/products/:id/full', async (req, res) => {
    try {
        const full = await loadProductFull(req.params.id);
        if (!full) return res.status(404).json({ error: 'Produto nao encontrado.' });
        res.json(full);
    } catch (error) {
        log.error('Erro ao carregar produto:', error);
        res.status(500).json({ error: 'Erro ao carregar produto' });
    }
});

/* -------------------------------------------------------- Caixa e turno */

app.get('/api/admin/cash/summary', async (_req, res) => {
    try {
        res.json(await cashSummary());
    } catch (error) {
        log.error('Erro ao montar resumo de caixa:', error);
        res.status(500).json({ error: 'Erro ao montar resumo de caixa' });
    }
});

app.get('/api/admin/cash/shift', async (_req, res) => {
    try {
        res.json({ open: await openShift() });
    } catch (error) {
        log.error('Erro ao ler turno:', error);
        res.status(500).json({ error: 'Erro ao ler turno' });
    }
});

app.post('/api/admin/cash/shift/open', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { openingFloat?: unknown };
        const result = await startShift(toNumber(b.openingFloat, 0));
        if (!result.ok) return res.status(409).json({ error: result.error });
        res.status(201).json({ success: true, shiftId: result.shiftId });
    } catch (error) {
        log.error('Erro ao abrir turno:', error);
        res.status(500).json({ error: 'Erro ao abrir turno' });
    }
});

app.post('/api/admin/cash/shift/close', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { countedCash?: unknown; note?: unknown };
        const result = await closeShift({
            countedCash: toNumber(b.countedCash, -1),
            note: typeof b.note === 'string' ? b.note : null,
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ success: true, report: result.report });
    } catch (error) {
        log.error('Erro ao fechar turno:', error);
        res.status(500).json({ error: 'Erro ao fechar turno' });
    }
});

/**
 * Preenche a contagem fisica de um turno que a agenda encerrou sem contar.
 * Sem isto, o fluxo "pendente de conferencia" nao teria fim.
 */
app.post('/api/admin/cash/shift/reconcile', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { shiftId?: unknown; countedCash?: unknown; note?: unknown };
        const result = await reconcileShift({
            shiftId: String(b.shiftId ?? ''),
            countedCash: toNumber(b.countedCash, -1),
            note: typeof b.note === 'string' ? b.note : null,
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        notifyClients();
        res.json({ success: true, difference: result.difference });
    } catch (error) {
        log.error('Erro ao conferir turno:', error);
        res.status(500).json({ error: 'Erro ao conferir turno' });
    }
});

app.get('/api/admin/cash/shifts', async (_req, res) => {
    try {
        res.json(await shiftHistory(30));
    } catch (error) {
        log.error('Erro ao listar turnos:', error);
        res.status(500).json({ error: 'Erro ao listar turnos' });
    }
});

app.post('/api/admin/cash/movement', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { type?: unknown; amount?: unknown; note?: unknown };
        const type = b.type === 'entrada' || b.type === 'saida' ? b.type : 'saida';
        const result = await registerCashMovement({
            type,
            amount: toNumber(b.amount, 0),
            note: typeof b.note === 'string' ? b.note : null,
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ success: true, warned: result.warned });
    } catch (error) {
        log.error('Erro ao registrar movimento de caixa:', error);
        res.status(500).json({ error: 'Erro ao registrar movimento' });
    }
});

/* ------------------------------------------------- Produtos: sku, csv, foto */

app.get('/api/admin/products.csv', async (_req, res) => {
    try {
        const csv = await exportProductsCsv();
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="produtos-${stamp}.csv"`);
        res.send('\uFEFF' + csv);
    } catch (error) {
        log.error('Erro ao exportar produtos:', error);
        res.status(500).send('Erro ao exportar');
    }
});

app.post('/api/admin/products/import', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { csv?: unknown };
        if (typeof b.csv !== 'string' || b.csv.trim().length < 10) {
            return res.status(400).json({ error: 'Envie o conteudo do CSV.' });
        }
        if (b.csv.length > 2_000_000) {
            return res.status(400).json({ error: 'CSV muito grande (limite 2MB).' });
        }
        const result = await importProductsFromCsv(b.csv);
        res.json({ success: true, ...result });
    } catch (error) {
        log.error('Erro ao importar produtos:', error);
        res.status(500).json({ error: 'Erro ao importar produtos' });
    }
});

/** Garante que o produto tenha SKU (usado pelo PDV ao montar o catalogo). */
app.post('/api/admin/products/:id/sku', async (req, res) => {
    try {
        const sku = await ensureSku(req.params.id, String((req.body ?? {}).name ?? ''));
        if (!sku) return res.status(400).json({ error: 'Nao foi possivel gerar SKU.' });
        res.json({ success: true, sku });
    } catch (error) {
        log.error('Erro ao gerar SKU:', error);
        res.status(400).json({ error: 'Erro ao gerar SKU' });
    }
});

const UPLOAD_DIR = DIR_UPLOADS_PRODUTOS;
const MAX_IMAGE_BYTES = 400_000; // base64: ~300KB de binario

app.post('/api/admin/products/:id/photo', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { dataUrl?: unknown };
        const dataUrl = typeof b.dataUrl === 'string' ? b.dataUrl : '';
        const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!match) {
            return res.status(400).json({ error: 'Envie uma imagem PNG, JPEG ou WebP.' });
        }

        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length === 0) return res.status(400).json({ error: 'Imagem vazia.' });
        if (dataUrl.length > MAX_IMAGE_BYTES) {
            return res.status(413).json({ error: 'Imagem grande demais (max 300KB apos redimensionar).' });
        }

        const id = req.params.id;
        if (!/^[A-Za-z0-9-]{6,64}$/.test(id)) {
            return res.status(400).json({ error: 'Id de produto invalido.' });
        }

        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
        const fileName = `${id}.${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);

        const imageUrl = `/uploads/produtos/${fileName}`;
        await prisma.product.update({ where: { id }, data: { imageUrl } });
        res.json({ success: true, imageUrl });
    } catch (error) {
        log.error('Erro ao salvar foto do produto:', error);
        res.status(500).json({ error: 'Erro ao salvar foto' });
    }
});

app.delete('/api/admin/products/:id/photo', async (req, res) => {
    try {
        const id = req.params.id;
        const product = await prisma.product.findUnique({ where: { id }, select: { imageUrl: true } });
        if (product?.imageUrl) {
            const file = path.join(UPLOAD_DIR, path.basename(product.imageUrl));
            try {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            } catch {
                // arquivo orfao nao impede de limpar o campo
            }
        }
        await prisma.product.update({ where: { id }, data: { imageUrl: null } });
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: 'Erro ao remover foto' });
    }
});

/* -------------------------------------------------------- Caixa e hold */

/** Salva o carrinho atual e libera o PDV para a proxima venda. */
app.post('/api/admin/pdv/hold', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { items?: unknown; label?: unknown };
        if (!Array.isArray(b.items) || b.items.length === 0) {
            return res.status(400).json({ error: 'Carrinho vazio.' });
        }
        const clean = b.items
            .map((x) => {
                // Preserva os grupos de modificadores escolhidos no PDV.
                const groups: Record<string, string[]> = {};
                const raw = (x as { groups?: unknown })?.groups;
                if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                    for (const [gid, val] of Object.entries(raw as Record<string, unknown>)) {
                        if (Array.isArray(val)) {
                            const opts = val.map((o) => String(o)).filter(Boolean);
                            if (opts.length) groups[gid] = opts;
                        }
                    }
                }
                return {
                    id: String((x as { id?: unknown })?.id ?? ''),
                    qty: Math.max(1, Math.round(toNumber((x as { qty?: unknown })?.qty, 1))),
                    groups,
                };
            })
            .filter((x) => x.id)
            .slice(0, 100);
        if (clean.length === 0) return res.status(400).json({ error: 'Carrinho vazio.' });

        await prisma.parkedSale.create({
            data: {
                tenantId: exigeLoja(),
                label: typeof b.label === 'string' ? b.label.trim().slice(0, 60) : null,
                items: serializeParkedItems(clean),
            },
        });
        res.status(201).json({ success: true });
    } catch (error) {
        log.error('Erro ao suspender venda:', error);
        res.status(500).json({ error: 'Erro ao suspender venda' });
    }
});

app.get('/api/admin/pdv/holds', async (_req, res) => {
    try {
        res.json(await parkedSales());
    } catch (error) {
        log.error('Erro ao listar vendas suspensas:', error);
        res.status(500).json({ error: 'Erro ao listar vendas suspensas' });
    }
});

app.delete('/api/admin/pdv/holds/:id', async (req, res) => {
    try {
        await prisma.parkedSale.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: 'Venda suspensa nao encontrada' });
    }
});

// O postJSON do front usa POST; aceita os dois verbos.
app.post('/api/admin/pdv/holds/:id/delete', async (req, res) => {
    try {
        await prisma.parkedSale.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: 'Venda suspensa nao encontrada' });
    }
});

/* ------------------------------------------------------- Menu do dia */

app.get('/api/admin/daily-menu', async (req, res) => {
    try {
        res.json({
            today: await getDailyMenu(),
            previous: await previousDailyMenu(new Date()),
        });
    } catch (error) {
        log.error('Erro ao ler menu do dia:', error);
        res.status(500).json({ error: 'Erro ao ler menu do dia' });
    }
});

/** Grava o menu do dia. Como o bot le o cardapio do banco a cada mensagem,
 *  nao existe "sincronizacao": salvar aqui ja muda o WhatsApp. */
app.post('/api/admin/daily-menu', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { date?: unknown; productIds?: unknown; note?: unknown };
        if (!Array.isArray(b.productIds)) return res.status(400).json({ error: 'Envie a lista de pratos.' });

        const result = await setDailyMenu({
            date: typeof b.date === 'string' ? b.date : null,
            productIds: b.productIds as string[],
            note: typeof b.note === 'string' ? b.note : null,
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        notifyClients();
        res.json({ success: true, menu: result.menu });
    } catch (error) {
        log.error('Erro ao salvar menu do dia:', error);
        res.status(500).json({ error: 'Erro ao salvar menu do dia' });
    }
});

/** Copia o menu de um dia para outro. */
app.post('/api/admin/daily-menu/copy', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { from?: unknown; to?: unknown };
        const result = await copyDailyMenu({
            from: typeof b.from === 'string' ? b.from : null,
            to: typeof b.to === 'string' ? b.to : null,
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        notifyClients();
        res.json({ success: true, copied: result.copied, menu: await getDailyMenu() });
    } catch (error) {
        log.error('Erro ao copiar menu do dia:', error);
        res.status(500).json({ error: 'Erro ao copiar menu do dia' });
    }
});

/* ------------------------------------------------------------ Estoque */

app.post('/api/admin/stock/movement', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { productId?: unknown; type?: unknown; quantity?: unknown; note?: unknown };
        const rawType = String(b.type ?? 'entrada');
        // Sem default silencioso: tipo desconhecido cair em 'entrada' somaria
        // estoque em vez de falhar (ex.: 'ajuste' virava entrada).
        if (rawType !== 'entrada' && rawType !== 'saida' && rawType !== 'perda') {
            return res.status(400).json({ error: `Tipo de movimento invalido: ${rawType}` });
        }
        const type = rawType;
        const result = await applyMovement({
            productId: String(b.productId ?? ''),
            type,
            quantity: toNumber(b.quantity, 0),
            source: 'manual',
            note: typeof b.note === 'string' ? b.note.slice(0, 140) : null,
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ success: true, stock: result.stock });
    } catch (error) {
        log.error('Erro ao registrar movimento:', error);
        res.status(500).json({ error: 'Erro ao registrar movimento' });
    }
});

/** Ajuste rapido de +/-1 unidade (botoes da tabela de estoque). */
app.post('/api/admin/stock/adjust', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { productId?: unknown; delta?: unknown };
        const delta = Math.round(toNumber(b.delta, 0));
        if (delta === 0) return res.status(400).json({ error: 'Delta invalido.' });

        const result = await applyMovement({
            productId: String(b.productId ?? ''),
            type: delta > 0 ? 'entrada' : 'saida',
            quantity: Math.abs(delta),
            source: 'manual',
            note: 'Ajuste rapido',
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ success: true, stock: result.stock });
    } catch (error) {
        log.error('Erro no ajuste de estoque:', error);
        res.status(500).json({ error: 'Erro ao ajustar estoque' });
    }
});

/** Define o saldo absoluto (contagem fisica), guardando o sinal da diferenca. */
app.post('/api/admin/stock/set', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { productId?: unknown; stock?: unknown; note?: unknown };
        const result = await setStockTo({
            productId: String(b.productId ?? ''),
            stock: toNumber(b.stock, 0),
            source: 'manual',
            note: typeof b.note === 'string' && b.note.trim() ? b.note.slice(0, 140) : 'Contagem fisica',
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ success: true, stock: result.stock, delta: result.delta });
    } catch (error) {
        log.error('Erro ao definir saldo:', error);
        res.status(500).json({ error: 'Erro ao definir saldo' });
    }
});

/** Registra perda por descarte, validade ou quebra (saldo reduz). */
app.post('/api/admin/stock/loss', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { productId?: unknown; quantity?: unknown; reason?: unknown };
        const result = await applyMovement({
            productId: String(b.productId ?? ''),
            type: 'perda',
            quantity: toNumber(b.quantity, 0),
            source: 'manual',
            note: typeof b.reason === 'string' && b.reason.trim() ? b.reason.slice(0, 140) : 'Descarte',
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ success: true, stock: result.stock });
    } catch (error) {
        log.error('Erro ao registrar perda:', error);
        res.status(500).json({ error: 'Erro ao registrar perda' });
    }
});

/** Lista de reposicao: produtos zerados ou no minimo, com a quantidade sugerida. */
app.get('/api/admin/stock/reorder', async (_req, res) => {
    try {
        const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
        res.json(reorderList(products.map(toStockRow)));
    } catch (error) {
        log.error('Erro ao montar lista de reposicao:', error);
        res.status(500).json({ error: 'Erro ao montar lista de reposicao' });
    }
});

/** Perdas (descarte/validade) de um periodo, para acompanhar desperdicio. */
app.get('/api/admin/stock/waste', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, Math.round(toNumber(req.query.days, 30))));
        const since = new Date();
        since.setDate(since.getDate() - days);
        since.setHours(0, 0, 0, 0);
        res.json(await wasteSummary(since));
    } catch (error) {
        log.error('Erro ao calcular perdas:', error);
        res.status(500).json({ error: 'Erro ao calcular perdas' });
    }
});

/** Ativa/desativa controle de estoque e define saldo e minimo. */
app.post('/api/admin/stock/tracking', async (req, res) => {
    try {
        const b = (req.body ?? {}) as { productId?: unknown; stock?: unknown; minStock?: unknown; trackStock?: unknown };
        const productId = String(b.productId ?? '');
        const trackStock = b.trackStock === true || b.trackStock === 'true';

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return res.status(404).json({ error: 'Produto nao encontrado.' });

        const stock = Math.max(0, Math.round(toNumber(b.stock, 0)));
        const minStock = Math.max(0, Math.round(toNumber(b.minStock, 0)));

        await prisma.product.update({
            where: { id: productId },
            data: { trackStock, stock: trackStock ? stock : 0, minStock: trackStock ? minStock : 0 },
        });

        if (trackStock && stock !== product.stock) {
            const delta = stock - product.stock;
            await prisma.stockMovement.create({
                data: {
                    tenantId: exigeLoja(),
                    productId,
                    type: 'ajuste',
                    quantity: Math.abs(delta),
                    delta,
                    source: 'manual',
                    note: 'Controle de estoque ativado',
                },
            });
        }

        res.json({ success: true });
    } catch (error) {
        log.error('Erro ao configurar estoque:', error);
        res.status(500).json({ error: 'Erro ao configurar estoque' });
    }
});

/* --------------------------------------------- SSE para atualizacao ao vivo */

app.get('/admin/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const remove = addClient(res);
    // Envia o estado atual imediatamente: quem abre a aba ja recebe o QR
    // valido sem precisar esperar a proxima mudanca de estado.
    res.write(`event: connection\ndata: ${JSON.stringify(getConnectionState())}\n\n`);

    req.on('close', remove);
});

/* ------------------------------------------------------------- Acoes POST */

app.post('/admin/order/:id/status', async (req, res) => {
    try {
        const { id } = req.params;

        // O enum do schema vem de ORDER_STATUSES, a mesma fonte que o Kanban
        // e os relatorios usam. Adicionar um status la passa a valer aqui sem
        // tocar nesta rota.
        const checado = validar(mudancaStatus, req.body);
        if (falhou(checado)) return res.status(400).json({ success: false, error: checado.error });
        const { status } = checado.dados;

        const updated = await prisma.order.update({ where: { id }, data: { status } });


        if (updated.clientPhone) {
            await sendOrderStatusNotification(updated.clientPhone, updated.status, updated.items, updated.total);
        }

        notifyClients();
        res.json({ success: true, status: updated.status });
    } catch (error) {
        log.error('Erro ao atualizar status do pedido:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar pedido' });
    }
});

app.post('/admin/orders/reset-completed', async (_req, res) => {
    try {
        const result = await prisma.order.updateMany({
            where: { status: 'concluido' },
            data: { status: 'pendente' },
        });
        notifyClients();
        res.json({ success: true, reset: result.count });
    } catch (error) {
        log.error('Erro ao resetar concluidos:', error);
        res.status(500).json({ error: 'Erro ao resetar concluidos' });
    }
});

app.post('/admin/bot/reconnect', async (_req, res) => {
    try {
        await reconnectBot();
        res.json({ success: true });
    } catch (error) {
        log.error('Erro ao reconectar bot:', error);
        res.status(500).json({ error: 'Nao foi possivel reconectar' });
    }
});

app.post('/admin/bot/logout', async (_req, res) => {
    try {
        await logoutBot();
        // Apaga TUDO da pasta, e nao so os .json: a marcacao de maquina tambem
        // precisa ir, senao o proximo pareamento nasceria marcado com a identidade
        // da sessao desfeita. Ver src/services/maquina.ts.
        try {
            if (fs.existsSync(AUTH_DIR)) {
                for (const file of fs.readdirSync(AUTH_DIR)) {
                    fs.unlinkSync(path.join(AUTH_DIR, file));
                }
            }
        } catch (error) {
            log.error('Erro ao limpar credenciais:', error);
        }
        res.json({ success: true });
    } catch (error) {
        log.error('Erro ao desconectar bot:', error);
        res.status(500).json({ error: 'Nao foi possivel desconectar' });
    }
});

/*
 * A regra esta em `services/config.ts`, compartilhada com a API REST. Aqui nao
 * ha validacao, de proposito: quando as duas rotas validavam por conta propria
 * divergiram. As colunas sem uso estao no comentario do model Config.
 */
app.post('/admin/config/save', async (req, res) => {
    const r = await salvarConfig(req.body);
    if (falhouSalvar(r)) {
        return res.status(400).json({ error: r.error });
    }
    res.json({ success: true, avisos: r.avisos });
});

const ALLOWED_MESSAGE_KEYS = Object.keys(DEFAULT_BOT_MESSAGES);

/**
 * So as chaves que VIERAM no corpo sao tocadas: a tela mostra vazio para quem
 * nunca editou, entao gravar a lista inteira apagaria as outras. Campo vazio e'
 * "voltar ao padrao" e apaga a linha -- nao e' efeito colateral do `||` do cache.
 */
app.post('/admin/bot-messages/save', async (req, res) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const salvas: string[] = [];
        const restauradas: string[] = [];

        for (const key of ALLOWED_MESSAGE_KEYS) {
            // Ausente no corpo = a pessoa nao mexeu. Nao e' o mesmo que vazio.
            if (!(key in body)) continue;
            if (typeof body[key] !== 'string') continue;
            const valor = body[key] as string;
            const estavaEditado = (mapaParaTela()[key]?.editado ?? false);

            await salvarMensagem(key, valor);

            if (valor.trim() === '') {
                if (estavaEditado) restauradas.push(key);
            } else if (!estavaEditado) {
                salvas.push(key);
            }
        }

        notifyClients();
        res.json({
            success: true,
            salvas,
            restauradas,
            // Devolve o estado inteiro para a tela se redesenhar sem recarregar.
            mensagens: mapaParaTela(),
        });
    } catch (error) {
        log.error('Erro ao salvar mensagens do bot:', error);
        res.status(500).json({ error: 'Erro ao salvar mensagens' });
    }
});

/**
 * Some com as edicoes de verdade, e nao grava o texto padrao por cima: e' o que
 * distingue "nunca editei" de "voltou ao padrao" na tela. Ver `restaurarMensagem`.
 */
app.post('/admin/bot-messages/restaurar-todas', async (_req, res) => {
    try {
        const quantas = await restaurarTodasMensagens();
        notifyClients();
        log.info('Mensagens do bot restauradas ao padrao', { quantas });
        res.json({ success: true, restauradas: quantas, mensagens: mapaParaTela() });
    } catch (error) {
        log.error('Erro ao restaurar mensagens do bot:', error);
        res.status(500).json({ error: 'Erro ao restaurar mensagens' });
    }
});

/** Estado das mensagens: texto atual, padrao e se esta editado. */
app.get('/admin/bot-messages', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(mapaParaTela());
});

/* --------------------------------------------------------- Exportacao CSV */

app.get('/admin/reports.csv', async (req, res) => {
    try {
        const now = new Date();
        const to = parseDateInput(req.query.to, now);
        const from = parseDateInput(req.query.from, new Date(now.getTime() - 29 * 86400000));
        const status = typeof req.query.status === 'string' && VALID_ORDER_STATUS.includes(req.query.status) ? req.query.status : undefined;

        const orders = await prisma.order.findMany({
            where: {
                createdAt: { gte: startOfDay(from), lte: endOfDay(to) },
                ...(status ? { status } : {}),
            },
            orderBy: { createdAt: 'desc' },
        });

        /*
         * O CSV vai para o Excel do dono, e um "@lid" na coluna de telefone e'
         * um telefone que ele nao consegue usar para ligar. Resolve aqui, com a
         * mesma fonte que a tela usa.
         */
        const jidsCsv = [...new Set(orders.map((o) => o.clientPhone.trim()).filter(Boolean))];
        const telefonesCsv = new Map<string, string>();
        if (jidsCsv.length > 0) {
            const chats = await prisma.chat.findMany({
                where: { phone: { in: jidsCsv } },
                select: { phone: true, telefone: true },
            });
            for (const ch of chats) {
                if (ch.telefone) telefonesCsv.set(ch.phone, ch.telefone);
            }
        }
        const linhasCsv = orders.map((o) => ({
            ...o,
            telefoneResolvido: telefonesCsv.get(o.clientPhone.trim()) ?? '',
        }));

        const csv = toCsv(toReportRows(linhasCsv));
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="pedidos-${stamp}.csv"`);
        res.send('\uFEFF' + csv);
    } catch (error) {
        log.error('Erro ao exportar CSV:', error);
        res.status(500).send('Erro ao exportar');
    }
});

/* ------------------------------------------------------------- Dashboard */

app.get('/admin', async (req, res) => {
    try {
        // Itens que sairam da sidebar (bot, stats, products, system) ainda
        // podem estar em links antigos, favoritos ou prints. Mandamos para o
        // destino real em vez de deixar cair na Home sem explicacao.
        const rawTab = typeof req.query.tab === 'string' ? req.query.tab : '';
        const legado = LEGACY_TABS[rawTab];
        // O destino ja vem pronto, incluindo a ?aba= das sub-abas do
        // Faturamento, entao nao ha nada para montar aqui.
        if (legado) return res.redirect(303, legado);

        // Sem ?tab= a home e a primeira tela; "pedidos" segue acessivel pelo menu.
        const active: TabId = isTabId(rawTab) ? rawTab : 'home';

        // `botMessage.findMany()` saiu daqui: as mensagens so' interessam a aba
        // do WhatsApp, que ja le' tudo por `mapaParaTela()`. Aqui era uma
        // consulta a mais em cada visita ao painel.
        const [products, orders, config] = await Promise.all([
            prisma.product.findMany({ orderBy: { createdAt: 'asc' } }),
            prisma.order.findMany({ orderBy: { createdAt: 'desc' } }),
            getConfig(),
        ]);

        /*
         * As ESTATISTICAS ja estao no banco (`computeStatsSql`); aqui ficam so
         * as listas que a tela desenha. NUNCA truncar: a receita vem do SQL e o
         * kanban perderia pedidos com o dinheiro certo. A saida e' janela por tela.
         */
        if (orders.length > AVISO_VOLUME_PEDIDOS) {
            log.warn(
                `Painel carregou ${orders.length} pedidos em memoria. ` +
                    `A partir de ~${AVISO_VOLUME_PEDIDOS} a visita comeca a ficar lenta. ` +
                    `A solucao e' agregar no banco, nao truncar a lista -- truncar faz o ` +
                    `Faturamento mostrar menos receita que a real.`
            );
        }

        let body = '';

        switch (active) {
            case 'home': {
                body = renderHome(
                    await loadHomeData({
                        orders,
                        products,
                        config,
                        botOnline: isBotOnline(),
                    })
                );
                break;
            }

            case 'kanban': {
                const by = (s: string) => orders.filter((o) => o.status === s);
                // A coluna Concluidos mostra apenas o dia corrente: os pedidos
                // antigos saem da visao sem alterar o status, preservando
                // relatorios, caixa e historico. A virada ocorre a meia-noite.
                const startOfToday = new Date();
                startOfToday.setHours(0, 0, 0, 0);
                const concluidosHoje = by('concluido').filter((o) => o.updatedAt >= startOfToday);
                const concluidosAntigos = by('concluido').length - concluidosHoje.length;

                body = renderKanban({
                    pendentes: by('pendente'),
                    preparando: by('preparando'),
                    entrega: by('entrega'),
                    concluido: concluidosHoje,
                    ocultosConcluidos: concluidosAntigos,
                    totalAguardando: by('pendente').length + by('preparando').length + by('entrega').length,
                });
                break;
            }

            case 'config': {
                body = renderConfig({
                    ...config,
                    agenda: estadoAgendaCaixa(config),
                    // Medido agora, nao estimado. Esta secao responde "onde estao
                    // meus dados", e um numero inventado nesse lugar seria pior
                    // do que a secao nao existir.
                    dados: await resumoArmazenamento(),
                });
                break;
            }

            /*
             * O corpo so e' montado para administrador: montar a tela e esconder
             * so o botao deixaria a lista de e-mails de todo mundo no HTML de
             * quem nao pode ver.
             */
            case 'usuarios': {
                if (req.sessao!.papel !== 'admin') {
                    res.status(403).send('Apenas o administrador pode ver quem tem acesso.');
                    return;
                }
                const usuarios = await prisma.user.findMany({
                    orderBy: [{ papel: 'asc' }, { nome: 'asc' }],
                    include: { _count: { select: { sessoes: true } } },
                });
                body = renderUsuarios({
                    euId: req.sessao!.userId,
                    totalAdministradores: usuarios.filter((u) => u.papel === 'admin' && u.ativo).length,
                    usuarios: usuarios.map((u) => ({
                        id: u.id,
                        email: u.email,
                        nome: u.nome,
                        papel: u.papel,
                        ativo: u.ativo,
                        precisaTrocarSenha: u.precisaTrocarSenha,
                        bloqueadoAte: u.bloqueadoAte ? u.bloqueadoAte.toISOString() : null,
                        ultimoLogin: u.ultimoLogin ? u.ultimoLogin.toISOString() : null,
                        criadaEm: u.criadoEm.toISOString(),
                        sessoes: u._count.sessoes,
                    })),
                });
                break;
            }

            case 'calendario': {
                const from = parseDateInput(req.query.from, new Date(new Date().getFullYear(), new Date().getMonth(), 1));
                const to = parseDateInput(req.query.to, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
                const inRange = orders.filter((o) => o.createdAt >= startOfDay(from) && o.createdAt <= endOfDay(to));
                body = renderCalendar({
                    totalOrders: inRange.length,
                    totalRevenue: inRange.reduce((a, o) => a + o.total, 0),
                    // Media por dia usa o mes inteiro, para nao inflar a media
                    // nos primeiros dias do mes.
                    daysInPeriod: Math.round((endOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000) + 1,
                });
                break;
            }

            case 'faturamento': {
                // Tudo que mexe em dinheiro entra numa aba so. A sub-aba inicial
                // vem do param ?aba=, que e' para onde os links antigos de
                // Caixa/Clientes/Relatorios sao reenviados.
                const sub = typeof req.query.aba === 'string' ? req.query.aba : 'resumo';
                const subInicial: 'resumo' | 'caixa' | 'clientes' | 'pedidos' = (
                    ['resumo', 'caixa', 'clientes', 'pedidos'] as const
                ).includes(sub as never)
                    ? (sub as 'resumo' | 'caixa' | 'clientes' | 'pedidos')
                    : 'resumo';

                const [shift, history, customerRows] = await Promise.all([
                    openShift(),
                    shiftHistory(30),
                    customerList(),
                ]);

                const dayStartF = startOfDay(new Date());
                const hojeOrders = orders.filter((o) => o.createdAt >= dayStartF);
                const receitaHoje = Math.round(hojeOrders.reduce((a, o) => a + o.total, 0) * 100) / 100;

                const relDe = parseDateInput(req.query.from, new Date(Date.now() - 29 * 86400000));
                const relAte = parseDateInput(req.query.to, new Date());
                const relStatus =
                    typeof req.query.status === 'string' && VALID_ORDER_STATUS.includes(req.query.status)
                        ? req.query.status
                        : undefined;
                const filtrados = orders.filter(
                    (o) =>
                        o.createdAt >= startOfDay(relDe) &&
                        o.createdAt <= endOfDay(relAte) &&
                        (!relStatus || o.status === relStatus)
                );

                const badge: Record<string, string> = {
                    pendente: 'badge-amber',
                    preparando: 'badge-orange',
                    entrega: 'badge-emerald',
                    concluido: 'badge-slate',
                };

                /*
                 * Uma consulta para resolver o telefone dos pedidos do periodo.
                 * Sem ela a tela mostra "192...@lid" ao lado do numero verdadeiro
                 * da lista de clientes: dois dados sobre a mesma pessoa, discordando.
                 */
                const telefonesDoPeriodo = new Map<string, string>();
                {
                    const jids = [...new Set(filtrados.map((o) => o.clientPhone.trim()).filter(Boolean))];
                    if (jids.length > 0) {
                        const chats = await prisma.chat.findMany({
                            where: { phone: { in: jids } },
                            select: { phone: true, telefone: true },
                        });
                        for (const ch of chats) {
                            if (ch.telefone) telefonesDoPeriodo.set(ch.phone, ch.telefone);
                        }
                    }
                }

                const rowsHtml = filtrados
                    .map(
                        (o) => `<tr>
                            <td class="text-xs ink-3">${escapeHtml(o.createdAt.toLocaleString('pt-BR'))}</td>
                            <td class="font-medium">${escapeHtml(o.clientName || 'Cliente')}</td>
                            <td class="text-xs ink-3">${escapeHtml(
                                o.channel === 'pdv'
                                    ? (o.paymentMethod ?? 'Balcao')
                                    : telefonesDoPeriodo.get(o.clientPhone.trim()) || o.clientPhone.replace('@s.whatsapp.net', '')
                            )}</td>
                            <td class="text-xs max-w-xs truncate">${escapeHtml(o.items)}</td>
                            <td class="text-xs ink-3">${o.discount > 0 ? '- ' + escapeHtml(currency(o.discount)) : ''} ${o.tip > 0 ? '+ ' + escapeHtml(currency(o.tip)) : ''}</td>
                            <td class="font-semibold accent-amber-strong">R$ ${escapeHtml(o.total.toFixed(2))}</td>
                            <td><span class="${badge[o.status] ?? 'badge-slate'} text-xs px-2 py-0.5 rounded-full">${escapeHtml(o.status)}</span></td>
                            <td><span class="${o.channel === 'pdv' ? 'badge-slate' : 'badge-emerald'} text-xs px-2 py-0.5 rounded-full">${o.channel === 'pdv' ? 'PDV' : 'WhatsApp'}</span></td>
                        </tr>`
                    )
                    .join('');

                body = renderFaturamento(
                    {
                        /*
                         * As estatisticas vem do SQL, nao de `computeStats(orders)`:
                         * os numeros sao os mesmos (ver `tests/stats-sql.test.ts`) e
                         * a soma deixa de crescer com o historico.
                         */
                        stats: await computeStatsSql(),
                        report: {
                            rowsHtml,
                            count: filtrados.length,
                            total: filtrados.reduce((a, o) => a + o.total, 0),
                            from: relDe.toISOString().slice(0, 10),
                            to: relAte.toISOString().slice(0, 10),
                            shifts: await shiftHistory(15),
                        },
                        cash: {
                            shift,
                            history,
                            // Turno que a agenda encerrou sem contagem: a Home avisava
                            // que estava pendente sem existir tela para resolver.
                            pending: history.filter((s) => s.difference === null),
                            scheduleOn: config.cashAutoOpen !== '' || config.cashAutoClose !== '',
                            autoOpen: config.cashAutoOpen,
                            autoClose: config.cashAutoClose,
                            hasFloat: config.cashDefaultFloat > 0,
                            todayRevenue: receitaHoje,
                            todayOrders: hojeOrders.length,
                        },
                        customers: { rows: customerRows, summary: summarizeCustomers(customerRows) },
                        todayRevenue: receitaHoje,
                        todayOrders: hojeOrders.length,
                        averageTicket: hojeOrders.length > 0 ? Math.round((receitaHoje / hojeOrders.length) * 100) / 100 : 0,
                        margin: estimateMargin(hojeOrders, products),
                    },
                    subInicial
                );
                break;
            }

            case 'pdv': {
                const todayStart0 = startOfDay(new Date());
                const counterOrders = orders.filter((o) => o.channel === 'pdv');
                const todayCounter = counterOrders.filter((o) => o.createdAt >= todayStart0);
                const categories = categoriasDoCatalogo(products.map((p) => p.category));

                // Modificadores e componentes de combo para o modal do PDV e o card.
                const modifierLinks = await prisma.productModifierGroup.findMany({
                    include: { group: { include: { options: { orderBy: { sortOrder: 'asc' } } } } },
                });
                const groupsByProduct = new Map<string, typeof modifierLinks>();
                for (const link of modifierLinks) {
                    const list = groupsByProduct.get(link.productId) ?? [];
                    list.push(link);
                    groupsByProduct.set(link.productId, list);
                }

                const comboLinks = await prisma.comboItem.findMany({ orderBy: { sortOrder: 'asc' } });
                const combosByProduct = new Map<string, typeof comboLinks>();
                for (const link of comboLinks) {
                    const list = combosByProduct.get(link.comboId) ?? [];
                    list.push(link);
                    combosByProduct.set(link.comboId, list);
                }

                body = renderPdv({
                    products: products.map((p) => ({
                        id: p.id,
                        name: p.name,
                        sku: p.sku,
                        imageUrl: p.imageUrl,
                        price: p.price,
                        costPrice: p.costPrice,
                        category: p.category || 'Geral',
                        description: p.description,
                        isAvailable: p.isAvailable,
                        isCombo: p.isCombo,
                        stock: p.stock,
                        minStock: p.minStock,
                        trackStock: p.trackStock,
                        groups: (groupsByProduct.get(p.id) ?? [])
                            .sort((a, b) => a.sortOrder - b.sortOrder)
                            .map((l) => ({
                                id: l.group.id,
                                name: l.group.name,
                                minSelect: l.group.minSelect,
                                maxSelect: l.group.maxSelect,
                                required: l.group.required,
                                options: l.group.options.map((o) => ({ id: o.id, name: o.name, price: o.price, prefix: o.prefix })),
                            })),
                        comboComponents: (combosByProduct.get(p.id) ?? []).map((c) => ({ componentId: c.componentId, quantity: c.quantity })),
                    })),
                    categories: categories.length ? categories : ['Geral'],
                    todaySales: todayCounter.length,
                    totals: {
                        total: products.length,
                        available: products.filter((p) => p.isAvailable).length,
                        paused: products.filter((p) => !p.isAvailable).length,
                        soldOut: products.filter((p) => p.trackStock && p.stock <= 0).length,
                    },
                    holds: await parkedSales(),
                });
                break;
            }

            case 'estoque': {
                const rows = products.map(toStockRow);
                const wasteSince = new Date();
                wasteSince.setHours(0, 0, 0, 0);
                body = renderInventory({
                    rows,
                    summary: summarize(rows),
                    movements: await recentMovements(30),
                    categories: categoriasDoCatalogo(products.map((p) => p.category)),
                    reorder: reorderList(rows),
                    waste: await wasteSummary(wasteSince),
                    // O catalogo (CRUD de produto) foi do PDV para ca: a entidade
                    // e a mesma, entao tambem o lugar.
                    catalog: {
                        products: products.map((p) => ({
                            id: p.id,
                            name: p.name,
                            sku: p.sku,
                            imageUrl: p.imageUrl,
                            price: p.price,
                            costPrice: p.costPrice,
                            description: p.description,
                            category: p.category || 'Geral',
                            isAvailable: p.isAvailable,
                            trackStock: p.trackStock,
                            stock: p.stock,
                            minStock: p.minStock,
                            isCombo: p.isCombo,
                        })),
                        categories: categoriasDoCatalogo(products.map((p) => p.category)),
                        lowStock: rows.filter((r) => {
                            const s = stockStatus(r);
                            return s === 'zerado' || s === 'baixo';
                        }).length,
                    },
                });
                break;
            }

            case 'marketplace': {
                // iFood e 99Food. O catalogo vem do mesmo `products` do resto da
                // tela -- casar item e' escolher um produto que ja existe, e uma
                // lista propria aqui seria uma segunda lista para manter.
                const [contas, itensIfood, itens99, pedidosIfood, pedidos99] = await Promise.all([
                    listarContas(),
                    listarItensCasados('ifood'),
                    listarItensCasados('99food'),
                    pedidosDoCanal('ifood'),
                    pedidosDoCanal('99food'),
                ]);

                body = renderMarketplace({
                    contas,
                    itens: { ifood: itensIfood, '99food': itens99 },
                    pedidos: { ifood: pedidosIfood, '99food': pedidos99 },
                    temChaveDeCifra: temChaveDeCifra(),
                    produtos: products.map((p) => ({ id: p.id, name: p.name, price: p.price })),
                    // O endereco do webhook vem do host da requisicao, e nao de
                    // um .env: quem cadastra no painel do parceiro digita o que
                    // ve na barra do endereco. Pedir para configurar seria redundante.
                    webhookBase: `${req.protocol}://${req.get('host') ?? 'localhost'}`,
                });
                break;
            }

            case 'whatsapp': {
                // Conexao + textos do bot na mesma tela (eram dois itens).
                body = renderWhatsApp({
                    pair: {
                        state: getConnectionState(),
                        authPath: AUTH_DIR,
                        hasSavedSession: hasSavedSession(),
                    },
                    bot: { mensagens: mapaParaTela() },
                });
                break;
            }
        }

        res.send(
            renderLayout({
                active,
                title: tabHint(active),
                productCount: products.length,
                botOnline: isBotOnline(),
                businessName: config.businessName,
counters: {
                    pdv: products.length,
                    kanban: orders.filter((o) => o.status !== 'concluido').length,
                    estoque: products.filter((p) => p.trackStock && p.stock <= p.minStock).length,
                    // Conversas nao lidas sao sinalizadas no item do WhatsApp
                    // para manter visibilidade sem precisar da aba separada.
                    whatsapp: await totalNaoLidas(),
                },
                body,
                scripts: active === 'whatsapp' ? PAIRING_CLIENT_SCRIPT : undefined,
                sessao: {
                    nome: req.sessao!.nome,
                    email: req.sessao!.email,
                    papel: req.sessao!.papel,
                },
                csrf: csrfDoRequest(req),
            })
        );
    } catch (error) {
        log.error('Erro ao carregar painel administrativo:', error);
        res.status(500).send('Erro interno ao carregar o painel.');
    }
});

/*
 * "0.0.0.0" escuta em todas as interfaces, para o painel abrir no celular da
 * loja. Como ha senha, isso significa "aceitar login de qualquer maquina da
 * rede": o risco e' a senha fraca. "127.0.0.1" corta o acesso de fora.
 */
const HOST = process.env.HOST?.trim() || '0.0.0.0';

/*
 * O servidor guardado por var porque `app.listen()` o devolve: e' ele quem diz
 * quando parou de aceitar conexao. Sem a referencia, o desligamento so poderia
 * matar o processo -- quem estava no meio de um pedido veria a tela girar.
 */
const servidor = app.listen(PORT, HOST, async () => {
    log.info(`Servidor HTTP escutando em ${HOST}:${PORT}`);
    // O endereco que aparece no log e' o que a pessoa digita no navegador. Com
    // 0.0.0.0, mostrar "localhost" mentiria para quem abre de outro aparelho:
    // localhost no celular e' o proprio celular.
    const paraNavegar = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
    log.info(`Dashboard: http://${paraNavegar}:${PORT}/entrar`);
    log.info(`API REST:  http://${paraNavegar}:${PORT}/api/admin`);
    if (HOST === '0.0.0.0' || HOST === '::') {
        /*
         * O aviso e' sobre o que a senha NAO protege: a tela de entrada e' a
         * fronteira, e o mesmo TOKEN vale para quem entra pela rede e por quem
         * entra nesta maquina.
         */
        log.warn(
            'Escutando na rede local. Quem entrar precisa de e-mail e senha, e a sessao vale ' +
                'igual para a rede e para esta maquina -- quem installar em Wi-Fi de loja aberta ' +
                'esta expondo faturamento e caixa. Prefira HOST=127.0.0.1 no .env quando o ' +
                'acesso for so de dentro.'
        );
    }
    log.info('Iniciando o robo do WhatsApp...');

    // A conta de administrador e' a primeira coisa depois de ouvir a porta: sem
    // usuario, o painel inteiro responde 401 e a pessoa nao tem por onde entrar.
    await garanteAdministrador();

    // Sessao vencida e' sessao que sobrou. Limpa no boot e de hora em hora.
    await limpaSessoes();
    setInterval(() => void limpaSessoes(), 60 * 60 * 1000).unref();

    // Textos do bot e cache sao segmentados por loja;
    // no boot local, carrega apenas as mensagens da loja ativa.
    await loadBotMessages(lojaDoBoot());
    // Espelha o estado de conexao do bot para o painel via SSE.
    onConnectionChange((state) => notifyConnection(JSON.stringify(state)));

    // Agenda de abertura/fechamento do caixa: notifica o painel quando um
    // turno abre ou fecha sozinho, para a tela atualizar sem recarregar.
    startCashScheduler(() => notifyClients());

    // Backup no startup e a cada 6h: o negocio inteiro cabe num arquivo SQLite.
    // Aguardado de proposito -- a virada do dia abaixo escreve no banco, e e' o
    // backup do startup que ainda tem o dia anterior, se a poda aprender errado.
    await startBackupScheduler();
    log.info(`Backups em: ${backupDir()}`);

    /*
     * A pasta vem de `DELIVERYADMIN_DATA` e e' criada no boot, nao no primeiro
     * pedido: quem so a cria na primeira venda falha sem aviso quando o disco
     * enche, e o log nem existe para dizer que falhou.
     */
    criaArvoreDeDados();
    log.info(`Dados em: ${DATA_DIR}`);

    /*
     * O primeiro tick roda no boot e e' ele que cobre o servidor que ficou
     * desligado a noite: o corte e' sempre a meia-noite de hoje, entao o
     * resultado e' o mesmo. Cuidado: ele mexe no `dev.db` no primeiro start.
     */
    startPodador();

    // O log vai para arquivo alem do terminal. Quem abre o terminal no meio do
    // expediente ve o que esta acontecendo agora; quem precisa saber o que
    // aconteceu meia hora atras abre o arquivo do dia.
    log.info(`Logs em: ${pastaDeLogs()}`);

    await initBot(notifyClients);
});

/* ---------------------------------------------------------------- Desligar */

/**
 * Desligar sem escrever pela metade: no meio de um pedido, matar o processo
 * deixa venda fantasma. A ordem dos passos e' o que garante isso -- backup
 * depois das requisicoes, e o tempo limite para o desligamento sempre acabar.
 */

/** Quantos segundos cada etapa pode levar antes de o desligamento desistir. */
const LIMITE_POR_ETAPA_MS = 8000;

/**
 * Espera uma promessa, mas nunca para sempre: uma etapa travada segura o
 * processo e o Windows mata a forca depois de dois minutos -- o mesmo resultado
 * que o desligamento existia para evitar.
 */
function comTempoLimite(p: Promise<unknown>, ms: number, rotulo: string): Promise<string> {
    return new Promise((resolve) => {
        let resolvido = false;
        const terminar = (r: string) => {
            if (!resolvido) {
                resolvido = true;
                resolve(r);
            }
        };
        setTimeout(() => terminar(`${rotulo}: passou de ${ms / 1000}s, seguindo`), ms).unref();
        p.then(
            () => terminar(`${rotulo}: ok`),
            (e) => terminar(`${rotulo}: falhou (${e})`)
        );
    });
}

/**
 * A mesma espera, devolvendo booleano: quem decide precisa saber se a porta
 * fechou ou deu timeout, e `comTempoLimite` so devolve um texto para o log.
 */
function fechouDentroDe(p: Promise<unknown>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
        let resolvido = false;
        const terminar = (v: boolean) => {
            if (!resolvido) {
                resolvido = true;
                resolve(v);
            }
        };
        setTimeout(() => terminar(false), ms).unref();
        p.then(
            () => terminar(true),
            () => terminar(false)
        );
    });
}

let desligando = false;

async function desliga(motivo: string): Promise<void> {
    if (desligando) return;
    desligando = true;
    log.info(`Desligando: ${motivo}`);

    /*
     * `server.close()` so resolve quando TODA conexao acaba, e o SSE fica
     * aberto por design -- por isso o close e' chamado ANTES de fechar o SSE: na
     * ordem invertida os dois caem no tempo limite e o desligamento dobra.
     */
    const fechouPorta = new Promise<void>((resolve) => {
        servidor.close(() => resolve());
    });

    // 2. As telas abertas sao avisadas antes de a conexao cair. Esta e' a etapa
    // que destrava a 1.
    const fechadas = fechaClientes('servidor desligando');
    if (fechadas > 0) log.info(`Conexoes ao vivo fechadas: ${fechadas}`);

    // 3. Deixa o que ja entrou terminar -- e' o que mantem a transacao inteira.
    const portaFechada = await fechouDentroDe(fechouPorta, LIMITE_POR_ETAPA_MS);
    log.info(portaFechada ? 'porta HTTP e requisicoes: ok' : `porta HTTP e requisicoes: passou de ${LIMITE_POR_ETAPA_MS / 1000}s, seguindo`);

    /*
     * O que sobra e' socket keep-alive ocioso, nao pedido em andamento: o
     * `res.end()` encerra a resposta mas o socket fica de pe. A janela de 8s ja
     * passou e a porta ja fechou, entao derrubar o que sobrou e' seguro.
     */
    if (!portaFechada) {
        log.warn('A porta nao fechou no tempo; derrubando conexao ociosa que sobrou.');
        servidor.closeAllConnections?.();
        log.info(await comTempoLimite(fechouPorta, 2000, 'porta HTTP apos forc'));
    }

    // 4. Backup com o sistema quieto: e' a copia que representa o estado real.
    try {
        const arquivo = await backupNow();
        log.info(arquivo ? `Backup final: ${arquivo}` : 'Backup final: nao houve nada a copiar');
    } catch (e) {
        log.error('Falha no backup final:', e);
    }

    // 5. As duas conexoes que ficam abertas mesmo com o HTTP fechado.
    try {
        if (await desconectaBot()) log.info('WhatsApp desconectado, sessao preservada');
    } catch (e) {
        log.error('Falha ao fechar o socket do WhatsApp:', e);
    }
    try {
        await prisma.$disconnect();
        log.info('Banco fechado');
    } catch (e) {
        log.error('Falha ao fechar o banco:', e);
    }

    log.info('Desligado.');
    process.exit(0);
}

// SIGINT e' o Ctrl+C no terminal. SIGTERM e' o que o Linux manda no `kill` e no
// logoff, e no Windows chega pelo Ctrl+C tambem.
process.on('SIGINT', () => void desliga('SIGINT (Ctrl+C)'));
process.on('SIGTERM', () => void desliga('SIGTERM'));

/*
 * Desligamento por HTTP porque no Windows `Stop-Process` nao entrega SIGTERM e
 * quem para programaticamente nao tem console. Fora de `/api/admin` de proposito:
 * quem chama e' o programa, entao o unico pedido e' o token, que vem do ambiente.
 */
app.post('/api/servico/desligar', (req, res) => {
    const esperado = process.env.DELIVERYADMIN_SHUTDOWN_TOKEN ?? '';
    const recebido = String(req.headers['x-shutdown-token'] ?? '');

    if (!esperado) {
        res.status(403).json({
            error: 'Desligamento remoto desativado: a variavel DELIVERYADMIN_SHUTDOWN_TOKEN nao foi definida.',
        });
        return;
    }

    /*
     * `===` devolve falso assim que os tamanhos diferem, e esse tempo de
     * resposta e' o que deixa adivinhar o token byte a byte. O
     * `timingSafeEqual` exige o mesmo tamanho de entrada -- a defesa e' cheap.
     */
    const a = Buffer.from(recebido);
    const b = Buffer.from(esperado);
    const confere = esperado && a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!confere) {
        log.warn('Desligamento remoto recusado: token invalido');
        res.status(403).json({ error: 'Token invalido.' });
        return;
    }

    /*
     * Alem do token, so de dentro da maquina: o valor esta no ambiente do
     * processo e um `tasklist /v` de outro usuario da rede o mostra. As duas
     * checagens juntas fecham o caminho; nenhuma sozinha fecha.
     */
    const ip = req.socket.remoteAddress ?? '';
    if (!ip.startsWith('127.') && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
        log.warn(`Desligamento remoto recusado: veio de ${ip}`);
        res.status(403).json({ error: 'Desligamento so aceito desta maquina.' });
        return;
    }

    res.status(202).json({ ok: true, mensagem: 'Servidor desligando.' });
    // Deixa a resposta sair antes de o processo comecar a fechar as conexoes.
    setTimeout(() => void desliga('pedido HTTP local'), 50);
});
