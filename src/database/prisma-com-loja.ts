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
    // A sessao do WhatsApp e' lida fora de requisicao; quem chama passa a loja na
    // mao, e a injecao aqui atrapalharia em vez de ajudar.
    'SessaoWhatsApp',
    'ChaveWhatsApp',
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

type Cliente = ReturnType<typeof montarCliente>;
const porLoja = new Map<string, Cliente>();

/** Monta o cliente de uma loja, com a loja fixa no interceptor. */
function montarCliente(tenantId: string) {
    // So para as operacoes de FILTRO. Embrulhar uma chave unica em `AND` quebra o
    // `WhereUniqueInput` que `upsert`/`update` exigem, e o erro chega longe da linha.
    const comLoja = (args: any, modelo: string) => ({
        ...args,
        where: { AND: [args?.where ?? {}, { [campoDaLoja(modelo)]: tenantId }] },
    });

    /**
     * A chave ja traz a loja quando o chamador usou a composta `tenantId_campo`, a unica
     * forma que o Prisma gera para unique composta; sem isso `where: { id }` estoura em vez
     * de rodar sem filtro. Confere o VALOR da loja, e nao o prefixo do campo.
     */
    const chaveUnica = (args: any, onde: string) => {
        const esperado = exigeLoja();
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

    return base.$extends({
        name: 'prisma-loja',
        query: {
            $allModels: {
                async findMany({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model));
                },
                async findFirst({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model));
                },
                async findFirstOrThrow({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model));
                },
                async findUnique({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(chaveUnica(args, model));
                },
                async findUniqueOrThrow({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(chaveUnica(args, model));
                },
                async count({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model));
                },
                async aggregate({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model));
                },
                async groupBy({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model));
                },
                async create({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query({ ...args, data: { ...args?.data, [campoDaLoja(model)]: tenantId } } as any);
                },
                async createMany({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query({ ...args, data: marca(args?.data, model, tenantId) } as any);
                },
                async update({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(chaveUnica(args, model));
                },
                async updateMany({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model));
                },
                async upsert({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query({
                        ...chaveUnica(args, model),
                        create: { ...args?.create, [campoDaLoja(model)]: tenantId },
                    } as any);
                },
                async delete({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(chaveUnica(args, model));
                },
                // `deleteMany` sem filtro e' a operacao mais perigosa que existe
                // aqui: sem a loja no `where` ela apagaria a tabela INTEIRA. A
                // virada da meia-noite usa exatamente esta chamada.
                async deleteMany({ args, query, model }) {
                    if (SEM_TENANT.has(model)) return query(args);
                    return query(comLoja(args, model));
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
        /*
         * Tudo que comeca com `$` vai para o cliente cru: SQL sem model, transacao e ciclo
         * de vida -- o backup roda no boot e nao tem loja. O `bind` evita o
         * Prisma ler um simbolo com o `this` trocado e voltar para este proxy.
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
