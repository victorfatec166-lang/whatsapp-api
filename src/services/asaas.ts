/**
 * Adaptador do Asaas. Fala HTTP e nada de negocio: o que um pagamento significa
 * para uma loja esta' em `assinaturas.ts`.
 */
import { logDoModulo } from './logger';
const log = logDoModulo('asaas');

const PRODUCAO = 'https://api.asaas.com';
const SANDBOX = 'https://api-sandbox.asaas.com';

/** `ASAAS_SANDBOX=sim` aponta para o ambiente de teste, que nao move dinheiro. */
export function base(): string {
    return process.env.ASAAS_SANDBOX === 'sim' ? SANDBOX : PRODUCAO;
}

/** Sem chave nao ha cobranca: o resto do produto continua funcionando sem ela. */
export function configurado(): boolean {
    return Boolean(process.env.ASAAS_API_KEY?.trim());
}

export type ClienteAsaas = { id: string; name: string; email: string };

export type AssinaturaAsaas = {
    id: string;
    customer: string;
    value: number;
    cycle: string;
    status: string;
    nextDueDate: string | null;
    billingType: string;
    /**
     * A cobranca da proxima parcela. Sem este campo a tela de espera so diz que a
     * cobranca existe -- e nao onde o dono paga, que e' a unica coisa que ele
     * precisa fazer. No Asaas vem em snake_case.
     */
    latestInvoice?: string | null;
};

export type CobrancaAsaas = {
    id: string;
    customer: string;
    subscription: string | null;
    value: number;
    status: string;
    dueDate: string | null;
};

/**
 * O erro do Asaas vem em `{ errors: [{ description }] }`. Sem isto a tela mostraria
 * "erro 400" e a causa -- chave invalida, cliente sem CPF, valor abaixo do
 * minimo -- fica hiding no corpo que ninguem le.
 */
function motivoDoErro(corpo: string, status: number): string {
    try {
        const dados = JSON.parse(corpo) as { errors?: Array<{ description?: string }> };
        const primeiro = dados.errors?.[0]?.description;
        if (primeiro) return `${status}: ${primeiro}`;
    } catch {}
    return corpo ? `${status}: ${corpo.slice(0, 300)}` : `HTTP ${status}`;
}

async function chamar<T>(caminho: string, metodo: 'GET' | 'POST' | 'DELETE', corpo?: unknown): Promise<T> {
    const chave = process.env.ASAAS_API_KEY?.trim();
    if (!chave) throw new Error('ASAAS_API_KEY nao configurada.');

    const r = await fetch(`${base()}/v3${caminho}`, {
        method: metodo,
        headers: { access_token: chave, 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(20_000),
    });

    const texto = await r.text();
    if (!r.ok) {
        const motivo = motivoDoErro(texto, r.status);
        log.warn(`Asaas ${metodo} ${caminho} recusou`, { motivo });
        throw new Error(motivo);
    }
    return (texto ? JSON.parse(texto) : {}) as T;
}

export async function criaCliente(dados: { nome: string; email: string; cpfCnpj?: string; telefone?: string }) {
    return chamar<ClienteAsaas>('/customers', 'POST', {
        name: dados.nome,
        email: dados.email,
        cpfCnpj: dados.cpfCnpj || undefined,
        phone: dados.telefone || undefined,
    });
}

export async function criaAssinatura(dados: {
    customer: string;
    valor: number;
    primeiroVencimento: string;
    descricao: string;
    formaPagamento?: 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX';
    referencia: string;
    juros?: number;
    multa?: number;
}) {
    return chamar<AssinaturaAsaas>('/subscriptions', 'POST', {
        customer: dados.customer,
        billingType: dados.formaPagamento ?? 'UNDEFINED',
        value: dados.valor,
        nextDueDate: dados.primeiroVencimento,
        cycle: 'MONTHLY',
        description: dados.descricao,
        externalReference: dados.referencia,
        interest: dados.juros ? { value: dados.juros } : undefined,
        fine: dados.multa ? { value: dados.multa } : undefined,
    });
}

export async function leAssinatura(id: string) {
    return chamar<AssinaturaAsaas>(`/subscriptions/${encodeURIComponent(id)}`, 'GET');
}

export async function atualizaAssinatura(id: string, dados: { valor?: number; proximoVencimento?: string }) {
    return chamar<AssinaturaAsaas>(`/subscriptions/${encodeURIComponent(id)}`, 'POST', {
        value: dados.valor,
        nextDueDate: dados.proximoVencimento,
    });
}

/**
 * Onde o dono paga. O Asaas hospeda a pagina e mostra cartao, PIX e boleto na
 * mesma tela -- nenhuma exige codigo nosso, e o dinheiro cai direto na conta
 * cadastrada. Sem isto o dono sabe que a cobranca existe e nao sabe onde pagar.
 */
export function urlDePagamento(idDaCobranca: string): string {
    const id = idDaCobranca.trim();
    return `${base()}/v3/payments/${encodeURIComponent(id)}/paymentForm`;
}

/** Cancela a recorrencia la no Asaas. O acesso e' desligado a parte, em `assinaturas`. */
export async function removeAssinatura(id: string) {
    return chamar<{ deleted: boolean }>(`/subscriptions/${encodeURIComponent(id)}`, 'DELETE');
}

export async function leCobranca(id: string) {
    return chamar<CobrancaAsaas>(`/payments/${encodeURIComponent(id)}`, 'GET');
}