import { Router } from 'express';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { prisma } from '../database/prisma';
import {
    aplicaCookies,
    autentica,
    criaSessao,
    derivaSenha,
    emailValido,
    encerraSessao,
    exigeCsrf,
    exigeSessao,
    geraCodigo,
    limitePorTentativa,
normalizaEmail,
    pedidoSeguro as pedidoSeguroNoProxy,
    primeiroAcessoLocal,
    recuperaComCodigo,
    sessaoDoRequest,
    trocaSenha,
} from '../services/auth';
import { logDoModulo } from '../services/logger';
import { problemaDaSenha } from '../services/regras';
import { guardaSenhaEscolhida, registraVenda, senhaDoDonoPendente, statusDoDono } from '../services/assinaturas';
import { renderLogin, renderTrocaSenha, renderCriarConta, renderAguardando, renderRecuperar, renderSobre, renderAjuda, seguroInterno } from '../views/login';
import { carregarConfig } from '../services/config';
/** O nome que a tela de entrada mostra. E' o produto, e nao a loja -- ver o GET /entrar. */
const NOME_DO_PRODUTO = 'DeliveryAdmin';

import { lojaDoBoot } from '../services/loja';
const log = logDoModulo('authRoutes');

/*
 * ESTE ARQUIVO USA O CLIENTE CRU. Tudo aqui acontece ANTES de existir loja -- e' a
 * sessao que carrega a loja -- entao o `prismaComLoja` estouraria e a tela de entrada
 * nao abriria. A excecao e' a criacao da conta, que recebe a loja do boot.
 */

/** Senha testavel ate o fim: por isso o limite por IP aqui, e o CSRF vem de um cookie de uso unico, nao da sessao. */
const router = Router();

/** Os mesmos nomes do `auth.ts`. Repetidos aqui porque este arquivo monta cookies
 *  antes de existir sessao -- e' a tela de entrada, que nao tem loja para consultar. */
const NOME_COOKIE = 'da_sessao';
const NOME_CSRF = 'da_csrf';
const NOME_CSRF_LOGIN = 'da_csrf_entrada';

/** Le um cookie. */
function cookieBruta(req: Request, nome: string): string {
    const bruto = req.headers.cookie;
    if (!bruto) return '';
    for (const parte of bruto.split(';')) {
        const [chave, ...resto] = parte.trim().split('=');
        if (chave === nome) return decodeURIComponent(resto.join('='));
    }
    return '';
}

/**
 * Comparacao simples, e nao `timingSafeEqual`: nenhum dos dois lados e' segredo
 * -- o token veio no HTML que o navegador acabou de receber. Protege-se a origem
 * do pedido, nao o valor.
 */
function tokenConfere(req: Request): boolean {
    const doCookie = cookieBruta(req, NOME_CSRF_LOGIN);
    const doCorpo = String((req.body as Record<string, unknown>)?.csrf ?? req.headers['x-csrf-token'] ?? '');
    return doCookie.length > 0 && doCookie === doCorpo;
}

/*
 * Existe por causa do cookie com flag `secure`: em HTTP simples ele nunca volta, e a
 * pessoa fica presa na tela de login sem entender. Mora no `auth.ts` desde que a
 * renovacao do cookie de sessao precisou dela -- duas copias divergiriam no 1o proxy.
 */
function pedidoSeguro(req: Request): boolean {
    return pedidoSeguroNoProxy(req);
}

/* ------------------------------------------------------------------ Login */

router.get('/entrar', async (req, res) => {
    const sessao = await sessaoDoRequest(req);
    const destino = seguroInterno(String(req.query.destino ?? '/admin'));

    // Quem ja entrou nao ve a tela de entrada. Sem isto, o "voltar" do
    // navegador traz de volta o login para quem ja esta autenticado -- e a
    // pessoa conclui que a sessao caiu.
    if (sessao) {
        res.redirect(303, sessao.precisaTrocarSenha ? '/trocar-senha' : destino);
        return;
    }

    /*
     * Recem-cadastrado com teste: a conta ja existe e ele vem da tela de cadastro.
     * Sem este e-mail preenchido, ele procuraria uma conta que acabou de criar e
     * acharia que o cadastro falhou.
     */
    let emailRecente = '';
    if (req.query.primeiraVez === '1') {
        emailRecente = normalizaEmail(String(req.query.email ?? ''));
        if (!emailValido(emailRecente)) emailRecente = '';
    }

    /*
     * O nome e' do PRODUTO, e nao da loja: esta rota roda sem sessao, e sem sessao
     * nao ha loja. E antes de autenticar a tela nao tem como saber de quem e' a
     * conta que esta entrando -- o nome da loja aparece no painel, depois.
     */
res.send(
        renderLogin({
            nomeNegocio: NOME_DO_PRODUTO,
            destino,
            primeiroAcesso: (await prisma.user.count()) === 0,
            emailRecente,
        })
    );
});

