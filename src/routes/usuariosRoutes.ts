import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { prisma } from '../database/prisma';
import { derivaSenha, exigeAdmin } from '../services/auth';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('usuariosRoutes');

/**
 * Quem pode entrar no painel.
 *
 * Montado em /api/admin, entao ja passa pelo exigeSessaoApi e pelo
 * exigeCsrf do servidor -- nenhuma repeticao aqui. O que sobra e' a AUTHORIZACAO:
 * criar, desativar e redefinir senha de alguem e' ato de administrador, e a
 * tela esconde o botao de quem nao e'. Esconder nao e' proteger; por isso o
 * exigeAdmin esta aqui, e nao so na interface.
 */
const router = Router();

/**
 * A tela inteira e' de administrador. Uma rota solta, em vez de repeticao.
 *
 * POR QUE ESTA LINHA VIROU UMA POR ROTA
 *
 * Era `router.use(exigeAdmin())`, e ela vazava. Montado em `/api/admin`, o `use`
 * sem caminho casa com TUDO que passa por ali, e nao so com as rotas deste
 * arquivo: qualquer router montado depois no mesmo prefixo herda a exigencia de
 * administrador. `/api/admin/chat` e' montada antes e por isso escapava; a de
 * backup, montada depois, respondia 403 "apenas o administrador" para um operador
 * -- e a causa sumia da tela, porque o erro era de arquivo.
 *
 * Pior do que o sintoma e' o jeito de descobrir: aparece como "a rota nova nao
 * funciona", e a tentacao e' ajeitar a rota nova. O certo e' nao vazar.
 *
 * O `exigeAdmin` em cada rota e' a unica forma de ele valer aqui e apenas aqui.
 */
const soAdmin = exigeAdmin();

router.get('/', soAdmin, async (_req, res) => {
    const users = await prisma.user.findMany({
        orderBy: [{ papel: 'asc' }, { nome: 'asc' }],
        include: { _count: { select: { sessoes: true } } },
    });
    res.json({ usuarios: users });
});

/**
 * Desativa e reativa.
 *
 * Desativar e' o que tira acesso sem apagar historico: a conta continua
 * vinculada aos pedidos que a pessoa registrou, e o nome continua aparecendo
 * onde precisa aparecer. Apagar a conta deixaria o pedido sem ninguem.
 *
 * Tres recusas que nao sa' erro de validacao e sim defesa de estado:
 * ninguem desativa a si mesmo (a pessoa ficaria presa fora no proximo comando),
 * ninguem desativa o ultimo administrador ativo (o sistema ficaria sem quem
 * administre) e ninguem promove a si mesmo (senha trocada na mao vira poder
 * permanente).
 */
router.post('/:id/alternar', soAdmin, async (req, res) => {
    const alvo = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!alvo) {
        res.status(404).json({ error: 'Conta nao encontrada.' });
        return;
    }
    if (alvo.id === req.sessao!.userId) {
        res.status(400).json({ error: 'Voce nao pode desativar a propria conta.' });
        return;
    }

    const ligando = !alvo.ativo;
    if (!ligando && alvo.papel === 'admin') {
        const outros = await prisma.user.count({ where: { papel: 'admin', ativo: true, NOT: { id: alvo.id } } });
        if (outros === 0) {
            res.status(400).json({ error: "Este e' o unico administrador ativo. Promova outro antes." });
            return;
        }
    }

    await prisma.user.update({ where: { id: alvo.id }, data: { ativo: ligando } });

    // Desativar encerra as sessoas NA HORA. Mantidas, elas valeriam ate
    // expirar -- doze horas -- e a pessoa desactivada continuaria entrando em
    // outros navegadores nesse tempo.
    if (!ligando) {
        await prisma.sessao.deleteMany({ where: { userId: alvo.id } });
    }
    log.info(ligando ? 'Conta reativada' : 'Conta desativada', { email: alvo.email });

    res.json({ success: true, ativo: ligando });
});

/**
 * Redefine a senha de outra conta.
 *
 * Gera uma senha nova e a mostra UMA vez, na resposta. Nao ha e-mail para
 * mandar, entao a unica forma de a pessoa receber e' o administrador repassar
 * -- e um numero de telefone serve melhor do que e-mail para quem esta no
 * balcao.
 *
 * A conta nasce com precisaTrocarSenha, entao quem entra tem que trocar antes
 * de usar. Sem isso, a senha gerada viraria a senha definitiva, e ela passou
 * por um telefone na frente de outras pessoas.
 */
router.post('/:id/gerar-senha', soAdmin, async (req, res) => {
    const alvo = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!alvo) {
        res.status(404).json({ error: 'Conta nao encontrada.' });
        return;
    }

    const senha = senhaGerada();
    const { hash, sal } = await derivaSenha(senha);

    await prisma.user.update({
        where: { id: alvo.id },
        data: {
            senhaHash: hash,
            senhaSalt: sal,
            precisaTrocarSenha: true,
            tentativas: 0,
            bloqueadoAte: null,
            codigoRecuperacao: null,
            recuperacaoExpiraEm: null,
        },
    });
    await prisma.sessao.deleteMany({ where: { userId: alvo.id } });
    log.warn('Senha redefinida pelo administrador', { email: alvo.email });

    res.json({ success: true, senha });
});

/** Delega que abre a sessao. */
router.post('/:id/trocar-papel', soAdmin, async (req, res) => {
    const alvo = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!alvo) {
        res.status(404).json({ error: 'Conta nao encontrada.' });
        return;
    }
    if (alvo.id === req.sessao!.userId) {
        res.status(400).json({ error: 'Voce nao pode mudar o proprio papel.' });
        return;
    }

    const novo = req.body?.papel === 'admin' ? 'admin' : 'operador';
    if (novo === 'operador' && alvo.papel === 'admin') {
        const outros = await prisma.user.count({ where: { papel: 'admin', ativo: true, NOT: { id: alvo.id } } });
        if (outros === 0) {
            res.status(400).json({ error: "Este e' o unico administrador ativo." });
            return;
        }
    }

    await prisma.user.update({ where: { id: alvo.id }, data: { papel: novo } });
    res.json({ success: true, papel: novo });
});

/*
 * Fecha as sessoes abertas de uma conta.
 *
 * E' o "sai do meu celular" visto pelo outro lado: quando a pessoa suspeita que
 * esqueceu a sessao aberta em algum aparelho, e' o administrador que encerra.
 */
router.post('/:id/encerrar-sessoes', soAdmin, async (req, res) => {
    const r = await prisma.sessao.deleteMany({ where: { userId: req.params.id } });
    log.info('Sessoes encerradas pelo administrador', { userId: req.params.id, quantas: r.count });
    res.json({ success: true, encerradas: r.count });
});

/**
 * Senha nova para repassar.
 *
 * Doze caracteres, sem caractere que se confunda com outro: o administrador vai
 * ler essa senha em voz alta ou digitar num telefone, e um O lido como zero faz
 * a pessoa errar tres vezes e achar que o sistema esta com defeito.
 */
function senhaGerada(): string {
    const alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(12);
    let saida = '';
    for (const b of bytes) saida += alfabeto[b % alfabeto.length];
    return saida;
}

export default router;
