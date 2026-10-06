import { Response } from 'express';
import { lojaAtual, lojaDoBoot } from './loja';

/**
 * Cada tela conectada e' de uma loja. Sem a loja no cliente do SSE, um pedido novo
 * de uma loja recarregava o painel das outras: o dado nao vazava, mas o dono da
 * loja vizinha via o ritmo de movimento do concorrente na propria tela.
 */
type Cliente = { loja: string; res: Response };

let clientes: Cliente[] = [];

/** Evita vazamento de memoria: remove clientes que ja fecharam o socket. */
function prune(): void {
    clientes = clientes.filter((c) => !c.res.writableEnded && c.res.writableLength < 1_000_000);
}

/** A loja de quem esta chamando; fora de requisicao, a loja do boot. */
function lojaDoChamador(): string {
    return lojaAtual() ?? lojaDoBoot();
}

export function addClient(res: Response, loja = lojaDoChamador()) {
    const cliente: Cliente = { loja, res };
    clientes.push(cliente);
    prune();
    return () => {
        clientes = clientes.filter((c) => c !== cliente);
    };
}

function write(loja: string, event: string, payload: string): void {
    for (const cliente of clientes) {
        if (cliente.loja !== loja) continue;
        try {
            cliente.res.write(`event: ${event}\ndata: ${payload}\n\n`);
        } catch {
            // cliente morto: sera removido no proximo prune
        }
    }
}

/** Avisa o painel que houve mudanca em pedidos/produtos (recarrega a view). */
export function notifyClients(loja = lojaDoChamador()): void {
    prune();
    write(loja, 'update', 'update');
}

/** Envia o estado de conexao do WhatsApp (QR, escaneado, conectado...). */
export function notifyConnection(loja: string, payload: string): void {
    prune();
    write(loja, 'connection', payload);
}

/**
 * Avisa que uma conversa mudou, mandando o id dela.
 * Separado do `notifyClients` de proposito: recarregar a tela de chat a cada
 * mensagem jogaria fora o que a pessoa estava digitando.
 */
export function notifyChat(chatId: string, loja = lojaDoChamador()): void {
    prune();
    write(loja, 'chat', JSON.stringify({ chatId }));
}

export function getClientCount(loja?: string): number {
    prune();
    return loja ? clientes.filter((c) => c.loja === loja).length : clientes.length;
}

/**
 * Encerra todas as conexoes SSE, avisando antes.
 * `res.end` puro deixa a aba em "atualizando..." ate o navegador desistir do
 * outro lado; o evento `encerrando` e' o que faz a tela recarregar sozinha.
 */
export function fechaClientes(motivo: string): number {
    prune();
    const total = clientes.length;
    for (const cliente of clientes) {
        try {
            cliente.res.write(`event: encerrando\ndata: ${JSON.stringify({ motivo })}\n\n`);
            cliente.res.end();
        } catch {
            // cliente ja morto; fechar era o que queriamos mesmo
        }
    }
    clientes = [];
    return total;
}