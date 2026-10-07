/**
 * Os WhatsApp conectados, um por loja. Mora separado do `bot.ts` porque ele importa
 * o Baileys, que e' ESM sem `require` e nao roda no teste -- e a regra do isolamento,
 * que e' o que impede a loja B de responder no numero da loja A, precisa de teste.
 */
import { lojaAtual, lojaDoBoot } from './loja';
import { notifyConnection } from './sse';
import { logDoModulo } from './logger';
import type { LinhaCarrinho } from './carrinho';

const log = logDoModulo('bot-lojas');

/** Onde a conversa com um cliente parou: menu, escolhendo modificador, fechou. */
export type Session = {
    step: string;
    productId?: string;
    groupIndex?: number;
    picked?: Record<string, string[]>;
    /**
     * Retrato da lista enviada ao cliente, na ordem em que ele a viu: o menu do
     * dia muda enquanto ele escolhe, e sem o retrato o numero digitado apontaria
     * para outro prato depois de uma edicao na hora.
     */
    offered?: Array<{ id: string; name: string; price: number }>;
    /** O que a pessoa ja pediu: e' o que faz "2 coxinhas e 1 refri" virar um pedido so. */
    carrinho?: LinhaCarrinho[];
};

export type ConnectionPhase =
    | 'desconectado'
    | 'aguardando-qr'
    | 'escaneado'
    | 'sincronizando'
    | 'conectado'
    | 'deslogado';

export type ConnectionState = {
    phase: ConnectionPhase;
    online: boolean;
    /** QR atual em base64 ou string crua; null quando nao ha QR valido. */
    qr: string | null;
    /** epoch ms de emissao do QR, para a UI detectar expiracao (validade ~30s). */
    qrIssuedAt: number | null;
    phone: string | null;
    name: string | null;
    platform: string | null;
    since: number | null;
    lastError: string | null;
    /** Aviso de outra instalacao com o mesmo numero; a tela mostra em cima do QR. */
    sessaoDeOutraMaquina: string | null;
};

/**
 * Um WhatsApp conectado, e tudo o que gira em volta dele: o socket (um aparelho so
 * nao atende duas lojas), a etapa de cada conversa e o estado do pareamento.
 */
export type Conexao = {
    loja: string;
    sock: any;
    sessoes: Record<string, Session>;
    estado: ConnectionState;
    /** Sobrevive ao reconnect, que zera o estado. */
    estranha: { motivo: string; podeAparear: boolean } | null;
    listeners: Set<(estado: ConnectionState) => void>;
    onOrderCreated?: () => void;
    /** Trava de abertura: duas chamadas seguidas nao podem abrir dois sockets. */
    abrindo?: Promise<void>;
    /** Quantas vezes reconectou sem sucesso. Zera quando o socket abre. */
    tentativas?: number;
};

/**
 * Quantas vezes o bot pode reconectar sozinho antes de parar e esperar o dono.
 *
 * Sem teto, um erro que se repete (QR expirado, rede fora) vira ciclo eterno: o
 * log enche de "conexao fechada" e o painel nunca sai do "reconectando".
 */
export const TENTATIVAS_MAXIMAS = 8;

/** O registro, exposto para quem precisar consultar (o ot.ts e o desligamento). */
export function registroDeLojas(): Map<string, Conexao> {
    return conexoes;
}

const conexoes = new Map<string, Conexao>();

/** QR expira em ~30s; depois disso a UI deve pedir um novo. */
export const QR_TTL_MS = 30_000;

/**
 * A loja de quem esta chamando. Fora de requisicao sobra a do boot -- que era a
 * unica loja que existia antes das assinaturas, e o unico lugar onde devolver ela
 * sem loja nao mostra o WhatsApp de outra.
 */
export function lojaDoChamador(): string {
    return lojaAtual() ?? lojaDoBoot();
}

export function estadoInicial(): ConnectionState {
    return {
        phase: 'desconectado',
        online: false,
        qr: null,
        qrIssuedAt: null,
        phone: null,
        name: null,
        platform: null,
        since: null,
        lastError: null,
        sessaoDeOutraMaquina: null,
    };
}

/** A conexao da loja em atendimento, ou `null` se ela nao tem WhatsApp ligado. */
export function conexaoAtual(): Conexao | null {
    const loja = lojaAtual();
    return loja ? conexoes.get(loja) ?? null : null;
}

/** Como `conexaoAtual`, mas para o caminho que nao pode seguir sem socket. */
export function exigeConexao(): Conexao {
    const conexao = conexaoAtual();
    if (!conexao) {
        throw new Error(
            'Bot sem conexao para a loja do contexto. Quem chama precisa rodar dentro de `comoLoja`, ' +
                'e a loja precisa ter o WhatsApp ligado.'
        );
    }
    return conexao;
}

/** O socket da loja em atendimento; `null` enquanto ela nao conectou. */
export function socket(): any {
    return conexaoAtual()?.sock ?? null;
}

/** As conversas em andamento da loja: carrinho e etapa sao por cliente e por loja. */
export function sessoes(): Record<string, Session> {
    return exigeConexao().sessoes;
}

/**
 * A conexao da loja, criada vazia se ainda nao existir. O painel precisa disso
 * para mostrar "desconectado" numa loja que nunca pareou, sem tratar a ausencia
 * como erro.
 */
export function garantirConexao(loja: string): Conexao {
    let conexao = conexoes.get(loja);
    if (!conexao) {
        conexao = {
            loja,
            sock: null,
            sessoes: {},
            estado: estadoInicial(),
            estranha: null,
            listeners: new Set(),
        };
        conexoes.set(loja, conexao);
    }
    return conexao;
}

export function isBotOnline(loja?: string): boolean {
    const id = loja ?? lojaAtual();
    return id ? conexoes.get(id)?.estado.online === true : false;
}

export function getConnectionState(loja = lojaDoChamador()): ConnectionState {
    const estado = conexoes.get(loja)?.estado ?? estadoInicial();
    // Mascara o QR expirado para a UI nunca renderizar um codigo morto.
    const qrValido = estado.qr !== null && estado.qrIssuedAt !== null && Date.now() - estado.qrIssuedAt < QR_TTL_MS;
    return { ...estado, qr: qrValido ? estado.qr : null };
}

export function setConnection(loja: string, patch: Partial<ConnectionState>): void {
    const conexao = garantirConexao(loja);
    Object.assign(conexao.estado, patch);
    // Reemitido em toda mudanca de estado, e nao so no boot: um reconnect reseta a
    // fase para aguardando-qr e o aviso sumiria bem quando a pessoa precisa dele.
    conexao.estado.sessaoDeOutraMaquina = conexao.estranha?.motivo ?? null;
    const snapshot = getConnectionState(loja);
    for (const listener of conexao.listeners) {
        try {
            listener(snapshot);
        } catch (error) {
            log.error('Erro em listener de conexao:', error);
        }
    }
    notifyConnection(loja, JSON.stringify(snapshot));
}

/** Quem acompanha o pareamento. Por loja: o painel do dono nao espelha o do vizinho. */
export function onConnectionChange(
    listener: (estado: ConnectionState) => void,
    loja = lojaDoChamador()
): () => void {
    const conexao = garantirConexao(loja);
    conexao.listeners.add(listener);
    listener(getConnectionState(loja));
    return () => {
        conexao.listeners.delete(listener);
    };
}

/** Usado pelos testes e pelo desligamento: esvazia o registro sem fechar socket. */
export function esqueceLoja(loja: string): void {
    conexoes.delete(loja);
}

export function lojasConectadas(): string[] {
    return [...conexoes.keys()];
}