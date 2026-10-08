import crypto from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../database/prisma';
import { logDoModulo } from './logger';
import { REGRA_EMAIL_TS } from './regras';
import { comoLoja, exigeLoja, lojaDoBoot } from './loja';
import { ARQUIVO_PRIMEIRO_ACESSO } from './paths';
import { apagaSenhaDoDono } from './assinaturas-destino';
const log = logDoModulo('auth');

/**
 * scrypt vem do node:crypto: sem binario nativo, porque a instalacao acontece
 * numa loja sem build. Token de sessao fica HASHSADO -- arquivo vazado nao abre
 * sessao. SameSite nao cobre o mesmo site em outra aba, entao escrita exige CSRF.
 */

/* ------------------------------------------------------------- Constantes */

const TAMANHO_SAL = 16;
const TAMANHO_HASH = 64;

/** scrypt: o que cada parametro controla. Os valores sao os do OWASP. */
const SCRYPT = {
    N: 16384, // custo de memoria (2^14)
    r: 8, // custo de CPU
    p: 1, // paralelismo
    maxmem: 64 * 1024 * 1024,
};

/** Quanto tempo uma sessao viva dura sem ser renovada. */
export const SESSAO_MS = 12 * 60 * 60 * 1000; // 12 horas: um expediente

/**
 * Lockout curto de proposito: longo demais tranca a pessoa legitima fora por
 * culpa de quem viu o e-mail dela. A resposta de erro nao revela se a conta existe.
 */
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 5 * 60 * 1000; // 5 minutos

const NOME_COOKIE = 'da_sessao';
const NOME_CSRF = 'da_csrf';

/* ------------------------------------------------------------- Senha */

/**
* Sal e hash em colunas separadas, e nao embutidos como no bcrypt: a comparacao
 * refaz a derivacao com o sal da linha, entao duas colunas sao o caminho sem
 * estado. O tamanho e' conferido porque timingSafeEqual exige buffers iguais.
 */
export async function derivaSenha(senha: string): Promise<{ hash: string; sal: string }> {
    const sal = crypto.randomBytes(TAMANHO_SAL).toString('hex');
    const derivada = await scrypt(senha, sal);
    return { hash: derivada.toString('hex'), sal };
}

function scrypt(senha: string, sal: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        crypto.scrypt(senha.normalize('NFKC'), sal, TAMANHO_HASH, SCRYPT, (err, key) => {
            if (err) reject(err);
            else resolve(key);
        });
    });
}

/** Confere a senha contra o par gravado. */
export async function confereSenha(senha: string, hash: string, sal: string): Promise<boolean> {
    try {
        const derivada = await scrypt(senha, sal);
        const guardado = Buffer.from(hash, 'hex');
        if (guardado.length !== derivada.length) return false;
        return crypto.timingSafeEqual(derivada, guardado);
    } catch (e) {
        return false;
    }
}

/**
 * 16 caracteres sem ambiguidade visual (sem 0/O, 1/l, I): a pessoa digita isso
 * de um papel, e a conta comeca bloqueada na troca -- vai digitar ate trocar.
 */
export function senhaAleatoria(): string {
    const alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(16);
    let saida = '';
    for (const b of bytes) saida += alfabeto[b % alfabeto.length];
    return saida;
}

/* ------------------------------------------------------------- E-mail */

/**
 * A unicidade do banco e' sobre o valor normalizado: sem isso "Dono@Loja.com" e
 * "dono@loja.com" viravam duas contas, e a segunda e' sequestro de acesso facil.
 */
export function normalizaEmail(valor: string): string {
    return valor.trim().toLowerCase();
}

export function emailValido(valor: string): boolean {
    /*
     * A MESMA expressao que a tela usa (views/ui/field.ts), nao uma parecida:
     * quando as duas divergiam, admin@localhost era recusado no navegador e
     * aceito no servidor, e o primeiro acesso do produto ficava impossivel.
     */
    return REGRA_EMAIL_TS.test(normalizaEmail(valor));
}


/* ------------------------------------------------------------- Sessao */

