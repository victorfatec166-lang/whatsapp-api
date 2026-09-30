import { Router } from 'express';
import type { Response } from 'express';

import { backupNow, listarBackups } from '../services/backup';
import { exigeCsrf, exigeSessaoApi } from '../services/auth';
import { logDoModulo } from '../services/logger';

/*
 * Rotas de backup.
 *
 * `backupNow()` existia desde o inicio e NAO ERA CHAMADO por ninguem: o backup
 * rodava sozinho, no startup e de seis em seis horas, e o dono nao tinha como
 * pedir um na hora. A rota e' o que falta para a tela de Configuracoes ter o
 * botao, e o botao e' o que faz o backup automatico deixar de ser a unica rede de
 * seguranca -- que era o ponto de um backup que a pessoa nao sabe se existe.
 *
 * Uma rota que o sistema chama sozinho e outra que a pessoa chama nao precisam do
 * mesmo cuidado, e por isso esta exige sessao e CSRF como qualquer outra escrita
 * do painel: `VACUUM INTO` reescreve o arquivo inteiro, e um `POST` sem sessao
 * seria um jeito de travar o banco de fora.
 *
 * A guarda fica DENTRO do router, e nao no `app.use` do server.ts. Ver a nota
 * longa em `calendarioRoutes.ts`: no `app.use(router, middleware)` o router
 * responde antes da sessao ser conferida, e o buraco so aparece em.metade das
 * rotas por acaso de timing.
 */

const log = logDoModulo('backupRoutes');
const router = Router();

/*
 * A guarda vai por rota, e nao em `router.use(...)`.
 *
 * Este router e' montado na raiz, e um `use` sem caminho vale para TODO pedido
 * que entra nele. Ver a nota longa em `calendarioRoutes.ts`, que e' onde esse
 * defeito esta descrito e ja custou um desligamento que parou de funcionar.
 */
const sessao = exigeSessaoApi();
const csrf = exigeCsrf();

/** As copias que existem, com tamanho e hora. */
router.get('/api/admin/backup/listar', sessao, csrf, (_req, res: Response) => {
    res.json({ copias: listarBackups() });
});

/**
 * Faz uma copia agora.
 *
 * `202` e nao `200`: o trabalho ja comecou e a resposta nao espera o arquivo.
 * Sem isso, apertar o botao com o banco grande trava a tela por segundos sem
 * dizer nada, e a pessoa aperta de novo -- dois `VACUUM INTO` ao mesmo tempo, que
 * e' exatamente a corrida que o destino unico tenta evitar.
 */
router.post('/api/admin/backup', sessao, csrf, (_req, res: Response) => {
    res.status(202).json({ ok: true, mensagem: 'Copia em andamento.' });

    /*
     * O `setTimeout` existe para a resposta sair antes de o `VACUUM INTO` comecar.
     *
     * Sem ele, o `res.json` e o `backupNow()` disputam o mesmo event loop: a
     * gravacao de centenas de MB segura o ciclo, a resposta so volta no fim, e a
     * tela fica parada sem explicacao. A pessoa que apressa o clique dispara duas
     * gravacoes ao mesmo tempo -- e a corrida que o `unlinkSync` do destino,
     * la em `backupNow()`, existe para evitar.
     */
    setTimeout(() => {
        backupNow().then((destino) => {
            if (destino) log.info(`copia pedida pela tela: ${destino}`);
            else log.error('copia pedida pela tela falhou');
        });
    }, 50);
});

export default router;
