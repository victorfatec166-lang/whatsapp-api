/**
 * Cliente de desktop do DeliveryAdmin.
 *
 * Roda no processo PRINCIPAL do Electron. A janela e' uma barra de itens a esquerda e
 * uma area central que mostra UM destino por vez -- o painel, o iFood ou o 99Food. Nenhum
 * negocio acontece aqui: o painel continua sendo o servidor, e o Electron e' a casca.
 *
 * POR QUE UM PAINEL POR VEZ E NAO DOIS LADO A LADO
 *
 * iFood e 99Food sao aplicacoes de tela cheia. Espremer o painel ao lado delas aperta
 * a coluna de pedidos ate ficar inutilizavel, entao a barra troca o que aparece no
 * centro. Barra sempre visivel e' o que faz o app parecer um app e nao uma pagina com
 * um menu.
 *
 * A barra e' um painel proprio, e nao HTML injetado no painel: o painel vem da nuvem e
 * muda quando a nuvem mudar, e uma barra injetada sumiria no primeiro F5.
 *
 * A URL do painel vem do ambiente e nao esta no codigo: em desenvolvimento e' localhost,
 * e o mesmo executavel aponta para a nuvem sem recompilar.
 */
const path = require('node:path');
const { app, BrowserWindow, Menu, shell, WebContentsView, ipcMain } = require('electron');

/*
 * Falha silenciosa e' o pior defeito de um aplicativo de desktop: o usuario ve a
 * janela nao abrir e nao tem como saber o que aconteceu. O Electron encerra o
 * processo principal numa promessa rejeitada sem dizer nada, entao a promessa
 * rejeitada e a excecao nao tratada viram erro visivel no stderr.
 */
process.on('unhandledRejection', (erro) => {
    console.error('[cliente] promessa rejeitada:', erro);
});
process.on('uncaughtException', (erro) => {
    console.error('[cliente] excecao:', erro);
});

const URL_DO_PAINEL = (process.env.DELIVERYADMIN_URL || 'http://localhost:3000/admin').trim();

const PARTA_CANAL = 'persist:canal';
const LARGURA_BARRA = 56;

/*
 * Os destinos da barra. Cada um abre no centro, um por vez.
 *
 * Endereco no codigo e' a primeira coisa a quebrar: o iFood muda porta e dominio, e um
 * link duro viraria 404 dentro do app sem ninguem perceber de onde veio. As variaveis de
 * ambiente sobrescrevem, que e' como se aponta para homologacao.
 *
 * O WhatsApp Web e' o unico com dois ajustes, e os dois sao obrigatorios:
 *
 * - `parta`: a sessao do WhatsApp nao divide espaco com os canais. Logado nele, o
 *   restante do app leria o `localStorage` da conta -- e sair de uma loja seria sair de
 *   todas.
 * - `userAgent`: a pagina compara o user-agent, ve "Electron" e devolve um aviso de
 *   "use o Chrome 100 ou posterior" que nao tem como dispensar. O Chromium embutido e'
 *   o 140, entao o aviso e' mentira.
 */
const CANAIS = {
    ifood: { rotulo: 'iFood', url: process.env.IFOOD_PAINEL || 'https://merchant.ifood.com.br/' },
    nfood: { rotulo: '99Food', url: process.env.NINETYNINE_PAINEL || 'https://merchant.99food.com.br/' },
    whatsapp: {
        rotulo: 'WhatsApp Web',
        url: 'https://web.whatsapp.com/',
        parta: 'persist:whatsapp',
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        // O QR e' servido por varios subdominios do WhatsApp, entao nao basta a origem
        // exata: barrar o resto deixaria o pareamento sem imagem.
       dominios: ['whatsapp.com', 'whatsapp.net'],
    },
};

/*
 * Atalho numerado por ordem de declaracao: iFood e' 1, 99Food e' 2, WhatsApp e' 3. A
 * ordem vem de `Object.entries`, entao o numero nunca sai de sincronia com a barra --
 * numero escrito a mao no template diverge assim que alguem acrescenta um canal.
 */
