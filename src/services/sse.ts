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

export function getClientCount(): number {
    prune();
    return clients.length;
}
