import { parseItems } from './items';

/**
 * Comanda da cozinha.
 *
 * E' o papel que sai na impressora termica quando o pedido entra. Duas coisas
 * valem a pena dizer antes do codigo:
 *
 * 1. A comanda NAO e' o espelho da tela do PDV. E' uma folha de trabalho da
 *    cozinha, e ela e' diferente porque e' lida com as maos sujas, as duas
 *    ocupadas, num lugar onde a luz e' ruim. Por isso: numero grande no topo,
 *    item e modificador em linhas separadas, nada de coluna apertada, e nada
 *    de valor -- a cozinha nao precisa saber quanto custou, e o preco no papel
 *    vira ponto de disputa no meio do expediente.
 *
 * 2. O texto vem do campo `items` que o priceCart gravou, lido pelo mesmo
 *    parseItems() do resto do sistema. Nao ha segunda forma de interpretar o
 *    item: se a comanda e o relatorio discordarem, e' porque o gravador mudou,
 *    e nao porque cada tela le de um jeito.
 *
 * Formato ESC/POS
 *
 * O texto puro serve para quem abre em bloco de notas, e e' o mesmo conteudo.
 * O ESC/POS serve para a impressora: 0x1B 0x40 reseta a impressora e 0x1D 0x56
 * corta o papel. Sao os dois comandos minimos de qualquer impressora
 * termica compativel, e mandamos sem depender de biblioteca: o pacote inteiro
 * cabe em duas linhas e nao traz nenhuma dependencia nova para um sistema que
 * roda local.
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
 * Telefone do cliente em formato curto, como quem anota no papel.
 *
 * O bot grava o jid inteiro (5511999999999@s.whatsapp.net). Na comanda isso
 * sao 30 caracteres que ninguem copia, entao fica so o numero.
 */
function telefoneCurto(jid: string): string {
    const digitos = jid.replace(/\D/g, '');
    if (digitos.length <= 11) return digitos;
    return digitos.slice(-11);
}

function horaLocal(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Monta a comanda.
 *
 * `numero` e' a etiqueta humana do pedido. O id completo e' util no sistema,
 * mas no papel e' ruido: o balcao precisa de algo que caiba na boca, e e' por
 * isso que o numero vai no topo em corpo grande.
 */
export function montarComanda(c: Comanda): ComandaTexto {
    const itens = parseItems(c.order.items);
    const L: string[] = [];

    // --- cabecalho: o que a pessoa le primeiro, de longe ---
    L.push(centralizar(c.businessName.toUpperCase()));
    L.push(centralizar('PEDIDO #' + c.numero));
    L.push('');
    L.push(`#${c.numero}   ${horaLocal(new Date(c.order.createdAt))}`);
    L.push(linha('='));

    // --- cliente: so o que ajuda a identificar ---
    const nome = (c.order.clientName ?? '').trim();
    const tel = telefoneCurto(c.order.clientPhone);
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
