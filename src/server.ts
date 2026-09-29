import express from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import adminRoutes from './routes/adminRoutes';
import comandaRoutes from './routes/comandaRoutes';
import chatRoutes from './routes/chatRoutes';
import marketplaceRoutes from './routes/marketplaceRoutes';
import { addClient, notifyClients, notifyConnection, getClientCount } from './services/sse';
// QR_TTL_MS saiu daqui: era usado para expire o QR antigo, e a sessao do
// Baileys ja resolve isso sozinha. O import nao custava nada, mas deixava
// parecer que o TTL era configuravel por aqui.
import { initBot, sendOrderStatusNotification, isBotOnline, loadBotMessages, reconnectBot, logoutBot, getConnectionState, onConnectionChange, AUTH_DIR } from './services/bot';
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
import { renderChat } from './views/chat';
import { listarContas, listarItensCasados, temChaveDeCifra, type Canal } from './services/marketplace';
import { listarConversas, totalNaoLidas } from './services/chat';
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
import { startCashScheduler, isValidHhMm } from './services/cashSchedule';
import { startBackupScheduler, backupDir } from './services/backup';
import { ensureSku, exportProductsCsv, importProductsFromCsv } from './services/products';
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
import { logDoModulo, pastaDeLogs } from './services/logger';
import { limitador as limitePorJanela } from './services/rateLimit';
const log = logDoModulo('server');

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT) || 3000;

/*
 * Limite de escrita.
 *
 * 30 requisicoes de escrita por 10 segundos. Calibrado contra o pior caso real
 * de uso na tela: uma pessoa cadastrando produto com foto e varios movimento
 * de estoque em sequencia, que e' a rajada mais longa que existe no painel.
 * Acima disso, ou e' gente nao vendo o resultado, ou nao e' pessoa.
 */
const limiteEscrita = limitePorJanela({ max: 30, janelaMs: 10_000 });

/**
 * A partir de quantos pedidos o painel avisa.
 *
 * 2000 e' cerca de seis meses de uma loja media. Antes disso a carga em memoria
 * e' irrelevante; depois disso a visita comeca a custar segundos, e o aviso
 * entra no log antes de alguem notar a lentidao. Ver o bloco em /admin.
 */
const AVISO_VOLUME_PEDIDOS = 2000;

const VALID_ORDER_STATUS: string[] = [...ORDER_STATUSES];

/*
 * Corpo cru do webhook de marketplace, montado a ma'os.
 *
 * Precisa vir ANTES do express.json, e a ordem aqui e o que faz isso funcionar:
 * o body-parser marca o corpo como lido, entao o parser seguinte nao ve mais nada
 * e a rota receberia um objeto ja desserializado. Com o raw primeiro, a rota
 * recebe o Buffer com o texto original -- que e' o unico texto que a assinatura
 * cobre, porque re-serializar o JSON muda a ordem das chaves e o HMAC deixa de
 * bater.
 *
 * O comentario original dizia "precisa vir antes de qualquer parser" e estava
 * montado DEPOIS do express.json. O resultado era body-parser recusando o corpo
 * com 400 antes da rota rodar, e a confericao de assinatura nunca acontecia:
 * nao era o marketplace sendo barrado, era um erro de montagem.
 *
 * Sem `verify`: um corpo que nao e JSON nao e barrado aqui, e sim na rota, que
 * responde 401 pelo caminho de assinatura/json. Barrar no parser daria um 400
 * generico e, pior, indicaria um problema de transporte onde o problema real e'
 * assinatura invalida -- que e' a unica coisa que este endpoint precisa dizer.
 */
