#!/usr/bin/env node
/*
 * Confere a sintaxe do JavaScript que o painel entrega ao navegador.
 *
 * Por que isso existe
 *
 * O painel e' HTML montado no servidor, com o comportamento de cada aba num
 * <script> escrito dentro de um template literal do TypeScript. Duas camadas de
 * escape separam o codigo do arquivo .ts do codigo que o navegador executa, e
 * as duas falham em silencio:
 *
 *   1. Um `\\"` escrito no .ts vira aspas simples no HTML. A string JS fecha
 *      mais cedo, o resto da linha vira lixo, e o bloco INTEIRO deixa de fazer
 *      parse. No navegador isso nao aparece: o console mostra o erro, a tela
 *      continua pintada e so o comportamento morre. Foi assim que a lista de
 *      conversas deixou de responder ao clique.
 *   2. Um backtick dentro de um comentario, dentro do template literal, fecha a
 *      string do TypeScript -- e o `tsc` aponta, mas a mensagem aponta a linha
 *      errada.
 *
 * O `tsc` nao pega nenhum dos dois: ele valida o arquivo .ts, nao o texto que
 * sai dele. So quem le o HTML entregue ve o problema.
 *
 * O que ele faz: pede cada aba ao servidor rodando, extrai os <script> e passa
 * cada um pelo construtor de funcao do proprio Node. `new Function(codigo)` faz
 * parse sem executar, entao nenhum handler roda aqui.
 *
 * Nao substitui teste de navegador. Pega a classe de erro que impede a tela de
 * funcionar, que e' a que passa mais despercebida.
 *
 * A SEGUNDA PARTE: atributo sem handler
 *
 * Sintaxe ok nao quer dizer botao funcionando. Houve um dia em que o PDV inteiro
 * ficou inerte -- clicar no produto nao acrescentava nada, o "+" e o "-" do
 * carrinho nao faziam nada, o troco nao recalculava -- e nada acusou: o `tsc`
 * passava, este script aqui passava (a sintaxe estava perfeita), o `check:ui`
 * passava (os rotulos estavam certos). A tela abria bonita e morta. O commit que
 * causou isso reescreveu a tela e levou o listener de delegacao junto, sem
 * nenhum sinal de que aquilo era comportamento.
 *
 * Entao, alem da sintaxe, este script confere se cada atributo `data-*` que o
 * HTML entrega e' lido por algum script da propria pagina. A regra e' simples e
 * tem um caso de falso positivo conhecido, tratado la embaixo: atributo que
 * ninguem le e' botao sem funcao.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Sessao de teste. Ver o porque em lib/sessaoDeTeste.cjs: o painel tem senha,
 * e sem entrar as duas pecas deste script seriam conferidas contra a tela de
 * login -- um verde falso.
 */
const { sessaoDeTeste } = require('./lib/sessaoDeTeste.cjs');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

/**
 * As telas cujo script vale conferir.
 *
 * Sao caminhos, e nao nomes de aba, porque duas telas nao vivem no lugar que a
 * sidebar sugere: `caixa` responde 302 para `/admin?tab=faturamento&aba=caixa`, e
 * e' la que o `cash.ts` e' montado. Pedir `?tab=caixa` trazia 58 bytes e zero
 * bloco de script -- que o verificador antigo contava como "ok (0 blocos)", a
 * mesma mentira que ele existia para acabar.
 *
 * TEM QUE COBRIR TODA TELA DO PAINEL. So quando a lista esta completa, a conta
 * de funcao orfa vale: a lista vivia com dez telas e o servidor aceita onze, e a
 * `usuarios` faltando fez o verificador acusar `cashReconcile` e
 * `stockPrintReorder` -- que sao chamadas por `onclick` na tela do caixa, que ele
 * nunca pediu. Ausencia de chamada so e' prova de codigo morto com cobertura
 * completa; com buraco, o verificador inventa codigo morto que funciona.
 */
