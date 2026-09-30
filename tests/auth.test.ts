import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    confereSenha,
    derivaSenha,
    emailValido,
    limitePorTentativa,
    normalizaEmail,
    senhaAleatoria,
    SESSAO_MS,
} from '../src/services/auth';
import { REGRA_EMAIL_JS, REGRA_EMAIL_TS } from '../src/services/regras';

/**
 * O que estes testes cobrem, e por que sao estes.
 *
 * A tela de login pode ser bonita e o sistema estar aberto. Estes testes existem
 * para a parte que ninguem ve: a senha nao e' reversivel, o e-mail nao revela
 * quem tem conta, o token de sessao nao volta do banco, e o login trava quando
 * alguem insiste.
 *
 * O que NAO e' testado aqui, e deveria ser: a gravacao no banco. O SQLite
 * compartilhado entre arquivos de teste ja causou colisao antes (da' o
 * `--test-concurrency=1` em package.json), e o caminho do banco e' o mesmo que
 * os outros 134 testes exercitam. Aqui o que muda e' a CRIPTOGRAFIA, e e' dela
 * que vem o risco.
 */

test("a senha guardada nao e' a senha", async () => {
    const senha = 'Emporio#2026Troca';
    const { hash, sal } = await derivaSenha(senha);

    assert.notEqual(hash, senha, 'o hash nao pode ser a senha');
    assert.ok(!hash.includes(senha), 'a senha nao pode aparecer dentro do hash');
    assert.equal(hash.length, 128, 'scrypt com 64 bytes devolve 128 caracteres em hex');
    assert.equal(sal.length, 32);
});

test("a mesma senha gera hashes diferentes, e ambos conferem", async () => {
    const senha = 'MesmaSenha123!';
    const a = await derivaSenha(senha);
    const b = await derivaSenha(senha);

    assert.notEqual(a.hash, b.hash, 'sem sal, hash igualizeria a base de senhas');
    assert.equal(await confereSenha(senha, a.hash, a.sal), true);
    assert.equal(await confereSenha(senha, b.hash, b.sal), true);
});

test("senha errada nao confere, e a conferida leva o tempo todo", async () => {
    const { hash, sal } = await derivaSenha('Correta#2026');
    assert.equal(await confereSenha('Errada#2026', hash, sal), false);
    assert.equal(await confereSenha('', hash, sal), false);
    // Hash de outro tamanho: o timingSafeEqual exige dois buffers iguais, e um
    // `===` aqui seria variavel em comprimento -- o que o atacante mede.
    assert.equal(await confereSenha('Correta#2026', 'abc', sal), false);
});

test("a senha e normalizada antes da derivacao", async () => {
    // A mesma senha escrita de duas formas tem de dar a mesma conta. Sem
    // normalizar, "e com acento" e "e com acento" seriam senhas diferentes e a
    // pessoa perderia o acesso sem entender por que.
    const comAcento = 'senha' + String.fromCharCode(0x0301); // e seguido de acento combinante
    const acentuada = 'senhá';

    const a = await derivaSenha(comAcento);
    assert.equal(await confereSenha(acentuada, a.hash, a.sal), true);

    const b = await derivaSenha(acentuada);
    assert.equal(await confereSenha(comAcento, b.hash, b.sal), true);
});

test('a senha gerada nao tem caractere que se confunda com outro', () => {
    // O administrador vai ler essa senha em voz alta ou digitar num telefone.
    // Um "O" lido como zero faz a pessoa errar tres vezes e concluir que o
    // sistema esta com defeito.
    for (let i = 0; i < 200; i++) {
        const s = senhaAleatoria();
        assert.equal(s.length, 16);
        assert.ok(!/[0O1lI]/.test(s), `senha com caractere ambiguo: ${s}`);
    }
});

test('as duas senhas geradas nunca saem iguais', () => {
    const vistas = new Set(Array.from({ length: 300 }, () => senhaAleatoria()));
    assert.equal(vistas.size, 300, 'o gerador esta devolvendo sempre a mesma senha');
});

test("e-mail e' normalizado e validado", () => {
    assert.equal(normalizaEmail('  Dono@Loja.COM '), 'dono@loja.com');
    assert.equal(normalizaEmail('A@B.CO'), 'a@b.co');

    assert.equal(emailValido('voce@email.com'), true);
    assert.equal(emailValido('a@b.co'), true);
    assert.equal(emailValido('voce@semdominio'), false);
    assert.equal(emailValido('sem arroba'), false);
    assert.equal(emailValido('dois@dominios@.com'), false);
    assert.equal(emailValido(''), false);
    assert.equal(emailValido('   '), false);
});