function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export type Sessao = {
    id: string;
    userId: string;
    email: string;
    nome: string;
    papel: string;
    /** A loja da pessoa. Vem do usuario, nunca da URL -- ver `sessaoDoRequest`. */
    tenantId: string;
    precisaTrocarSenha: boolean;
    /**
     * Quando a sessao vence no banco, e `undefined` antes de ela existir: `autentica`
     * devolve este mesmo tipo para dizer que a conta serve, e ainda nao ha linha em
     * `Sessao`. Ausente significa "ainda nao renovar" -- que e' o que `tocaSessao` faz.
     */
    expiraEm?: Date;
};

/** Abre sessao e devolve os cookies a colocar na resposta. */
export async function criaSessao(
    userId: string,
    req: Request
): Promise<{ token: string; csrf: string; expiraEm: Date }> {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    const expiraEm = new Date(Date.now() + SESSAO_MS);

    await prisma.sessao.create({
        data: {
            tokenHash: hashToken(token),
            userId,
            ip: req.socket.remoteAddress ?? '',
            agente: String(req.headers['user-agent'] ?? '').slice(0, 200),
            expiraEm,
        },
    });

    return { token, csrf, expiraEm };
}

/**
 * Null em qualquer duvida -- cookie ausente, token desconhecido, sessao
 * vencida, conta desativada -- para o navegador nao diferenciar os casos.
 * A busca e' pelo hash, que e' unico, entao uma consulta so.
 */
export async function sessaoDoRequest(req: Request): Promise<Sessao | null> {
    const token = cookie(req, NOME_COOKIE);
    if (!token) return null;

    const linha = await prisma.sessao.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
    });
    if (!linha) return null;

    if (linha.expiraEm.getTime() <= Date.now()) {
        // Vencida: apaga na hora. Sessoes mortas na tabela sao o que faz a tela de
        // "acessos" mostrar sessao que ninguem tem mais.
        await prisma.sessao.delete({ where: { id: linha.id } }).catch(() => {});
        return null;
    }
    if (!linha.user.ativo) return null;

    return {
        id: linha.id,
        userId: linha.user.id,
        email: linha.user.email,
        nome: linha.user.nome,
        papel: linha.user.papel,
        /*
         * A loja e' vinculada ao registro do usuario na sessao;
         * nao vem de parametro na URL para evitar vazamento cruzado.
         */
        tenantId: linha.user.tenantId,
        precisaTrocarSenha: linha.user.precisaTrocarSenha,
        expiraEm: linha.expiraEm,
    };
}

const INTERVALO_DE_USO_MS = 5 * 60 * 1000;

/*
 * Renova o PRAZO, e nao so o registro de uso: turno de 13 horas e' comum na loja, e com a
 * validade fixa a pessoa era jogada para o login no meio do expediente. O `Set-Cookie` vem junto
 * -- sem ele o cookie morre na hora original, com a sessao viva no banco. E o token e' reaproveitado.
 */
export function tocaSessao(req: Request, res: Response, sessao: Sessao): void {
    const agora = new Date();
    const novoPrazo = new Date(agora.getTime() + SESSAO_MS);

    void prisma.sessao
        .updateMany({
            where: { id: sessao.id, usadoEm: { lt: new Date(agora.getTime() - INTERVALO_DE_USO_MS) } },
            data: { usadoEm: agora, expiraEm: novoPrazo },
        })
        .catch(() => {});

    // Na metade do prazo, e nao a cada requisicao: o header a mais em toda chamada
    // custaria caro e nao traria ganho antes disso.
    const falta = sessao.expiraEm ? sessao.expiraEm.getTime() - agora.getTime() : 0;
    if (falta < SESSAO_MS / 2) {
        res.cookie(NOME_COOKIE, cookie(req, NOME_COOKIE), {
            path: '/',
            sameSite: 'lax',
            secure: pedidoSeguro(req),
            maxAge: SESSAO_MS,
            httpOnly: true,
        });
    }
}

export async function encerraSessao(req: Request): Promise<void> {
    const token = cookie(req, NOME_COOKIE);
    if (!token) return;
    await prisma.sessao.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => {});
}

/** Encerra todas as sessoes de um usuario. Usado ao trocar a senha e ao desativar. */
export async function encerraSessoesDe(userId: string): Promise<number> {
    const r = await prisma.sessao.deleteMany({ where: { userId } });
    return r.count;
}

