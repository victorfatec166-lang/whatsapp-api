/**
 * Onde a loja entra na requisicao.
 *
 * Este e' o unico lugar do sistema que decide "de quem e' esta chamada", e ele
 * le a sessao. Nao ha outro: nem parametro na URL, nem cookie proprio, nem
 * cabecalho. Se uma rota precisar da loja, ela pega do contexto -- e o contexto
 * so' foi preenchido daqui.
 *
 * POR QUE A LOJA VIRO COM O USUARIO E NAO COM A URL
 *
 * Um `?loja=padaria` seria mais facil de escrever, e seria um vazamento pronto:
 * a pessoa logada na loja A trocava o parametro e passaria a ler a loja B, com o
 * cookie dela, sem trocar de sessao. O erro e' silencioso, nao tem como recuperar
 * depois, e o dono veria o preco de venda da loja vizinha com a cara de "seu".
 *
 * POR QUE O CONTEXTO ENVOLVE A REQUISICAO INTEIRA
 *
 * As consultas acontecem dentro de servicos que nao recebem o `req`. Passar a
 * loja como parametro nesses 197 pontos vira 197 chances de esquecer uma. O
 * `AsyncLocalStorage` atravessa `await` sem perder o valor e sem misturar com a
 * requisicao vizinha, entao o servico le `lojaAtual()` e nem sabe que existe
 * concorrencia.
 *
 * O nome e' `publica-loja` e nao `loja` porque `loja.ts` ja e' o modulo que
 * guarda o contexto, em `services/`. Dois arquivos com o mesmo nome em pastas
 * diferentes fazem o import resolver para o proprio arquivo -- e o erro que
 * aparece ("declara localmente, mas nao exporta") nao fala de nome de arquivo.
 */
import type { NextFunction, Request, Response } from 'express';
import { sessaoDoRequest } from '../services/auth';
import { comoLoja } from '../services/loja';

/**
 * Publica a loja da requisicao no contexto.
 *
 * Monta antes de qualquer rota ler do banco. O `next()` DENTRO do `comoLoja` e'
 * o essencial: chamado fora dele, o contexto acabaria quando o middleware
 * devolvesse, e a primeira consulta de cada rota estouraria.
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
