import { Router } from 'express';
import type { Request, Response } from 'express';

import { listarDoMes, anotar, alternarConcluido, apagar, falhouAnotar, falhouConcluir, falhouApagar } from '../services/lembretes';
import { exigeCsrf, exigeSessaoApi } from '../services/auth';
import { logDoModulo } from '../services/logger';

/*
 * Rotas de lembrete do Calendario.
 *
 * EXTRAINDO DO MONOLITO, E O QUE ISSO MUDOU DE VERDADE
 *
 * Estas quatro rotas viviam em `src/server.ts` em `/api/calendar/lembretes`, e o
 * caminho era o motivo de elas NAO terem sessao: o `exigeSessaoApi()` so protege
 * `/api/admin`, e estas nao estavam la. Conferido nesta maquina com um pedido sem
 * cookie nenhum:
 *
 *   GET  /api/calendar/lembretes?mes=2026-09   -> 200, e o texto dos lembretes
 *   POST /api/calendar/lembretes                -> 200, cria anotacao
 *   POST /api/calendar/lembretes/:id/apagar     -> 200, apaga
 *
 * O sistema escuta em 0.0.0.0 por padrao e o proprio boot avisa que quem entra
 * precisa de senha. Essa parte do aviso era verdade para o painel e falsa para
 * estas rotas: qualquer aparelho da mesma rede lia a agenda de trabalho e podia
 * apagar lembretes de quem esta na loja. Ler o texto de uma anotacao interna e'
 * vazamento; apagar e' destruicao de dado de outra pessoa.
 *
 * A correcao nao e' reescrever a rota: e' montar o router ATRAS da sessao, como
 * os outros. Ver o `app.use` em `src/server.ts`, onde este router e' montado com
 * `exigeSessaoApi()` e `exigeCsrf()`.
 *
 * O caminho PUBLICO e' de proposito: o painel e' um SPA de SSR, o JavaScript da
 * tela do calendario ja chama `/api/calendar/lembretes` e mudar o caminho
 * obrigaria a mexer em template literal, que e' onde mora o JavaScript que o
 * `tsc` nao ve. Nao vale o risco por seguranca -- a sessao e' o que seguranca
 * precisa, e ela esta no middleware.
 */

const log = logDoModulo('calendarioRoutes');
const router = Router();

/*
 * A guarda vai POR ROTA, e nao em `router.use(...)`.
 *
 * Este router e' montado na raiz (`app.use(calendarioRoutes)`), porque o caminho
 * publico das rotas e' `/api/calendar/lembretes` e mudar o caminho obrigaria a
 * mexer no JavaScript de dentro do template literal da tela. E ai esta o
 * problema: um `router.use()` sem caminho vale para TODO pedido que entra no
 * router, e o router entra em todo caminho. A sessao passava a ser exigida em
 * qualquer rota registrada DEPOIS -- inclusive em
 * `POST /api/servico/desligar`, que respondia 401 e nao desligava.
 *
 * E' a mesma armadilha que o `router.use(exigeAdmin())` do `usuariosRoutes`
 * armou antes: um `use` sem caminho nao protege o arquivo, protege a partir
 * dali. Por rota, o alcance e' o da rota.
 */
const sessao = exigeSessaoApi();
const csrf = exigeCsrf();

/**
 * Lista os lembretes de um mes.
 *
 * O `mes` e' "AAAA-MM". A validacao fica no servico, que e' quem sabe o que e' um
 * mes valido e o que e' meia-noite local -- a rota so repassa.
 */
router.get('/api/calendar/lembretes', sessao, csrf, async (req: Request, res: Response) => {
    const mes = typeof req.query.mes === 'string' ? req.query.mes : '';
    if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ error: 'Informe o mes no formato AAAA-MM.' });
    }
    try {
        res.json(await listarDoMes(mes));
    } catch (error) {
        log.error('Erro ao buscar lembretes:', error);
        res.status(500).json({ error: 'Erro ao buscar lembretes' });
    }
});

/** Anota um lembrete. Sem `dia`, vai para hoje. */
router.post('/api/calendar/lembretes', sessao, csrf, async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const r = await anotar(b.texto, typeof b.dia === 'string' ? b.dia : undefined);
    if (falhouAnotar(r)) return res.status(400).json({ error: r.error });
    res.status(201).json(r.lembrete);
});

/** Marca concluida ou desmarca. Concluir nao apaga: a ideia pode voltar. */
router.post('/api/calendar/lembretes/:id/concluir', sessao, csrf, async (req: Request, res: Response) => {
    const r = await alternarConcluido(req.params.id);
    if (falhouConcluir(r)) return res.status(404).json({ error: r.error });
    res.json({ feito: r.feito });
});

/** Apaga de vez. Quem apaga e' a pessoa na frente da tela, com confirmacao. */
router.post('/api/calendar/lembretes/:id/apagar', sessao, csrf, async (req: Request, res: Response) => {
    const r = await apagar(req.params.id);
    if (falhouApagar(r)) return res.status(404).json({ error: r.error });
    res.json({ ok: true });
});

export default router;
