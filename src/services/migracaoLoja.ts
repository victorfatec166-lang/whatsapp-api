/*
 * A loja passando da nuvem (Postgres) para o arquivo SQLite do PC dela.
 *
 * Linha a linha, com o mesmo id nos dois bancos: e' o id que mantem o historico.
 */

import type { PrismaClient } from '@prisma/client';

type Cliente = PrismaClient;

type Tabela = {
    modelo: string;
    /** A coluna que diz de quem a linha e': quase todas sao `tenantId`. */
    coluna: 'tenantId' | 'id';
};

/**
 * A ordem e' a das chaves estrangeiras, e o SQLite respeita FK: filha antes do pai
 * aqui e' um `db push` quebrado na metade. `Tenant` primeiro, `Message` (que aponta
 * para `Chat`) por ultimo.
 */
const TABELAS: Tabela[] = [
    { modelo: 'tenant', coluna: 'id' },
    { modelo: 'user', coluna: 'tenantId' },
    { modelo: 'config', coluna: 'id' },
    { modelo: 'botMessage', coluna: 'id' },
    { modelo: 'modifierGroup', coluna: 'tenantId' },
    { modelo: 'modifierOption', coluna: 'tenantId' },
    { modelo: 'product', coluna: 'tenantId' },
    { modelo: 'productModifierGroup', coluna: 'tenantId' },
    { modelo: 'comboItem', coluna: 'tenantId' },
    { modelo: 'dailyMenu', coluna: 'tenantId' },
    { modelo: 'dailyMenuItem', coluna: 'tenantId' },
    { modelo: 'stockMovement', coluna: 'tenantId' },
    { modelo: 'order', coluna: 'tenantId' },
    { modelo: 'marketplaceAccount', coluna: 'tenantId' },
    { modelo: 'marketplaceItem', coluna: 'tenantId' },
    { modelo: 'parkedSale', coluna: 'tenantId' },
    { modelo: 'cashShift', coluna: 'tenantId' },
    { modelo: 'cashMovement', coluna: 'tenantId' },
    { modelo: 'pedidoAberto', coluna: 'tenantId' },
    { modelo: 'chat', coluna: 'tenantId' },
    { modelo: 'message', coluna: 'tenantId' },
    { modelo: 'reminder', coluna: 'tenantId' },
];

/** A sessao do WhatsApp e' da maquina que pareou, entao so vai com `--copiar-sessao-whatsapp`. */
const SESSAO = [
    { modelo: 'sessaoWhatsApp', coluna: 'tenantId' },
    { modelo: 'chaveWhatsApp', coluna: 'tenantId' },
] as const;

export type ResultadoDaCopia = {
    modelo: string;
    lidas: number;
    gravadas: number;
    repetidas: number;
};

/** Nao atravessa sessao, fila nem assinatura (moram na nuvem), nem segredo cifrado. */
const CIFRADOS = ['relayChaveEnc', 'secretsEnc', 'webhookSecretEnc'];

export type Copia = {
    /** Percorre sem gravar: e' o que o script mostra antes de perguntar. */
    simular?: boolean;
    sessaoWhatsApp?: boolean;
    /** Uma linha por tabela, para o log do script. */
    aoGravar?: (linha: ResultadoDaCopia) => void;
};

type TabelaSolta = {
    findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
    create: (a: unknown) => Promise<unknown>;
};

/**
 * Os dois clientes vem do mesmo schema, mas de pastas diferentes: o do SQLite vive em
 * `cliente/servidor/`, porque o `node_modules` da raiz so tem um driver por vez.
 */
function modeloDe(cliente: Cliente, nome: string): TabelaSolta {
    const solto = cliente as unknown as Record<string, TabelaSolta>;
    const modelo = solto[nome];
    if (!modelo) throw new Error('modelo desconhecido: ' + nome);
    return modelo;
}

function semCifrado(linha: Record<string, unknown>): Record<string, unknown> {
    const copia = { ...linha };
    for (const campo of CIFRADOS) delete copia[campo];
    return copia;
}

/** `P2002` e' violacao de chave unica: a linha ja estava no destino. */
function jaExiste(erro: unknown): boolean {
    return (erro as { code?: string })?.code === 'P2002';
}

/**
 * Copia a loja de um banco para o outro, sem apagar nada.
 *
 * O que ja existe no destino e' pulado, e nao sobrescrito: e' o que faz o script poder
 * rodar duas vezes depois de uma falha no meio sem duplicar pedido.
 */
export async function copiaLoja(origem: Cliente, destino: Cliente, loja: string, copia: Copia = {}): Promise<ResultadoDaCopia[]> {
    const resultados: ResultadoDaCopia[] = [];
    const tabelas = copia.sessaoWhatsApp ? [...TABELAS, ...SESSAO] : TABELAS;

    for (const { modelo, coluna } of tabelas) {
        const daLoja = modeloDe(origem, modelo);
        const doDestino = modeloDe(destino, modelo);
        const linhas = await daLoja.findMany({ where: { [coluna]: loja } });

        let gravadas = 0;
        let repetidas = 0;
        if (!copia.simular) {
            for (const linha of linhas) {
                try {
                    await doDestino.create({ data: semCifrado(linha) as never });
                    gravadas++;
                } catch (erro) {
                    if (!jaExiste(erro)) throw erro;
                    repetidas++;
                }
            }
        }

        const resultado = { modelo, lidas: linhas.length, gravadas, repetidas };
        resultados.push(resultado);
        copia.aoGravar?.(resultado);
    }

    return resultados;
}