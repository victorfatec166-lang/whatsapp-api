import type { Request, Response, NextFunction } from 'express';

/*
 * Limite de requisicoes, em memoria, por janela deslizante simples.
 * O painel nao tem senha -- enquanto isso durar, e' defesa de borda, e nao auditoria.
 * Nao passa por aqui o webhook do marketplace (rajada e' venda perdida) nem o SSE.
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
 * Aplica o limite. Devolve 429 com `Retry-After` em segundos: quem estourou
 * precisa saber que espera, nao por que a tela quebrou.
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

