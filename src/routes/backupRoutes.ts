import { Router } from 'express';
import type { Response } from 'express';

import { backupNow, listarBackups } from '../services/backup';
import { exigeCsrf, exigeSessaoApi } from '../services/auth';
import { logDoModulo } from '../services/logger';

/*
 * `backupNow()` existia sem ninguem chamar: o backup rodava sozinho, no startup e
 * de seis em seis horas. A rota exige sessao e CSRF como qualquer escrita do painel
 * -- `VACUUM INTO` reescreve o arquivo inteiro, e um POST sem sessao travaria o banco.
 */

const log = logDoModulo('backupRoutes');
const router = Router();

/*
 * Guarda por rota, e nao em `router.use(...)`: este router e' montado na raiz, e
 * um `use` sem caminho exigiria sessao de TODA rota registrada depois, inclusive
 * `POST /api/servico/desligar`, que parou de desligar. Ver `calendarioRoutes.ts`.
 */
const sessao = exigeSessaoApi();
const csrf = exigeCsrf();

/** As copias que existem, com tamanho e hora. */
router.get('/api/admin/backup/listar', sessao, csrf, (_req, res: Response) => {
    res.json({ copias: listarBackups() });
});

/**
 * `202` e nao `200`: a resposta nao espera o arquivo. Com `200`, banco grande
 * trava a tela sem dizer nada e a pessoa aperta o botao de novo -- dois
 * `VACUUM INTO` ao mesmo tempo, que e' a corrida que o destino unico evita.
 */
router.post('/api/admin/backup', sessao, csrf, (_req, res: Response) => {
    res.status(202).json({ ok: true, mensagem: 'Copia em andamento.' });

    /*
     * O `setTimeout` deixa a resposta sair antes do `VACUUM INTO` comecar. Sem ele
     * a gravacao segura o event loop e a tela fica parada sem explicacao, e quem
     * apressa o clique dispara duas gravacoes ao mesmo tempo.
     */
    setTimeout(() => {
        backupNow().then((destino) => {
            if (destino) log.info(`copia pedida pela tela: ${destino}`);
            else log.error('copia pedida pela tela falhou');
        });
    }, 50);
});

export default router;
