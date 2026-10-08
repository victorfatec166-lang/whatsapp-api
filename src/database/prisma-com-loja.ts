/**
 * O cliente do Prisma que injeta a loja em toda consulta: um `tenantId` esquecido
 * daria resultado errado em vez de erro -- por isso o proxy le a loja no `get`, que
 * roda na fila do chamador. Nao cria cliente proprio: dois clientes sao dois pools.
 */
import { Prisma } from '@prisma/client';
import { SEM_LOJA, exigeLoja } from '../services/loja';
import { prisma as base } from './prisma';

/** Modelos que NAO tem loja e por isso ficam de fora da injecao. */
const SEM_TENANT = new Set([
    SEM_LOJA,
    'Sessao',
    'Assinatura',
    'EventoAssinatura',
    // A senha de entrada do dono: quem busca e' a tela de login, que roda sem loja
    // -- nao ha loja antes de existir sessao. Injetar aqui a impediria a busca.
    'CredencialProvisional',
    // A sessao do WhatsApp e' lida fora de requisicao; quem chama passa a loja na
    // mao, e a injecao aqui atrapalharia em vez de ajudar.
    'SessaoWhatsApp',
    'ChaveWhatsApp',
    // A chave do PC da loja e' procurada pelo SEGREDO, antes de existir loja: e' a
    // propria autenticacao. O campo com o nome da loja e' a chave primaria.
    'ChaveDeLoja',
]);

/**
 * Modelos em que o `id` E' a loja, e nao uma coluna a parte: o filtro vai em `id`.
 * Escrever `tenantId` neles faz o Prisma recusar a consulta ("Unknown argument").
 */
const ID_E_LOJA = new Set(['Config', 'BotMessage']);

/** Em qual campo a loja entra no filtro deste model. */
function campoDaLoja(modelo: string): string {
    return ID_E_LOJA.has(modelo) ? 'id' : 'tenantId';
}

/**
 * O `tx` entrega o delegate pelo nome em camelCase (`dailyMenuItem`) e as listas
 * acima estao em PascalCase (`DailyMenuItem`). Casa os dois pela forma da palavra,
 * porque `camelCase -> PascalCase` nao tem regra: `dailyMenu` voltaria `Dailymenu`.
 */
const MODELO_PELO_DELEGATE = new Map<string, string>(
    Prisma.dmmf.datamodel.models.map((m) => [m.name.toLowerCase().replace(/\W/g, ''), m.name])
);

type Cliente = ReturnType<typeof montarCliente>;
const porLoja = new Map<string, Cliente>();

// So para as operacoes de FILTRO. Embrulhar uma chave unica em `AND` quebra o
// `WhereUniqueInput` que `upsert`/`update` exigem, e o erro chega longe da linha.
const comLoja = (args: any, modelo: string, loja: string) => ({
    ...args,
    where: { AND: [args?.where ?? {}, { [campoDaLoja(modelo)]: loja }] },
});

/**
 * A chave ja traz a loja quando o chamador usou a composta `tenantId_campo`, a unica
 * forma que o Prisma gera para unique composta; sem isso `where: { id }` estoura em vez
 * de rodar sem filtro. Confere o VALOR da loja, e nao o prefixo do campo.
 */
const chaveUnica = (args: any, onde: string, esperado: string) => {
    const where = (args?.where ?? {}) as Record<string, unknown>;
    for (const [campo, valor] of Object.entries(where)) {
        if (!valor || typeof valor !== 'object') continue;
        if (campo.startsWith('tenantId_') && (valor as any).tenantId === esperado) return args;
        if (ID_E_LOJA.has(onde) && campo.startsWith('id_') && (valor as any).id === esperado) return args;
    }
    if (ID_E_LOJA.has(onde) && where.id === esperado) return args;

    throw new Error(
        `Consulta por chave unica sem a loja: ${onde}. Use a chave composta -- ` +
            `where: { tenantId_id: { tenantId: exigeLoja(), id } } -- ou uma operacao de filtro. ` +
            'Sem isso a consulta alcancaria a loja vizinha.'
    );
};

/** Operacoes por chave unica: a loja tem de estar na chave, nao no filtro. */
const CHAVE_UNICA = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);

/** O mesmo passo que a extensao da, para o cliente que a extensao nao alcanca. */
function reescreve(metodo: string, args: any, modelo: string, loja: string): any {
    if (SEM_TENANT.has(modelo)) return args;
    if (CHAVE_UNICA.has(metodo)) return chaveUnica(args, modelo, loja);
    if (metodo === 'upsert') {
        return { ...chaveUnica(args, modelo, loja), create: marca(args?.create, modelo, loja) };
    }
    if (metodo === 'create' || metodo === 'createMany') {
        return { ...args, data: marca(args?.data, modelo, loja) };
    }
    return comLoja(args, modelo, loja);
}

