/**
 * Hora ao dono, nao a hora do servidor. O Render roda em UTC, e comanda, caixa, card
 * do pedido e log do turno abriam tres horas atrasados de Sao Paulo. O fuso esta num
 * lugar so (services/fuso.ts); estes testes impedem que volte a ler o fuso da maquina.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { horaDoDono } from '../src/services/fuso';

/** 15:04 de Sao Paulo. A mesma hora em UTC sao 18:04. */
const MEIA_TARDE = new Date('2026-10-07T15:04:00-03:00');

function comTZ(tz: string, fn: () => string): string {
    const antes = process.env.TZ;
    process.env.TZ = tz;
    try {
        return fn();
    } finally {
        if (antes === undefined) delete process.env.TZ;
        else process.env.TZ = antes;
    }
}

test('a hora do dono e a de Sao Paulo, nao a da maquina', () => {
    assert.equal(comTZ('UTC', () => horaDoDono(MEIA_TARDE)), '15:04');
});

test('a hora nao muda com o fuso de quem gera a tela', () => {
    const emUtc = comTZ('UTC', () => horaDoDono(MEIA_TARDE));
    const emTokyo = comTZ('Asia/Tokyo', () => horaDoDono(MEIA_TARDE));
    const emNovaYork = comTZ('America/New_York', () => horaDoDono(MEIA_TARDE));
    assert.equal(emUtc, emTokyo);
    assert.equal(emUtc, emNovaYork);
});

test('meia-noite continua meia-noite: o dia nao vira a noite', () => {
    const meiaNoite = new Date('2026-10-07T00:05:00-03:00');
    assert.equal(comTZ('UTC', () => horaDoDono(meiaNoite)), '00:05');
});

test('as opcoes do chamador continuam valendo, junto com o fuso', () => {
    const comSegundos = comTZ('UTC', () => horaDoDono(MEIA_TARDE, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    assert.match(comSegundos, /^15:04:00$/);
});