/** Le um cookie sem dependencia. */
function cookie(req: Request, nome: string): string {
    const bruto = req.headers.cookie;
    if (!bruto) return '';
    for (const parte of bruto.split(';')) {
        const [chave, ...resto] = parte.trim().split('=');
        if (chave === nome) return decodeURIComponent(resto.join('='));
    }
    return '';
}

/*
 * O pedido veio por HTTPS. No Render o TLS termina no proxy, entao o Express ve HTTP e
 * o `x-forwarded-proto` e' a unica fonte que diz a verdade: sem confiar nele o cookie
 * `secure` nunca seria gravado -- HTTPS funcionando e sessao que nao persiste.
 */
export function pedidoSeguro(req: Request): boolean {
    return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/* ------------------------------------------------------------- Cookies */

/*
 * httpOnly impede o JS ler o token: sem isso um XSS vaza a sessao. `secure` so entra sob
 * HTTPS, e `strict` no SameSite ficou de fora de proposito -- o link de `?destino=` que o dono
 * recebe e' a forma comum de entrar, e com `strict` o cookie nao voltaria junto com ele.
 */
export function aplicaCookies(res: Response, token: string, csrf: string, seguro: boolean): void {
    const comum = {
        path: '/',
        sameSite: 'lax' as const,
        secure: seguro,
        maxAge: SESSAO_MS,
    };
    res.cookie(NOME_COOKIE, token, { ...comum, httpOnly: true });
    // O CSRF precisa ser legivel pelo JavaScript da pagina: e' ele que vai no
    // corpo da requisicao. Por isso NAO e' httpOnly -- e por isso ele nao vale
    // nada sozinho, sem o cookie que o navegador manda sozinho.
    res.cookie(NOME_CSRF, csrf, comum);
}

export function csrfDoRequest(req: Request): string {
    return cookie(req, NOME_CSRF) || String(req.headers['x-csrf-token'] ?? '');
}

/* ------------------------------------------------------------- Login */

/** O que o login devolve quando da certo, e o que diz quando da errado. */
export type ResultadoLogin =
    | { ok: true; sessao: Sessao }
    | { ok: false; motivo: 'credencial' | 'bloqueado' | 'inativo' | 'loja'; minutosRestantes?: number };

/**
 * Erro unico para e-mail e senha errados: a lista de contas do sistema e' curta
 * e adivinhavel. Bloqueio curto: 5 tentativas por 5 minutos torna inviavel uma
 * senha de 4 digitos sem trancar a pessoa legitima no meio de um pedido.
 */
export async function autentica(email: string, senha: string): Promise<ResultadoLogin> {
    const chave = normalizaEmail(email);
    const user = await prisma.user.findUnique({ where: { email: chave } });

    if (!user) {
        // Deriva mesmo assim: sem esta linha o tempo de resposta diz se o e-mail
        // existe (1 ms contra 120 ms), e a diferenca mede a lista de contas.
        await scrypt(senha, 'inexistente-para-gastar-o-mesmo-tempo');
        return { ok: false, motivo: 'credencial' };
    }

    if (user.bloqueadoAte && user.bloqueadoAte.getTime() > Date.now()) {
        const minutos = Math.max(1, Math.ceil((user.bloqueadoAte.getTime() - Date.now()) / 60000));
        return { ok: false, motivo: 'bloqueado', minutosRestantes: minutos };
    }

    if (!user.ativo) {
        await scrypt(senha, 'inexistente-para-gastar-o-mesmo-tempo');
        return { ok: false, motivo: 'inativo' };
    }

    /*
     * Loja desligada e' assinatura vencida ou cancelada. Sem esta conferences
     * `Tenant.ativo` so era lido por jobs, e a loja suspensa entrava normalmente
     * -- o campo existe desde o primeiro dia para este fim e nunca foi lido aqui.
     */
    const loja = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { ativo: true } });
    if (loja && !loja.ativo) {
        await scrypt(senha, 'inexistente-para-gastar-o-mesmo-tempo');
        return { ok: false, motivo: 'loja' };
    }

    const confere = await confereSenha(senha, user.senhaHash, user.senhaSalt);

    if (!confere) {
        const tentativas = user.tentativas + 1;
        await prisma.user.update({
            where: { id: user.id },
            data: {
                tentativas,
                bloqueadoAte: tentativas >= MAX_TENTATIVAS ? new Date(Date.now() + BLOQUEIO_MS) : null,
            },
        });
        log.warn('Senha errada', { email: chave, tentativas });
        return { ok: false, motivo: 'credencial' };
    }

    // Zera o contador: a pessoa entrou, entao nao ha mais o que bloquear.
    await prisma.user.update({
        where: { id: user.id },
        data: { tentativas: 0, bloqueadoAte: null, ultimoLogin: new Date() },
    });

    return {
        ok: true,
        sessao: {
            id: user.id,
            userId: user.id,
            email: user.email,
            nome: user.nome,
            papel: user.papel,
            tenantId: user.tenantId,
            precisaTrocarSenha: user.precisaTrocarSenha,
        },
    };
}

