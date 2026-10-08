/*
 * As rotas do painel de administracao, em `/ops`.
 *
 * Guarda por REDE, nao por conta: e' a tela que atravessa loja de proposito, e so
 * a rede do dono chega aqui. Sem sessao nem token -- quem entra nao tem cookie.
 */
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { alternaLoja, apagaLoja, listaDeLojas, resumo } from '../services/ops';
import { criaContaDeTeste } from '../services/opsConta';
import { geraChave } from '../services/relay';
import { prisma } from '../database/prisma';
import { renderOps } from '../views/ops';
import { exigeCsrf } from '../services/auth';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('opsRoutes');

const router = Router();

/**
 * Sem token, sem sessao e sem CSRF: quem chega aqui esta na sua rede, e o CSRF
 * exigiria cookie que esta tela nao tem. A protecao e' a rede -- e por isso o
 * nome do arquivo e' `/ops`, e nao `/admin`.
 */

/** A rede liberada. Variavel de ambiente, ou a faixa domestica como padrao. */
function redesLiberadas(): string[] {
    const configurado = process.env.SAIDA_ADMIN_IP?.trim();
    return configurado ? configurado.split(',').map((s) => s.trim()) : ['127.0.0.1', '::1'];
}

/**
 * Confere a origem contra a lista. Com IPv4 e' comparacao direta; o `::ffff:` e'
 * como o Node entrega um IPv4 que chegou por conexao IPv6, e sem esta linha o
 * painel apareceria bloqueado justo na maquina do dono.
 */
export function naRedeLiberada(remoto: string | undefined): boolean {
    if (!remoto) return false;
    const limpo = remoto.replace(/^::ffff:/, '');
    return redesLiberadas().some((liberada) => {
        if (liberada.includes('/')) {
            // Faixa em CIDR e' trabalho de rede; o dono usa so a faixa padrao,
            // entao o casamento e' por prefixo e o resto nega.
            const [base, bits] = liberada.split('/');
            const tamanho = Number(bits);
            if (!Number.isFinite(tamanho)) return false;
            const emBinario = (endereco: string) => endereco.split('.').map((p) => Number(p).toString(2).padStart(8, '0')).join('');
            return emBinario(limpo).slice(0, tamanho) === emBinario(base).slice(0, tamanho);
        }
        return limpo === liberada;
    });
}

/**
 * A tela so existe com `OPS_LIGADO=1`. A guarda de rede sozinha NAO serve na
 * nuvem: no Render a origem e' sempre a internet, e `req.ip` de quem chega de fora
 * nunca e' `127.0.0.1`. Sem a variavel, `/ops` da 404 ate no localhost.
 */
function opsLigado(): boolean {
    return process.env.OPS_LIGADO === '1';
}

function exigeRedeDoDono(req: Request, res: Response, next: NextFunction): void {
    if (!opsLigado() || !naRedeLiberada(req.ip)) {
        // 404 e nao 403: quem esta' fora nao precisa saber que a tela existe.
        res.status(404).type('text/plain').send('Nao encontrado.');
        return;
    }
    next();
}

router.use('/ops', exigeRedeDoDono);
router.use('/ops', exigeCsrf());

/** A tela. Servida no servidor: a lista muda por la fora, nao por JavaScript. */
router.get('/ops', async (_req, res: Response) => {
    try {
        res.send(renderOps({ resumo: await resumo(), lojas: await listaDeLojas() }));
    } catch (erro) {
        log.error('Falha ao montar a tela de administracao:', erro);
        res.status(500).type('text/plain').send('Erro ao carregar as lojas.');
    }
});

/** Os numeros do topo. */
router.get('/api/ops/resumo', async (_req, res: Response) => {
    try {
        res.json(await resumo());
    } catch (erro) {
        log.error('Falha ao ler o resumo das lojas:', erro);
        res.status(500).json({ error: 'Erro ao ler as lojas.' });
    }
});