app.use(
    '/webhook/marketplace',
    express.raw({ type: ['application/json', 'application/*+json'], limit: '2mb' })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

/*
 * Limite de requisicoes nas rotas que escrevem.
 *
 * Montado aqui, e nao dentro de cada router, por dois motivos: a lista do que
 * protege fica num lugar so, e uma rota nova nasce protegida sem ninguem
 * lembrar.
 *
 * Escrita e' o que tem limite apertado. Ler nao tem limite nenhum de proposito:
 * quem abre o painel atualiza o Kanban, o estoque e o caixa na mesma visita, e
 * um limite de leitura derrubaria a tela no meio do expediente sem impedir
 * nada de ruim.
 *
 * Os numeros nao sao regulationos de seguranca, sao o ponto em que um laco
 * comeca a fazer estrago antes de alguem perceber. Uma pessoa com o dedo na
 * tela nao chega perto: digitar no campo de mensagem e' uma requisicao por
 * tecla, e o limite de envio esta bem acima disso.
 */
app.use('/api/admin', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    return limiteEscrita(req, res, next);
});

// Fotos de produto ficam em public/uploads e sao servidas estaticamente.
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads'), { maxAge: '7d' }));
// CSS compilado do design system (saida de `npm run build:css`).
// Sem maxAge longo de proposito: o arquivo nao tem hash no nome, e um cache
// fixo serviria estilo velho depois de uma recompilacao. O ETag padrao do
// Express resolve com 304 cheaply.
app.use('/styles', express.static(path.join(process.cwd(), 'dist', 'styles'), { etag: true, lastModified: true }));
app.use('/api/admin', adminRoutes);
// Comanda da cozinha: saida para a impressora, com vida propria. Ver o
// arquivo para por que a impressao em si nao acontece aqui.
app.use('/api/admin', comandaRoutes);
// Conversas do WhatsApp. Montado em /api/admin porque quem chama e' o painel, e
// nao um parceiro -- ver a nota sobre a falta de senha em chatRoutes. As rotas
// do arquivo sao relativas a este prefixo.
app.use('/api/admin', chatRoutes);
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

async function getConfig() {
    const existing = await prisma.config.findUnique({ where: { id: 'default' } });
    if (existing) return existing;
    return prisma.config.create({
        data: { id: 'default' },
    });
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

/* A coluna "Concluidos" e filtrada por dia na renderizacao do Kanban
   (ver case 'kanban'), entao nao ha job de meia-noite: resetar o status dos
   pedidos contaminaria os relatorios e devolveria itens a coluna de pendentes.
   Se a loja quiser o dia Cortado antes da meia-noite, basta ajustar o
   startOfToday gerado em renderKanbanData. */

/* ------------------------------------------------------- API do dashboard */

app.get('/api/bot-status', (_req, res) => {
    res.json({ online: isBotOnline(), sseClients: getClientCount() });
});

/**
 * Tem sessao salva no disco?
 *
 * Procura `creds.json` pelo nome exato, e nao "qualquer .json". A pasta ganha
 * outros arquivos ao lado das chaves -- a marcacao de maquina, por exemplo --
 * e um "tem arquivo .json" responderia verdadeiro mesmo sem sessao pareada,
 * o que faria a tela mandar para um QR que nao tem o que parear.
 */
function hasSavedSession(): boolean {
    try {
        return fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).some((f) => f === 'creds.json');
    } catch {
        return false;
    }
}

app.get('/api/bot/connection', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getConnectionState());
});

/**
 * QR renderizado como SVG no servidor. O texto do QR nunca sai do servidor
 * alem do navegador que abriu o painel, e o no-store impede caching.
 */
app.get('/api/bot/qr.svg', async (_req, res) => {
    try {
        const state = getConnectionState();
        if (!state.qr) {
            res.status(404).type('text/plain').send('sem QR disponivel');
            return;
        }
        const svg = await QRCode.toString(state.qr, {
            type: 'svg',
            margin: 1,
            width: 260,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000ff', light: '#ffffffff' },
        });
        res.setHeader('Cache-Control', 'no-store');
        res.type('image/svg+xml').send(svg);
    } catch (error) {
        log.error('Erro ao gerar QR:', error);
        res.status(500).type('text/plain').send('erro ao gerar QR');
    }
});

