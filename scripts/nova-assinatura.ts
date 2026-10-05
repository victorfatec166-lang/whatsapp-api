/*
 * Venda nova: cria a loja e a assinatura no Asaas. E' a unica porta de entrada --
 * nao existe cadastro publico, porque criar conta e' o que o pagamento faz.
 *
 *   npm run assinatura:nova -- --email dono@loja.com --nome "Loja X" --valor 49.9
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** O `.env` da pasta, como no `start.mjs`: quem roda na mao nao tem `process.env`. */
function leEnv(chave: string): string | null {
    try {
        const texto = readFileSync(resolve(RAIZ, '.env'), 'utf8');
        for (const linha of texto.split('\n')) {
            const limpa = linha.trim();
            if (limpa.startsWith('#') || limpa === '') continue;
            const igual = limpa.indexOf('=');
            if (igual < 1 || limpa.slice(0, igual).trim() !== chave) continue;
            const valor = limpa.slice(igual + 1).trim();
            const comAspas =
                valor.length > 1 &&
                ((valor.startsWith('"') && valor.endsWith('"')) ||
                    (valor.startsWith("'") && valor.endsWith("'")));
            return comAspas ? valor.slice(1, -1) : valor;
        }
    } catch {}
    return null;
}

function argumentos(): Record<string, string> {
    const saida: Record<string, string> = {};
    const lista = process.argv.slice(2);
    for (let i = 0; i < lista.length; i += 2) {
        const chave = lista[i]?.replace(/^--/, '');
        if (!chave) continue;
        saida[chave] = lista[i + 1] ?? '';
    }
    return saida;
}

/** Dia 10 do mes que vem: antes do fim do mes o cliente ainda tem o dinheiro do mes. */
function vencimentoPadrao(): string {
    const hoje = new Date();
    const alvo = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 10));
    return alvo.toISOString().slice(0, 10);
}

async function principal() {
    const arg = argumentos();
    const email = (arg.email || '').trim().toLowerCase();
    const nome = (arg.nome || '').trim();
    const valor = Number(arg.valor || process.env.PLANO_MENSAALIDADE || '0');

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Use --email com um endereco valido.');
    if (nome.length < 2) throw new Error('Use --nome com o nome da loja.');
    if (!Number.isFinite(valor) || valor <= 0) throw new Error('Use --valor com o preco da mensalidade.');

    process.env.DATABASE_URL = process.env.DATABASE_URL?.trim() || leEnv('DATABASE_URL') || '';
    for (const chave of ['ASAAS_API_KEY', 'ASAAS_SANDBOX']) {
        const valor = leEnv(chave);
        if (valor && !process.env[chave]) process.env[chave] = valor;
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL nao encontrada (nem no processo, nem no .env).');
    if (!process.env.ASAAS_API_KEY) throw new Error('ASAAS_API_KEY nao encontrada. Rode com ASAAS_SANDBOX=sim primeiro.');

    const { registraVenda } = await import('../src/services/assinaturas');
    const r = await registraVenda({
        nomeLoja: nome,
        emailDono: email,
        valor,
        plano: arg.plano || 'Mensal',
        primeiroVencimento: arg.vencimento || vencimentoPadrao(),
        cpfCnpj: arg.cpfcnpj,
        telefone: arg.telefone,
        formaPagamento: (arg.pagamento as 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX') || 'UNDEFINED',
    });

    console.log('');
    console.log('Venda registrada. A loja entra assim que o primeiro pagamento chegar.');
    console.log(`  loja ......... ${r.loja}`);
    console.log(`  assinatura ... ${r.assinatura}`);
    console.log(`  e-mail ....... ${email}`);
    console.log('');
    console.log("A senha do administrador so existe no log do servidor, e uma vez.");
    console.log('');
}

principal().then(
    () => process.exit(0),
    (erro) => {
        console.error('');
        console.error(String(erro?.message ?? erro));
        console.error('');
        process.exit(1);
    }
);