/*
 * Quem o Render pode ligar no boot.
 *
 * Banco e' o mesmo da nuvem e do PC: sem a lista a maquina do dono abre socket das
 * lojas de todos. E se a loja do dono ficasse de fora, o bot dela ficaria off.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const CHAVE = 'DELIVERYADMIN_LOJAS';
const TENANT = 'DELIVERYADMIN_TENANT';

/**
 * Recarrega `loja.ts` com o ambiente atual.
 *
 * O modulo le `process.env` quando e' importado, entao um unico import nao serve:
 * cada caso precisa da sua copia, senao todos veriam a lista do caso anterior.
 */
async function bootAutorizadoAgora(): Promise<(loja: string) => boolean> {
    const { bootAutorizado } = await import(`../src/services/loja.ts?caso=${Math.random()}`);
    return bootAutorizado;
}

const restaura = (valores: Record<string, string | undefined>) => {
    for (const [chave, valor] of Object.entries(valores)) {
        if (valor === undefined) delete process.env[chave];
        else process.env[chave] = valor;
    }
};

test('sem a lista, tudo sobe: e o que o dono quer no PC', async () => {
    process.env[CHAVE] = '';
    try {
        const bootAutorizado = await bootAutorizadoAgora();
        assert.equal(bootAutorizado('qualquer-loja'), true);
        assert.equal(bootAutorizado('outra-loja'), true);
    } finally {
        restaura({ [CHAVE]: undefined });
    }
});

test('com a lista, so as lojas citadas sobem', async () => {
    process.env[CHAVE] = 'minha-loja, outra';
    try {
        const bootAutorizado = await bootAutorizadoAgora();
        assert.equal(bootAutorizado('minha-loja'), true, 'a loja do dono nao subiu');
        assert.equal(bootAutorizado('outra'), true, 'a loja citada nao subiu');
        assert.equal(bootAutorizado('loja-de-outro-cliente'), false, 'abriu socket de outro cliente');
    } finally {
        restaura({ [CHAVE]: undefined });
    }
});

test('a loja do boot entra mesmo fora da lista', async () => {
    /*
     * Quem configurou a maquina e' quem ela tem que atender. Se a loja do boot
     * ficasse de fora, o dono configurava a lista e perdia o proprio bot sem aviso
     * -- e o sintoma seria "nao conecta", de novo.
     */
    process.env[CHAVE] = 'outra-loja';
    process.env[TENANT] = 'minha-loja-do-boot';
    try {
        const bootAutorizado = await bootAutorizadoAgora();
        assert.equal(bootAutorizado('minha-loja-do-boot'), true, 'a loja do boot ficou de fora');
        assert.equal(bootAutorizado('terceira-loja'), false);
    } finally {
        restaura({ [CHAVE]: undefined, [TENANT]: undefined });
    }
});

test('espaco e linha em branco na lista nao viram loja', async () => {
    process.env[CHAVE] = ' minha-loja , , outra ';
    try {
        const bootAutorizado = await bootAutorizadoAgora();
        assert.equal(bootAutorizado('minha-loja'), true);
        assert.equal(bootAutorizado('outra'), true);
        assert.equal(bootAutorizado(''), false, 'entrou uma loja de nome vazio');
    } finally {
        restaura({ [CHAVE]: undefined });
    }
});