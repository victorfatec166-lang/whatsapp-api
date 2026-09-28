import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import {
    assumirConversa,
    buscarConversas,
    devolverAoBot,
    guardaFoto,
    historico,
    listarConversas,
    marcarLida,
    obterConversa,
    registrarEnvioDoPainel,
    totalNaoLidas,
} from '../services/chat';
import { enviarMensagemDoPainel, fotoDoContato, resolveNome, resolveTelefone } from '../services/bot';
import { logDoModulo } from '../services/logger';

const log = logDoModulo('chatRoutes');
const router = Router();

/**
 * Ultimo envio por (conversa, texto), para barrar a repeticao imediata.
 *
 * Cinco segundos. Curto o bastante para pegar duplo envio, longo o bastante
 * para nao pegar o atendente que legitimamente repete uma frase -- "são 30
 * minutos, pode vir" -- em duas conversas seguidas, o que acontece com
 * frequencia numa loja de marmita e nao pode ser bloqueado.
 */
const JANELA_REPETICAO_MS = 5_000;
const ultimoEnvio = new Map<string, number>();

/*
 * Rotas de conversa.
 *
 * O caminho e' RELATIVO, como nos outros routers de /api/admin. Escrever
 * '/api/admin/chat' aqui montaria a rota em /api/admin/api/admin/chat, que e' o
 * que aconteceu na primeira versao deste arquivo: o painel recebia 404 em tudo
 * e nenhuma rota de conversa existia. O prefixo vem do `app.use` no server.ts.
 *
 * Nao ha senha no painel neste momento -- decisao de desenvolvimento, e nao de
 * projeto. Vale o registro: com o painel aberto na rede local, qualquer coisa na
 * mesma rede que saiba a porta 3000 le as conversas e responde por um cliente.
 */

/** Lista de conversas, mais recente primeiro. */
router.get('/chat', async (req: Request, res: Response) => {
    try {
        const termo = typeof req.query.busca === 'string' ? req.query.busca : '';
        const conversas = termo ? await buscarConversas(termo) : await listarConversas();
        res.json({ conversas, naoLidas: await totalNaoLidas() });
    } catch (error) {
        log.error('Erro ao listar conversas', { erro: String(error) });
        res.status(500).json({ error: 'Erro ao listar conversas' });
    }
});

/** Historico de uma conversa. */
router.get('/chat/:id', async (req: Request, res: Response) => {
    try {
        const conversa = await obterConversa(req.params.id);
        if (!conversa) return res.status(404).json({ error: 'Conversa nao encontrada.' });
        const [mensagens, pedido] = await Promise.all([
            historico(conversa.id),
            conversa.orderId
                ? prisma.order.findUnique({
                      where: { id: conversa.orderId },
                      select: { id: true, total: true, status: true, items: true, createdAt: true },
                  })
                : Promise.resolve(null),
        ]);
        res.json({ conversa, mensagens, pedido });
    } catch (error) {
        log.error('Erro ao ler conversa', { erro: String(error) });
        res.status(500).json({ error: 'Erro ao ler conversa' });
    }
});

/** Marca a conversa como lida quando ela e' aberta na tela. */
router.post('/chat/:id/lida', async (req: Request, res: Response) => {
    try {
        await marcarLida(req.params.id);
        res.json({ ok: true });
    } catch (error) {
        log.error('Erro ao marcar conversa como lida', { erro: String(error) });
        res.status(500).json({ error: 'Erro ao marcar como lida' });
    }
});

/**
 * Assume a conversa. O bot cala a partir daqui.
 *
 * A tela chama isto sozinha quando o campo de resposta recebe foco, e nao no
 * clique de um botao "assumir". O motivo e' concreto: quem atende ja escreveu
 * metade da resposta e so percebe depois que o bot respondeu junto. Assumir no
 * foco nao atrapalha ninguem -- o que atrapalha e' a janela em que os dois
 * falam.
 */
router.post('/chat/:id/assumir', async (req: Request, res: Response) => {
    try {
        const conversa = await assumirConversa(req.params.id);
        if (!conversa) return res.status(404).json({ error: 'Conversa nao encontrada.' });
        res.json({ ok: true, conversa });
    } catch (error) {
        log.error('Erro ao assumir conversa', { erro: String(error) });
        res.status(500).json({ error: 'Erro ao assumir conversa' });
    }
});

/** Devolve ao bot, que volta a responder sozinho. */
router.post('/chat/:id/devolver', async (req: Request, res: Response) => {
    try {
        const conversa = await devolverAoBot(req.params.id);
        if (!conversa) return res.status(404).json({ error: 'Conversa nao encontrada.' });
        res.json({ ok: true, conversa });
    } catch (error) {
        log.error('Erro ao devolver conversa ao bot', { erro: String(error) });
        res.status(500).json({ error: 'Erro ao devolver ao bot' });
    }
});

/**
 * Envia mensagem para o cliente.
 *
 * A mensagem e' gravada no historico MESMO se o envio falhar, marcada como
 * `falhou`. A alternativa -- so gravar o que deu certo -- deixaria o atendente
 * sem registro do que ele tentou dizer, e ele repetiria a mesma pergunta. Ver o
 * texto que volta no corpo da resposta.
 */
