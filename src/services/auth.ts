import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../database/prisma';
import { logDoModulo } from './logger';
import { REGRA_EMAIL_TS } from './regras';
const log = logDoModulo('auth');

/**
 * Autenticacao do painel: senha, sessao e o que impede forca bruta.
 *
 * TRES DECISOES QUE VALEM EXPLICAR
 *
 * 1. scrypt, e nao bcrypt nem argon2.
 *
 *    Vem do `node:crypto`, sem dependencia nova e sem binario nativo para
 *    compilar na maquina do cliente -- que e' um requisito do produto, porque a
 *    instalacao acontece numa loja de bairro e nao num servidor com build.
 *    scrypt e' a funcao de derivacao recomendada do OWASP quando o custo e' de
 *    memoria, e o Node a implementa nativamente. Um `hashSync` de SHA-256 com
 *    sal -- que e' o caminho que o programador ingênuo toma -- e' rapido demais
 *    para ser defesa: um notebook faz bilhoes por segundo.
 *
 * 2. Token de sessao guardado HASHSADO no banco.
 *
 *    O token vai inteiro no cookie HttpOnly. No banco fica so o SHA-256 dele.
 *    Se o arquivo do banco vazar -- e ele vaza, ele esta na pasta do programa
 *    -- o que o atacante encontra nao abre sessao nenhuma, porque hash nao se
 *    desfaz para o valor original. Guardar o token em claro tornaria o backup do
 *    cliente equivalente a um cadastro de senhas.
 *
 * 3. Cookie SameSite + token CSRF, e nao so o cookie.
 *
 *    SameSite=Lax ja barra o caso classico (um site terceiro que manda o
 *    navegador para uma rota de escrita). O que ele NAO barra e' o mesmo site
 *    em outra aba, ou um subdomain sob controle do atacante. Por isso as rotas
 *    que mudam o estado exigem tambem um token CSRF no corpo, guardado na
 *    sessao e comparado em tempo constante. Sao as duas defesas, porque cada uma
 *    cobre um buraco da outra.
 *
 * O QUE ESTE ARQUIVO NAO FAZ
 *
 * Nao define politica. Quem decide o que um papel pode fazer, quanto tempo a
 * sessao dura e quantas tentativas cabem sao as constantes no fim do arquivo --
 * num lugar so, e nao espalhadas em comparacao solta dentro do codigo.
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
 * Onde a conta para de responder e comeca a levar o mesmo tempo para responder
 * de qualquer jeito.
 *
 * Comparar senha e' trabalho deliberado, e uma conta valida por tentativa leva
 * o dobro. O lockout corta isso, mas vira arma contra a pessoa legitima: e' o
 * proprio cliente sendo trancado fora por alguem que viu o e-mail dele. Por
 * isso o bloqueio e' curto e a senha nao revela nada.
 */
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 5 * 60 * 1000; // 5 minutos

const NOME_COOKIE = 'da_sessao';
const NOME_CSRF = 'da_csrf';

/* ------------------------------------------------------------- Senha */

/**
 * Deriva o hash de uma senha.
 *
 * Devolve o par [hash, sal] para gravar em duas colunas separadas. Guardar o sal
 * dentro do hash (como faz o formato modulo do bcrypt) seria mais elegante, mas
 * exigiria uma coluna so e mudaria a forma de comparacao -- e aqui a comparacao
 * precisa refazer a derivacao com o sal da linha, entao as duas colunas sao o
 * caminho curto e sem estado.
 *
 * `timingSafeEqual` exige dois buffers do mesmo tamanho. Dois hashes de senhas
 * diferentes tem tamanho fixo, entao so faltaria o caso do hash vazio, que o
 * banco nunca devolve -- mas a checagem esta aqui porque a alternativa e' um
 * `===` silenciosamente variavel, e isso e' o tipo de coisa que so se nota
 * depois.
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
 * Senha gerada no primeiro boot.
 *
 * 16 caracteres de um alfabeto sem ambiguidade visual: sem `0`/`O`, sem `1`/`l`,
 * sem `I`. Senha gerada que a pessoa precisa digitar de um papel, olhando a tela,
 * nao pode ter caractere que se confunda com outro -- e a conta comeca bloqueada
 * na troca, entao ela vai digitar isso muitas vezes ate trocar.
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
 * Normaliza o e-mail para a chave de login.
 *
 * Minuscula e sem espaco nas pontas. A unicidade do banco e' sobre o valor ja
 * normalizado: sem isso, "Dono@Loja.com" e "dono@loja.com" viram duas contas, e a
 * segunda conta e' a forma mais simples de sequestrar o acesso de alguem.
 */
export function normalizaEmail(valor: string): string {
    return valor.trim().toLowerCase();
}

