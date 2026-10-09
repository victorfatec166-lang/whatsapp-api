/*
 * As tres rotas que o cliente de desktop usa para se atualizar. Fora do `/api/admin`
 * e sem sessao: quem chega aqui e' um programa instalado que ainda nem tem login --
 * publico pela mesma razao do instalador, ja' que e' o mesmo codigo do `.exe`.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

import { arquivoDoPacote, manifesto, schemaAtual } from '../services/pacote';
import { logDoModulo } from '../services/logger';

const log = logDoModulo('pacoteRoutes');
const router = Router();

/** O que mudou desde a versao que o cliente tem. */
router.get('/pacote/manifesto', (_req: Request, res: Response) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json(manifesto());
    } catch (erro) {
        log.error('falha ao montar o manifesto:', erro);
        res.status(500).json({ error: 'Pacote indisponivel.' });
    }
});

/** Um arquivo do pacote. `caminho` e' relativo a raiz do dist. */
router.get('/pacote/arquivo', (req: Request, res: Response) => {
    const conteudo = arquivoDoPacote(String(req.query.caminho ?? ''));
    if (!conteudo) return res.status(404).json({ error: 'Arquivo nao existe no pacote.' });
    res.set('Cache-Control', 'no-store');
    return res.type('application/octet-stream').send(conteudo);
});

/**
 * O `schema.prisma` do deploy. O cliente compara o hash com o local e so' roda
 * `db push` quando eles diferem -- e' o que impede migrar o banco da loja a cada
 * abertura.
 */
router.get('/pacote/schema', (_req: Request, res: Response) => {
    const texto = schemaAtual();
    if (!texto) return res.status(404).json({ error: 'Schema indisponivel.' });
    res.set('Cache-Control', 'no-store');
    return res.type('text/plain').send(texto);
});

export default router;