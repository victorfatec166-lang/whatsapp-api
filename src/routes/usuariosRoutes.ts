import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { prismaComLoja as prisma } from '../database/prisma-com-loja';
import { derivaSenha, exigeAdmin } from '../services/auth';
import { exigeLoja } from '../services/loja';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('usuariosRoutes');

/**
 * Montado em `/api/admin`, entao ja passa pelo exigeSessaoApi e pelo exigeCsrf do
 * servidor. O que sobra e' a AUTHORIZACAO: criar, desativar e redefinir senha e' ato
 * de administrador -- esconder o botao nao protege, e o exigeAdmin e' o que protege.
 */
const router = Router();

/**
 * Guarda por rota, e nao em `router.use(exigeAdmin())`: o `use` sem caminho casa
 * com TUDO no prefixo `/api/admin`, e o router de backup, montado depois, respondia
 * 403 a um operador. Por rota, o alcance e' o da rota.
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
 * Desativar tira acesso sem apagar historico -- sem a conta, o pedido que a pessoa
 * registrou fica com ninguem. Tres recusas sao defesa de estado: ninguem desativa a
 * si mesmo, ninguem desativa o ultimo admin ativo, ninguem se promove.
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
 * A senha nova aparece UMA vez, na resposta: nao ha e-mail para mandar, e telefone
 * serve melhor para quem esta no balcao. A conta nasce com precisaTrocarSenha,
 * senao a senha que passou na frente de outras pessoas viraria a definitiva.
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
    /*
     * `Sessao` nao tem `tenantId` (e' indexada por hash de token);
     * buscar o usuario na loja antes evita encerrar sessoes de outras lojas.
     */
    const alvo = await prisma.user.findFirst({
        where: { id: req.params.id, tenantId: exigeLoja() },
        select: { id: true },
    });
    if (!alvo) {
        res.status(404).json({ error: 'Conta nao encontrada.' });
        return;
    }

    const r = await prisma.sessao.deleteMany({ where: { userId: alvo.id } });
    log.info('Sessoes encerradas pelo administrador', {
        userId: alvo.id,
        loja: exigeLoja(),
        quantas: r.count,
    });
    res.json({ success: true, encerradas: r.count });
});

/**
 * Doze caracteres, e nenhum que se confunda com outro: o administrador vai ler
 * essa senha em voz alta ou digitar num telefone, e um O lido como zero faz a
 * pessoa errar tres vezes e achar que o sistema esta com defeito.
 */
function senhaGerada(): string {
    const alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(12);
    let saida = '';
    for (const b of bytes) saida += alfabeto[b % alfabeto.length];
    return saida;
}

export default router;