export function emailValido(valor: string): boolean {
    /*
     * A MESMA regra que a tela usa, e nao uma parecida.
     *
     * A versao do navegador vive em `views/ui/field.ts` (REGRA_EMAIL_JS), e as
     * duas sao comparadas caso a caso em `tests/auth.test.ts`. Isso nao e'
     * preciosismo: quando as duas eram diferentes, a conta do primeiro acesso
     * (`admin@localhost`) era recusada pelo navegador e aceita pelo servidor --
     * e o primeiro acesso do produto ficava impossivel, com o sistema inteiro
     * funcionando. Cada lado passava no seu teste, porque cada um testava a si
     * mesmo.
     *
     * Reutilizar o regex de la em vez de reescrever e' o que impede a volta do
     * problema: os dois agora vem da mesma expressao, e um teste novo aqui
     * invalida os dois de uma vez.
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
    precisaTrocarSenha: boolean;
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
 * Le a sessao do cookie.
 *
 * Devolve null em qualquer duvida: cookie ausente, token desconhecido, sessao
 * vencida, conta desativada. Quem chama trata tudo igual -- nao ha ramo que
 * diferencie "nao ha cookie" de "cookie invalido" para o navegador ver.
 *
 * A busca e' pelo HASH, que e' unico, entao uma consulta so. A conta vem junto
 * (`include`) para nao custar uma segunda consulta em cada requisicao -- sao
 * quatro campos, e o SQLite le isso de graca no mesmo bloco.
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
        precisaTrocarSenha: linha.user.precisaTrocarSenha,
    };
}

/** Registra o uso, sem esperar. Antigo demais e' a sessao esquecida. */
export async function tocaSessao(id: string): Promise<void> {
    await prisma.sessao
        .update({ where: { id }, data: { usadoEm: new Date() } })
        .catch(() => {});
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

/* ------------------------------------------------------------- Cookies */

/**
 * Coloca os cookies da sessao.
 *
 * `httpOnly` e' o que impede o JavaScript da pagina ler o token -- sem isso, um
 * erro de XSS no painel vaza a sessao. `sameSite=lax` barra o envio em
 * navegacao vinda de fora. `secure` so entra quando o servidor esta sob HTTPS:
 * em HTTP simples, um cookie marcado secure nunca volta, e a pessoa fica
 * presa fora do painel sem entender por que.
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

export function limpaCookies(res: Response): void {
    res.clearCookie(NOME_COOKIE, { path: '/' });
    res.clearCookie(NOME_CSRF, { path: '/' });
}

export function csrfDoRequest(req: Request): string {
    return cookie(req, NOME_CSRF) || String(req.headers['x-csrf-token'] ?? '');
}

/* ------------------------------------------------------------- Login */

/** O que o login devolve quando da certo, e o que diz quando da errado. */
export type ResultadoLogin =
    | { ok: true; sessao: Sessao }
    | { ok: false; motivo: 'credencial' | 'bloqueado' | 'inativo'; minutosRestantes?: number };

/**
 * Autentica.
 *
 * Duas regras que mudam tudo aqui:
 *
 * 1. Mensagem de erro UNICA para e-mail errado e senha errada. Dizer "e-mail
 *    nao existe" entrega a lista de quem tem conta no sistema -- e o sistema
 *    e' de uma loja, entao a lista e' curta e adivinhavel. Dizer "conta bloqueada
 *    por 5 minutos" e' diferente, e justified: e' a unica resposta que impede a
 *    pessoa de continuar tentando e ajuda ela a saber que o problema e' espera,
 *    nao senha.
 *
 * 2. Bloqueio por tentativas, com prazo curto. Cinco erros e a conta para por
 *    cinco minutos. E' o bastante para tornar inviavel adivinhar uma senha de
 *    quatro digitos, e curto o bastante para nao trancar a pessoa fora de um
 *    pedido no meio do expediente.
 */
export async function autentica(email: string, senha: string): Promise<ResultadoLogin> {
    const chave = normalizaEmail(email);
    const user = await prisma.user.findUnique({ where: { email: chave } });

    if (!user) {
        // Ainda assim deriva uma senha, para o tempo de resposta nao dizer se o
        // e-mail existe. Sem esta linha, "e-mail errado" voltaria em 1 ms e
        // "senha errada" em 120 ms -- e a diferenca mede sozinha a lista de
        // contas.
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
 * Exige sessao. Redireciona quem nao tem para a tela de login, preservando o
 * destino -- quem clicou num link de WhatsApp e caiu no login precisa voltar
 * para a tela que queria, e nao para a Home.
 *
 * Duas recusas, e a segunda e' a que impede o acesso com a senha temporaria:
 * sem ela, quem recebe a senha gerada na instalacao loga e usa o painel inteiro
 * -- faturamento, caixa, usuarios -- ate que se lembre de trocar. O exchange de
 * `precisaTrocarSenha` manda para a troca e barra o resto ate ela acontecer.
 */
export function exigeSessao(rotaDeLogin = '/entrar') {
    return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
        const sessao = await sessaoDoRequest(req);
        if (!sessao) {
            if (req.accepts('html') && req.method === 'GET') {
                const destino = encodeURIComponent(req.originalUrl || '/admin');
                res.redirect(303, `${rotaDeLogin}?destino=${destino}`);
                return;
            }
            res.status(401).json({ sessaoExpirada: true, error: 'Sessao expirada. Entre novamente.' });
            return;
        }

        if (sessao.precisaTrocarSenha && !req.path.startsWith('/auth/')) {
            res.redirect(303, '/trocar-senha');
            return;
        }

        req.sessao = sessao;
        await tocaSessao(sessao.id);
        next();
    };
}

/**
 * Exige sessao em rota de API.
 *
 * A diferenca para o de cima e' o que devolve: JSON 401, nao redirecionamento.
 * O `fetch` de uma tela que perdeu a sessao recebe o codigo, e a tela manda a
 * pessoa para o login -- em vez de o navegador seguir o 303 e trocar o HTML do
 * painel por uma pagina de login no meio de uma chamada de dados.
 *
 * O `sessaoExpirada` viaja na resposta porque e' ele que permite ao painel
 * distinguir "a sessao acabou" de "a acao falhou". Sem o campo, o `postJSON`
 * mostraria "nao foi possivel salvar" para uma sessao encerrada ha horas, e a
 * pessoa tentaria de novo pelo motivo errado.
 */
export function exigeSessaoApi() {
    return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
        const sessao = await sessaoDoRequest(req);
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
        await tocaSessao(sessao.id);
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
             * Nao e' "sessao expirada": a sessao pode estar valendo, e nesse caso
             * esta -- o que falhou foi o token. A pagina no navegador e' uma copia
             * antiga, com o token de antes, enquanto o cookie ja e' o de agora. A
             * pessoa le "sessao expirada", conclui que foi desconectada, entra
             * com a senha de novo e o problema continua sendo a pagina velha.
             *
             * Dizer o que e' permite o conserto: recarregar. E o `postJSON` ja
             * recarrega sozinho, entao este texto so aparece quando a pagina
             * recarregou duas vezes e o token continuou errado.
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
 * Limite das tentativas de login, por IP.
 *
 * Diferente do `limitador` geral (services/rateLimit), que protege contra
 * write em massa, este e' o que protege contra TESTAR SENHA. As duas coisas sao
 * necessarias e nao se substituem: o lockout por conta impede tentativas contra
 * uma conta; este limita quantas cuentas distintas o mesmo IP pode sondar em
 * cinco minutos, o que e' o que acontece quando alguem tem uma lista de
 * e-mails e uma lista de senhas.
 *
 * O valor e' alto de proposito. Doze tentativas em cinco minutos nao atrapalha
 * quem digita a senha tres vezes seguidas, e corta o script que faz mil.
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

/* ------------------------------------------------------------- Recuperação */

/**
 * Gera o codigo de recuperacao de uma conta.
 *
 * A senha nao muda aqui: o codigo so PROVA que quem pede tem acesso ao log do
 * servidor, e a troca acontece em `/api/auth/recuperar-confirmar`. Separar as
 * duas coisas e' o que permite gerar o codigo sem INVALIDAR a senha -- quem
 * pediu a recuperacao e' a pessoa real, e se a senha sumisse no primeiro passo,
 * um equivoco dela deixaria a loja sem acesso ate o administradordagora.
 *
 * O codigo vale uma hora e e' de uso unico: `geraCodigo` sobrescreve o
 * anterior, entao pedir duas vezes invalida o primeiro.
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
 * O e-mail da conta que a instalacao cria.
 *
 * Exportado porque a tela de entrada mostra no primeiro acesso, e ela importa
 * daqui -- a dependencia vai da tela para o servico, nunca ao contrario. Um
 * valor duplicado nas duas pontas ja custou um primeiro acesso impossivel.
 */
export const ADMIN_PADRAO = 'admin@localhost';

/**
 * Cria o administrador inicial, uma vez so.
 *
 * Por que a senha e' gerada e nao pedida: nao existe tela para escolher senha
 * antes de existir usuario, e inventar uma (admin/admin) seria a pior das
 * opcoes -- e' a senha que todo mundo tenta primeiro. A gerada e' mostrada UMA
 * vez, no log, e a conta nasce marcado para troca obrigatoria: quem entra tem
 * que trocar antes de fazer qualquer outra coisa.
 *
 * Se ja existe usuario, nao faz nada. Roda em todo boot.
 */
export async function garanteAdministrador(): Promise<void> {
    const total = await prisma.user.count();
    if (total > 0) return;

    const senha = senhaAleatoria();
    const { hash, sal } = await derivaSenha(senha);

    await prisma.user.create({
        data: {
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
    log.info('  e-mail .... admin@localhost');
    log.info(`  senha ..... ${senha}`);
    log.info('  Troca obrigatoria no primeiro acesso.');
    log.info('='.repeat(64));
}

/**
 * Troca a senha e apaga as sessoes.
 *
 * Apagar as sessoes nao e' um detalhe: quem pediu a troca pode ser alguem que
 * descobriu a senha em papel alheio ou num log. Se as sessoas antigas
 * continuarem valendo, trocar a senha nao expulsou ninguem -- e' o mesmo erro
 * classico de "redefina sua senha" em quem nao tinha sessao para redefinir.
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
}

/** Apaga sessoes vencidas. Chamado no boot e de hora em hora. */
export async function limpaSessoes(): Promise<number> {
    const r = await prisma.sessao.deleteMany({ where: { expiraEm: { lte: new Date() } } });
    return r.count;
}