/*
 * Paginas publicas do menu de tres pontinhos, sem sessao: sao o texto que explica o
 * produto para quem ainda nao entrou. O nome vem do produto e nao do `Config`, que
 * exige loja -- e loja so existe depois que alguem entra.
 */
router.get('/sobre', (_req, res) => {
    res.send(
        renderSobre({
            nomeNegocio: NOME_DO_PRODUTO,
            /*
             * Contato vem do ambiente e nao do codigo: um telefone escrito no fonte
             * vira numero velho que ninguem lembra de atualizar, e a pessoa que
             * mudou o telefone nao tem como abrir este arquivo.
             */
            contato: [
                ...contatoDoAmbiente(),
            ],
        })
    );
});

router.get('/ajuda', (_req, res) => {
    res.send(renderAjuda({ nomeNegocio: NOME_DO_PRODUTO }));
});

/** Le os contatos do ambiente, descartando o que nao foi cadastrado. */
function contatoDoAmbiente(): Array<{ rotulo: string; valor: string; icone: string }> {
    const onde: Array<[string, string, string]> = [
        ['CONTATO_TELEFONE', 'Telefone', 'fa-solid fa-phone'],
        ['CONTATO_EMAIL', 'E-mail', 'fa-solid fa-envelope'],
        ['CONTATO_INSTAGRAM', 'Instagram', 'fa-brands fa-instagram'],
    ];
    return onde.flatMap(([chave, rotulo, icone]) => {
        const valor = (process.env[chave] ?? '').trim();
        return valor ? [{ rotulo, valor, icone }] : [];
    });
}

/**
 * POST, e nao GET: a tela envia por `postJSON`, e a rota GET respondia 405 sem o
 * `fetch` lancar excecao. E' POST de verdade porque grava o cookie do token --
 * GET que escreve cookie e' o que o navegador recusa em alguns cenarios.
 */
router.post('/api/auth/token', (req, res) => {
    const token = randomBytes(24).toString('base64url');
    res.cookie(NOME_CSRF_LOGIN, token, {
        path: '/',
        sameSite: 'lax',
        secure: pedidoSeguro(req),
        maxAge: 30 * 60 * 1000,
        httpOnly: true,
    });
    res.json({ token });
});

/*
 * A senha do primeiro acesso, para o programa instalado mostrar na tela. Fora do
 * `/api/admin` de proposito: quem ainda nao entrou e' exatamente quem precisa dela.
 * E `null` fora do MODO_LOCAL, entao na nuvem a rota responde 404 e nao entrega nada.
 */
