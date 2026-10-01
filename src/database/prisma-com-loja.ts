/**
 * O cliente do Prisma que sabe a que loja ele esta' falando.
 *
 * Toda consulta que passa por aqui ganha a loja no `where` e no `create`, sem que
 * ninguem peça: sao 197 pontos de consulta e um esquecimento em um deles daria o
 * resultado errado em vez de erro. A loja A leria o pedido da loja B e o painel
 * mostraria dados de outro negocio com a cara de "seu" -- o pior defeito de um
 * SaaS, e invisivel em teste enquanto houver uma loja so.
 *
 * POR QUE UM PROXY E NAO UM `AsyncLocalStorage` DENTRO DO INTERCEPTOR
 *
 * A primeira versao guardava a loja num `AsyncLocalStorage` e o interceptor do
 * Prisma lia. **Nao funciona**, e o motivo e' a razao de o proxy existir: o
 * Prisma nao executa a extensao na mesma fila do chamador. O interceptor roda
 * na fila interna dele, e ve `null` mesmo quando a consulta foi chamada dentro
 * de `comoLoja(...)` -- verificado, nao e' teoria. A alternativa seria capturar
 * a loja em um parametro em 197 lugares.
 *
 * O proxy resolve porque a hora em que a loja pode ser lida e' a hora em que o
 * CODIGO DA CHAMADA e' avaliado, e isso e' sincrono. `prismaComLoja.product`
 * dispara o `get` ali mesmo, dentro da requisicao; o `get` le a loja do contexto e
 * devolve o cliente JA CONSTRUIDO para ela, com a loja fixo no interceptor.
 * Depois disso o Prisma pode executar quando quiser: o valor ja foi copiado.
 *
 * Os clientes por loja sao memorizados, e saoulingues finos sobre o mesmo motor
 * do banco: um tenant por loja, nao uma conexao por loja.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { SEM_LOJA, exigeLoja } from '../services/loja';

const base = new PrismaClient();

/** Modelos que NAO tem loja e por isso ficam de fora da injecao. */
const SEM_TENANT = new Set([SEM_LOJA, 'Sessao']);

/**
 * Modelos em que o `id` E' a loja, e nao uma coluna a parte.
 *
 * Sao a `Config` e o `BotMessage`: uma linha por loja, e a loja e' a propria
 * chave. Neles o filtro vai em `id`, nao em `tenantId` -- escrever `tenantId`
 * nesses models faz o Prisma recusar a consulta ("Unknown argument"), que e' o
 * que derrubou a tela de entrada e o cache de textos do bot na primeira versao.
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
    /**
     * Acrescenta a loja ao `where` sem perder o filtro de quem chamou.
     *
     * So para as operacoes de FILTRO. As de chave unica vao por `chaveUnica`, e
     * a diferenca nao e' detalhe de estilo: embrulhar uma chave unica em `AND`
     * transforma a chave em filtro comum, e `upsert`/`update` exigem
     * `WhereUniqueInput` -- o Prisma recusa em tempo de execucao, com
     * `PrismaClientValidationError`, longe da linha que escreveu a consulta.
     */
    const comLoja = (args: any, modelo: string) => ({
        ...args,
        where: { AND: [args?.where ?? {}, { [campoDaLoja(modelo)]: tenantId }] },
    });

    /**
     * Para as operacoes de chave unica.
     *
     * A chave ja carrega a loja quando o chamador escreveu na forma
     * `tenantId_campo: { ... }` -- e essa e' a forma que o compilador obriga,
     * porque e' a unica que o Prisma gera para uma unique composta. Nesses
     * casos nao se mexe: acrescentar a loja de novo seria redundante, e o `AND`
     * quebraria o tipo do `where`.
     *
     * Quando a chave NAO carrega a loja -- `where: { id }` -- a consulta estourar
     * em vez de rodar sem filtro. E' o mesmo principio do `exigeLoja()`: uma
     * consulta que talvez alcance a loja vizinha nao passa em silencio. O
     * conserto e' no chamador, e o compilador aponta.
     *
     * E o que se compara e' o VALOR da loja, nao o nome do campo. Conferir so o
     * prefixo deixava passar `where: { tenantId_id: { tenantId: 'padaria', id } }`
     * numa sessao da sushi: a consulta rodava, trazia a loja alheia, e nao havia
     * erro em lugar nenhum. A unica forma que passa e' a que traz a loja de quem
     * perguntou.
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
 * O cliente com loja. `prismaComLoja.product.findMany(...)`.
 *
 * O `get` e' o ponto onde a loja e' lida, e ele roda no contexto da chamada.
 *
 * A anotacao de tipo e' `typeof base` de proposito: um `Proxy` inferido devolve
 * `any`, e as consultas passavam a devolver `unknown` em 26 arquivos -- com
 * `price`, `name` e `modifierGroups` deixando de existir para o compilador. O
 * proxy em tempo de execucao tem a MESMA forma do cliente, entao o tipo do
 * cliente e' o tipo certo.
 */
export const prismaComLoja: typeof base = new Proxy({} as any, {
    get(_alvo, membro) {
        /*
         * Tudo que comeca com `$` vai direto para o cliente cru: sao operacoes de
         * SQL sem model (`$queryRawUnsafe`), transacao e ciclo de vida. A loja nao
         * entra nelas -- SQL cru nao passa pelo interceptor, e fingir que entra
         * seria o pior dos dois mundos. Exigir a loja aqui quebrava o backup e o
         * VACUUM, que rodam justamente no boot para nao depender de requisicao.
         *
         * O `bind` nao e' enfeite: sem ele a funcao sai do cliente com o `this`
         * trocado, e o Prisma, la dentro, le um simbolo -- que volta para este
         * proxy e cai no ramo de baixo, estourando "consulta sem loja" num
         * backup que nem consultou loja nenhuma.
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