const TELAS = [
    { nome: 'home', caminho: '/admin?tab=home' },
    { nome: 'chat', caminho: '/admin?tab=chat' },
    { nome: 'config', caminho: '/admin?tab=config' },
    { nome: 'marketplace', caminho: '/admin?tab=marketplace' },
    { nome: 'whatsapp', caminho: '/admin?tab=whatsapp' },
    { nome: 'faturamento', caminho: '/admin?tab=faturamento' },
    { nome: 'estoque', caminho: '/admin?tab=estoque' },
    { nome: 'pdv', caminho: '/admin?tab=pdv' },
    { nome: 'kanban', caminho: '/admin?tab=kanban' },
    { nome: 'calendario', caminho: '/admin?tab=calendario' },
    { nome: 'caixa', caminho: '/admin?tab=faturamento&aba=caixa' },
    { nome: 'usuarios', caminho: '/admin?tab=usuarios' },
];

/** Telas de entrada: publicas, e por isso sem cookie. */
const TELAS_DE_ENTRADA = ['/entrar', '/criar-conta', '/recuperar-senha'];

/** Cabecalho de cookie da sessao de teste. Vazio ate `main` entrar. */
let cookieSessao = '';

/**
 * Busca uma pagina ou um script, ja com a sessao de teste.
 *
 * Sem o cabecalho, `/admin?tab=pdv` devolve 401 e o bloco de script chega vazio:
 * o verificador contaria "0 bloco(s)" e daria verde. E o verde mais caro deste
 * projeto -- o que ele existe para pegar e' justamente a tela que abre bonita e
 * nao responde.
 *
 * Devolve { corpo, statusCode }. Redirect (3xx) precisa ser tratado pelo chamador:
 * um 303 sem corpo nao e' HTML conferivel.
 */
function pegar(caminho, cookie) {
    return new Promise((resolve, reject) => {
        /*
         * O cabecalho vai NAS OPCOES, e nao em `req.setHeader` depois.
         *
         * `http.get()` envia a requisicao no momento da chamada. Um
         * `setHeader` seguinte chega tarde demais e o Node lanca
         * "Cannot set headers after they are sent" -- erro do cliente
         * aparecendo com cara de erro do servidor, o que mandava os doze
         * verbos falharem sem dizer nada de util.
         */
        const usar = cookie === undefined ? cookieSessao : cookie;
        const opcoes = usar ? { headers: { Cookie: usar } } : undefined;
        http
            .get(BASE + caminho, opcoes, (res) => {
                let corpo = '';
                res.on('data', (d) => (corpo += d));
                res.on('end', () =>
                    resolve({
                        corpo,
                        statusCode: res.statusCode,
                        /*
                         * O cabecalho `Location` e' o que separa "redirecionou
                         * porque o cadastro esta fechado", que e' o comportamento
                         * certo, de "redirecionou porque a tela quebrou". Sem
                         * isso, os dois viram a mesma linha de aviso e a tela
                         * some da cobertura sem ninguem saber por que.
                         */
                        destino: res.headers.location || '',
                    })
                );
            })
            .on('error', reject);
    });
}

/** Reconta a linha do erro, que vem como deslocamento dentro do bloco. */
function suspecta(codigo, nome) {
    const linhas = codigo.split('\n');
    for (let i = 0; i < linhas.length; i++) {
        if (linhas[i].includes('onerror') || linhas[i].includes('<<<') || linhas[i].includes('@@@')) {
            console.log(`        linha ${i + 1}: ${linhas[i].trim().slice(0, 110)}`);
        }
    }
}

/**
 * Atributos `data-*` que aparecem no HTML e nao sao lidos por nenhum script.
 *
 * O nome no HTML vem em duas grafias e o script costuma ler so uma delas: o
 * `dataset` do navegador converte o hífen em maiúscula (`data-cart-inc` vira
 * `dataset.cartInc`), e a busca no texto do código acha qualquer uma das duas.
 * Por isso a comparação ignora o hífen e a caixa.
 *
 * O que NAO entra na conta, para o verificador não virar barulho:
 *
 *   - `data-modal-cancel`: é lido pelo behavior de janelas, que está no script
 *     do layout -- em todas as abas, e nem toda aba o inclui no proprio
 *     <script>. E `data-*` de comportamento, não de dado.
 *   - atributos que são só marcação semântica para leitor de tela e estilização.
 *   - `data-href` e afins: ligada por atributo, não por JavaScript.
 */
