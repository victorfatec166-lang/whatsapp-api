/**
 * Extrai a loja da sessao via AsyncLocalStorage para cobrir a requisicao.
 * Impede vazamento cruzado por parametro na URL.
 */
import type { NextFunction, Request, Response } from 'express';
import { sessaoDoRequest } from '../services/auth';
import { comoLoja } from '../services/loja';

/**
 * O `next()` DENTRO do `comoLoja` e' o essencial: chamado fora dele, o contexto
 * acabaria quando o middleware devolvesse e a primeira consulta da rota estouraria.
 */
export function publicaLoja(req: Request, res: Response, next: NextFunction): void {
    void (async () => {
        const sessao = await sessaoDoRequest(req);
        if (!sessao) {
            // Sem sessao nao ha loja, e sem loja nao ha leitura. As rotas
            // publicas (login, criacao de conta, webhook do marketplace)
            // respondem antes de chegar em qualquer consulta de dado da loja.
            next();
            return;
        }
        comoLoja(sessao.tenantId, next);
    })();
}
