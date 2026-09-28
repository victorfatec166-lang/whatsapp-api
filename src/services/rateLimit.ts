import type { Request, Response, NextFunction } from 'express';

/*
 * Limite de requisicoes, em memoria, por janela deslizante simples.
 *
 * Por que existe agora
 *
 * O painel nao tem senha -- decisao de desenvolvimento. Enquanto isso durar,
 * qualquer coisa na mesma rede que saiba a porta 3000 pode escrever: registrar
 * venda, baixar estoque, mexer no caixa. Um limite nao impede o ataque, mas
 * corta as duas consequencias mais caras:
 *
 * 1. Um lauco automatizado repetindo "registrar venda" nao vira centenas de
 *    pedidos em segundos.
 * 2. Um bug de interface -- botao em laco, `onclick` disparando duas vezes, um
 *    `while` que esqueceu de sair -- para no limite em vez de encher a base.
 *
 * Por que em memoria e nao em banco
 *
 * A contagem nao vale depois de reiniciar o servidor, e nao precisa: e' uma
 * defensa de borda, nao auditoria. Um contador em banco custaria uma escrita a
 * cada requisicao, e o SQLite serializa escrita -- o limite viraria a coisa
 * mais lenta do sistema.
 *
 * Por que janela simples
 *
 * Contador que zera a cada janela e' previsivel e cabe em um Map. A janela
 * deslizante de verdade exige timestamps por requisicao e gasta memoria
 * proporcional ao trafego -- preco que nao se justifica para defender um
 * endpoint local.
 *
 * O que NAO passa por aqui, de proposito:
 *
 * - O webhook do marketplace. A plataforma envia em rajada, e um pedido
 *   legitimo recusado por limite e' venda perdida.
 * - O SSE (`/admin/events`). A conexao fica aberta e conta uma requisicao so
 *   enquanto dura, mas o comportamento de "conexao viva" nao combina com
 *   contador de janela.
 */

type Janela = { contagem: number; expiraEm: number };

const janelas = new Map<string, Janela>();

/** Chave do contador: rota + origem, para nao punir todo mundo junto. */
function chaveDe(req: Request): string {
    // `req.ip` so funciona atras de proxy confiavel. Como o servidor escuta em
    // 0.0.0.0, a origem TCP e' o que separa as maquinas da rede -- e nao e'
    // confiavel como identidade de usuario, mas serve para separar volume.
    const origem = req.socket.remoteAddress || 'desconhecido';
    return `${origem}|${req.baseUrl}${req.path}`;
}

/** Limpa as janelas vencidas. Roda a cada requicao; o Map e' pequeno. */
function expira(): void {
    const agora = Date.now();
    for (const [chave, j] of janelas) {
        if (j.expiraEm <= agora) janelas.delete(chave);
    }
}

export type Limite = {
    /** Requisicoes por janela. */
    max: number;
    /** Tamanho da janela, em milissegundos. */
    janelaMs: number;
};

/**
 * Aplica o limite.
 *
 * Devolve 429 com `Retry-After` em segundos. A resposta diz o que aconteceu
 * sem revelar o estado interno: quem estourou precisa saber que espera, nao por
 * que a tela quebrou.
 */
export function limitador(limite: Limite) {
    return function (req: Request, res: Response, next: NextFunction): void {
        const agora = Date.now();
        expira();

        const chave = chaveDe(req);
        let janela = janelas.get(chave);

        if (!janela || janela.expiraEm <= agora) {
            janela = { contagem: 1, expiraEm: agora + limite.janelaMs };
            janelas.set(chave, janela);
            next();
            return;
        }

        janela.contagem += 1;
        if (janela.contagem > limite.max) {
            const espera = Math.max(1, Math.ceil((janela.expiraEm - agora) / 1000));
            res.setHeader('Retry-After', String(espera));
            res.status(429).json({ error: 'Muitas requisicoes. Tente de novo em alguns segundos.' });
            return;
        }

        next();
    };
}

/** Zera os contadores. Usado pelos testes e por uma limpeza manual. */
export function zeraLimites(): void {
    janelas.clear();
}
