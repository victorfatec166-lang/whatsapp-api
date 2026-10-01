#!/usr/bin/env node
/*
 * O painel e' HTML montado no servidor, com o comportamento de cada aba num
 * <script> dentro de template literal: duas camadas de escape separam o .ts do
 * codigo do navegador, e as duas falham em silencio.
 */

/*
 * Um `\\"` fecha a string mais cedo e o bloco inteiro deixa de fazer parse: a
 * tela continua pintada e so o comportamento morre. Foi assim que a lista de
 * conversas deixou de responder ao clique.
 */

/*
 * E um backtick em comentario fecha a string do TypeScript, com o `tsc` apontando
 * a linha errada. O `tsc` nao pega nenhum dos dois: ele valida o .ts, nao o texto
 * que sai dele.
 */

/*
 * O que ele faz: pede cada aba ao servidor rodando, extrai os <script> e passa
 * cada um pelo construtor de funcao do proprio Node. `new Function(codigo)` faz
 * parse sem executar, entao nenhum handler roda aqui. Nao substitui teste de navegador.
 */

/*
 * Sintaxe ok nao quer dizer botao funcionando: o PDV inteiro ficou inerte -- clicar
 * no produto nao acrescentava nada, o "+" e o "-" nao faziam nada, o troco nao
 * recalculava -- e `tsc`, este script e `check:ui` passavam. A tela abriu morta.
 */

/*
 * Por isso a segunda parte: todo `data-*` que o HTML entrega precisa ser lido por
 * algum script da propria pagina. Atributo que ninguem le e' botao sem funcao, e
 * isso e' falha, nao aviso.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Sessao de teste; o porque esta em lib/sessaoDeTeste.cjs. Sem entrar, as duas
 * pecas deste script seriam conferidas contra a tela de login -- um verde falso.
 */
const { sessaoDeTeste } = require('./lib/sessaoDeTeste.cjs');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

/**
 * Caminhos, e nao nomes de aba: `caixa` responde 302 para
 * `/admin?tab=faturamento&aba=caixa`, e e' la que o `cash.ts` e' montado. Pedir
 * `?tab=caixa` trazia 58 bytes e zero bloco, que o verificador contava como ok.
 */

/**
 * TEM QUE COBRIR TODA TELA DO PAINEL: so com a lista completa a conta de funcao
 * orfa vale. Faltou `usuarios` e ele acusou `cashReconcile` e `stockPrintReorder`,
 * que sao chamadas por `onclick` na tela do caixa, que ele nunca pediu.
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
 * Busca uma pagina ou um script, ja com a sessao de teste. Sem o cabecalho o PDV
 * devolve 401 e o bloco chega vazio -- o verificador contaria "0 bloco(s)" e daria
 * verde. Devolve { corpo, statusCode }; um 303 sem corpo nao e' HTML conferivel.
 */
