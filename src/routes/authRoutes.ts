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
    recuperaComCodigo,
    sessaoDoRequest,
    trocaSenha,
} from '../services/auth';
import { logDoModulo } from '../services/logger';
import { problemaDaSenha } from '../services/regras';
import { renderLogin, renderTrocaSenha, renderCriarConta, renderRecuperar, seguroInterno } from '../views/login';
import { carregarConfig } from '../services/config';
const log = logDoModulo('authRoutes');

/**
 * Entrada, saida, troca de senha, cadastro e recuperacao.
 *
 * O login e' o UNICO endpoint do sistema onde uma senha pode ser testada mil
 * vezes, entao ele tem limite proprio por IP, alem do lockout por conta que
 * mora no servico. Os dois sao necessarios: o lockout impede tentativas contra
 * uma conta, e o limite por IP impede sondar uma lista de contas.
 *
 * O CSRF do login nao pode vir do cookie de sessao -- ainda nao existe sessao.
 * Ele vem de um cookie de uso unico que este router cria ao servir a pagina, e
 * e' o que impede um site de terceiro de mandar o navegador da pessoa tentar
 * entrar com uma conta que o site's dono conhece.
 */
const router = Router();

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
 * Confere o token do formulario contra o cookie.
 *
 * A comparacao e' de igualdade simples, e nao `timingSafeEqual`: os dois
 * lados nao sao segredo -- o token esta no HTML que o navegador acabou de
 * receber e no cookie que o navegador acabou de mandar. O que se protege aqui
 * e' a origem do pedido, nao o valor.
 */
function tokenConfere(req: Request): boolean {
    const doCookie = cookieBruta(req, NOME_CSRF_LOGIN);
    const doCorpo = String((req.body as Record<string, unknown>)?.csrf ?? req.headers['x-csrf-token'] ?? '');
    return doCookie.length > 0 && doCookie === doCorpo;
}

/**
 * HTTPS de verdade: confia no cabecalho do proxy, e so se ele disser que sim.
 *
 * A checagem existe por causa do cookie com flag `secure`: marcado em HTTP
 * simples, ele nunca volta, e a pessoa fica presa na tela de login sem entender
 * por que. Pior que isso: a tela de login e' justamente onde a pessoa vai
 * descobrir que algo esta errado, e o sintoma seria "a conta nao entra".
 */
function pedidoSeguro(req: Request): boolean {
    return req.secure || req.headers['x-forwarded-proto'] === 'https';
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

    const config = await carregarConfig();
    res.send(
        renderLogin({
            nomeNegocio: config.businessName,
            destino,
            primeiroAcesso: (await prisma.user.count()) === 0,
        })
    );
});

/**
 * Serve o token do formulario.
 *
 * E' POST, e nao GET, por um motivo que ja custou uma tela morta: a rota era
 * GET e a tela chamava por `postJSON`, que faz POST. O navegador recebia 405,
 * o `fetch` nao lancava excecao, e o `catch` do envio mostrava "nao foi possivel
 * falar com o servidor" -- com o servidor no ar, respondendo, e a pessoa
 *_convicta de que era a maquina.
 *
 * POST tambem e' o metodo certo: a chamada muda estado, porque grava o cookie do
 * token. GET que escreve cookie e' o que faz o navegador recusar em alguns
 * cenarios e o que confunde quem le o codigo depois.
 *
 * O token volta no corpo e fica tambem num cookie HttpOnly, e sao os dois que
 * precisam bater na hora do envio. Nao ha segredo no valor: o que se protege e'
 * a ORIGEM do pedido. Quem consegue ler o corpo le o token, e quem consegue ler
 * o token le o corpo -- o que nao acontece de um site de terceiro, que nao tem
 * nenhum dos dois.
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
     * `=== false` e nao `!ok`.
     *
     * O encurtamento negando o discriminante nao questa versao do compilador
     * estreita o uniao: na linha de baixo ele ainda via o ramo de sucesso, e o
     * acesso a `motivo` era erro de compilacao. Comparar com `false` estreita
     * nos dois sentidos, e deixa a intencao explicita -- que e' o que o leitor
     * precisa ver num bloco que decide entre "entrou" e "nao entrou".
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
    limpa(res);
    res.json({ success: true });
});

/** Saida por link, para nao depender de JavaScript. */
router.get('/sair', async (req, res) => {
    await encerraSessao(req);
    limpa(res);
    res.redirect(303, '/entrar');
});