/* ------------------------------------------------------------- Middleware */

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            sessao?: Sessao;
        }
    }
}

/**
 * Preserva o destino no redirect: quem clicou num link de WhatsApp precisa
 * voltar para a tela que queria. A segunda recusa e' a que impede o acesso com
 * a senha temporaria -- sem ela o painel inteiro abre ate alguem lembrar de trocar.
 */
export function exigeSessao(rotaDeLogin = '/entrar') {
    return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
        const sessao = (req.sessao ??= await sessaoDoRequest(req));
        if (!sessao) {
            if (req.accepts('html') && req.method === 'GET') {
                const destino = encodeURIComponent(req.originalUrl || '/admin');
                res.redirect(303, `${rotaDeLogin}?destino=${destino}`);
                return;
            }
            res.status(401).json({ sessaoExpirada: true, error: 'Sessao expirada. Entre novamente.' });
            return;
        }

        /*
         * A senha provisoria barra o painel, mas nao a troca dela: a excecao cobre os
         * dois caminho (`/trocar-senha` e `POST /api/auth/trocar-senha`). Sem o
         * segundo, a troca era barrada pela regra que existe para barrar o resto.
         */
        const ehLoginOuTroca = req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/');
        if (sessao.precisaTrocarSenha && !ehLoginOuTroca) {
            res.redirect(303, '/trocar-senha');
            return;
        }

        req.sessao = sessao;
        tocaSessao(req, res, sessao);
        next();
    };
}

/**
 * JSON 401 em vez de redirect: um fetch que perdeu a sessao receberia um 303 e
 * trocaria o HTML do painel por uma pagina de login no meio de uma chamada de
 * dados. sessaoExpirada no corpo distingue "a sessao acabou" de "a acao falhou".
 */
export function exigeSessaoApi() {
    return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
        const sessao = (req.sessao ??= await sessaoDoRequest(req));
        if (!sessao) {
            res.status(401).json({ sessaoExpirada: true, error: 'Sessao expirada. Entre novamente.' });
            return;
        }

        if (sessao.precisaTrocarSenha && !req.path.startsWith('/auth/')) {
            res.status(403).json({
                precisaTrocarSenha: true,
                error: 'Troque a senha provisoria antes de usar o painel.',
            });
            return;
        }

        req.sessao = sessao;
        tocaSessao(req, res, sessao);
        next();
    };
}

/** O CSRF vale para quem muda estado. Ler nao precisa. */
export function exigeCsrf() {
    return function (req: Request, res: Response, next: NextFunction): void {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
        if (!req.sessao) {
            res.status(401).json({ error: 'Sem sessao.' });
            return;
        }
        const enviado = String((req.body && req.body.csrf) ?? req.headers['x-csrf-token'] ?? '');
        const esperado = csrfDoRequest(req);
        const a = Buffer.from(enviado);
        const b = Buffer.from(esperado);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            log.warn('CSRF recusado', { rota: req.path });
            /*
             * Nao e' "sessao expirada": o que falhou foi o token, e a pagina e' uma
             * copia antiga. Dizer o que e' permite o conserto, que e' recarregar.
             */
            res.status(403).json({ error: 'Sua pagina ficou desatualizada. Recarregue e tente de novo.' });
            return;
        }
        next();
    };
}

/** Exige o papel de administrador. */
export function exigeAdmin() {
    return function (req: Request, res: Response, next: NextFunction): void {
        if (req.sessao?.papel !== 'admin') {
            res.status(403).json({ error: 'Apenas o administrador pode fazer isso.' });
            return;
        }
        next();
    };
}

