/**
 * A sessao do Baileys no Postgres: o arquivo morre a cada deploy na nuvem, e o bot
 * voltava para a tela de QR toda vez. O Baileys nao entra por import -- quem chama
 * passa o codec, porque ele e' ESM sem `require` e quebraria o runner de teste.
 */
import fs from 'fs';
import path from 'path';

import type {
    AuthenticationCreds,
    AuthenticationState,
    SignalDataSet,
    SignalKeyStore,
} from '@whiskeysockets/baileys';

import { prisma } from '../database/prisma';
import { logDoModulo } from './logger';
import { idDaMaquina } from './maquina';
import { DIR_SESSAO_WHATSAPP } from './paths';

const log = logDoModulo('whatsapp-sessao');

/** O que o Baileys precisa saber para ler e escrever o estado; vem de quem o usa. */
export type CodecsDaSessao = {
    /** Creds de uma sessao que ainda nao existe: o formato completo, que nao se inventa. */
    credsVazios: () => AuthenticationCreds;
    serializa: (valor: unknown) => string;
    desserializa: (texto: string) => unknown;
    /**
     * `app-state-sync-key` volta do JSON como objeto solto, e o Baileys espera a
     * classe do proto. Fica de fora do store porque essa e' a unica transformacao
     * que depende do Baileys de verdade.
     */
    preparar?: (tipo: string, valor: any) => unknown;
};

/**
 * A instalacao que pareou. O `MachineGuid` nao existe no Linux, e sem ele a nuvem
 * cairia num id sorteado a cada deploy -- que seria pedir QR outra vez, o defeito que
 * este servico existe para tirar. `BAILEYS_INSTALACAO` separa duas maquinas la.
 */
export function idDaInstalacao(): string {
    const doAmbiente = process.env.BAILEYS_INSTALACAO?.trim();
    if (doAmbiente) return doAmbiente;
    return idDaMaquina() || 'nuvem';
}

/** Onde o Baileys deixa a sessao em arquivo, quando ela ainda existe de antes. */
export function pastaDeArquivo(): string {
    return process.env.BAILEYS_AUTH_DIR?.trim() || DIR_SESSAO_WHATSAPP;
}

/**
 * Tipos de chave de sinal, do mais longo para o mais curto: `sender-key-memory`
 * comeca com `sender-key`, e desfazer o nome do arquivo na ordem errada gravaria a
 * chave de grupo como sessao -- e ai o grupo inteiro deixa de ser lido.
 */
const TIPOS = [
    'app-state-sync-version',
    'app-state-sync-key',
    'sender-key-memory',
    'lid-mapping',
    'device-list',
    'identity-key',
    'tctoken',
    'pre-key',
    'session',
    'sender-key',
];

/**
 * Todas as chaves de sinal do arquivo, com o texto de cada uma como o Baileys
 * gravou -- o texto vai cru, que ja' e' o formato do `serializa`. O id do Signal
 * nunca tem `/` nem `:`, que sao os trocados no nome do arquivo, entao volta pelo fim.
 */
function chavesDoArquivo(): Array<{ tipo: string; chave: string; valor: string }> {
    const lista: Array<{ tipo: string; chave: string; valor: string }> = [];
    let nomes: string[];
    try {
        nomes = fs.readdirSync(pastaDeArquivo());
    } catch {
        return lista;
    }
    for (const nome of nomes) {
        if (!nome.endsWith('.json') || nome === 'creds.json') continue;
        const corpo = nome.slice(0, -'.json'.length);
        const tipo = TIPOS.find((t) => corpo.startsWith(`${t}-`));
        if (!tipo) continue;
        try {
            lista.push({
                tipo,
                chave: corpo.slice(tipo.length + 1),
                valor: fs.readFileSync(path.join(pastaDeArquivo(), nome), 'utf8'),
            });
        } catch {
            // Chave ilegivel e' uma chave a menos; o resto da sessao presta.
        }
    }
    return lista;
}

/**
 * Importa a sessao que estava em arquivo, uma vez so. Sem as chaves de sinal o
 * Baileys ignora a mensagem de quem ja conversava, e um cliente que nao sabe que
 * foi silenciado repete a mensagem achando que deu errado.
 */
