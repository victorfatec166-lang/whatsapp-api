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
        // Guardada na requisicao porque este middleware e' o primeiro de todos: o
        // `exigeSessao` consultava a MESMA sessao de novo, uma ida a mais ao banco
        // em cada pagina do painel, sem nenhum ganho.
        req.sessao = sessao;
        comoLoja(sessao.tenantId, next);
    })();
}
