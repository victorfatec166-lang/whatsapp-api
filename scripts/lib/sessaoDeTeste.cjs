/*
 * Sessao para quem testa a API de fora.
 *
 * POR QUE EXISTE
 *
 * `scripts/check-ui.js`, `scripts/check-js.js` e `tests/paginacao.test.ts`
 * pedem as rotas do painel ao servidor de verdade, e nao montam o HTML sozinhos.
 * Isso e' deliberado -- o que eles verificam e' o que o navegador recebe, e o
 * HTML montado em teste nao passa pelo mesmo caminho de dados que o HTML real.
 *
 * Desde que o painel tem senha, essas chamadas levam 401 sem sessao, e os tres
 * verificadores passam a "conferir" a tela de login em vez do painel: um verde
 * falso que e' pior que nenhuma verificacao. A solucao e' o que este arquivo
 * faz -- entrar de verdade e devolver o cabecalho de cookie.
 *
 * O QUE ESTE ARQUIVO NAO E
 *
 * Nao e' uma porta dos fundos no servidor. Nao existe rota de teste, nem
 * bypass, nem parametro que oligue a autenticacao: o login acontece pelo mesmo
 * `POST /api/auth/login` que o navegador usa, com senha conferida por scrypt
 * como qualquer outra.
 *
 * A unica coisa que ele faz de diferente e' GARANTIR a conta: se o e-mail de
 * teste nao existir, cria com uma senha conhecida. Sem isso, o primeiro `npm
 * test` numa maquina nova falharia por nao ter conta, e o segundo falharia
 * porque a pessoa trocou a senha na tela de troca obrigatoria.
 *
 * A conta e' de operador e nunca administra: um teste quebrado nao consegue
 * desligar a conta do dono.
 */

const { PrismaClient } = require('@prisma/client');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL = process.env.TESTE_EMAIL || 'teste@local';
const SENHA = process.env.TESTE_SENHA || 'Teste#Local2026';

/*
 * Duas conexoes e `$disconnect` no fim, e nao um cliente solto.
 *
 * O pooler do Supabase conta SESSAO e limita a 15 no total, o mesmo teto que o
 * painel ja impõe a si mesmo (`src/database/prisma.ts`). Um `new PrismaClient()`
 * sem teto abre pool para quantas CPUs a maquina tiver, e enquanto este script
 * segura uma sessao o painel perde a cota dele -- a Home abre dez consultas em
 * paralelo e caía em 500 com "Erro interno ao carregar o painel", erro que nao
 * tem nada com o codigo sob teste.
 */
const prisma = new PrismaClient({
    datasourceUrl: (() => {
        const url = process.env.DATABASE_URL;
        if (!url || url.includes('connection_limit')) return url;
        return `${url}${url.includes('?') ? '&' : '?'}connection_limit=2`;
    })(),
});

/** Derivacao igual a do servico: scrypt com sal novo, mesmos parametros. */
async function derivaSenha(senha) {
    const crypto = require('node:crypto');
    const sal = crypto.randomBytes(16).toString('hex');
    const hash = await new Promise((ok, er) => {
        crypto.scrypt(senha.normalize('NFKC'), sal, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) =>
            e ? er(e) : ok(k)
        );
    });
    return { hash: hash.toString('hex'), sal };
}

/** Cria a conta de teste se ela nao existir. Operador, nunca administrador. */
async function garanteConta() {
    try {
        await garanteContaInterna();
    } finally {
        await prisma.$disconnect();
    }
}

async function garanteContaInterna() {
    const existente = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (existente) {
        // Ja existe e a senha pode ter sido trocada por um teste anterior que
        // passou pela tela de troca. Resetar e' o que torna o teste repetivel.
        const { hash, sal } = await derivaSenha(SENHA);
        await prisma.user.update({
            where: { id: existente.id },
            data: { senhaHash: hash, senhaSalt: sal, ativo: true, precisaTrocarSenha: false, tentativas: 0, bloqueadoAte: null },
        });
        return;
    }

    // `User` exige a loja: e' ela que diz de quem e' a conta no painel. A linha
    // da loja ja existe -- quem garante e' o boot do servidor, que sobe antes.
    const loja = process.env.DELIVERYADMIN_TENANT?.trim() || 'local';
    await prisma.tenant.upsert({ where: { id: loja }, update: {}, create: { id: loja, name: 'Loja de teste', ativo: true } });

    const { hash, sal } = await derivaSenha(SENHA);
    await prisma.user.create({
        data: {
            email: EMAIL,
            nome: 'Teste automatico',
            senhaHash: hash,
            senhaSalt: sal,
            papel: 'operador',
            ativo: true,
            precisaTrocarSenha: false,
            tenant: { connect: { id: loja } },
        },
    });
}

/** Token do formulario: o login exige o mesmo CSRF que o navegador envia. */
async function tokenDoFormulario() {
    // POST, e nao GET. A tela chama por `postJSON`, que faz POST; a rota sendo
    // GET respondia 405, o fetch nao lanca excecao, e o catch do envio
    // mostrava "nao foi possivel falar com o servidor" com o servidor no ar.
    const res = await fetch(`${BASE}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (!res.ok) throw new Error(`token: HTTP ${res.status}`);
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    const dados = await res.json();
    return { token: dados.token, cookie };
}

/**
 * Entra e devolve o cabecalho `Cookie` pronto.
 *
 * Devolve `Cookie: ...` e nao so o valor, porque quem usa faz
 * `fetch(url, { headers: { Cookie: sessao } })` -- e um valor solto ali
 * produzia um header invalido que o servidor ignorava em silencio, com o
 * verificador contando aquilo como 401.
 */
async function sessaoDeTeste() {
    await garanteConta();
    const { token, cookie } = await tokenDoFormulario();

    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ email: EMAIL, senha: SENHA, destino: '/admin', csrf: token }),
    });

    if (!res.ok) {
        const corpo = await res.text();
        throw new Error(`login de teste falhou: HTTP ${res.status} ${corpo.slice(0, 200)}`);
    }

    const sessao = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    return { Cookie: sessao };
}

module.exports = { sessaoDeTeste, garanteConta, EMAIL, SENHA, BASE };