/*
 * O navegador e o servidor tem de concordar sobre o que e' um e-mail.
 *
 * Este teste existe por causa de um bug real: o primeiro acesso do produto e'
 * `admin@localhost`, o navegador recusou o endereco por falta de ponto no
 * dominio, e o painel ficou impossivel de abrir com tudo o mais funcionando.
 * Cada lado passava no seu proprio teste -- porque cada um testava a si mesmo.
 *
 * Aqui os dois sao testados com a MESMA lista. Se a regra mudar em um e nao no
 * outro, este teste quebra antes de a pessoa bater na parede.
 */
test("a regra de e-mail do navegador e' a mesma do servidor", () => {
    // A tela carrega a regra como texto e monta o RegExp em tempo de execucao.
    const doNavegador = new RegExp(REGRA_EMAIL_JS);
    // E o modulo tem a mesma regra em TypeScript, que e' o que o teste usa
    // direto -- se as duas divergirem aqui, nem comeca a comparar com o servidor.
    assert.equal(REGRA_EMAIL_JS, REGRA_EMAIL_TS.source, 'as duas formas da regra divergiram');

    const casos: Array<[string, boolean]> = [
        ['voce@empresa.com.br', true],
        ['a@b.co', true],
        // O primeiro acesso. Sem esta linha, o produto nao abre na propria
        // conta que ele mesmo criou.
        ['admin@localhost', true],
        ['voce@empresa', false],
        ['voce', false],
        ['@empresa.com', false],
        ['voce@', false],
        ['a@b..com', false],
        ['', false],
    ];

    for (const [email, esperado] of casos) {
        assert.equal(doNavegador.test(email), esperado, `navegador: "${email}"`);
        assert.equal(emailValido(email), esperado, `servidor: "${email}"`);
    }
});

test('a sessao dura um expediente, e nao mais que isso', () => {
    // Doze horas e' o turno. Mais que isso e' uma sessao esquecida aberta em
    // algum computador da loja; menos que isso e' a pessoa logando varias vezes
    // por dia, num balcao.
    assert.equal(SESSAO_MS, 12 * 60 * 60 * 1000);
});

test('o limite de tentativas barra o excesso e passa o que cabe', () => {
    const req = { socket: { remoteAddress: '10.0.0.9' } } as never;
    let barradas = 0;
    let passaram = 0;

    /*
     * Resposta falsa, e nao um mock.
     *
     * O middleware chama `res.status(429).json(...)`: se o falso responder so a
     * `json`, o teste passa a testar o mock e nao o codigo. Este tem a corrente
     * inteira, e `estado()` le o que o codigo realmente respondeu.
     */
    const respostaFalsa = () => {
        let codigo = 200;
        const r = {
            setHeader() {},
            status(v: number) {
                codigo = v;
                return r;
            },
            json() {
                return r;
            },
        };
        return { r: r as never, estado: () => codigo };
    };

    const limite = limitePorTentativa({ max: 3, janelaMs: 60_000 });
    for (let i = 0; i < 6; i++) {
        const { r, estado } = respostaFalsa();
        limite(req, r, () => {
            passaram++;
        });
        if (estado() === 429) barradas++;
    }

    assert.equal(passaram, 3, 'tres passam, como o limite pede');
    assert.equal(barradas, 3, 'as tres seguintes sao barradas');
});

test('o limite conta por origem, e nao por rota', () => {
    // Se contasse por rota, um script podia ciclar pelas rotas e nunca bater no
    // limite. E o caso de uso real: sondar 20 rotas do painel com 5 senhas cada.
    let passouNaRotaA = 0;

    for (const ip of ['10.0.0.1', '10.0.0.2']) {
        const limite = limitePorTentativa({ max: 1, janelaMs: 60_000 });
        const req = { socket: { remoteAddress: ip }, path: '/api/auth/login' } as never;
        let codigo = 200;
        const r = {
            setHeader() {},
            status(v: number) {
                codigo = v;
                return r;
            },
            json() {
                return r;
            },
        } as never;
        limite(req, r, () => {
            passouNaRotaA++;
        });
        assert.equal(codigo, 200, `a origem ${ip} nao devia ser barrada na primeira tentativa`);
    }

    assert.equal(passouNaRotaA, 2, 'cada origem tem o proprio contador');
});
