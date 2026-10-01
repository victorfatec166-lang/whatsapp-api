import { Response } from 'express';

let clients: Response[] = [];

/** Evita vazamento de memoria: remove clientes que ja fecharam o socket. */
function prune(): void {
    clients = clients.filter((c) => !c.writableEnded && c.writableLength < 1_000_000);
}

export function addClient(res: Response) {
    clients.push(res);
    prune();
    return () => {
        clients = clients.filter((c) => c !== res);
    };
}

function write(event: string, payload: string): void {
    for (const client of clients) {
        try {
            client.write(`event: ${event}\ndata: ${payload}\n\n`);
        } catch {
            // cliente morto: sera removido no proximo prune
        }
    }
}

/** Avisa o painel que houve mudanca em pedidos/produtos (recarrega a view). */
export function notifyClients(): void {
    prune();
    write('update', 'update');
}

/** Envia o estado de conexao do WhatsApp (QR, escaneado, conectado...). */
export function notifyConnection(payload: string): void {
    prune();
    write('connection', payload);
}

/**
 * Avisa que uma conversa mudou, mandando o id dela.
 * Separado do `notifyClients` de proposito: recarregar a tela de chat a cada
 * mensagem jogaria fora o que a pessoa estava digitando.
 */
export function notifyChat(chatId: string): void {
    prune();
    write('chat', JSON.stringify({ chatId }));
}

export function getClientCount(): number {
    prune();
    return clients.length;
}

/**
 * Encerra todas as conexoes SSE, avisando antes.
 * `res.end()` puro deixa a aba em "atualizando..." ate o navegador desistir
 * sozinho; o evento `encerrando` e' o que faz a tela recarregar por conta propria.
 */
export function fechaClientes(motivo: string): number {
    prune();
    const total = clients.length;
    for (const client of clients) {
        try {
            client.write(`event: encerrando\ndata: ${JSON.stringify({ motivo })}\n\n`);
            client.end();
        } catch {
            // cliente ja morto: fechar e' o que queriamos mesmo
        }
    }
    clients = [];
    return total;
}