const ATALHOS = ['CmdOrCtrl+1', 'CmdOrCtrl+2', 'CmdOrCtrl+3'];

let janela = null;
let viewPainel = null;
let viewBarra = null;

function origemPermitida(url) {
    try {
        return new URL(url).origin === new URL(URL_DO_PAINEL).origin;
    } catch {
        return false;
    }
}

/** Nunca abre `javascript:`, `file:` ou `data:` fora: sao execucao a partir da pagina. */
function abrirExterno(url) {
    if (url.startsWith('https://')) void shell.openExternal(url);
}

/**
 * Regras de uma pagina que carrega conteudo remoto.
 *
 * Os tres `webPreferences` sao o nucleo: `nodeIntegration` ligado daria o Node
 * inteiro a qualquer XSS do painel, e o painel e' remoto. `contextIsolation` separa
 * o preload do contexto, e `sandbox` tira o renderizador dos privilegios do sistema.
 */
function webPreferencesSeguras(extra = {}) {
    return {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        ...extra,
    };
}

/**
 * Empacota um painel para fora da origem dele.
 *
 * `will-navigate` cuida da navegacao dentro da view e `setWindowOpenHandler` do popup.
 * Sem os dois, um link da pagina trocaria o conteudo por qualquer site mantendo as
 * permissoes do cliente -- e `webview` fica bloqueado por ser a porta classica de
 * escapar do sandbox.
 *
 * `permitir` diz quais origens podem ocupar a view. O painel permite so a propria; os
 * canais vao para o navegador, porque eles abrem login e subdomain em outro lugar e
 * barrar isso deixaria o painel do iFood inutilizavel.
 */