async function importaDoArquivo(
    tenantId: string,
    maquinaId: string,
    codecs: CodecsDaSessao
): Promise<AuthenticationCreds | null> {
    let creds: AuthenticationCreds;
    try {
        creds = codecs.desserializa(
            fs.readFileSync(path.join(pastaDeArquivo(), 'creds.json'), 'utf8')
        ) as AuthenticationCreds;
    } catch {
        return null;
    }

    /*
     * `registered: false` e' uma sessao que o WhatsApp ja encerrou. Importar isso
     * faria o bot passar o boot inteiro tentando conectar com credencial morta e
     * cair em logout de novo -- e o dono leria isso como "o sistema nao para".
     */
    if (creds.registered !== true) {
        log.warn('A sessao em arquivo esta encerrada; ignorando e pareando de novo.');
        limpaArquivoDeSessao();
        return null;
    }

    await prisma.sessaoWhatsApp.create({ data: { tenantId, maquinaId, creds: codecs.serializa(creds) } });

    /*
     * Uma sessao com meses de conversa tem dezenas de mil chaves, e o Postgres corta
     * o INSERT em 65.535 parametros: 24 mil linhas estouram isso numa so. O lote de
     * 500 deixa cada INSERT com folga e nao depende do tamanho da sessao.
     */
    const chaves = chavesDoArquivo();
    const LOTE = 500;
    for (let i = 0; i < chaves.length; i += LOTE) {
        await prisma.chaveWhatsApp.createMany({
            data: chaves.slice(i, i + LOTE).map((c) => ({ tenantId, maquinaId, ...c })),
            skipDuplicates: true,
        });
    }
    log.info(`Sessao do WhatsApp importada do arquivo: ${chaves.length} chave(s).`);
    return creds;
}

/**
 * O store de chaves do Baileys sobre o banco. `set` chega com varias chaves por vez,
 * e no handshake vem uma leva inteira de pre-key: a insercao e' em lote, e o cache em
 * memoria cobre a releitura do mesmo jid (TTL so abriria janela de valor velho).
 */
function storeDeChaves(tenantId: string, maquinaId: string, codecs: CodecsDaSessao): SignalKeyStore {
    const cache = new Map<string, any>();
    const idDeCache = (tipo: string, chave: string) => `${tipo}\u0000${chave}`;
    const guarda = (tipo: string, chave: string, valor: unknown) => {
        // Teto simples em vez de LRU: um mapa que cresce sem parar em troca de
        // acertar o Complexo nao serve, e a sessao que cresce e' a memoria.
        if (cache.size >= 5_000) cache.clear();
        cache.set(idDeCache(tipo, chave), valor);
    };

    return {
        async get(type, ids) {
            const dados: Record<string, any> = {};
            const faltando: string[] = [];
            for (const id of ids) {
                const emCache = cache.get(idDeCache(type as string, id));
                if (emCache === undefined) faltando.push(id);
                else dados[id] = emCache;
            }
            if (!faltando.length) return dados as any;

            const linhas = await prisma.chaveWhatsApp.findMany({
                where: { tenantId, maquinaId, tipo: type as string, chave: { in: faltando } },
            });
            for (const linha of linhas) {
                const bruto = codecs.desserializa(linha.valor);
                const valor = codecs.preparar ? codecs.preparar(linha.tipo, bruto) : bruto;
                dados[linha.chave] = valor;
                guarda(linha.tipo, linha.chave, valor);
            }
            return dados as any;
        },

        async set(data: SignalDataSet) {
            for (const [tipo, itens] of Object.entries(data)) {
                const ids = Object.keys(itens ?? {});
                if (!ids.length) continue;

                const paraApagar = ids.filter((id) => !itens[id]);
                const paraGravar = ids.filter((id) => !!itens[id]);
                if (paraApagar.length) {
                    await prisma.chaveWhatsApp.deleteMany({
                        where: { tenantId, maquinaId, tipo, chave: { in: paraApagar } },
                    });
                    for (const chave of paraApagar) cache.delete(idDeCache(tipo, chave));
                }
                if (!paraGravar.length) continue;

                const existentes = await prisma.chaveWhatsApp.findMany({
                    where: { tenantId, maquinaId, tipo, chave: { in: paraGravar } },
                    select: { chave: true },
                });
                const jaGravadas = new Set(existentes.map((linha) => linha.chave));
                const novas = paraGravar.filter((id) => !jaGravadas.has(id));
                if (novas.length) {
                    await prisma.chaveWhatsApp.createMany({
                        data: novas.map((chave) => ({
                            tenantId,
                            maquinaId,
                            tipo,
                            chave,
                            valor: codecs.serializa(itens[chave]),
                        })),
                        skipDuplicates: true,
                    });
                }
                for (const chave of paraGravar) {
                    const valor = itens[chave];
                    if (jaGravadas.has(chave)) {
                        await prisma.chaveWhatsApp.update({
                            where: { tenantId_maquinaId_tipo_chave: { tenantId, maquinaId, tipo, chave } },
                            data: { valor: codecs.serializa(valor) },
                        });
                    }
                    guarda(tipo, chave, codecs.preparar ? codecs.preparar(tipo, valor) : valor);
                }
            }
        },

        async clear() {
            cache.clear();
            await prisma.chaveWhatsApp.deleteMany({ where: { tenantId, maquinaId } });
        },
    };
}

