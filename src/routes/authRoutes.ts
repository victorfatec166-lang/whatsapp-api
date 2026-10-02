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
    recuperaComCodigo,
    sessaoDoRequest,
    trocaSenha,
} from '../services/auth';
import { logDoModulo } from '../services/logger';
import { problemaDaSenha } from '../services/regras';
import { renderLogin, renderTrocaSenha, renderCriarConta, renderRecuperar, seguroInterno } from '../views/login';
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
     * O nome e' do PRODUTO, e nao da loja: esta rota roda sem sessao, e sem sessao
     * nao ha loja. E antes de autenticar a tela nao tem como saber de quem e' a
     * conta que esta entrando -- o nome da loja aparece no painel, depois.
     */
    res.send(
        renderLogin({
            nomeNegocio: NOME_DO_PRODUTO,
            destino,
            primeiroAcesso: (await prisma.user.count()) === 0,
        })
    );
});

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
router.get('/criar-conta', async (req, res) => {
    if ((await prisma.user.count()) > 0) {
        res.redirect(303, '/entrar?cadastro=fechado');
        return;
    }
    // O nome do PRODUTO, e nao `carregarConfig()`: o `Config` e' da loja, e esta
    // rota roda sem loja. A razao e' a mesma do GET /entrar, e o efeito seria o
    // mesmo -- a tela nao abriria.
    res.send(renderCriarConta({ nomeNegocio: NOME_DO_PRODUTO }));
});

router.post(
    '/api/auth/criar-conta',
    limitePorTentativa({ max: 5, janelaMs: 60 * 60 * 1000 }),
    async (req, res) => {
        if (!tokenConfere(req)) {
            res.status(403).json({ error: 'Recarregue a pagina e tente de novo.' });
            return;
        }
        if ((await prisma.user.count()) > 0) {
            res.status(403).json({ error: 'O cadastro esta fechado. Peca a um administrador para criar a sua conta.' });
            return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const email = typeof body.email === 'string' ? normalizaEmail(body.email) : '';
        const nome = typeof body.nome === 'string' ? body.nome.trim() : '';
        const senha = typeof body.senha === 'string' ? body.senha : '';

        if (!emailValido(email)) {
            res.status(400).json({ error: 'Informe um e-mail valido.' });
            return;
        }
        if (nome.length < 2 || nome.length > 60) {
            res.status(400).json({ error: 'Informe o nome que aparecera no painel.' });
            return;
        }
        const erro = problemaDaSenha(senha);
        if (erro) {
            res.status(400).json({ error: erro });
            return;
        }

const { hash, sal } = await derivaSenha(senha);
        await prisma.user.create({
            data: {
                tenantId: lojaDoBoot(),
                email,
                nome,
                senhaHash: hash,
                senhaSalt: sal,
                papel: 'operador',
            },
        });
        log.info('Conta de operador criada', { email });

        res.json({ success: true });
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