/** Todas as lojas, com assinatura, teste e contagens. */
router.get('/api/ops/lojas', async (_req, res: Response) => {
    try {
        res.json({ lojas: await listaDeLojas() });
    } catch (erro) {
        log.error('Falha ao listar as lojas:', erro);
        res.status(500).json({ error: 'Erro ao listar as lojas.' });
    }
});

/**
 * Desliga ou religa. `POST` e nao `DELETE`: desligar nao apaga nada, e quem
 * reler a URL depois acha que apagou.
 */
router.post('/api/ops/loja/:id/alternar', async (req, res: Response) => {
    const ligar = req.body?.ligar === true;
    try {
        const ok = await alternaLoja(req.params.id, ligar);
        if (!ok) {
            res.status(404).json({ error: 'Loja nao encontrada.' });
            return;
        }
        res.json({ ok: true, estado: ligar ? 'ativa' : 'desligada' });
    } catch (erro) {
        log.error('Falha ao alternar a loja:', erro);
        res.status(500).json({ error: 'Erro ao mudar a loja.' });
    }
});

/**
 * A chave que liga o PC da loja a fila. O segredo aparece UMA vez, aqui: a nuvem
 * guarda so o hash e o PC guarda o segredo cifrado. Gerar de novo troca a chave e a
 * loja perde a fila ate colar a nova -- por isso a tela avisa antes.
 */
router.post('/api/ops/loja/:id/relay', async (req, res: Response) => {
    try {
        const loja = await prisma.tenant.findUnique({ where: { id: req.params.id }, select: { id: true } });
        if (!loja) {
            res.status(404).json({ error: 'Loja nao encontrada.' });
            return;
        }
        res.json({ chave: await geraChave(loja.id) });
    } catch (erro) {
        log.error('Falha ao gerar a chave do relay:', erro);
        res.status(500).json({ error: 'Erro ao gerar a chave.' });
    }
});

/**
 * Apagar a loja e TUDO dela. `POST` e nao `DELETE` porque a tela precisa de uma
 * confirmacao com o nome, e um GET nao conversa -- mas o efeito e' destructivo e
 * a resposta diz o que foi.
 */
router.post('/api/ops/loja/:id/apagar', async (req, res: Response) => {
    try {
        const ok = await apagaLoja(req.params.id);
        if (!ok) {
            res.status(404).json({ error: 'Loja nao encontrada.' });
            return;
        }
        res.json({ ok: true });
    } catch (erro) {
        log.error('Falha ao apagar a loja:', erro);
        res.status(500).json({ error: 'Erro ao apagar a loja.' });
    }
});

/**
 * Conta sem assinatura, para uso proprio. Cria loja, assinatura com teste longo
 * e conta de administrador -- e por isso e' a rota mais perigosa do arquivo: e' a
 * unica forma de entrar sem pagar. Ela mora em `/ops`, que so a sua rede alcanca.
 */
router.post('/api/ops/conta', async (req, res: Response) => {
    const nome = String(req.body?.nome ?? '').trim();
    const nomeLoja = String(req.body?.nomeLoja ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const senha = String(req.body?.senha ?? '');

    if (nome.length < 2 || nomeLoja.length < 2) {
        res.status(400).json({ error: 'Informe o nome do dono e o da loja.' });
        return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        res.status(400).json({ error: 'Informe um e-mail valido.' });
        return;
    }

    try {
        const jaTem = await listaDeLojas();
        if (jaTem.some((l) => l.emailDono === email)) {
            res.status(409).json({ error: 'Ja existe uma loja com este e-mail.' });
            return;
        }

        const criado = await criaContaDeTeste({ nome, nomeLoja, email, senha });
        log.warn('Conta de teste criada pelo painel de administracao', { loja: criado.loja, email });
        res.json({ ok: true, loja: criado.loja });
    } catch (erro) {
        log.error('Falha ao criar a conta de teste:', erro);
        res.status(500).json({ error: erro instanceof Error ? erro.message : 'Erro ao criar a conta.' });
    }
});

export default router;