function limpa(res: Parameters<typeof aplicaCookies>[0]): void {
    res.clearCookie('da_sessao', { path: '/' });
    res.clearCookie('da_csrf', { path: '/' });
    res.clearCookie(NOME_CSRF_LOGIN, { path: '/' });
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
     * A senha atual e' conferida mesmo quando a troca e' forcada.
     *
     * Sem esta linha, quem pegou a senha temporaria trocava a senha e tomava
     * conta permanente sem nunca ter sabido a senha de verdade -- que e' o
     * caminho mais curto para assumir um sistema. E o que faz a troca forcada
     * servir para alguma coisa em vez de ser um formulario a mais.
     */
    const confere = await autentica(sessao.email, atual);
    if (!confere.ok) {
        res.status(401).json({ error: 'A senha atual nao confere.' });
        return;
    }

    await trocaSenha(sessao.userId, nova);

    // A troca apaga as sessoas -- inclusive a que esta fazendo a troca. Abri
    // outra e devolvida: voltar a entrar e' o que a pessoa espera depois de
    // trocar a senha, e deixar a sessao morta faria o painel recarregar e
    // devolver para o login sem explicacao.
    const { token, csrf } = await criaSessao(sessao.userId, req);
    aplicaCookies(res, token, csrf, pedidoSeguro(req));
    log.info('Senha trocada', { email: sessao.email });

    res.json({ success: true, destino: '/admin' });
});

/* ---------------------------------------------------------------- Cadastro */

/**
 * Cadastro de conta de OPERADOR.
 *
 * Deliberadamente nao cria administrador. O sistema e' de uma loja, e um
 * cadastro aberto que cria administrador e' um botao que qualquer pessoa com o
 * e-mail da loja pode apertar e tomar o painel. Quem administra e' quem criou o
 * primeiro acesso -- e o cadastro se fecha sozinho assim que a primeira conta
 * existe, sem ninguem precisar lembrar de fechar.
 */
router.get('/criar-conta', async (req, res) => {
    if ((await prisma.user.count()) > 0) {
        res.redirect(303, '/entrar?cadastro=fechado');
        return;
    }
    const config = await carregarConfig();
    res.send(renderCriarConta({ nomeNegocio: config.businessName }));
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
            data: { email, nome, senhaHash: hash, senhaSalt: sal, papel: 'operador' },
        });
        log.info('Conta de operador criada', { email });

        res.json({ success: true });
    }
);

/* -------------------------------------------------------- Recuperar senha */

/**
 * Recuperacao sem e-mail, e a razao de existir e' ser honesta sobre o que o
 * sistema tem.
 *
 * Nao ha SMTP, nao ha conta de e-mail, e numa instalacao de loja isso seria mais
 * um servico para configurar antes de a pessoa usar o produto. Um botao
 * "esqueci minha senha" que pede um link que nunca chega e' pior do que nao ter
 * o botao: a pessoa espera, e a espera e' o defeito.
 *
 * O que existe: um codigo de uso unico, valido por uma hora, que sai no LOG do
 * servidor. Quem tem o log tem a maquina -- e quem nao tem pede ao administrador,
 * que redefine pela tela de usuarios.
 *
 * A senha nao muda no primeiro passo. O codigo so PROVA acesso ao log; a troca
 * acontece no segundo. Se a senha sumisse no primeiro, um equivoco da propria
 * pessoa deixaria a loja sem acesso.
 */
router.get('/recuperar-senha', async (req, res) => {
    const config = await carregarConfig();
    res.send(renderRecuperar({ nomeNegocio: config.businessName }));
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