/* ------------------------------------------------------------- Limites */

/**
 * Nao e' o limitador geral (rateLimit), que protege contra write em massa: este
 * conta quantas contas distintas um IP pode sondar -- ataque de lista de senhas.
 * O valor e' alto para nao atrapalhar quem erra a senha tres vezes seguidas.
 */
export function limitePorTentativa(limite: { max: number; janelaMs: number }) {
    const tentativas = new Map<string, number[]>();

    return function (req: Request, res: Response, next: NextFunction): void {
        const chave = req.socket.remoteAddress || 'desconhecido';
        const agora = Date.now();
        const recentes = (tentativas.get(chave) ?? []).filter((t) => agora - t < limite.janelaMs);

        if (recentes.length >= limite.max) {
            const espera = Math.max(1, Math.ceil((limite.janelaMs - (agora - recentes[0])) / 1000));
            res.setHeader('Retry-After', String(espera));
            res.status(429).json({
                error: `Muitas tentativas. Espere ${Math.ceil(espera / 60)} minuto(s) e tente de novo.`,
            });
            return;
        }

        recentes.push(agora);
        tentativas.set(chave, recentes);
        next();
    };
}

/* ------------------------------------------------------------- Recuperacao */

/**
 * A senha nao muda aqui: o codigo so PROVA acesso ao log do servidor, e a troca
 * acontece em /api/auth/recuperar-confirmar -- pedir o codigo nao pode deixar a
 * loja sem acesso. Pedir duas vezes invalida o primeiro, porque este sobrescreve.
 */
export async function geraCodigo(email: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { email: normalizaEmail(email) } });
    if (!user) return null;

    // Seis caracteres de um alfabeto sem digitos parecidos: o codigo vai ser
    // lido de um terminal e digitado num campo de senha, e "0"vs"O" e "1"vs"l"
    // custam uma segunda tentativa a quem ja esta sem a senha.
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(6);
    let codigo = '';
    for (const b of bytes) codigo += alfabeto[b % alfabeto.length];

    await prisma.user.update({
        where: { id: user.id },
        data: { codigoRecuperacao: codigo, recuperacaoExpiraEm: new Date(Date.now() + 60 * 60 * 1000) },
    });
    return codigo;
}

/** Confere o codigo e troca a senha. Apaga as sessoes. */
export async function recuperaComCodigo(email: string, codigo: string, senhaNova: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { email: normalizaEmail(email) } });
    if (!user) return 'Codigo invalido.';
    if (!user.codigoRecuperacao || !user.recuperacaoExpiraEm) return 'Nao ha recuperacao pendente para esta conta.';
    if (user.recuperacaoExpiraEm.getTime() < Date.now()) {
        await prisma.user.update({ where: { id: user.id }, data: { codigoRecuperacao: null, recuperacaoExpiraEm: null } });
        return 'O codigo expirou. Peca outro.';
    }

    const a = Buffer.from(codigo.toUpperCase().trim());
    const b = Buffer.from(user.codigoRecuperacao);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'Codigo invalido.';

    await trocaSenha(user.id, senhaNova);
    return null;
}

/* ------------------------------------------------------------- Primeiro boot */

/**
 * Exportado porque a tela de entrada mostra no primeiro acesso: a dependencia
 * vai da tela para o servico, nunca ao contrario. Valor duplicado nas duas
 * pontas ja custou um primeiro acesso impossivel.
 */
export const ADMIN_PADRAO = 'admin@localhost';

/**
 * Garante tenant padrao e gera senha inicial do administrador no primeiro boot.
 * A senha inicial e' impressa uma unica vez e exige troca no login.
 */
