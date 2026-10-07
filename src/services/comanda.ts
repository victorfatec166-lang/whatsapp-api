import { parseItems } from './items';
import { FUSO, horaDoDono } from './fuso';

/**
 * Comanda da cozinha: nao espelha o PDV, porque e' lida com as maos sujas e as
 * duas ocupadas -- numero grande no topo, item e modificador em linhas separadas,
 * e sem valor (preco no papel vira discussao de troco).
 */

/** Largura padrao das impressoras termicas de 80 colunas, o mais comum. */
const COLUNAS = 42;

function linha(caractere = '-', largura = COLUNAS): string {
    return caractere.repeat(largura);
}

function centralizar(texto: string, largura = COLUNAS): string {
    const t = texto.slice(0, largura);
    const espacos = Math.max(0, Math.floor((largura - t.length) / 2));
    return ' '.repeat(espacos) + t;
}

function truncar(texto: string, largura: number): string {
    return texto.length <= largura ? texto : texto.slice(0, largura - 1) + '~';
}

export type Comanda = {
    order: {
        id: string;
        clientPhone: string;
        clientName: string | null;
        items: string;
        notes: string | null;
        status: string;
        channel: string;
        createdAt: Date;
    };
    businessName: string;
    /** Numero curto e falado, para o balcao gritar "numero 47". */
    numero: number;
    /** Numero de verdade do cliente, quando o pedido guarda um endereco @lid. */
    telefone?: string;
    /** Fuso de quem pediu a comanda; sem ele, o padrao do servidor. */
    fuso?: string;
};

export type ComandaTexto = {
    /** Para conferir na tela. */
    linhas: string[];
    /** Texto pronto para a impressora, com quebras de linha. */
    texto: string;
    /** Mesmo conteudo, com os comandos de reset e corte do ESC/POS. */
    escpos: string;
};

/**
 * Telefone do cliente em formato curto, como quem anota no papel. O bot grava o
 * endereco inteiro (55188887777@s.whatsapp.net), 30 caracteres que ninguem copia,
 * entao fica so o numero -- e o ":12" depois dele e' o DEVICE, nao entra.
 */
function telefoneCurto(enderco: string): string {
    // "@lid" nao tem telefone: e' o indice de privacidade do WhatsApp, e tirar os
    // nao-digitos dele fabricava um numero que nao existe. A linha simplesmente nao
    // sai -- quem resolve o numero de verdade passa em `Comanda.telefone`.
    if (enderco.endsWith('@lid')) return '';
    const digitos = enderco.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (digitos.length <= 11) return digitos;
    return digitos.slice(-11);
}

function horaLocal(d: Date, fuso?: string): string {
    return horaDoDono(d, { hour: '2-digit', minute: '2-digit' }, fuso ?? FUSO);
}

/**
 * Monta a comanda. `numero` e' a etiqueta humana do pedido: o id completo e'
 * ruido no papel, e o balcao precisa de algo que caiba na boca.
 */
export function montarComanda(c: Comanda): ComandaTexto {
    const itens = parseItems(c.order.items);
    const L: string[] = [];

    // --- cabecalho: o que a pessoa le primeiro, de longe ---
    L.push(centralizar(c.businessName.toUpperCase()));
    L.push(centralizar('PEDIDO #' + c.numero));
    L.push('');
    L.push(`#${c.numero}   ${horaLocal(new Date(c.order.createdAt), c.fuso)}`);
    L.push(linha('='));

    // --- cliente: so o que ajuda a identificar ---
    const nome = (c.order.clientName ?? '').trim();
    const tel = telefoneCurto(c.telefone?.trim() || c.order.clientPhone);
    if (nome) L.push(truncar(nome, COLUNAS));
    if (tel) L.push(truncar('Tel ' + tel, COLUNAS));
    if (nome || tel) L.push(linha('-'));

    // --- itens: um por bloco, modificador em linha propria ---
    for (const item of itens) {
        L.push(`${item.qty}x ${truncar(item.name, COLUNAS - 5)}`);
        // Modificador fica indentado e sozinho: e' instrucao para quem monta,
        // nao continuacao do nome. "Sem cebola" colado no nome some na hora
        // que a linha passa de 40 colunas.
        for (const mod of item.mods) {
            L.push('   - ' + truncar(mod, COLUNAS - 5));
        }
    }

    // --- observacao: a parte que mais importa e a ultima ---
    const obs = (c.order.notes ?? '').trim();
    if (obs) {
        L.push('');
        L.push(linha('-'));
        L.push('OBS: ' + truncar(obs, COLUNAS - 5));
    }

    L.push(linha('='));

    // --- sem total, de proposito ---
    // A cozinha nao precisa do valor, e numero na comanda vira discussao de
    // troco na hora de montar. O valor vive no Faturamento, que exige senha.

    const texto = L.join('\n');
    return {
        linhas: L,
        texto,
        escpos: '\x1B\x40' + texto + '\n\n\n' + '\x1D\x56\x00',
    };
}