const NAO_CHECAR = new Set(['modal-cancel', 'href', 'target', 'label', 'value']);

function atributosDataNaoLidos(html, codigo) {
    const noHtml = new Set();
    for (const m of html.matchAll(/\sdata-([a-z0-9-]+)\s*=/gi)) {
        noHtml.add(m[1].toLowerCase());
    }

    // O script é procurado com o hífen removido, porque é assim que o
    // `dataset` entrega o nome. E o atributo tambem: `data-cart-inc` no HTML
    // e' `dataset.cartInc` no script, e as duasformas precisam chegar na mesma
    // string antes de comparar.
    const codigoSemHifen = codigo.replace(/-/g, '').toLowerCase();

    const orphans = [];
    for (const attr of noHtml) {
        if (NAO_CHECAR.has(attr)) continue;
        if (codigoSemHifen.includes(attr.replace(/-/g, ''))) continue;
        orphans.push(attr);
    }
    return [...orphans].sort();
}

/**
 * Funcoes declaradas mas nunca chamadas dentro do mesmo <script>.
 *
 * Procura: function nomeFuncao(...), var/const/let nomeFuncao = function/arrow.
 * Ignora: window.nomeFuncao (exportadas como globais), funcoes anonimas, IIFE.
 *
 * Limitacoes conhecidas (aceitaveis para um gate conservador):
 * - Nao detecta metodos de objeto (const obj = { fn() {} }).
 * - Falso positivo se nome aparece em string ou comentario.
 * - Callbacks sem parenteses (setTimeout(fn, 100)) exigem regex separada.
 */
/**
 * Funcoes de navegador declaradas e sem nenhuma referencia no projeto.
 *
 * `declaracoes` e' o JavaScript de tela (o que esta dentro de `<script>`, no
 * fonte e no que o navegador recebeu). `corpus` e' o projeto inteiro, onde a
 * referencia pode estar: um `onclick` no HTML, um `data-*` lido por delegacao,
 * um `import` que so o servidor ve.
 *
 * POR QUE A CONTA E' GLOBAL E NAO POR TELA
 *
 * O layout (`src/views/layout.ts`) entra em todas as paginas com o mesmo script
 * de 32 KB, e e' ele que declara `modalBind`, `confirmThen` e `aplicaPainel`.
 * A `confirmThen` e' chamada pelas janelas de qualquer aba; a `modalBind` so pelas
 * abas que tem janela. Conferindo tela por tela, a `modalBind` saia "orfa" em
 * todas as abas que nao abrem janela -- o verificador acusando sete funcoes que
 * funcionam, em cinco telas, na primeira vez que rodou contra o corpus de verdade.
 *
 * "Orfa" so faz sentido no conjunto: uma funcao esta morta quando NENHUM lugar
 * a chama. E' esse o criterio daqui.
 *
 * POR QUE "APARECER" E NAO "SER CHAMADA COM PARENTESE"
 *
 * A primeira versao contava chamada por regex de local de chamada, e o regex
 * classificava errado os dois jeitos mais comuns deste codigo:
 *
 *   - `algo.then(aplicaPainel)`: a funcao vira REFERENCIA, nao `nome(`. O
 *     `aplicaPainel` e' o painel de notificacoes do sino e nao aparece em uma
 *     unica chamada com parentes em lugar nenhum.
 *   - `addEventListener('click', pertoDe)`: igual, referencia.
 *
 * Classificar forma de chamada com regex e' tentar adivinhar JavaScript. A
 * pergunta que resolve e' mais simples e mais barata: APOS apagar as proprias
 * declaracoes, o nome ainda aparece em algum lugar? Aparecer e' estar em uso --
 * chamada, referencia, `onclick`, ou nome dentro de um `data-*` lido por
 * delegacao. Nao aparecer e' orfa de verdade, e nao ha caso legitimo para isso
 * neste projeto.
 */