router.post('/chat/:id/enviar', async (req: Request, res: Response) => {
    try {
        const conversa = await obterConversa(req.params.id);
        if (!conversa) return res.status(404).json({ error: 'Conversa nao encontrada.' });

        const texto = String((req.body ?? {}).texto ?? '').trim();
        if (!texto) return res.status(400).json({ error: 'Escreva a mensagem.' });
        /*
         * Teto de 2000 caracteres, e nao os 4000 que o WhatsApp aceita.
         *
         * O limite do WhatsApp existe para nao cortar mensagem; aqui o teto e'
         * menor por outro motivo: e' o maior texto que uma pessoa digita
         * respondendo um cliente sobre um pedido de marmita. Passar disso e'
         * ou um texto colado inteiro, ou uma pessoa colando o historico de novo
         * sem perceber -- e nos dois casos o cliente recebe um bloco que nao
         * foi lido por ninguem.
         */
        if (texto.length > 2000) {
            return res.status(400).json({ error: 'Mensagem muito longa (max 2000 caracteres).' });
        }

        /*
         * Resposta repetida para o mesmo cliente, no mesmo instante.
         *
         * A tela trava o botao durante o envio, entao um duplo clique nao
         * chega aqui. Chega o duplo envio por outra via -- Enter duas vezes com
         * o foco voltando ao campo, um reenvio de rede, o `chatManda` chamado
         * pelo onkeydown e pelo onclick ao mesmo tempo. O cliente receberia a
         * mesma frase duas vezes, e a segunda parece o atendente se repetindo.
         *
         * A janela e' curta de proposito: repetir a mesma frase de verdade, em
         * conversa de entrega, acontece em minutos -- nunca no mesmo segundo.
         */
        const marca = `${conversa.id}|${texto}`;
        const agora = Date.now();
        const anterior = ultimoEnvio.get(marca);
        if (anterior && agora - anterior < JANELA_REPETICAO_MS) {
            return res.json({ ok: true, aviso: 'Mensagem repetida ignorada.', ignorada: true });
        }
        ultimoEnvio.set(marca, agora);
        // O Map cresce com cada texto distinto. Sem podar, ficaria grande
        // demais: o limite de entradas abaixo e' o que segura isso.
        if (ultimoEnvio.size > 2000) {
            for (const [chave, quando] of ultimoEnvio) {
                if (agora - quando > JANELA_REPETICAO_MS) ultimoEnvio.delete(chave);
            }
        }

        // assume antes de enviar: mensagem do painel com o bot atendendo e' o
        // caso em que o cliente recebe as duas respostas.
        if (conversa.atendente !== 'humano') {
            await assumirConversa(conversa.id);
        }

        /*
         * `enviarMensagemDoPainel` devolve o resultado, ao contrario de
         * `sendWhatsAppMessage`, que engole o erro. Aqui quem esta com o cursor
         * no campo precisa saber se pode limpar a caixa de texto.
         *
         * A gravacao no historico vem depois, em registrarEnvioDoPainel, e
         * carrega `falhou`. A conversa mostra o que a pessoa tentou dizer mesmo
         * quando nao saiu -- sem isso ela repetiria a mesma frase sem saber
         * que ela ja foi tentada.
         */
        const ok = await enviarMensagemDoPainel(conversa.phone, texto);

        await registrarEnvioDoPainel({ phone: conversa.phone, text: texto, falhou: !ok });

        res.json({
            ok,
            // Texto pronto para o flash da tela. A diferenca entre "nao foi
            // possivel enviar" e "enviado" e' o que evita a pessoa repetir a
            // mensagem sem necessidade.
            aviso: ok
                ? 'Mensagem enviada.'
                : 'Nao foi possivel enviar. O WhatsApp pode estar desconectado.',
        });
    } catch (error) {
        log.error('Erro ao enviar mensagem', { erro: String(error) });
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
});

/**
 * Busca a foto, o telefone e o nome do cliente, e grava na conversa.
 *
 * Existe porque os tres so se resolvem sozinhos quando chega mensagem nova. A
 * conversa que ja estava no banco -- de antes desta feature -- ficaria sem foto,
 * sem numero e sem nome ate o cliente falar de novo, e nenhuma dessas tres coisas
 * e' algo que se espere o cliente repetir para ter.
 *
 * A busca de foto respeita a validade de uma semana, entao chamar e' barato. O
 * `forcar` existe para o botao da tela: quem clica quer o resultado agora, nao o
 * cache.
 */
router.post('/chat/:id/atualizar-contato', async (req: Request, res: Response) => {
    try {
        const conversa = await obterConversa(req.params.id);
        if (!conversa) return res.status(404).json({ error: 'Conversa nao encontrada.' });

        const forcar = (req.body ?? {}).forcar === true;
        // Nome e telefone sao leituras locais, a foto e' a unica que vai a
        // rede. Rodam juntos porque a foto e' a lenta e nao ha razao para
        // esperar por ela antes de gravar o resto.
        const [atualizado, nome, telefone] = await Promise.all([
            guardaFoto(conversa.id, () => fotoDoContato(conversa.phone), new Date(), forcar),
            // So procura o nome se ainda falta, para nao sobrescrever o que a
            // mensagem seguinte ja trouxe.
            conversa.name ? Promise.resolve(null) : resolveNome(conversa.phone),
            conversa.semTelefone ? resolveTelefone(conversa.phone) : Promise.resolve(null),
        ]);

        const depois = await obterConversa(conversa.id);
        res.json({ ok: true, atualizado, nome, telefone, conversa: depois });
    } catch (error) {
        log.error('Erro ao atualizar dados do contato', { erro: String(error) });
        res.status(500).json({ error: 'Erro ao buscar foto, nome e telefone' });
    }
});

export default router;