function pegar(caminho, cookie) {
    return new Promise((resolve, reject) => {
        /*
         * O cabecalho vai nas OPCOES: `http.get()` envia a requisicao na chamada, e
         * um `setHeader` depois chega tarde e o Node lanca "Cannot set headers after
         * they are sent" -- erro de cliente com cara de erro de servidor.
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
                         * `Location` separa "redirecionou porque o cadastro esta
                         * fechado", que e' o certo, de "redirecionou porque a tela
                         * quebrou" -- sem isso os dois viram a mesma linha.
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
 * Atributos `data-*` que aparecem no HTML e nao sao lidos por nenhum script. O
 * `dataset` do navegador converte o hifen em maiuscula (`data-cart-inc` vira
 * `dataset.cartInc`), e por isso a busca ignora hifen e caixa.
 */

/**
 * Fora da conta, para nao virar barulho: `data-modal-cancel` e' lido pelo
 * comportamento de janelas, que esta no script do layout e nem sempre no <script>
 * da aba; atributo que so' marca `data-*` para leitor de tela; `data-href` e afins.
 */
const NAO_CHECAR = new Set(['modal-cancel', 'href', 'target', 'label', 'value']);

function atributosDataNaoLidos(html, codigo) {
    const noHtml = new Set();
    for (const m of html.matchAll(/\sdata-([a-z0-9-]+)\s*=/gi)) {
        noHtml.add(m[1].toLowerCase());
    }

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
 * `declaracoes` e' o JavaScript de tela, `corpus` e' o projeto inteiro, onde a
 * referencia pode estar: `onclick` no HTML, `data-*` lido por delegacao, `import`
 * que so o servidor ve. Nao ve metodo de objeto, e nome em string conta como uso.
 */

/**
 * A conta e' global e nao por tela: o layout entra em todas as paginas com o mesmo
 * script de 32 KB e declara `modalBind` e `aplicaPainel`, que nenhuma aba chama
 * sozinha. Tela por tela saiam sete orfas que funcionam: "orfa" so faz sentido no conjunto.
 */

/**
 * "Aparecer" e nao "ser chamada com parentes": `algo.then(aplicaPainel)` e
 * `addEventListener('click', pertoDe)` sao REFERENCIA. Apagadas as declaracoes, o
 * nome ainda aparece? Aparecer e' estar em uso -- chamada, referencia ou `onclick`.
 */
function funcoesOrfas(codigo, corpus) {
    /*
     * IIFE: `(function restauraAba() { ... })()` tem UMA ocorrencia do nome no
     * arquivo inteiro -- a propria declaracao -- e mesmo assim se executa no load.
     * Sem esta checagem, `abreCertaAba` e `restauraAba` entraram na conta como orfas.
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
     * Apaga as declaracoes para o nome nao se defender sozinho: `function orfa()`
     * contem o proprio nome, entao "o nome aparece" seria sempre verdade. Depois
     * desta substituicao so sobram referencias de verdade.
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
 * Quem entrou na conta e quem nao. O resumo antigo dizia "3 tela(s) de entrada"
 * com uma delas pulada por redirect: contava o pedido, nao o conferido. A
 * diferenca entre 13 e 12 telas e' a cobertura que este script existe para proteger.
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
         * Zero bloco e' "nao conferido" em qualquer tela, nao so nas de entrada:
         * `?tab=caixa` respondeu 58 bytes -- um redirect -- e saiu "ok (0 blocos)".
         * "Tela vazia" e "tela redirecionada" sao estados diferentes.
         */
        if (resposta.statusCode >= 300 && resposta.statusCode < 400) {
            telasPuladas.push(tela.nome);
            console.log(`  pulou   ${tela.nome}  (HTTP ${resposta.statusCode} para ${resposta.destino || 'destino vazio'}: nao conferido)`);
            continue;
        }

        falha += await conferir(tela.nome, resposta.corpo, cookieSessao);
    }

    /*
     * Sem elas, a unica tela que a pessoa ve ANTES de ter sessao nao era conferida:
     * a rota do token era GET, a tela chamava por POST, e o `fetch` devolvia 405
     * sem lancar excecao. O painel inteiro estava verde.
     */

    /*
     * Nao precisam de cookie: sao publicas por definicao, e o que se quer e' a
     * sintaxe do script delas -- o unico jeito de o botao funcionar.
     */
    for (const tela of ['/entrar', '/criar-conta', '/recuperar-senha']) {
        let resposta;
        try {
            /*
             * `null`, e nao a sessao do painel: `/entrar` redireciona para o painel
             * quando quem pede ja tem sessao, e o verificador recebia um 303 sem
             * corpo, contando "0 bloco(s)" como ok na tela que a pessoa nova ve.
             */
            resposta = await pegar(tela, null);
        } catch (e) {
            console.log(`  ERRO    ${tela}: servidor nao respondeu (${e.message})`);
            falha++;
            continue;
        }

        /*
         * 3xx em tela de entrada e' "nao conferido": entrou um 303 sem corpo, nao
         * havia JavaScript para conferir, e dizer "ok" seria mentir.
         */

        /*
         * Excecao documentada: `/criar-conta` com cadastro fechado redireciona de
         * proposito para `/entrar?cadastro=fechado` (ver authRoutes.ts:281). Isso
         * nao e' cobertura perdida, e' a tela funcionando. E o `Location` distingue.
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
        // ou veio vazia. Contar nos dois lugares inflava o numero em duas unidades
        // por tela de entrada, e o resumo dizia "4 de entrada" num projeto com tres.
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
     * O resumo conta o que foi CONFERIDO: dizer "13 telas" com uma pulada por
     * redirect e' a mesma mentira que "ok criar-conta (0 blocos)". Por isso as
     * puladas ficam nomeadas na saida.
     */

    /*
     * "Nao conferido" nao e' "verde": e' codigo que ninguem rodou, e o resumo tem
     * que dizer isso em vez de somar a tela no total e deixar o numero feliz.
     */
    const entrada = telasConferidas.filter((n) => TELAS_DE_ENTRADA.includes('/' + n)).length;
    const doPainel = telasConferidas.length - entrada;
    /*
     * A frase final so pode dizer "nenhuma funcao orfa" quando NAO ha nenhuma: dizer
     * isso abaixo de uma lista com seis nomes e' o resumo repetindo o defeito que o
     * script inteiro veio para acabar -- a tela verde contando o que nao foi conferido.
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
 * quem leia. Isolado do `main` para servir as duas familias de pagina, que
 * diferem so no cookie: e' essa diferenca que nao estava sendo conferida.
 */
async function conferir(nome, html, cookie) {
    const falha = [];
    const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

    /*
     * Script externo entra na conta: o calendario e' o unico caso, e nao era
     * conferido -- a aba passava por "ok" com dois blocos inline perfeitos
     * enquanto o arquivo de verdade podia ter erro de sintaxe.
     */
    const externos = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    for (const src of externos) {
        try {
            /*
             * `.corpo`, e nao a resposta inteira: `pegar` devolve `{ corpo, statusCode }`
             * e o objeto inteiro na lista de blocos colocava `{ corpo: ... }` no meio
             * do codigo, o `new Function` falhava e o gate inteiro caia.
             */

            /*
             * O calendario e' a unica tela com script servido por rota, entao era a
             * unica que aparecia o erro -- e o quebrado era o verificador, nao a tela.
             */
            blocos.push((await pegar(src, cookie)).corpo);
        } catch (e) {
            console.log(`  ERRO    ${nome}: nao foi possivel baixar ${src} (${e.message})`);
            falha.push(1);
        }
    }

    /*
     * Zero bloco e' "nao conferido" em qualquer tela: a regra nasceu nas de entrada
     * (`/criar-conta` contava 303 sem corpo como "ok (0 blocos)") e ficou restrita a
     * elas, e `?tab=caixa` saiu "ok (0 blocos)" com o layout de 32 KB ao lado.
     */

    /*
     * Em tela de entrada e' FALHA: `/entrar` e `/recuperar-senha` estao sempre
     * disponiveis e tem script. No painel e' "pulou": a `usuarios` responde 48 bytes
     * para nao-administrador, e a sessao de teste e' de operador de proposito.
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
 * O HTML entregue so tem o que o dado do momento produziu: o `onclick` do Caixa so
 * existe na linha da tabela quando existe turno. Com a base vazia de turno o
 * verificador nao acha a chamada e acusa funcao que funciona.
 */

/**
 * O `.ts` tem o outro lado: declaracao e `onclick` estao no mesmo arquivo,
 * independentemente de quem abre a tela. E o unico lugar onde a existencia de um
 * `onclick` pode ser afirmada sem depender do conteudo do banco.
 */

/**
 * SO o que esta DENTRO de `<script>` vira candidato: o `.ts` das views mistura as
 * linguagens, e `renderLogin` -- TypeScript do servidor -- entraria como orfa. A
 * referencia vem de TODO o `src`, e o `import` em `authRoutes.ts` e' a prova.
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
 * Roda depois de todas as telas: pode acusar funcao que nenhuma tela chama, o que
 * e' a unica forma de achar codigo morto no JavaScript embutido. Antes, o "ok"
 * saia com arquivo quebrado, 303 contado e sete funcoes em uso accusadas de mortas.
 */

/**
 * Orfa e' AVISO e nao FALHA: "declarada e sem referencia" tem duas leituras, codigo
 * morto ou feature com o servidor pronto e o botao nunca ligado -- foi o que o gate
 * achou. Gate que reprova por "alguem precisa criar um botao" ensina a usar `|| true`.
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