function trancarView(view, permitir) {
    view.webContents.setWindowOpenHandler(({ url }) => {
        abrirExterno(url);
        return { action: 'deny' };
    });

    view.webContents.on('will-navigate', (event, url) => {
        if (permitir(url)) return;
        event.preventDefault();
        abrirExterno(url);
    });

    view.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function criarPainel() {
    viewBarra = new WebContentsView({
        webPreferences: webPreferencesSeguras({ preload: path.join(__dirname, 'rail-preload.js') }),
    });
    viewBarra.webContents.loadFile(path.join(__dirname, 'rail.html'));

    viewPainel = new WebContentsView({
        webPreferences: webPreferencesSeguras({ preload: path.join(__dirname, 'preload.js') }),
    });
    viewPainel.webContents.loadURL(URL_DO_PAINEL);
    trancarView(viewPainel, origemPermitida);
    viewPainel.setVisible(true);

    janela.contentView.addChildView(viewBarra);
    janela.contentView.addChildView(viewPainel);
}

/**
 * A view de um canal so' e' criada na primeira vez que o item e' clicado: abrir
 * iFood e 99Food no boot gastaria memoria e mostraria dois logins que ninguem pediu.
 *
 * Cada canal ocupa a largura TODA do centro, e nao uma faixa estreita. O painel do
 * iFood e' uma aplicacao de tela cheia -- numa faixa estreita ela aperta a coluna de
 * pedidos e fica inutilizavel. Por isso a barra TROCA o que aparece no centro, em vez
 * de espremer painel e canal lado a lado.
 */
const viewsCanal = new Map();

/**
 * O que esta no centro agora: 'painel' ou o id de um canal. O estado mora em um
 * lugar so -- a barra e o menu leem daqui e nao guardam copia.
 */
let showing = 'painel';

function mostrarPainel() {
    showing = 'painel';
    for (const v of viewsCanal.values()) v.setVisible(false);
    viewPainel?.setVisible(true);
    viewPainel?.webContents.focus();
    avisarBarra();
}

function mostrarCanal(canal) {
    const alvo = CANAIS[canal];
    if (!alvo) return;

    let view = viewsCanal.get(canal);
    if (!view) {
        view = new WebContentsView({
            webPreferences: webPreferencesSeguras({ partition: alvo.parta ?? PARTA_CANAL }),
        });
        if (alvo.userAgent) view.webContents.setUserAgent(alvo.userAgent);
        view.webContents.loadURL(alvo.url);
        // So a propria origem ocupa a view: login e subdomain sao popup, e vao para
        // o navegador de verdade em vez de trocarem a view por baixo da pessoa.
        trancarView(view, (url) => mesmaFamilia(url, alvo));
        view.setBounds(centro());
        janela.contentView.addChildView(view);
        viewsCanal.set(canal, view);
    }

    showing = canal;
    viewPainel?.setVisible(false);
    for (const [nome, v] of viewsCanal) v.setVisible(nome === canal);
    view.webContents.focus();
    avisarBarra();
}

/** Verdadeiro quando a URL pertence ao destino, no dominio base ou num subdominio dele. */
function mesmaFamilia(url, alvo) {
    try {
        const alvoUrl = new URL(alvo.url);
        const testada = new URL(url);
        if (testada.protocol !== 'https:') return false;
        if (testada.origin === alvoUrl.origin) return true;
        return (alvo.dominios ?? []).some((d) => testada.hostname === d || testada.hostname.endsWith(`.${d}`));
    } catch {
        return false;
    }
}

/** O centro e' tudo que sobra a direita da barra. */
function centro() {
    const b = janela.getContentBounds();
    return { x: LARGURA_BARRA, y: 0, width: b.width - LARGURA_BARRA, height: b.height };
}

/**
 * Recoloca os paineis depois de resize. `setBounds` e' sincrono e o `resize` chega
 * antes da janela assentar, o que fazia a barra piscar e o canal ficar deslocado.
 */
function arrange() {
    if (!janela || !viewBarra) return;
    const b = janela.getContentBounds();
    const area = centro();

    viewBarra.setBounds({ x: 0, y: 0, width: LARGURA_BARRA, height: b.height });
    viewPainel?.setBounds(area);
    for (const v of viewsCanal.values()) v.setBounds(area);
}

function avisarBarra() {
    viewBarra?.webContents.send('conteudo:mudou', showing);
}

function montarMenu() {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: 'Painel',
                submenu: [
                    { role: 'reload', label: 'Recarregar' },
                    { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' },
                    { type: 'separator' },
                    { role: 'quit', label: 'Sair' },
                ],
            },
            {
                label: 'Canais',
                submenu: Object.entries(CANAIS).map(([canal, alvo], i) => ({
                    label: alvo.rotulo,
                    accelerator: ATALHOS[i],
                    click: () => mostrarCanal(canal),
                })),
            },
        ])
    );
}

function registrarIpc() {
    ipcMain.handle('canal:abrir', (_evento, canal) => {
        mostrarCanal(canal);
        return showing;
    });

    ipcMain.handle('painel:ir', () => {
        mostrarPainel();
        viewPainel?.webContents.loadURL(URL_DO_PAINEL);
    });

    ipcMain.handle('painel:recarregar', () => {
        if (showing === 'painel') viewPainel?.webContents.reload();
        else viewsCanal.get(showing)?.webContents.reload();
    });

    ipcMain.handle('app:sair', () => app.quit());
}

function criarJanela() {
    janela = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        backgroundColor: '#0b1220',
        title: 'DeliveryAdmin',
        show: false,
        webPreferences: webPreferencesSeguras(),
    });

    criarPainel();
    arrange();

    janela.on('resize', arrange);
    janela.on('maximize', arrange);
    janela.on('unmaximize', arrange);
    viewPainel.webContents.on('did-finish-load', () => janela.show());
}

// Duas copias do app brigariam pela sessao do canal e pela janela.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!janela) return;
        if (janela.isMinimized()) janela.restore();
        janela.focus();
    });

    app.whenReady().then(() => {
        registrarIpc();
        montarMenu();
        criarJanela();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) criarJanela();
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}