function funcoesOrfas(codigo, corpus) {
    /*
     * Declaracoes, com o texto de volta, para poder distinguir IIFE.
     *
     * `(function restauraAba() { ... })()` tem UMA ocorrencia do nome no
     * arquivo inteiro -- a propria declaracao -- e mesmo assim nao e' codigo
     * morto: ela se executa no load. Sem esta checagem, as duas IIFE do painel
     * (`abreCertaAba` no Faturamento e `restauraAba` no Estoque) entraram na conta
     * como orfas. Foi o mesmo erro de antes, com a roupa nova: um detector que
     * acusa quem funciona e' pior do que nenhum, porque o nome dele perde o
     * significado e ninguem mais olha a saida.
     */
    const declaracoes = new Map();
    for (const m of codigo.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
        const antes = codigo.slice(Math.max(0, m.index - 4), m.index);
        const iife = /\(\s*$/.test(antes);
        declaracoes.set(m[1], { iife });
    }
    for (const m of codigo.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) {
        declaracoes.set(m[1], { iife: false });
    }

    /*
     * Apaga as declaracoes, para o nome nao se defender sozinho.
     *
     * E' o que impede o falso positivo mais obvio: `function orfa()` contem o
     * proprio nome, entao "o nome aparece" seria sempre verdade e a funcao
     * contaria como usada. Depois desta substituicao, so sobram referencias de
     * verdade.
     */
    const semDeclaracaoBase = corpus
        .replace(/(?:^|[^\w$.])(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g, '(')
        .replace(/(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g, '=');

    // Uma funcao exportada em `window` existe para o HTML chamar por atributo.
    let semDeclaracao = semDeclaracaoBase;
    for (const nome of declaracoes.keys()) {
        if (new RegExp(`window\\.${nome}\\s*=`).test(corpus)) {
            semDeclaracao += ` ${nome}`;
        }
    }

    return [...declaracoes.entries()]
        .filter(([nome, info]) => !info.iife && !semDeclaracao.includes(nome))
        .map(([nome]) => nome)
        .sort();
}

/** Blocos contados no total. Vive fora do `main` porque `conferir` soma nele. */
let totalBlocos = 0;

/**
 * O JavaScript e o HTML de todas as telas, acumulados.
 *
 * A funcao orfa so se decide no fim, e no conjunto. Ver `funcoesOrfas`.
 */
const corpusDeCodigo = [];
const corpusDeHtml = [];

/**
 * Quem entrou na conta e quem nao entrou.
 *
 * O resumo antigo dizia "3 tela(s) de entrada" mesmo com uma delas pulada por
 * redirect: contava o que foi pedido, nao o que foi conferido. A diferenca entre
 * 13 e 12 telas conferidas e' justamente a cobertura que este script existe para
 * proteger, entao o numero tem que ser o real.
 */
const telasConferidas = [];
const telasPuladas = [];

/** Resultado da conta de orfas, guardado para o resumo nao refazer o trabalho. */
let funcoesOrfasDoPainel = [];

async function main() {
    let falha = 0;

    try {
        const sessao = await sessaoDeTeste();
        cookieSessao = sessao.Cookie;
    } catch (e) {
        console.log(`ERRO: nao foi possivel entrar para conferir o painel (${e.message}).`);
        console.log('      O servidor precisa estar no ar em ' + BASE + ' com o banco migrated.');
        process.exitCode = 1;
        return;
    }

    for (const tela of TELAS) {
        let resposta;
        try {
            resposta = await pegar(tela.caminho);
        } catch (e) {
            console.log(`  ERRO    ${tela.nome}: servidor nao respondeu (${e.message})`);
            falha++;
            continue;
        }

        /*
         * Zero bloco em tela do painel e' "nao conferido", em qualquer uma.
         *
         * A regra existia so para as telas de entrada, e ai nasceu a confusao:
         * `?tab=caixa` respondeu 58 bytes -- um redirect -- e saiu "ok (0
         * blocos)". Um painel com 12 telas todas carregando script e uma delas
         * sem nada, e o verificador nao distingue "tela vazia" de "tela
         * redirecionada". Sao estados diferentes e os dois precisam de nome.
         */
        if (resposta.statusCode >= 300 && resposta.statusCode < 400) {
            telasPuladas.push(tela.nome);
            console.log(`  pulou   ${tela.nome}  (HTTP ${resposta.statusCode} para ${resposta.destino || 'destino vazio'}: nao conferido)`);
            continue;
        }

        falha += await conferir(tela.nome, resposta.corpo, cookieSessao);
    }

    /*
     * As telas de entrada entram na conta.
     *
     * Nao e'-settings bônus: sem elas, a unica tela que a pessoa ve ANTES de
     * ter sessao nao era conferida por ninguem. Foi assim que a tela de login
     * passou a responder "nao foi possivel falar com o servidor" com o servidor
     * no ar -- a rota do token era GET, a tela chamava por POST, e o `fetch`
     * devolvia 405 sem lancar excecao. O painel inteiro estava verde.
     *
     * Nao precisam de cookie: sao publicas por definicao, e o que se quer e'
     * exatamente a sintaxe do script delas, que e' o unico jeito de o botao
     * funcionar.
     */
    for (const tela of ['/entrar', '/criar-conta', '/recuperar-senha']) {
        let resposta;
        try {
            /*
             * `null`, e nao a sessao do painel.
             *
             * `/entrar` redireciona para o painel quando quem pede ja tem
             * sessao. Mandando o cookie, o verificador recebia um 303 sem
             * corpo e contava "0 bloco(s)" como ok -- conferindo nada, na tela
             * que e' a primeira coisa que uma pessoa nova ve.
             */
            resposta = await pegar(tela, null);
        } catch (e) {
            console.log(`  ERRO    ${tela}: servidor nao respondeu (${e.message})`);
            falha++;
            continue;
        }

        /*
         * Redirect (3xx) em tela de entrada = nao conferido. E a saida honesta
         * para o que o verificador viu: entrou um 303 sem corpo, entao nao havia
         * JavaScript para conferir, e dizer "ok" seria mentir.
         *
         * A excecao documentada e' `/criar-conta` com o cadastro fechado: a rota
         * conta os usuarios e redireciona de proposito para `/entrar?cadastro=
         * fechado` (ver authRoutes.ts:281). Isso nao e' cobertura perdida, e' a
         * tela funcionando. E o `Location` e' que distingue os dois casos.
         */
        const nome = tela.replace('/', '');
        if (resposta.statusCode >= 300 && resposta.statusCode < 400) {
            if (resposta.destino.includes('cadastro=fechado')) {
                telasPuladas.push(nome);
                console.log(`  pulou   ${nome}  (cadastro fechado: a rota redireciona de proposito)`);
            } else {
                telasPuladas.push(nome);
                console.log(`  AVISO   ${nome}  (HTTP ${resposta.statusCode} para ${resposta.destino || 'destino vazio'}: nao conferido)`);
            }
            continue;
        }

        // A contagem e' do `conferir`: e' la que se sabe se a tela trouxe script
        // ou veio vazia. Contar aqui e no `conferir` inflava o numero em duas
        // unidades por tela de entrada, e o resumo dizia "4 de entrada" num
        // projeto que tem tres telas de entrada.
        falha += await conferir(nome, resposta.corpo, null);
    }

    /*
     * A conta de funcao orfa vem depois de todas as telas, e e' a ultima
     * palavra: pode acusar funcao que nenhuma tela chama, o que e' a unica
     * forma de o verificador achar codigo morto no JavaScript embutido.
     */
    falha += confereCorpusGlobal();

    console.log('');
    if (falha > 0) {
        console.log(`${falha} problema(s). O painel pode pintar certo e nao responder.`);
        process.exitCode = 1;
        return;
    }

    /*
     * O resumo conta o que foi CONFERIDO, e nao o que foi pedido.
     *
     * Dizer "13 telas" quando uma pulou por redirect e' a mesma mentira que a
     * linha "ok criar-conta (0 bloco(s))" contava, so que agora no resumo. As
     * puladas ficam nomeadas na saida justamente para a cobertura nao depender
     * de alguem lembrar quantas telas eram.
     *
     * A frase sobre cobertura e' deliberada. "Nao conferido" nao e' "verde": e'
     * codigo que ninguem rodou, e o resumo precisa dizer isso em vez de somar a
     * tela no total e deixar o numero feliz.
     */
    const entrada = telasConferidas.filter((n) => TELAS_DE_ENTRADA.includes('/' + n)).length;
    const doPainel = telasConferidas.length - entrada;
    /*
     * A frase final so pode dizer "nenhuma funcao orfa" quando NAO ha nenhuma.
     * Dizer isso logo abaixo de uma lista com seis nomes e' o resumo repetindo o
     * defeito que o script inteiro veio para acabar: a tela verde contando como
     * conferido o que nao foi.
     */
    console.log(
        `${telasConferidas.length} tela(s) conferida(s) (${doPainel} do painel + ${entrada} de entrada), ` +
            `${totalBlocos} bloco(s) de script: sintaxe ok e todo data-* tem handler. ` +
            (funcoesOrfasDoPainel.length === 0
                ? 'Nenhuma funcao orfa no painel inteiro.'
                : `${funcoesOrfasDoPainel.length} funcao(es) orfa(s) listada(s) acima, como aviso.`)
    );
    if (telasPuladas.length > 0) {
        console.log(`NAO conferida(s), por design: ${telasPuladas.join(', ')}`);
        console.log('  O JavaScript dessas telas nao foi verificado. Nao e' + ' o mesmo que estar tudo certo.');
    }
}

/**
 * Confere uma pagina: sintaxe de todo bloco de script e atributo `data-*` sem
 * quem leia.
 *
 * Isolado do `main` para servir as duas familias de pagina -- as dez abas do
 * painel, que precisam de sessao, e as telas de entrada, que nao tem. A
 * diferenca entre elas era exatamente o que nao estava sendo conferido, entao
 * a funcao e' a mesma e muda so quem a chama.
 */
async function conferir(nome, html, cookie) {
    const falha = [];
    const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

    /*
     * Script externo entra na conta tambem.
     *
     * O calendario e' o unico caso de script servido por rota, e ele nao
     * estava sendo conferido: a aba passava por estar "ok" com dois blocos
     * inline perfeitos, enquanto o arquivo de verdade -- o que desenha a
     * grade e responde ao clique no dia -- podia estar com erro de sintaxe e
     * ninguem ver. Verificador que so olha metade do que a pagina entrega
     * da verde falso no que ele nao cobre.
     */
    const externos = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    for (const src of externos) {
        try {
            /*
             * `.corpo`, e nao a resposta inteira.
             *
             * `pegar` passou a devolver `{ corpo, statusCode }` para que o
             * chamador visse o 303. O script externo e' empurrado direto na
             * lista de blocos, entao empurrar o objeto colocava `{ corpo: ... }`
             * no meio do codigo: o `new Function` do bloco externo falhava com
             * "Unexpected identifier", o calendario era dado como quebrado --
             * quando o quebrado era o verificador -- e o `suspecta` estourava em
             * `codigo.split is not a function` e derrubava o gate inteiro.
             *
             * O calendario e' a unica tela com script servido por rota, entao era
             * a unica que aparecia o erro.
             */
            blocos.push((await pegar(src, cookie)).corpo);
        } catch (e) {
            console.log(`  ERRO    ${nome}: nao foi possivel baixar ${src} (${e.message})`);
            falha.push(1);
        }
    }

    /*
     * Zero bloco e' "nao conferido", em qualquer tela -- e nao so nas de entrada.
     *
     * A regra nasceu nas telas de entrada (`/criar-conta` contava 303 sem corpo
     * como "ok (0 blocos)") e foi deixada restrita a elas, o que produziu o
     * mesmo bug dois andares abaixo: `?tab=caixa` respondeu 58 bytes e saiu
     * "ok (0 blocos)", com o layout inteiro de 32 KB carregando ao lado.
     *
     * Duas consequencias, e elas sao diferentes:
     *
     * - tela de entrada (`/entrar`, `/recuperar-senha`): e' FALHA. Essas duas
     *   estao sempre disponiveis e sempre tem script. Nao tem para onde ir.
     * - tela do painel: e' "pulou". A `usuarios` responde 48 bytes para quem
     *   nao e' administrador, e a sessao de teste e' de operador de proposito
     *   (ver lib/sessaoDeTeste.cjs). Isso e' permissao funcionando, nao tela
     *   quebrada -- mas tambem e' cobertura que o projeto nao tem, e dizer so
     *   "pulou" esconderia isso. Por isso a tela entra em `telasPuladas` e o
     *   resumo lista o nome.
     */
    if (blocos.length === 0 && externos.length === 0) {
        telasPuladas.push(nome);
        if (TELAS_DE_ENTRADA.includes('/' + nome)) {
            falha.push(1);
            console.log(`  FALHA   ${nome}  (0 blocos: esta tela de entrada esta sempre disponivel e sempre tem script)`);
        } else {
            console.log(`  pulou   ${nome}  (0 blocos: a resposta nao trouxe script -- conferir a rota e a permissao)`);
        }
        return falha.length;
    }

    telasConferidas.push(nome);

    const ruins = [];
    blocos.forEach((codigo, i) => {
        try {
            new Function(codigo);
        } catch (e) {
            ruins.push({ i, e, codigo });
        }
    });

    if (ruins.length === 0) {
        totalBlocos += blocos.length;
        console.log(`  ok      ${nome}  (${blocos.length} bloco(s))`);
    } else {
        totalBlocos += blocos.length;
        falha.push(1);
        console.log(`  FALHA   ${nome}  (${ruins.length} de ${blocos.length} bloco(s) nao fazem parse)`);
        for (const r of ruins) {
            console.log(`        bloco ${r.i}: ${r.e.message}`);
            suspecta(r.codigo, nome);
        }
    }

    /*
     * Sintaxe ok e' precondicao para a parte de atributo: um bloco que nao
     * faz parse pode "nao usar" um atributo so porque morreu no meio, e
     * acusar o atributo em vez do parse seria apontar o sintoma.
     */
    if (ruins.length === 0) {
        const orphans = atributosDataNaoLidos(html, blocos.join('\n'));
        if (orphans.length > 0) {
            falha.push(1);
            console.log(`  FALHA   ${nome}  (${orphans.length} atributo(s) data-* sem handler)`);
            console.log(`        ${orphans.join(', ')}`);
            console.log('        atributo data-* que ninguem le = botao sem funcao. O painel abre, e o clique nao faz nada.');
        }
    }

    /*
     * O codigo desta tela vai para o corpus global, e a conta de funcao orfa sai
     * uma vez so, no fim do `main`. Conferir aqui acusaria `modalBind` em toda
     * tela que nao abre janela -- ver o comentario de `funcoesOrfas`.
     */
    corpusDeCodigo.push(blocos.join('\n'));
    corpusDeHtml.push(html.replace(/<script[\s\S]*?<\/script>/g, ' '));

    return falha.length;
}

/**
 * O codigo-fonte das views e do servidor, para entrar no corpus das orfas.
 *
 * O HTML entregue so tem o que o dado do momento produziu. O botao
 * `onclick="cashReconcile('...')"` da tela de Caixa so existe na linha da tabela
 * quando existe turno -- e com a base vazia de turno, o HTML nao tem o botao, o
 * verificador nao acha a chamada, e acusa uma funcao que funciona. O mesmo
 * vale para qualquer tela cuja acao dependa de lista nao vazia.
 *
 * O `.ts` tem o outro lado da conta: a declaracao da funcao E o `onclick` que a
 * chama estao no mesmo arquivo, o tempo todo, independentemente de quem abre a
 * tela. Por isso o fonte entra no corpus. E o que separa "esta morta" de
 * "esta em uso e o dado de agora nao a exercita".
 *
 * Nao e' uma saida de emergencia: e' o unico lugar onde a existencia de um
 * `onclick` pode ser afirmada sem depender do conteudo do banco.
 *
 * SO o que esta DENTRO de `<script>...</script>` vira candidato a orfa.
 *
 * O `.ts` das views mistura as duas linguagens no mesmo arquivo: `login.ts` tem
 * `renderLogin()`, que e' TypeScript do servidor e monta o HTML, ao lado do
 * JavaScript que o navegador executa. Sem separar, `renderLogin`, `renderTroca
 * Senha` e `renderCriarConta` entraram na conta como orfas -- sao TS, e o `tsc`
 * cuida delas.
 *
 * A referencia, ao contrario, vem de TODO o `src`. `renderLogin` nao aparece
 * dentro de nenhum `<script>`, e sim no `import` de `authRoutes.ts` -- que e'
 * exatamente a prova de que a funcao esta em uso. Ausencia de referencia so
 * vale com o arquivo inteiro disponivel para a busca.
 */
function corpusDoFonte() {
    const base = path.join(__dirname, '..', 'src');
    const arquivos = [];

    const anda = (dir) => {
        for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
            const caminho = path.join(dir, entrada.name);
            if (entrada.isDirectory()) anda(caminho);
            else if (entrada.isFile() && caminho.endsWith('.ts')) arquivos.push(caminho);
        }
    };

    anda(base);

    let todo = '';
    const soScripts = [];
    for (const arquivo of arquivos) {
        const texto = fs.readFileSync(arquivo, 'utf8');
        todo += `\n${texto}`;
        for (const m of texto.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
            soScripts.push(m[1]);
        }
    }

    return { declaracoes: soScripts.join('\n'), referencias: todo };
}

/**
 * Roda depois de todas as telas.
 *
 * A saida de "ok" e' a mesma; a diferenca e que agora ela significa alguma
 * coisa. Antes, `check-js` podia imprimir "sintaxe ok e todo data-* tem handler"
 * tendo deixado passar um arquivo com objeto no meio do codigo, uma tela que
 * recebeu 303 contada como conferida, e sete funcoes em uso accusadas de
 * mortas -- tudo isso junto, com o gate verde. Agora cada uma dessas tres coisas
 * tem uma linha propria dizendo o que aconteceu.
 *
 * POR QUE FUNCAO ORFA E' AVISO E NAO FALHA
 *
 * Porque "declarada e sem referencia" tem duas leituras, e o verificador nao sabe
 * qual e': codigo morto, ou feature com a metade do servidor pronta e o botao
 * nunca ligado. Foi exatamente o que o gate encontrou aqui -- `pdvDropHold` e
 * `pdvRestore` com quatro rotas de hold prontas em `/api/admin/pdv/hold*`, e
 * `stockAdjust`, `stockEdit`, `stockEntry` e `stockLoss` com
 * `/api/admin/stock/{adjust,set,loss,movement}` esperando chamador. Sao seis
 * features inalcancaveis pela tela, e a solucao e ligar o botao, nao apagar a
 * funcao.
 *
 * Gate que reprova por "alguem precisa criar um botao" ensina a classe a rodar o
 * gate com `|| true`, e ai nao volta. O que reprova aqui e' tela quebrada --
 * sintaxe, `data-*` sem handler, tela de entrada vazia. Orfa fica registrada e
 * alguem decide o que fazer com ela.
 */
function confereCorpusGlobal() {
    const fonte = corpusDoFonte();
    const corpus = [...corpusDeCodigo, ...corpusDeHtml, fonte.referencias].join('\n');
    funcoesOrfasDoPainel = funcoesOrfas(fonte.declaracoes, corpus);
    if (funcoesOrfasDoPainel.length === 0) {
        console.log('  ok      funcoes orfas (nenhuma declaracao sem referencia no painel inteiro)');
        return 0;
    }
    console.log(`  AVISO   funcoes orfas  (${funcoesOrfasDoPainel.length} declarada(s) e sem nenhuma referencia no painel inteiro)`);
    console.log(`        ${funcoesOrfasDoPainel.join(', ')}`);
    console.log('        Duas leituras, e o verificador nao sabe qual: codigo morto, ou feature com');
    console.log('        a rota do servidor pronta e o botao nunca ligado. Confira a rota antes de apagar.');
    return 0;
}

/* `require.main === module` evita que o `main()` suba o servidor ao importar. */
if (require.main === module) main();

module.exports = { funcoesOrfas, atributosDataNaoLidos, TELAS };