/**
 * O `tx` do `$transaction` e' o cliente CRU e a extensao nao chega nele: uma
 * `findUnique({ where: { id } })` la dentro lia -- e escrevia -- o produto da loja
 * vizinha. O embrulho so reescreve os argumentos, entao a transacao continua a mesma.
 */
function envolveTransacao(tx: any, loja: string): any {
    const porModelo = new Map<string, any>();
    return new Proxy(tx, {
        get(alvo, membro) {
            /*
             * O que comeca com `$` e' do proprio `tx`: `$executeRawUnsafe` nao tem
             * `where` para reescrever, e quem escreve `tenantId` no texto da consulta
             * continua sendo o responsavel por ele.
             */
            if (typeof membro !== 'string' || membro.startsWith('$')) {
                const direto = alvo[membro];
                return typeof direto === 'function' ? direto.bind(alvo) : direto;
            }
            let modelo = porModelo.get(membro);
            if (!modelo) {
                const nome = MODELO_PELO_DELEGATE.get(membro.toLowerCase()) ?? membro;
                modelo = new Proxy(alvo[membro], {
                    get(del, metodo) {
                        if (typeof metodo !== 'string') return del[metodo];
                        return (args: any) => del[metodo](reescreve(metodo, args, nome, loja));
                    },
                });
                porModelo.set(membro, modelo);
            }
            return modelo;
        },
    });
}

/** A loja dentro da transacao. O array de `$transaction([...])` ja vem montado. */
function transacaoDaLoja(args: any, loja: string): any {
    if (typeof args !== 'function') return args;
    return (tx: any) => args(envolveTransacao(tx, loja));
}

/** Monta o cliente de uma loja, com a loja fixa no interceptor. */
function montarCliente(tenantId: string) {
    return base.$extends({
        name: 'prisma-loja',
        query: {
            $allModels: {
                async findMany({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model, tenantId));
                },
                async findFirst({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model, tenantId));
                },
                async findFirstOrThrow({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model, tenantId));
                },
                async findUnique({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(chaveUnica(args, model, tenantId));
                },
                async findUniqueOrThrow({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(chaveUnica(args, model, tenantId));
                },
                async count({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model, tenantId));
                },
                async aggregate({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model, tenantId));
                },
                async groupBy({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model, tenantId));
                },
                async create({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query({ ...args, data: marca(args?.data, model, tenantId) } as any);
                },
                async createMany({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query({ ...args, data: marca(args?.data, model, tenantId) } as any);
                },
                async update({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(chaveUnica(args, model, tenantId));
                },
                async updateMany({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model, tenantId));
                },
                async upsert({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query({
                        ...chaveUnica(args, model, tenantId),
                        create: marca(args?.create, model, tenantId),
                    } as any);
                },
                async delete({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(chaveUnica(args, model, tenantId));
                },
                // `deleteMany` sem filtro e' a operacao mais perigosa que existe
                // aqui: sem a loja no `where` ela apagaria a tabela INTEIRA. A
                // virada da meia-noite usa exatamente esta chamada.
                async deleteMany({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model, tenantId));
                },
            },
        },
    });
}

/** `createMany` aceita um array; a loja entra em cada item. */
function marca(data: any, modelo: string, tenantId: string) {
    const campo = campoDaLoja(modelo);
    return Array.isArray(data) ? data.map((d) => ({ ...d, [campo]: tenantId })) : { ...data, [campo]: tenantId };
}

function clienteDaLoja(tenantId: string): Cliente {
    let c = porLoja.get(tenantId);
    if (!c) {
        c = montarCliente(tenantId);
        porLoja.set(tenantId, c);
    }
    return c;
}

/**
 * O `get` e' onde a loja e' lida, e roda no contexto da chamada. O tipo e'
 * `typeof base`: um `Proxy` inferido devolve `any` e as consultas viravam `unknown`.
 */
export const prismaComLoja: typeof base = new Proxy({} as any, {
    get(_alvo, membro) {
        if (typeof membro === 'string' && membro === '$transaction') {
            /*
             * A transacao e' a unica porta em que a extensao nao acompanha: o `tx` que
             * o Prisma entrega ao callback e' o cliente cru, e por isso ela ganha o
             * embrulho. O `bind` evita o Prisma ler um simbolo com o `this` trocado.
             */
            const loja = exigeLoja();
            return (corpo: any, opcoes?: any) => (base as any).$transaction(transacaoDaLoja(corpo, loja), opcoes);
        }
        /*
         * Tudo que comeca com `$` vai para o cliente cru: SQL sem model e ciclo de
         * vida -- o backup roda no boot e nao tem loja.
         */
        if (typeof membro !== 'string' || membro.startsWith('$')) {
            const direto = (base as any)[membro];
            return typeof direto === 'function' ? direto.bind(base) : direto;
        }
        return clienteDaLoja(exigeLoja())[membro as never];
    },
}) as typeof base;

/** O cliente cru, para o que e' de fato global: Tenant, Sessao e o proprio login. */
export const prisma = base;

export { Prisma };