app.get('/api/calendar/orders', async (_req, res) => {
    try {
        const orders = await prisma.order.findMany({ orderBy: { createdAt: 'asc' } });
        const grouped: Record<
            string,
            { date: string; orders: OrderWithProductless[]; totalRevenue: number; count: number; byStatus: Record<string, number> }
        > = {};

        for (const order of orders) {
            const key = order.createdAt.toISOString().slice(0, 10);
            if (!grouped[key]) {
                grouped[key] = {
                    date: key,
                    orders: [],
                    totalRevenue: 0,
                    count: 0,
                    byStatus: { pendente: 0, preparando: 0, entrega: 0, concluido: 0 },
                };
            }
            grouped[key].orders.push(order);
            grouped[key].totalRevenue += order.total;
            grouped[key].count += 1;
            grouped[key].byStatus[order.status] = (grouped[key].byStatus[order.status] ?? 0) + 1;
        }
        res.json(grouped);
    } catch (error) {
        log.error('Erro ao buscar pedidos para calendario:', error);
        res.status(500).json({ error: 'Erro ao buscar pedidos' });
    }
});

app.get('/api/calendar.js', (_req, res) => {
    res.type('application/javascript').send(`
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let ordersByDate = {};

const MONTHS = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const WEEKDAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];

function esc(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
    const label = document.getElementById('monthYear');
    if (!grid || !label) return;

    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();
    const startDay = new Date(currentYear, currentMonth, 1).getDay();
    const today = new Date();

    label.textContent = MONTHS[currentMonth] + ' ' + currentYear;

    let html = '';
    for (let i = 0; i < startDay; i++) html += '<div class="p-1"></div>';

    for (let day = 1; day <= totalDays; day++) {
        const iso = currentYear + '-' + String(currentMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const data = ordersByDate[iso];
        const count = data ? data.count : 0;
        const revenue = data ? data.totalRevenue : 0;
        const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();

        const base = 'p-2 min-h-[4.5rem] rounded-lg border cursor-pointer transition flex flex-col gap-0.5 ';
        const tone = isToday ? 'border-amber-500 ring-1 ring-amber-500 ' : (count ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 ' : 'border-stone-200 dark:border-stone-700 ');

        html += '<div class="' + base + tone + '" onclick="showDayOrders(\\'' + iso + '\\')" title="' + esc(iso) + '">';
        html += '<span class="text-sm font-bold ' + (isToday ? 'text-amber-600 dark:text-amber-400' : '') + '">' + day + '</span>';
        if (count) {
            html += '<span class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">' + count + ' ped.</span>';
            html += '<span class="text-[11px] text-stone-500 dark:text-stone-400">R$ ' + revenue.toFixed(2) + '</span>';
        }
        html += '</div>';
    }
    grid.innerHTML = html;
}

window.changeMonth = function (delta) {
    currentMonth += delta;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
};

window.showDayOrders = function (iso) {
    const box = document.getElementById('dayOrders');
    if (!box) return;
    const data = ordersByDate[iso];
    if (!data || !data.orders.length) {
        box.innerHTML = '<p class="ink-3 text-sm">Nenhum pedido neste dia.</p>';
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

fetchOrdersForCalendar();
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
         * Forma primeiro, regra depois.
         *
         * O schema confere a FORMA: se items e' lista, se cada linha tem id, se
         * a quantidade e' numero. A REGRA continua com o priceCart logo abaixo:
         * se o produto existe, se esta disponivel, se o modificador pertence ao
         * produto e quanto custa. Nao misturei as duas coisas, e de proposito --
         * o preco nunca veio do navegador e nao vai passar a vir.
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
         * Pedido e baixa de estoque no mesmo commit.
         *
         * Antes eram dois: prisma.order.create() e depois registerSale(), que
         * abria a transacao dela. Se o estoque falhasse, o pedido ficava
         * gravado e o sistema contava uma venda que nao tinha baixado nada.
         * createOrderWithStock faz as duas coisas juntas, entao agora nao existe
         * esse estado intermediario.
         *
         * O preco continua sendo calculado acima, por computeTotals, sobre as
         * linhas que priceCart ja precificou a partir do banco. Este bloco
         * so grava.
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
         * shortfalls sao itens que venderam com saldo insuficiente. A venda foi
         * concluida de proposito: recusar um pedido no meio do almoço por causa
         * de um saldo velho custa mais caro do que vender e avisar. O caixa ve
         * isto na resposta e pode repor na hora.
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
                where: { productId_groupId: { productId, groupId } },
                update: {},
                create: { productId, groupId, sortOrder: count },
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
                data: { comboId, componentId: unique[i], quantity: qty, sortOrder: i },
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

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'produtos');
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
        // A sessao em disco e apagada para que o proximo pareamento comece do zero.
        // Apaga TUDO da pasta, e nao so os .json: a marcacao de maquina tambem
        // precisa ir, senao o proximo pareamento nasceria ja marcado com a
        // identidade da sessao que acabou de ser desfeita. Ver src/services/maquina.ts.
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

app.post('/admin/config/save', async (req, res) => {
    try {
        const b = req.body ?? {};
        const data = {
            // Sem fallback hardcoded: um nome inventado ("DeliveryAdmin") e o
            // que aparecia no logo antes de o dono preencher a configuracao.
            businessName: String(b.businessName ?? '').trim(),
            /*
             * minOrderValue, estimatedPrepMinutes e pixKey sairam daqui.
             *
             * Nenhum dos tres era lido por nada: o bot criava pedido sem checar
             * valor minimo, o tempo de preparo nao aparecia em mensagem nenhuma,
             * e a chave PIX so era lida pelo checklist da Home -- que marcava
             * "configurada" sem nunca ter chegado ao cliente. Continuar
             * gravando os tres dava a impressao de que a tela os controlava.
             *
             * As sete colunas foram removidas do schema na migration
             * 20260928173000_remove_colunas_config_sem_uso, junto com
             * originAddress, baseFee, feePerKm e googleApiKey. O motivo de cada
             * grupo esta no comentario do model Config, em schema.prisma.
             */
            // Agenda do caixa: horario invalido vira vazio (desativado) em vez
            // de ser gravado e nunca casar no agendador.
            cashAutoOpen: isValidHhMm(b.cashAutoOpen) ? String(b.cashAutoOpen).trim() : '',
            cashAutoClose: isValidHhMm(b.cashAutoClose) ? String(b.cashAutoClose).trim() : '',
            cashDefaultFloat: Math.max(0, toNumber(b.cashDefaultFloat, 0)),
        };

        await prisma.config.upsert({
            where: { id: 'default' },
            update: data,
            create: { id: 'default', ...data },
        });

        res.json({ success: true });
    } catch (error) {
        log.error('Erro ao salvar configuracoes:', error);
        res.status(500).json({ error: 'Erro ao salvar configuracoes' });
    }
});

const ALLOWED_MESSAGE_KEYS = Object.keys(DEFAULT_BOT_MESSAGES);

/**
 * Salva as mensagens editadas.
 *
 * So as chaves que VIERAM no corpo sao tocadas, e nunca a lista inteira. A
 * versao anterior gravava as 15 chaves com o que veio no formulario -- e, como
 * a tela mostrava os campos vazios para quem nunca editou nada, salvar uma
 * unica mensagem apagaria as outras catorze da tabela. Como o valor vazio caia
 * no padrao por acidente (o `||` do cache), o bot continuava mandando texto --
 * mas a tela ficava mostrando "sem edicao" para tudo, e a proxima vez que
 * alguém editasse ia apagar de novo.
 *
 * Agora a regra e' explicita: campo vazio e' "usar o padrao", e a funcao
 * `salvarMensagem` apaga a linha. Nao e' um efeito colateral do `||`.
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
 * Volta as mensagens aos padroes.
 *
 * Um botao so para as 15, porque a pergunta "qual mensagem eu alterei?" e' a
 * que a pessoa faz quando o bot comeca a falar uma coisa estranha. O caminho
 * longo e' apagar as edicoes uma a uma; este e' para quando o estrago foi geral.
 *
 * Some com as edicoes de verdade, e nao grava o texto padrao por cima. Ver
 * `restaurarMensagem`.
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

        // `botMessage.findMany()` saiu daqui. As mensagens do bot so' interessam
        // a aba do WhatsApp, e la' o texto vem de `mapaParaTela()`, que ja
        // le' o banco. Trazer as linhas em toda visita ao painel era uma
        // consulta a mais em cada pagina por um dado que quase ninguem abre.
        const [products, orders, config] = await Promise.all([
            prisma.product.findMany({ orderBy: { createdAt: 'asc' } }),
            prisma.order.findMany({ orderBy: { createdAt: 'desc' } }),
            getConfig(),
        ]);

        /*
         * Todos os pedidos ainda sao carregados em memoria, em toda visita.
         *
         * As ESTATISTICAS ja foram movidas para o banco (`computeStatsSql`,
         * em src/services/statsSql.ts), que e' onde estava o custo de verdade: as
         * somas e os agrupamentos saem de 4 mil linhas para 4. O que sobra
         * aqui sao as listas que a tela desenha -- kanban, calendario, relatorio
         * do periodo -- e cada uma delas tem uma janela que a tela ja impunha.
         *
         * A carga sem limite que restou e' a que o aviso abaixo mede.
         *
         * O numero que faz a conta: 300 pedidos por mes, ~250 bytes cada, sao
         * 900 KB por pagina em um ano.
         *
         * A parte de TRUNCAR a lista continua fora de proposito, e agora por um
         * motivo concreto: a receita total vem do SQL (`computeStatsSql`), e
         * cortar esta lista afetaria o que as telas DESENHAM -- kanban, calendario
         * -- sem mexer no total. Ou seja, o numero de dinheiro ficaria certo e o
         * kanban perderia pedidos, que e' pior: a pessoa que olha a tela acredita
         * que a coluna esta vazia, e o pedido existe.
         *
         * A solucao para o que resta e' dar janela por tela, com o filtro que a
         * tela ja aplica, e nao um limite global. E' trabalho de tela por tela,
         * e o aviso abaixo continua ate la: um aviso no log e' de graca, porque
         * o dia que o painel comecar a demorar, o log ja diz por que.
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
                    businessName: config.businessName,
                    cashAutoOpen: config.cashAutoOpen,
                    cashAutoClose: config.cashAutoClose,
                    cashDefaultFloat: config.cashDefaultFloat,
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
                 * Telefone resolvido por endereco, para a coluna de cliente.
                 *
                 * Uma consulta para os enderecos deste periodo, indexada em
                 * memoria. Sem ela, a lista de pedidos mostraria "192...@lid"
                 * ao lado da lista de clientes mostrando o numero verdadeiro --
                 * dois dados sobre a mesma pessoa, na mesma tela, discordando.
                 *
                 * O endereco continua no pedido: e' ele que o bot usa para
                 * responder. Aqui e' so o que se mostra.
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
                         * As estatisticas vem do banco, nao de `computeStats(orders)`.
                         *
                         * A receita total, o "mais vendidos" e os graficos sao os
                         * mesmos numeros -- `tests/stats-sql.test.ts` compara os
                         * dois calculos campo a campo sobre o banco real. A
                         * diferenca e' que a soma acontece em SQL, entao o custo
                         * nao cresce com o historico.
                         *
                         * `orders` continua sendo carregado abaixo para a LISTA do
                         * relatorio, que e' a tabela da tela, e nao e' truncada.
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
                const categories = [...new Set(products.map((p) => p.category || 'Geral'))].sort();

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
                    categories: [...new Set(products.map((p) => p.category || 'Geral'))].sort(),
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
                        categories: [...new Set(products.map((p) => p.category || 'Geral'))].sort(),
                        lowStock: rows.filter((r) => {
                            const s = stockStatus(r);
                            return s === 'zerado' || s === 'baixo';
                        }).length,
                    },
                });
                break;
            }

            case 'chat': {
                // A lista vem do servidor, mas abrir e enviar vao por fetch: a
                // tela nunca recarrega, para nao perder o que a pessoa esta
                // digitando -- que e' justamente o conteudo desta tela.
                body = renderChat({
                    conversas: await listarConversas(),
                    naoLidas: await totalNaoLidas(),
                    botOnline: isBotOnline(),
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
                    // O endereco do webhook e' montado a partir do host da
                    // requisicao, e nao de um .env: quem cadastra o endereco
                    // no painel do parceiro e' a pessoa, e ela digita o que o
                    // navegador mostra. Montar aqui evita a tela pedir para
                    // configurar algo que ela acaba de ver na barra de endereco.
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
                    // Conversas nao lidas, no mesmo formato dos outros
                    // contadores da sidebar. E' o unico contador que muda sozinho
                    // enquanto a pessoa trabalha em outra aba, entao e' ele que
                    // faz a aba de chat parecer viva.
                    chat: active === 'chat' ? undefined : await totalNaoLidas(),
                },
                body,
                scripts: active === 'whatsapp' ? PAIRING_CLIENT_SCRIPT : undefined,
            })
        );
    } catch (error) {
        log.error('Erro ao carregar painel administrativo:', error);
        res.status(500).send('Erro interno ao carregar o painel.');
    }
});

/*
 * Endereco de escuta.
 *
 * Padrao "0.0.0.0": todas as interfaces, o que permite abrir o painel pelo
 * celular ou por outro computador da loja. E' o que o dono precisa e tambem o
 * que expoe receita, caixa e conversas para qualquer maquina da mesma rede --
 * e o painel ainda nao tem senha, o que era decisao de desenvolvimento.
 *
 * "127.0.0.1" deixa o painel so nesta maquina. Quem usa o PDV no balcao e nao
 * precisa de acesso de fora tem aqui o corte de uma linha no .env.
 */
const HOST = process.env.HOST?.trim() || '0.0.0.0';

app.listen(PORT, HOST, async () => {
    log.info(`Servidor HTTP escutando em ${HOST}:${PORT}`);
    // O endereco que aparece no log e' o que a pessoa digita no navegador. Com
    // 0.0.0.0, mostrar "localhost" mentiria para quem abre de outro aparelho:
    // localhost no celular e' o proprio celular.
    const paraNavegar = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
    log.info(`Dashboard: http://${paraNavegar}:${PORT}/admin`);
    log.info(`API REST:  http://${paraNavegar}:${PORT}/api/admin`);
    if (HOST === '0.0.0.0' || HOST === '::') {
        log.warn(
            'Escutando na rede local SEM SENHA: qualquer maquina da mesma rede que saiba a porta ' +
                PORT + ' ve o faturamento e pode escrever no sistema. Defina HOST=127.0.0.1 no .env ' +
                'se o acesso e so desta maquina.'
        );
    }
    log.info('Iniciando o robo do WhatsApp...');

    await loadBotMessages();
    // Espelha o estado de conexao do bot para o painel via SSE.
    onConnectionChange((state) => notifyConnection(JSON.stringify(state)));

    // Agenda de abertura/fechamento do caixa: notifica o painel quando um
    // turno abre ou fecha sozinho, para a tela atualizar sem recarregar.
    startCashScheduler(() => notifyClients());

    // Backup do banco: uma copia no startup e outra a cada 6h. O negocio todo
    // cabe num arquivo SQLite, e perder esse arquivo nao tem conserto.
    startBackupScheduler();
    log.info(`Backups em: ${backupDir()}`);

    // O log vai para arquivo alem do terminal. Quem abre o terminal no meio do
    // expediente ve o que esta acontecendo agora; quem precisa saber o que
    // aconteceu meia hora atras abre o arquivo do dia.
    log.info(`Logs em: ${pastaDeLogs()}`);

    await initBot(notifyClients);
});
