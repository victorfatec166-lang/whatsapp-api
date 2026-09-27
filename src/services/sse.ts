import { Response } from 'express';

let clients: Response[] = [];

export function addClient(res: Response) {
    clients.push(res);
    return () => {
        clients = clients.filter(c => c !== res);
    };
}

export function notifyClients() {
    clients.forEach(client => {
        client.write('data: update\n\n');
    });
}

export function getClientCount() {
    return clients.length;
}
