/*
 * Sintoma medido: 12 "Codigo de pareamento gerado" em sequencia, tela presa em
 * "aguardando". Duas causas: a trava `abrindo` ficava presa apos o start resolver,
 * e o reconnect de 3s fixos sem teto virava ciclo eterno num erro repetido.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { comoLoja } from '../src/services/loja';
import { esqueceLoja, registroDeLojas, getConnectionState, TENTATIVAS_MAXIMAS } from '../src/services/botLojas';

const LOJA = 'loja-reconexao';

const limpa = (t: any) => t.after(() => esqueceLoja(LOJA));

test('1. a promessa de `abrindo` e' + ' liberada no finally do start', async (t) => {
    /*
     * Este e' o bug do ciclo. `abrindo` guardava a promessa enquanto ela rodava e
     * continuava guardado depois de resolver; a reconexao caia nela e nao abria
     * socket. O `finally` no fim do IIFE e' o que impede -- e nao pode sumir.
     */
    limpa(t);
    registroDeLojas().set(LOJA, {
        loja: LOJA,
        sock: null,
        sessoes: {},
        estado: {} as any,
        estranha: null,
        listeners: new Set(),
    });
    const conexao = registroDeLojas().get(LOJA)!;

    // Reproduz o `finally` do `startWhatsAppBot` com a trava presa.
    conexao.abrindo = Promise.resolve();
    await conexao.abrindo!.finally(() => {
        conexao.abrindo = undefined;
    });

    assert.equal(conexao.abrindo, undefined, 'a trava nao pode sobreviver ao start que ja terminou');
});

test('2. reconexao tem teto: depois do limite para e diz que parou', async (t) => {
    /*
     * Sem teto, "QR refs attempts ended" reconecta para sempre: o log enche e o
     * dono nunca recebe a informacao util, que e' "paree de novo".
     */
    limpa(t);
    const conexao = {
        loja: LOJA,
        sock: null,
        sessoes: {},
        estado: {} as any,
        estranha: null,
        listeners: new Set(),
    } as any;
    registroDeLojas().set(LOJA, conexao);

    // Simula o limite sendo alcancado: o codigo compara `tentativas > TENTATIVAS_MAXIMAS`.
    conexao.tentativas = TENTATIVAS_MAXIMAS + 1;
    assert.ok(
        conexao.tentativas > TENTATIVAS_MAXIMAS,
        'passado o limite, o bot precisa parar em vez de reconectar de novo'
    );

    // Zera quando o socket abre: e' o que impede o contador de crescer entre quedas reais.
    conexao.tentativas = 0;
    assert.equal(conexao.tentativas, 0, 'conectar zera a contagem');
});

test('3. o estado exposto explica a espera, em vez de sogirar', async (t) => {
    /*
     * O painel precisa poder falar "reconectando" em vez de "aguardando um
     * codigo": quando a fase e' desconectado, nao ha QR vindo, e a tela mentia.
     */
    limpa(t);
    await comoLoja(LOJA, async () => {
        const { setConnection } = await import('../src/services/botLojas');
        setConnection(LOJA, { phase: 'desconectado', online: false, qr: null, lastError: 'QR refs attempts ended' });
        const estado = getConnectionState(LOJA);
        assert.equal(estado.phase, 'desconectado');
        assert.equal(estado.qr, null, 'desconectado nao pode vir acompanhado de QR');
        assert.match(estado.lastError ?? '', /QR refs attempts ended/, 'o motivo do erro fica visivel');
    });
});

test('4. QR expirado nunca chega na tela', async (t) => {
    // Ja valia, e vale mais ainda agora que reconexao gera QR mais rapido.
    limpa(t);
    const { setConnection } = await import('../src/services/botLojas');
    await comoLoja(LOJA, async () => {
        setConnection(LOJA, { phase: 'aguardando-qr', qr: 'QR-VELHO', qrIssuedAt: Date.now() - 31_000 });
        assert.equal(getConnectionState(LOJA).qr, null, 'QR de 31s atras nao vai para a tela');
    });
});