export async function garanteAdministrador(): Promise<void> {
    const LOJA_DO_BOOT = lojaDoBoot();

    const jaTem = await prisma.tenant.findUnique({ where: { id: LOJA_DO_BOOT } });
    if (!jaTem) {
        await prisma.tenant.create({
            data: { id: LOJA_DO_BOOT, name: 'Minha loja', ativo: true },
        });
    }

    await comoLoja(LOJA_DO_BOOT, async () => {
        const total = await prisma.user.count();
        if (total > 0) return;

        const senha = senhaAleatoria();
        const { hash, sal } = await derivaSenha(senha);

        await prisma.user.create({
            data: {
                tenantId: exigeLoja(),
                email: ADMIN_PADRAO,
                nome: 'Administrador',
                senhaHash: hash,
                senhaSalt: sal,
                papel: 'admin',
                precisaTrocarSenha: true,
            },
        });

        log.info('='.repeat(64));
        log.info('USUARIO ADMINISTRADOR CRIADO');
        log.info(`  e-mail .... ${ADMIN_PADRAO}`);
        log.info(`  loja ...... ${LOJA_DO_BOOT}`);
        log.info(`  senha ..... ${senha}`);
        log.info('  Troca obrigatoria no primeiro acesso.');
        log.info('='.repeat(64));

        /*
         * O log serve quem desenvolve. Quem instala o programa nunca abre um: ve
         * tela de login e nao tem de onde tirar a senha. `trocaSenha` apaga o
         * arquivo, para a promessa de "uma vez so" valer nos dois lugares.
         */
        gravaPrimeiroAcesso(senha);
    });
}

/** Escreve a senha do primeiro acesso. Falhar aqui nao impede o boot. */
function gravaPrimeiroAcesso(senha: string): void {
    try {
        writeFileSync(
            ARQUIVO_PRIMEIRO_ACESSO,
            JSON.stringify({ email: ADMIN_PADRAO, senha, criadoEm: new Date().toISOString() }, null, 2),
            'utf8'
        );
    } catch (erro) {
        log.warn('Nao consegui gravar o arquivo de primeiro acesso:', String(erro));
    }
}

/**
 * A senha do primeiro acesso, ou `null`. Le ONLY no modo local: na nuvem o log ja
 * resolve e um endpoint que entrega senha a quem chega na porta e' risco demais.
 */
export function primeiroAcessoLocal(): { email: string; senha: string } | null {
    if (!process.env.MODO_LOCAL) return null;
    try {
        if (!existsSync(ARQUIVO_PRIMEIRO_ACESSO)) return null;
        const lido = JSON.parse(readFileSync(ARQUIVO_PRIMEIRO_ACESSO, 'utf8')) as { email?: string; senha?: string };
        return lido.email && lido.senha ? { email: lido.email, senha: lido.senha } : null;
    } catch {
        return null;
    }
}

/** Apaga a senha do primeiro acesso, depois que ela foi trocada. */
export function apagaPrimeiroAcesso(): void {
    try {
        if (existsSync(ARQUIVO_PRIMEIRO_ACESSO)) rmSync(ARQUIVO_PRIMEIRO_ACESSO, { force: true });
    } catch {
        // Sem apagar, o arquivo fica com senha velha: e' melhor um aviso do que
        // um boot que falha por causa de arquivo de texto.
    }
}

/**
 * Apagar as sessoes e' o que da sentido a troca: quem pediu pode ter achado a
 * senha em papel alheio ou num log, e sessao antiga valendo nao expulsou ninguem.
 */
export async function trocaSenha(userId: string, senhaNova: string): Promise<void> {
    const { hash, sal } = await derivaSenha(senhaNova);
    await prisma.user.update({
        where: { id: userId },
        data: {
            senhaHash: hash,
            senhaSalt: sal,
            precisaTrocarSenha: false,
            tentativas: 0,
            bloqueadoAte: null,
        },
    });
    await encerraSessoesDe(userId);

    // A senha do primeiro acesso valeu ate aqui. Depois disto ela nao abre mais nada.
    apagaPrimeiroAcesso();

    /*
     * Mesma promessa para a senha de loja: vale ate ele trocar. Sem esta linha a
     * `CredencialProvisional` ficaria para sempre, e `/minha-senha` entregaria uma
     * senha velha a quem soubesse o e-mail.
     */
    const lojaDaConta = await prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
    if (lojaDaConta) await apagaSenhaDoDono(lojaDaConta.tenantId);
}

/** Apaga sessoes vencidas. Chamado no boot e de hora em hora. */
export async function limpaSessoes(): Promise<number> {
    const r = await prisma.sessao.deleteMany({ where: { expiraEm: { lte: new Date() } } });
    return r.count;
}