router.get('/api/auth/primeiro-acesso', (_req, res) => {
    const acesso = primeiroAcessoLocal();
    if (!acesso) {
        res.status(404).json({ error: 'Sem primeiro acesso pendente.' });
        return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(acesso);
});

router.post('/api/auth/login', limitePorTentativa({ max: 12, janelaMs: 5 * 60 * 1000 }), async (req, res) => {
    if (!tokenConfere(req)) {
        res.status(403).json({ error: 'Recarregue a pagina e tente de novo.' });
        return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : '';
    const senha = typeof body.senha === 'string' ? body.senha : '';

    if (!email || !senha) {
        res.status(400).json({ error: 'Informe o e-mail e a senha.' });
        return;
    }

    const resultado = await autentica(email, senha);

    /*
     * `=== false` e nao `!ok`: so a comparacao estreita os dois sentidos do uniao.
     * Com `!ok` o ramo de sucesso continuava aberto na linha de baixo, e o
     * acesso a `motivo` virava erro de compilacao.
     */
    if (resultado.ok === false) {
const texto =
            resultado.motivo === 'bloqueado'
                ? `Conta bloqueada por ${resultado.minutosRestantes} min. Tente de novo depois.`
                : resultado.motivo === 'inativo'
                  ? 'Esta conta esta desativada. Fale com o administrador.'
                  : resultado.motivo === 'loja'
                    ? 'A mensalidade desta loja esta em atraso. Regularize para o acesso voltar.'
                    : 'E-mail ou senha incorretos.';
        res.status(resultado.motivo === 'bloqueado' ? 429 : 401).json({ error: texto });
        return;
    }

    const { token, csrf } = await criaSessao(resultado.sessao.userId, req);
    aplicaCookies(res, token, csrf, pedidoSeguro(req));
    log.info('Login', { email: resultado.sessao.email });

    res.json({
        success: true,
        destino: seguroInterno(typeof body.destino === 'string' ? body.destino : '/admin'),
        // A tela usa isto para ir para a troca em vez do painel. Sem a flag, a
        // pessoa entraria com a senha temporaria e teria acesso a tudo.
        trocarSenha: resultado.sessao.precisaTrocarSenha,
    });
});

/* ------------------------------------------------------------------ Saida */

router.post('/api/auth/logout', exigeSessao(), async (req, res) => {
    await encerraSessao(req);
    limpa(req, res);
    res.json({ success: true });
});

/** Saida por link, para nao depender de JavaScript. */
router.get('/sair', async (req, res) => {
    await encerraSessao(req);
    limpa(req, res);
    res.redirect(303, '/entrar');
});

/*
 * Apaga os tres cookies. O `secure` precisa vir junto: um cookie gravado como `Secure`
 * so e' removido por um `Set-Cookie` que tambem o declara -- sem a flag o antigo sobrevive,
 * e como a sessao o reescreve a cada uso, era ele que sobrava: a pessoa saia e voltava.
 */
function limpa(req: Request, res: Parameters<typeof aplicaCookies>[0]): void {
    const base = { path: '/', secure: pedidoSeguro(req), sameSite: 'lax' as const };
    res.clearCookie(NOME_COOKIE, base);
    res.clearCookie(NOME_CSRF, base);
    res.clearCookie(NOME_CSRF_LOGIN, { ...base, maxAge: 30 * 60 * 1000 });
}

/* --------------------------------------------------------- Troca de senha */

router.get('/trocar-senha', async (req, res) => {
    const sessao = await sessaoDoRequest(req);
    if (!sessao) {
        res.redirect(303, '/entrar?destino=%2Ftrocar-senha');
        return;
    }
    const config = await carregarConfig();
    res.send(
        renderTrocaSenha({
            nomeNegocio: config.businessName,
            nome: sessao.nome,
            email: sessao.email,
            obrigatoria: sessao.precisaTrocarSenha,
        })
    );
});

router.post('/api/auth/trocar-senha', exigeSessao(), exigeCsrf(), async (req, res) => {
    const sessao = req.sessao!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const atual = typeof body.atual === 'string' ? body.atual : '';
    const nova = typeof body.nova === 'string' ? body.nova : '';

    const erro = problemaDaSenha(nova);
    if (erro) {
        res.status(400).json({ error: erro });
        return;
    }
    if (atual === nova) {
        res.status(400).json({ error: 'A senha nova precisa ser diferente da atual.' });
        return;
    }

    /*
     * A senha atual e' conferida mesmo na troca forcada: quem pegou a senha
     * temporaria trocaria a senha e ficaria com conta permanente sem nunca ter
     * sabido a senha de verdade.
     */
    const confere = await autentica(sessao.email, atual);
    if (!confere.ok) {
        res.status(401).json({ error: 'A senha atual nao confere.' });
        return;
    }

    await trocaSenha(sessao.userId, nova);

    // A troca apaga as sessoes, inclusive a que esta trocando. Abrir outra e' o
    // que a pessoa espera depois de trocar a senha; sessao morta recarrega o
    // painel e devolve para o login sem explicacao.
    const { token, csrf } = await criaSessao(sessao.userId, req);
    aplicaCookies(res, token, csrf, pedidoSeguro(req));
    log.info('Senha trocada', { email: sessao.email });

    res.json({ success: true, destino: '/admin' });
});

/* ---------------------------------------------------------------- Cadastro */

/**
 * Cadastro de conta de OPERADOR. Nunca de administrador: um cadastro aberto que
 * cria admin e' um botao que qualquer pessoa com o e-mail da loja aperta para tomar
 * o painel. E o cadastro se fecha sozinho assim que a primeira conta existe.
 */
/** A tela entre o cadastro e o login, com o e-mail do dono para consultar o status. */
router.get('/cadastro/aguardando', async (req, res) => {
    const email = normalizaEmail(String(req.query.email ?? ''));
    const destino = seguroInterno(String(req.query.destino ?? '/admin'));
    if (await sessaoDoRequest(req)) {
        res.redirect(303, destino);
        return;
    }
    res.send(renderAguardando({ nomeNegocio: NOME_DO_PRODUTO, email }));
});

router.get('/criar-conta', (_req, res) => {
    /*
     * Antes era a primeira conta do sistema e se fechava sozinha depois dela.
     * Isso descreve loja unica; num SaaS de assinatura a marmitaria n.o 2 entra
     * sem depender da n.o 1. O que decide se o cadastro abre e' o POST.
     */
    res.send(renderCriarConta({ nomeNegocio: NOME_DO_PRODUTO }));
});

/**
 * A senha que o dono recebe ao pagar, buscada pelo e-mail. Fora do `/api/admin`
 * porque quem nao entrou ainda e' quem precisa dela. Quem sabe o e-mail ve a
 * senha -- por isso o limite apertado, e ela some quando o dono troca.
 */
router.get('/api/auth/minha-senha', limitePorTentativa({ max: 8, janelaMs: 5 * 60 * 1000 }), async (req, res) => {
    const email = normalizaEmail(String(req.query.email ?? ''));
    if (!emailValido(email)) {
        res.status(400).json({ error: 'Informe um e-mail valido.' });
        return;
    }

    const assinatura = await prisma.assinatura.findFirst({
        where: { emailDono: email },
        select: { tenantId: true },
    });
    if (!assinatura) {
        res.status(404).json({ error: 'Nao encontramos nenhuma loja com esse e-mail.' });
        return;
    }

    const status = await statusDoDono(assinatura.tenantId);
    const pendente = await senhaDoDonoPendente(assinatura.tenantId);

    /*
     * 402 e' "pague para entrar". O `pagina` vem junto porque e' a unica coisa que
     * o dono pode fazer agora -- mandar so "o pagamento nao caiu" o deixa parado
     * olhando uma tela que ele nao consegue mudar.
     */
    if (!status?.ativo) {
        res.status(402).json({
            error: 'O pagamento da sua loja ainda nao caiu.',
            aguardandoPagamento: true,
            pagina: status?.pagina ?? null,
            testeRestante: status?.testeRestante ?? 0,
            testeAte: status?.testeAte ?? null,
        });
        return;
    }

    if (!pendente) {
        res.status(404).json({ error: 'Essa senha ja foi usada. Entre com a sua senha atual.' });
        return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json(pendente);
});

/** O plano e o preco saem do servidor, nunca do formulario. */
const PLANO_PADRAO = process.env.PLANO_PADRAO?.trim() || 'DeliveryAdmin Mensal';
const VALOR_PADRAO = Number(process.env.VALOR_MENSAL?.trim() || '0');

/**
 * Quantos dias o dono usa sem pagar. `0` desliga o teste: a loja so abre com a
 * mensalidade paga, e e' o que a cobranca de verdade precisa.
 */
function testeDias(): number {
    const n = Number(process.env.TESTE_DIAS?.trim() || '0');
    return Number.isFinite(n) && n > 0 ? Math.min(60, Math.round(n)) : 0;
}

/** 5 por hora e' o limite do token de CSRF; o do cadastro e' mais apertado. */
router.post(
    '/api/auth/criar-conta',
    limitePorTentativa({ max: 5, janelaMs: 60 * 60 * 1000 }),
    async (req, res) => {
        if (!tokenConfere(req)) {
            res.status(403).json({ error: 'Recarregue a pagina e tente de novo.' });
            return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const email = typeof body.email === 'string' ? normalizaEmail(body.email) : '';
        const nome = typeof body.nome === 'string' ? body.nome.trim() : '';
        const nomeLoja = typeof body.nomeLoja === 'string' ? body.nomeLoja.trim() : '';
        const senha = typeof body.senha === 'string' ? body.senha : '';

        /*
         * A senha que o dono digita e' a DEFINITIVA dele: quem assina precisa poder
         * escolher. Com teste, ela ja entra na conta agora -- e o acesso sem pago
         * e' o prazo no banco, nao uma exemptao no login.
         */
        if (!emailValido(email)) {
            res.status(400).json({ error: 'Informe um e-mail valido.' });
            return;
        }
        if (nome.length < 2 || nome.length > 60) {
            res.status(400).json({ error: 'Informe o nome que aparecera no painel.' });
            return;
        }
        if (nomeLoja.length < 2 || nomeLoja.length > 60) {
            res.status(400).json({ error: 'Informe o nome da loja.' });
            return;
        }
        const erro = problemaDaSenha(senha);
        if (erro) {
            res.status(400).json({ error: erro });
            return;
        }

        /*
         * E-mail repetido e' a loja DO DONO: ele pode ter duas marmitarias. Como
         * `User.email` e' unico, o segundo cadastro cai aqui -- e a mensagem tem
         * que mandar ele para a conta certa, nao dizer "e-mail ja usado".
         */
        const jaTem = await prisma.user.findFirst({ where: { email }, select: { tenantId: true } });
        if (jaTem) {
            res.status(409).json({
                error: 'Ja existe uma conta com este e-mail. Entre nela, ou recupere a senha.',
            });
            return;
        }

        const valor = VALOR_PADRAO;
        if (!(valor > 0)) {
            log.error('Cadastro recusado: VALOR_MENSAL nao esta cadastrado no servidor.');
            res.status(503).json({ error: 'O cadastro esta temporariamente indisponivel. Tente mais tarde.' });
            return;
        }

        /*
         * O primeiro vencimento e' o FIM do teste, e nao uma data arbitraria: com
         * teste de 14 dias, cobrar no dia 7 daria a quem esta provando o produto.
         * Sem teste, o vencimento e' em uma semana.
         */
        const dias = testeDias();
        const primeiroVencimento = new Date(Date.now() + (dias || 7) * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);

        let venda;
        try {
            venda = await registraVenda({
                nomeLoja,
                emailDono: email,
                nome,
                senha,
                valor,
                plano: PLANO_PADRAO,
                primeiroVencimento,
                testeDias: dias,
            });
        } catch (erro) {
            log.error('Cadastro falhou ao registrar a venda:', String(erro));
            res.status(502).json({ error: 'Nao conseguimos iniciar sua assinatura. Tente de novo.' });
            return;
        }

        /*
         * A senha escolhida e' guardada para a tela de espera mostrar onde esta o
         * link de pagamento, e apagada no primeiro acesso. Com teste a conta ja
         * existe: ele entra direto, e isto aqui so cobre a consulta de status.
         */
        await guardaSenhaEscolhida(venda.loja, senha).catch((erro) =>
            log.error('Venda ok, mas a senha do dono nao foi guardada:', String(erro))
        );

        log.info('Cadastro publico concluido', { loja: venda.loja, nomeLoja, testeDias: dias });
        res.json({
            success: true,
            loja: venda.loja,
            emTeste: venda.testeAte !== null,
            // Sem teste o dono tem que pagar para entrar: ele vai para a espera.
            destino: venda.testeAte ? '/entrar?primeiraVez=1' : '/cadastro/aguardando',
            email,
        });
    }
);

/* -------------------------------------------------------- Recuperar senha */

/**
 * Sem SMTP, o que existe e' um codigo de uso unico, valido por uma hora, que sai
 * no LOG do servidor. A senha so muda no segundo passo: o codigo prova acesso ao
 * log, e trocar no primeiro deixaria a loja sem acesso por um equivoco.
 */
router.get('/recuperar-senha', async (req, res) => {
    res.send(renderRecuperar({ nomeNegocio: NOME_DO_PRODUTO }));
});

router.post(
    '/api/auth/recuperar',
    limitePorTentativa({ max: 5, janelaMs: 60 * 60 * 1000 }),
    async (req, res) => {
        if (!tokenConfere(req)) {
            res.status(403).json({ error: 'Recarregue a pagina e tente de novo.' });
            return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const email = typeof body.email === 'string' ? normalizaEmail(body.email) : '';
        if (!emailValido(email)) {
            res.status(400).json({ error: 'Informe um e-mail valido.' });
            return;
        }

        const codigo = await geraCodigo(email);
        if (codigo) {
            log.warn('RECUPERACAO pedida', { email, codigo });
        }
        // A resposta e' a mesma com ou sem conta. Dizer "nao encontramos essa
        // conta" entrega a lista de quem tem acesso -- que e' a mesma razao de
        // o login nao dizer se foi o e-mail ou a senha.
        res.json({ success: true, enviado: true });
    }
);

router.post(
    '/api/auth/recuperar-confirmar',
    limitePorTentativa({ max: 8, janelaMs: 30 * 60 * 1000 }),
    async (req, res) => {
        if (!tokenConfere(req)) {
            res.status(403).json({ error: 'Recarregue a pagina e tente de novo.' });
            return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const email = typeof body.email === 'string' ? normalizaEmail(body.email) : '';
        const codigo = typeof body.codigo === 'string' ? body.codigo : '';
        const senha = typeof body.senha === 'string' ? body.senha : '';

        const erroSenha = problemaDaSenha(senha);
        if (erroSenha) {
            res.status(400).json({ error: erroSenha });
            return;
        }

        const erro = await recuperaComCodigo(email, codigo, senha);
        if (erro) {
            res.status(400).json({ error: erro });
            return;
        }

        log.info('Senha recuperada por codigo', { email });
        res.json({ success: true });
    }
);

export default router;