/** `creds` de uma instalacao, ja importado do arquivo se for a primeira vez. */
async function credsDaInstalacao(
    tenantId: string,
    maquinaId: string,
    codecs: CodecsDaSessao
): Promise<AuthenticationCreds> {
    const linha = await prisma.sessaoWhatsApp.findUnique({
        where: { tenantId_maquinaId: { tenantId, maquinaId } },
    });
    if (linha) return codecs.desserializa(linha.creds) as AuthenticationCreds;

    const doArquivo = await importaDoArquivo(tenantId, maquinaId, codecs);
    return doArquivo ?? codecs.credsVazios();
}

/**
 * O estado de autenticacao que o `makeWASocket` recebe. Fica no banco para o
 * deploy nao derrubar o pareamento, e na memoria do processo para o handshake.
 */
export async function estadoDaSessao(
    tenantId: string,
    codecs: CodecsDaSessao,
    maquinaId = idDaInstalacao()
): Promise<AuthenticationState & { saveCreds: () => Promise<void> }> {
    const creds = await credsDaInstalacao(tenantId, maquinaId, codecs);
    const chaves = storeDeChaves(tenantId, maquinaId, codecs);

    return {
        creds,
        keys: chaves,
        async saveCreds() {
            await prisma.sessaoWhatsApp.upsert({
                where: { tenantId_maquinaId: { tenantId, maquinaId } },
                create: { tenantId, maquinaId, creds: codecs.serializa(creds) },
                update: { creds: codecs.serializa(creds) },
            });
        },
    };
}

/**
 * Apaga a sessao no banco E o arquivo que a originou. Os dois, e nao so o banco: o
 * arquivo e' a fonte da importacao, entao uma sessao morta que ficasse nele voltaria
 * no boot seguinte e o bot passaria o boot inteiro caindo em logout de novo.
 */
export async function apagaSessao(tenantId: string, maquinaId = idDaInstalacao()): Promise<void> {
    await prisma.chaveWhatsApp.deleteMany({ where: { tenantId, maquinaId } });
    await prisma.sessaoWhatsApp.deleteMany({ where: { tenantId, maquinaId } });
    limpaArquivoDeSessao();
}

/**
 * Esvazia a pasta da sessao, marcacao de maquina incluida: ela descreve a sessao que
 * esta saindo. Apagar arquivo e' acessorio -- se o disco brigar, o banco ja foi
 * limpo e a sessao nao volta.
 */
export function limpaArquivoDeSessao(): void {
    try {
        const pasta = pastaDeArquivo();
        for (const arquivo of fs.readdirSync(pasta)) {
            fs.unlinkSync(path.join(pasta, arquivo));
        }
    } catch (erro) {
        log.warn(`Nao foi possivel limpar a pasta da sessao: ${String(erro)}`);
    }
}

/**
 * As lojas que ja parearam um numero em alguma instalacao. E' a lista que o boot
 * usa para religar os WhatsApp: sem ela, um deploy derrubaria todos de uma vez.
 */
export async function lojasComSessao(): Promise<string[]> {
    const linhas = await prisma.sessaoWhatsApp.findMany({
        select: { tenantId: true },
        distinct: ['tenantId'],
    });
    return linhas.map((linha) => linha.tenantId);
}

/**
 * Instalacoes diferentes com sessao viva da mesma loja. O WhatsApp derruba uma das
 * duas, e a que cai e' a que o dono nao sabe que existe.
 */
export async function outraInstalacaoComSessao(
    tenantId: string,
    maquinaId = idDaInstalacao()
): Promise<{ maquinaId: string; atualizadoEm: Date }[]> {
    const linhas = await prisma.sessaoWhatsApp.findMany({
        where: { tenantId, maquinaId: { not: maquinaId } },
        select: { maquinaId: true, atualizadoEm: true },
    });
    return linhas.map((linha) => ({ maquinaId: linha.maquinaId, atualizadoEm: linha.atualizadoEm }));
}