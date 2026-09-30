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
 *
 * Separado do `notifyClients` de proposito: aquele diz "recarrega a pagina" e
 * serve para pedido e produto. Recarregar a tela de chat a cada mensagem
 * jogaria o que a pessoa estava digitando no meio da conversa, que e' o
 * pior lugar possivel para perder o que se estava escrevendo. Aqui o painel
 * sabe exatamente qual conversa mudar e atualiza so ela.
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
 *
 * O `res.end()` puro fecha a conexao sem dizer nada, e o painel fica com a aba
 * aberta mostrando "atualizando..." ate o navegador desistir sozinho -- que sao
 * trinta segundos de tela morta numa hora em que a pessoa nao sabe o que
 * aconteceu. Mandar um evento `encerrando` deixa o JavaScript da tela recarregar
 * por conta propria, e o que a pessoa ve e' o painel de novo, nao um aviso de
 * erro.
 *
 * Devolve quantas conexoes foram fechadas, para o log do desligamento dizer.
 */
export function fechaClientes(motivo: string): number {
    prune();
    const total = clients.length;
    for (const client of clients) {
        try {
            client.write(`event: encerrando\ndata: ${JSON.stringify({ motivo })}\n\n`);
            client.end();
        } catch {
            // cliente ja morto: fechar e' o que queríamos mesmo
        }
    }
    clients = [];
    return total;
}
