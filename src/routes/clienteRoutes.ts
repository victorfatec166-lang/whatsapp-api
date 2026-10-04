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

/*
 * O que responde quando ainda nao ha pacote: HTML, e nao texto.
 *
 * O navegador salva como arquivo qualquer resposta que chegue sob o atributo
 * `download`, e o dono recebia um `download.txt` de erro em vez de ver o que deu.
 */
function semPacote(res: Response): void {
    res.status(503)
        .type('text/html; charset=utf-8')
        .send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cliente de desktop</title>
<link rel="icon" href="/marca/favicon.ico" sizes="any">
<style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f6f8;
        color: #0e1116; font: 400 15px/1.6 Inter, system-ui, "Segoe UI", sans-serif; padding: 24px; }
    .caixa { max-width: 30rem; background: #fff; border: 1px solid #e1e4e9; border-radius: 14px; padding: 28px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { margin: 0 0 10px; color: #4b525c; }
    code { background: #eff1f4; border-radius: 6px; padding: 2px 6px; font-size: 13px; }
    a { color: #c42b12; }
    @media (prefers-color-scheme: dark) {
        body { background: #0a0d12; color: #f2f4f7; }
        .caixa { background: #12161c; border-color: #242a33; }
        p { color: #a9b2bf; }
        code { background: #1a1f26; }
        a { color: #f2492c; }
    }
</style></head>
<body><div class="caixa">
    <h1>O cliente de desktop ainda nao foi montado neste servidor</h1>
    <p>O botao continua aqui de proposito -- o pacote e' gerado no build, e este build
       nao conseguiu gerar. Se voce esta' vendo isto, o log do deploy mostra a linha.</p>
    <p>Para gerar localmente: <code>npm run cliente:dist</code>. O arquivo fica em
       <code>cliente-dist/</code>.</p>
    <p><a href="/entrar">Voltar para a tela de entrada</a></p>
</div></body></html>`);
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
