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
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, shell, WebContentsView, ipcMain } = require('electron');

const { atualiza, volta, nuvem } = require('./atualiza');
const { pastaDeDados, urlDoBanco, garanteBancoInicial, idDaLoja } = require('./dados');

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

/**
 * Le o `.env` da raiz do projeto antes de ler o ambiente.
 *
 * O servidor ja faz isso em `src/services/paths.ts`, e sem o mesmo passo aqui o
 * cliente ignorava o arquivo: `process.env.DELIVERYADMIN_URL` chegava vazio do
 * duplo clique e o painel abria em `localhost` mesmo com a URL escrita no `.env`.
 */
function leEnvDoProjeto() {
    let texto;
    try {
        texto = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    } catch {
        return;
    }
    for (const linha of texto.split('\n')) {
        const limpa = linha.trim();
        if (limpa === '' || limpa.startsWith('#')) continue;
        const igual = limpa.indexOf('=');
        if (igual < 1) continue;
        const chave = limpa.slice(0, igual).trim();
        if (process.env[chave] !== undefined) continue;
        let valor = limpa.slice(igual + 1).trim();
        const comAspas =
            valor.length > 1 &&
            ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'")));
        process.env[chave] = comAspas ? valor.slice(1, -1) : valor;
    }
}

leEnvDoProjeto();

/**
 * A chave de cifra da loja.
 *
 * Sem `CHANNEL_SECRET` o sistema recusa guardar a credencial do iFood e a chave do
 * relay, e a loja descobriria isso so quando tentasse configurar o canal. Ela e' de
 * cada maquina: nasce na primeira abertura e fica na area do dado, ao lado do banco.
 * Perder esse arquivo deixa as credenciais antigas ilegiveis -- por isso ele nao sai
 * do `%APPDATA%` e nunca e' versionado.
 */
function segredoDeCifra() {
    const doAmbiente = (process.env.CHANNEL_SECRET || '').trim();
    if (doAmbiente) return doAmbiente;

    const pasta = pastaDeDados();
    const arquivo = path.join(pasta, 'chave-de-cifra.txt');
    try {
        const guardado = fs.readFileSync(arquivo, 'utf8').trim();
        if (guardado.length >= 32) return guardado;
    } catch {
        // Primeira abertura: ainda nao existe, e isso e' o normal.
    }

    const novo = crypto.randomBytes(32).toString('base64url');
    try {
        fs.mkdirSync(pasta, { recursive: true });
        fs.writeFileSync(arquivo, novo, 'utf8');
    } catch (erro) {
        console.error('[cliente] nao deu para guardar a chave de cifra:', erro.message);
    }
    return novo;
}

/** A primeira porta livre a partir da base. Duas copias do cliente brigariam se fixo. */
function portaLivre(base) {
    const net = require('node:net');
    return new Promise((resolve) => {
        const teste = net.createServer();
        teste.once('error', () => resolve(portaLivre(base + 1)));
        teste.once('listening', () => teste.close(() => resolve(base)));
        teste.listen(base, '127.0.0.1');
    });
}

/** O sistema respondeu? `GET /entrar` e' a tela que existe antes de qualquer sessao. */
async function responde(url, tentativasRestantes) {
    try {
        const controle = new AbortController();
        const relogio = setTimeout(() => controle.abort(), 2500);
        const resposta = await fetch(url + '/entrar', { signal: controle.signal });
        clearTimeout(relogio);
        return resposta.ok;
    } catch {
        if (tentativasRestantes <= 0) return false;
        await new Promise((r) => setTimeout(r, 700));
        return responde(url, tentativasRestantes - 1);
    }
}

/**
 * Sobe o sistema empacotado e devolve a URL do painel local.
 *
 * O servidor roda no proprio executavel com `ELECTRON_RUN_AS_NODE`: e' o mesmo
 * executavel que o usuario abriu, e por isso nao precisa de `node.exe` na maquina. A
 * espera e' pelo HTTP e nao pelo processo: o servidorAvisa assim que `escutando`, e
 * um `exit` sem erro nenhum significaria janela aberta sem sistema atras.
 */
