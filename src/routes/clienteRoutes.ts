import { Router } from 'express';
import type { Request, Response } from 'express';
import { createReadStream, existsSync } from 'node:fs';

import { garanteZipDoCliente, NOME_DO_ZIP, PASTA_CLIENTE, tamanhoDoZip, zipDoCliente } from '../services/cliente';
import { logDoModulo } from '../services/logger';

const log = logDoModulo('clienteRoutes');

/*
 * O download mora aqui, e nao num endereco externo: `download` so vale na mesma origem
 * (no link de fora o navegador navegava e ninguem baixava nada) e o endereco de fora
 * morre com o servico que o hospeda. Rota PUBLICA: quem oferece o download e' a tela de entrada.
 */
const router = Router();

/** O que responde quando ainda nao ha pacote: 503 e nao 404, porque o endereco existe. */
function semPacote(res: Response): void {
    res.status(503)
        .type('text/plain; charset=utf-8')
        .send(
            [
                'O pacote do cliente de desktop ainda nao foi montado neste servidor.',
                '',
                'Ele e gerado pelo passo de build (npm run cliente:dist).',
                'Se voce esta lendo isto, o build rodou sem o runtime do Electron.',
            ].join('\n')
        );
}

router.get('/cliente/download', async (_req: Request, res: Response) => {
    const caminho = zipDoCliente() ?? (await garanteZipDoCliente());
    if (!caminho) {
        semPacote(res);
        return;
    }

    const tamanho = tamanhoDoZip();
    if (tamanho === null || !existsSync(caminho)) {
        semPacote(res);
        return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(tamanho));
    res.setHeader('Content-Disposition', `attachment; filename="${NOME_DO_ZIP}"`);
    // O pacote so muda quando o cliente e' remontado, e o nome do arquivo nao tem
    // hash dentro: cache longo serviria a versao antiga depois de um `cliente:dist`.
    res.setHeader('Cache-Control', 'no-cache');

    const fluxo = createReadStream(caminho);
    fluxo.on('error', (erro) => {
        log.error('falhou na leitura do zip', { erro: erro });
        res.destroy();
    });
    fluxo.pipe(res);
    log.info('download do cliente', { mb: Math.round(tamanho / 1024 / 1024), pasta: PASTA_CLIENTE });
});

export default router;
