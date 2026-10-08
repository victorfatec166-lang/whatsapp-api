/*
 * Configuracao do relay: como a loja liga o PC dela a fila do marketplace.
 *
 * A chave nao vem do dono da loja: quem a gera e' o dono do sistema, em `/ops`, e a
 * loja cola aqui. Fica cifrada no banco dela e nunca sai por esta API.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

import { exigeCsrf } from '../services/auth';
import { comoLoja, exigeLoja } from '../services/loja';
import { buscaEGrava, estadoDoRelay, registraSegredo, segredoDaLoja } from '../services/relay';
import { logDoModulo } from '../services/logger';

const log = logDoModulo('relayAdmin');
const router = Router();

/** Se a loja ja tem chave, e quando a fila foi buscada pela ultima vez. */
router.get('/api/admin/relay', async (_req: Request, res: Response) => {
    try {
        return res.json({
            temChave: Boolean(await segredoDaLoja()),
            loja: exigeLoja(),
            // A loja e' local por definicao aqui: se ha chave, ela puxa a fila.
            ...estadoDoRelay(),
        });
    } catch (error) {
        log.error('nao deu para ler o estado do relay:', { erro: String(error).slice(0, 160) });
        return res.status(500).json({ error: 'Nao deu para ler o estado.' });
    }
});

/**
 * A loja cola a chave que o dono do sistema gerou. Trocar e' colar outra: a antiga
 * deixa de valer na hora, porque a nuvem guarda um hash so.
 */
router.post('/api/admin/relay/chave', exigeCsrf(), async (req: Request, res: Response) => {
    const chave = String((req.body ?? {}).chave ?? '').trim();
    if (chave.length < 16 || chave.length > 200) {
        return res.status(400).json({ error: 'A chave parece errada. Cole a chave inteira.' });
    }
    try {
        await comoLoja(exigeLoja(), () => registraSegredo(chave));
        return res.json({ ok: true, temChave: true });
    } catch (error) {
        log.error('nao deu para gravar a chave do relay:', { erro: String(error).slice(0, 160) });
        return res.status(500).json({ error: 'Nao deu para guardar a chave.' });
    }
});

/** Busca na hora, para o dono nao ficar esperando o proximo tique de 20s. */
router.post('/api/admin/relay/buscar', exigeCsrf(), async (_req: Request, res: Response) => {
    try {
        return res.json(await comoLoja(exigeLoja(), () => buscaEGrava()));
    } catch (error) {
        log.error('nao deu para buscar a fila:', { erro: String(error).slice(0, 160) });
        return res.status(500).json({ error: 'Nao deu para buscar agora.' });
    }
});

export default router;