async function sobeServidor() {
    const entrada = path.join(PASTA_SERVIDOR, 'dist', 'server.js');
    if (!fs.existsSync(entrada)) {
        throw new Error('o sistema nao esta no pacote do programa (' + entrada + ')');
    }

    const porta = await portaLivre(Number(process.env.DELIVERYADMIN_PORTA) || PORTA_PADRAO);
    const url = 'http://127.0.0.1:' + porta;

    /*
     * O banco e' arquivo e o sistema so aceita `file:` quando sabe que e' local: sem
     * estas duas variaveis o processo sobe, conecta e morre na primeira consulta. A
     * loja do boot vem do `loja.txt`, que a migracao escreve -- e nao do `.env` de
     * desenvolvimento, que apontaria para a outra loja.
     */
    garanteBancoInicial();

    const filho = spawn(process.execPath, [entrada], {
        cwd: PASTA_SERVIDOR,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            HOST: '127.0.0.1',
            PORT: String(porta),
            CHANNEL_SECRET: segredoDeCifra(),
            DELIVERYADMIN_NUVEM: nuvem(),
            DELIVERYADMIN_DATA: pastaDeDados(),
            DELIVERYADMIN_TENANT: idDaLoja(),
            DATABASE_URL: urlDoBanco(),
            MODO_LOCAL: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    processoServidor = filho;
    filho.on('exit', servidorCaiu);

    for (const fluxo of [filho.stdout, filho.stderr]) {
        fluxo?.on('data', (d) => process.stdout.write('[sistema] ' + d));
    }

    if (await responde(url, 40)) return url;
    throw new Error('o sistema local nao respondeu em ' + url);
}

/**
 * Sobe o sistema, e se a versao que acabou de descer nao levantar, volta a anterior.
 *
 * Uma unica tentativa de volta, de proposito: se a versao antiga tambem nao subir, o
 * problema nao e' do deploy e insistir so' gasta a abertura da loja. O que resta e'
 * mostrar a tela que explica.
 */
async function sobeServidorOuVolta() {
    try {
        return await sobeServidor();
    } catch (erro) {
        console.error('[cliente] o sistema local nao subiu:', erro.message);
        if (!volta()) throw erro;
        return await sobeServidor();
    }
}

/**
 * O painel mora NA MAQUINA DA LOJA, e a nuvem nao entra nessa conta.
 *
 * O sistema vem dentro do proprio programa: o `main.js` sobe o servidor empacotado
 * como processo Node (o proprio executavel, com `ELECTRON_RUN_AS_NODE`) e a janela
 * abre `127.0.0.1`. O que continua na nuvem e' fila do iFood, assinatura e conta --
 * e o `atualiza.js` e' quem traz o codigo novo de la.
 *
 * `DELIVERYADMIN_URL` continua valendo para desenvolvimento: apontar o cliente para um
 * servidor que ja' esta' no ar e' como se olha o log de boot sem abrir duas janelas.
 */
const PORTA_PADRAO = 3977;

const PASTA_SERVIDOR = path.join(__dirname, 'servidor');

/** A URL do painel: preenchida em `sobeServidor`, antes de qualquer view existir. */
let URL_DO_PAINEL = (process.env.DELIVERYADMIN_URL || '').trim();

/** O processo do sistema. Vive aqui para ser derrubado junto com a janela. */
let processoServidor = null;

function ehLocal(url) {
    try {
        const h = new URL(url).hostname;
        return h === 'localhost' || h === '127.0.0.1' || h === '::1';
    } catch {
        return false;
    }
}

const PARTA_CANAL = 'persist:canal';
const LARGURA_BARRA = 58;

/*
 * Medido no Electron: a faixa do Windows fica ACIMA da area web, nao sobre ela
 * (`getContentBounds().y - getBounds().y = 31`). O `ALTURA_TITULO` que existia aqui
 * virava tarja de verdade -- 38px de fundo entre o topo e o painel. Antes do `y: 0`
 * o cabecalho do SaaS nao encostava no topo da janela.
 */
const ALTURA_TITULO = 38;

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
    /*
     * `parceiros.ifood.com.br` e' o painel do RESTAURANTE, e e' o que o dono precisa.
     * `merchant.ifood.com.br` foi a porta antiga e hoje responde 302 para o site do
     * cliente final -- quem usava a URL antiga via o iFood de quem COMPRA, e nao o
     * painel da loja. O sistema e' para restaurante, entao o destino e' o de parceiro.
     */
    ifood: {
        rotulo: 'iFood',
        url: process.env.IFOOD_PAINEL || 'https://parceiros.ifood.com.br/',
        /*
         * O painel do parceiro autentica em `autenticacao.ifood.com.br` e devolve para
         * o painel em subdomain proprio. Sem estas entradas na familia, o
         * `will-navigate` barra a propria navegacao do iFood e manda o dono para o
         * Chrome -- onde ele nao esta logado e o cliente nao enxerga a sessao.
         */
        dominios: ['parceiros.ifood.com.br', 'ifood.com.br'],
    },
    /*
     * O 99Food nao tem um "merchant" proprio: o login acontece em
     * `page.didiglobal.com` (a pagina de login da DiDi) e devolve para
     * `merchant.99app.com`, que e' onde o restaurante ve os pedidos. Os dois precisam
     * estar na familia: barrar a pagina de login deixaria o painel pedindo senha
     * para sempre, e e' a razao de o 99Food "voltar para o Chrome".
     */
    nfood: {
        rotulo: '99Food',
        url:
            process.env.NINETYNINE_PAINEL ||
            'https://page.didiglobal.com/pc-login-page/4.0.1/index.html?source=200108&appid=200108&role=13&country_id=76&theme=yellow&lang=pt-BR',
        dominios: ['didiglobal.com', '99app.com', '99food.com.br'],
    },
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
 * `permitir` diz quais origens podem ocupar a view. O painel permite so a propria.
 *
 * `dentroDaView` e' o que mantem o iFood e o 99Food ABRINDO NO CLIENTE: o login deles
 * acontece em `autenticacao.ifood.com.br` e `99app.com`, que sao paginas de terceiro
 * -- e a regra antiga mandava qualquer popup para o Chrome. O dono acabava logando no
 * navegador do sistema, numa sessao que o cliente nao enxerga, e voltava para um
 * painel que continuava pedindo login. Por isso um popup da MESMA familia agora
 * ocupa a propria view, e so o que e' mesmo de fora da familia vai para o navegador.
 */
function trancarView(view, permitir, dentroDaView = () => false) {
    view.webContents.setWindowOpenHandler(({ url }) => {
        if (dentroDaView(url)) {
            void view.webContents.loadURL(url);
            return { action: 'deny' };
        }
        abrirExterno(url);
        return { action: 'deny' };
    });

    view.webContents.on('will-navigate', (event, url) => {
        if (permitir(url)) return;
        // Um redirecionamento da propria pagina para fora da familia nao e' page load
        // popup: e' a propria tela mudando de endereco. Sem isto, o `preventDefault`
        // cancela a mudanca e a pessoa fica presa numa pagina que ja nao existe.
        if (dentroDaView(url) || view.webContents.isLoading()) {
            void view.webContents.loadURL(url);
            return;
        }
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

    /*
     * Sem faixa de arrasto aqui: a barra de titulo do Windows e' que faz o arrasto, e
     * `titleBarOverlay` a pinta sem esconder. A tentativa de recriar o arrasto com uma
     * view transparente custou um topo branco e nao sobreviveu ao `setBackgroundColor`.
     */
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
 *
 * Criar a view NAO e' o que trava o cliente: `loadURL` devolve de imediato e a tela
 * ja aparece. O travamento vem de esperar `did-finish-load`, e nenhuma view e' criada
 * no boot -- entao o boot e' rapido.
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
        // Login e redirect do mesmo destino ocupam a view; o resto vai para o Chrome.
        trancarView(
            view,
            (url) => mesmaFamilia(url, alvo),
            (url) => mesmaFamilia(url, alvo)
        );
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

/*
 * A faixa de arrasto que existia aqui foi REMOVIDA de proposito.
 *
 * Duas razoes, e a segunda e' a que custou tempo: uma `WebContentsView` transparent
 * exige `setBackgroundColor('#00000000')` -- `background: transparent` no CSS deixa o
 * body transparente mas a VIEW continua branca opaca, e o resultado e' uma faixa
 * branca sobre o topo. Pior: `titleBarStyle: 'hidden'` mata o arrasto nativo, e
 * reconstituir arrasto em cima de conteudo remoto e' fragil.
 *
 * A barra de titulo do Windows e' o arrasto. Ela ja funciona, ja e' nativa e ja
 * tem o botao de fechar certo. Esconder a barra custou o arrasto e devolveu o branco;
 * ficar com ela resolve os dois de uma vez.
 */
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

/** O centro e' tudo que sobra a direita da barra. Sem folga no topo: ve `ALTURA_TITULO`. */
function centro() {
    const b = janela.getContentBounds();
    return {
        x: LARGURA_BARRA,
        y: 0,
        width: b.width - LARGURA_BARRA,
        height: b.height,
    };
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

/**
 * A tela que substitui o painel quando a URL nao responde.
 *
 * Ela precisa existir porque a janela ja esta' visivel antes do painel carregar: sem
 * isto, quem abre o cliente sem o sistema no ar ve uma moldura vazia e nao sabe se o
 * programa quebrou ou se o servidor que faltava era outro. O aviso do host local e'
 * o que evita a adivinhacao, porque `localhost` funciona normalmente e falha so
 * quando o dono esqueceu de subir o servidor.
 *
 * Vai em arquivo e nao em `data:` URL porque o preload nao roda em `data:` -- e e'
 * ele que da o botao de "tentar de novo".
 */
function mostrarErro(detalhe) {
    /*
     * O painel agora e' local, entao "fora do ar" significa uma coisa so: o sistema
     * desta maquina nao levantou. A tela aponta para a nuvem porque e' de la que vem a
     * atualizacao -- e e' o unico conserto que o dono da loja consegue tentar sem
     * entender de processo. Em desenvolvimento, com `DELIVERYADMIN_URL` apontando
     * para outro lugar, o texto antigo ainda vale.
     */
    const local = ehLocal(URL_DO_PAINEL);
    const explicacao = local
        ? 'O sistema deste computador nao subiu. Uma atualizacao nova pode ter causado isso -- fechar e abrir de novo resolve na maior parte das vezes.'
        : 'Nao foi possivel falar com o painel em:';

    const q = new URLSearchParams({
        titulo: local ? 'O sistema nao subiu' : 'Painel fora do ar',
        texto: explicacao,
        alvo: local ? nuvem() + '/admin' : URL_DO_PAINEL,
        detalhe: detalhe ?? '',
    });

    mostrarPainel();
    viewPainel.webContents.loadFile(path.join(__dirname, 'erro.html'), { query: Object.fromEntries(q) });
}

function criarJanela() {
    janela = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        backgroundColor: '#090d16',
        title: 'DeliveryAdmin',
        icon: path.join(__dirname, 'deliveryadmin.ico'),
        autoHideMenuBar: true,
        /*
         * A barra do Windows FICA, e e' ela que faz o arrasto.
         *
         * `titleBarStyle: 'hidden'` foi tentado para o topo ficar escuro, e custou
         * dois defeitos: matou o arrasto (a janela so se movia por uma regiao de 58px
         * na lateral, fina demais para acertar) e deixou o topo branco, porque a
         * correcao caseira -- uma view transparente em cima -- exige
         * `setBackgroundColor('#00000000')` e volta a aparecer branca se faltar.
         *
         * `titleBarOverlay` PODE ser combinado com a barra visivel: ele pinta so a
         * faixa dos botoes, no nosso azul, e o arrasto nativo continua valendo. E'
         * o que resolve a aparencia sem perder o que a barra faz.
         */
        titleBarOverlay: {
            color: '#090d16',
            symbolColor: '#94a3b8',
            height: ALTURA_TITULO,
        },
        webPreferences: webPreferencesSeguras(),
    });
    janela.setMenuBarVisibility(false);
    /*
     * A opcao `icon` acima NAO resolve a aba da janela no Windows: com a barra nativa,
     * o icone do titulo vem do executavel -- e no desenvolvimento esse executavel e' o
     * `electron.exe`, que carrega o icone do Electron. O `setIcon` depois de criada e' a
     * unica forma de a marca aparecer ali sem trocar o executavel.
     */
    janela.setIcon(path.join(__dirname, 'deliveryadmin.ico'));
    criarPainel();
    arrange();

    janela.on('resize', arrange);
    janela.on('maximize', arrange);
    janela.on('unmaximize', arrange);
    /*
     * A janela aparece assim que nasce, e nao quando o painel carrega.
     *
     * O `show: false` com `did-finish-load` era o defeito: se a URL nao respondesse, o
     * evento nunca chegava e o cliente ficava invisivel, com 400 MB de memoria, sem
     * um unico pixel na tela -- o usuario so via "nao abre". Quem abre sem o servidor
     * no ar era exatamente o caso comum, e o pior deles.
     */
    janela.once('ready-to-show', () => janela.show());

    /*
     * Falha ao carregar vira tela de erro com botao, e nao silencio. O `-3` e' o
     * `ERR_ABORTED`: e' o que o Chromium devolve quando a propria view troca de
     * endereco, e virar erro nela mostraria "fora do ar" no meio da navegacao.
     */
    viewPainel.webContents.on('did-fail-load', (_evento, codigo, descricao, url) => {
        if (codigo === -3 || url !== URL_DO_PAINEL) return;
        mostrarErro(descricao + ' (erro ' + codigo + ') em ' + url);
    });

    // O painel sumiu: sair do escuro em branco sem explicar nada.
    viewPainel.webContents.on('render-process-gone', (_evento, detalhes) => {
        mostrarErro('O processo que desenhava o painel encerrou: ' + detalhes.reason);
    });
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

/*
 * A identidade do app no Windows. Sem isso o Windows agrupa a janela por executavel
 * (o `electron.exe`, no desenvolvimento) e a barra de tarefas mostra o icone do
 * Electron; o `AppUserModelID` e' o mesmo do `electron-builder.yml`, entao develop e
 * produto empacotado aparecem como o mesmo programa.
 */
app.setAppUserModelId('br.com.apegopet.deliveryadmin');

/**
 * O boot: atualiza, sobe o sistema, abre a janela.
 *
 * A ordem importa. A atualizacao vem primeiro porque ela troca a pasta do sistema, e
 * trocar com o servidor rodando nao funciona no Windows. O sistema sobe antes da
 * janela porque `criarJanela` ja aponta a view para `URL_DO_PAINEL` -- e sem o
 * servidor no ar a janela abriria em `127.0.0.1` sem ninguem respondendo.
 *
 * Falha na atualizacao NAO impede a abertura: a loja usa isso para workingar. Falha
 * ao subir o sistema tambem nao -- a janela mostra a tela que explica o que houve.
 */
app.whenReady().then(async () => {
    registrarIpc();
    montarMenu();

    try {
        const relatorio = await atualiza();
        if (!relatorio.atualizou && relatorio.motivo) console.log('[cliente] nada atualizado (' + relatorio.motivo + ')');
    } catch (erro) {
        console.error('[cliente] a atualizacao falhou e a versao atual segue valendo:', erro.message);
    }

    if (!URL_DO_PAINEL) {
        try {
            URL_DO_PAINEL = (await sobeServidorOuVolta()) + '/admin';
        } catch (erro) {
            console.error('[cliente] o sistema local nao subiu:', erro.message);
            URL_DO_PAINEL = nuvem() + '/admin';
        }
    }

    criarJanela();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) criarJanela();
    });
});

/**
 * O sistema e' filho deste programa: fechar a janela tem de derruba-lo.
 *
 * Sem isto sobraria um `node` rodando o sistema da loja sem janela e sem dono -- e o
 * proximo clique no icone brigaria com ele pela porta e pelo banco.
 */
function derrubaServidor() {
    if (!processoServidor || processoServidor.killed) return;
    processoServidor.kill();
    processoServidor = null;
}

/**
 * O sistema novo levantou e caiu: a loja nao pode ficar sem painel.
 *
 * A pasta antiga so' e apagada na atualizacao seguinte, e nunca no mesmo instante da
 * troca -- por isso ela ainda esta' aqui quando o processo novo morre. O boot e' quem
 * decide tentar de novo, em `sobeServidorOuVolta`.
 */
function servidorCaiu(processo) {
    if (processo !== processoServidor) return;
    processoServidor = null;
    console.log('[cliente] o sistema local encerrou (codigo ' + processo.exitCode + ')');
}

process.on('exit', () => derrubaServidor());

app.on('window-all-closed', () => {
    derrubaServidor();
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', derrubaServidor);
}