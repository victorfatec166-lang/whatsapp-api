/*
 * A IA extrai a INTENCAO, e nada mais: o id do produto sai de achaProduto contra
 * o catalogo real, o preco e' relido do banco em priceCart, e fechar pedido e'
 * palavra da pessoa. Ela so entra quando as regras falham, e devolve null se falhar.
 */
import { chave, achaProduto, achaModificadores, type Intencao, type IntencaoItem, type ItemCatalogo } from './entender';
import { logDoModulo } from './logger';

const log = logDoModulo('ia');

/** Endpoint no formato OpenAI: Groq, OpenRouter, Together, Ollama, LM Studio. */
const URL_PADRAO = 'https://api.openai.com/v1/chat/completions';

/**
 * Curto de proposito. A resposta e' um JSON de poucas linhas e a pessoa esta
 * esperando no balcao: esperar dez segundos por "nao entendi" e' pior do que
 * esperar tres e cair no interpretador de sempre.
 */
const TIMEOUT_MS = 4_000;

/** Frase curta demais e' comando ou numero, e nao conversa para o modelo ver. */
const MINIMO_CARACTERES = 4;

/** Teto do catalogo enviado: acima disso o pedido estoura e a resposta vem truncada. */
const MAX_PRODUTOS = 120;

function endpoint(): string {
    return process.env.BOT_IA_URL?.trim() || URL_PADRAO;
}

export function iaLigada(): boolean {
    return Boolean(process.env.BOT_IA_CHAVE?.trim()) && process.env.BOT_IA !== 'off';
}

/**
 * O catalogo vai como lista de NOME, sem id e sem preco. O limite de escolha entra
 * porque o modelo NAO respeita instrucao escrita: mandou tres queijos num grupo de
 * dois, e veio os tres.
 */
function catalogoComoTexto(catalogo: ItemCatalogo[]): string {
    const linhas = catalogo.slice(0, MAX_PRODUTOS).map((p) => {
        const grupos = (p.grupos ?? [])
            .map((g) => {
                const opcoes = g.opcoes.map((o) => o.nome).join(' | ');
                return `${g.nome} (escolha ate ${g.maxSelect}): ${opcoes}`;
            })
            .join('; ');
        return grupos ? `- ${p.nome} [${grupos}]` : `- ${p.nome}`;
    });
    return linhas.join('\n');
}

const PROMPT = `Voce le o que um cliente de restaurante pediu no WhatsApp e extrai o pedido.

Regras:
- Use APENAS produtos da lista. Nunca invente produto, nunca inclua preco.
- Quantidade de cada produto, numero inteiro. Se nao houver quantidade, 1.
- Em "modificadores", escreva as opcoes exatamente como aparecem na lista do produto,
  e NUNCA mais opcoes do que o "escolha ate" permitir.
- Se algo do texto nao for comida nem produto, escreva o trecho em "naoEntendidos".
- Responda SO com JSON, sem texto em volta.

Formato: {"itens":[{"nome":"...","qtd":2,"modificadores":["bacon"]}],"naoEntendidos":[]}

Lista de produtos:
{catalogo}`;

/**
 * Quando a frase NAO e' pedido: o modelo responde em vez de devolver a frase em
 * "naoEntendidos". O preco NAO entra -- quem diz quanto custa e' o `priceCart`.
 */
const PROMPT_CONVERSA = `Voce e' o atendente virtual do {loja}, e responde no WhatsApp.

Regras:
- Responda em portugues do Brasil, curto e simpatico, como um balconista.
- Voce conhece o cardapio abaixo. Se perguntarem se tem algo, confirme; se perguntarem
  o preco, diga que o preco aparece no cardapio do link, sem inventar valor.
- Se quiserem fazer um pedido, convide a digitar o nome dos produtos.
- Nunca invente produto que nao esta na lista.
- Responda SO com o texto da resposta.

Cardapio:
{catalogo}`;

/**
 * Uma chamada ao modelo, com o timeout. Compartilhada pelos dois caminhos
 * (extrair e conversar) porque a parte cara -- chave, modelo, abort -- e' igual.
 */
async function perguntaAoModelo(sistema: string, frase: string, catalogo: ItemCatalogo[]): Promise<string | null> {
    if (!iaLigada() || catalogo.length === 0) return null;

    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);

    try {
        const resposta = await fetch(endpoint(), {
            method: 'POST',
            signal: controle.signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.BOT_IA_CHAVE as string}`,
            },
            body: JSON.stringify({
                model: process.env.BOT_IA_MODELO?.trim() || 'gpt-4o-mini',
                // Zero: extrair pedido nao pode variar entre duas respostas, ou o
                // mesmo "coxinha 2" viraria 1 numa vez e 2 na outra.
                temperature: 0,
                messages: [
                    { role: 'system', content: sistema.replace('{catalogo}', catalogoComoTexto(catalogo)) },
                    { role: 'user', content: frase },
                ],
            }),
        });

        if (!resposta.ok) {
            log.warn(`A IA respondeu ${resposta.status}; seguindo com as regras.`);
            return null;
        }

        const corpo = (await resposta.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return corpo.choices?.[0]?.message?.content ?? '';
    } catch (erro) {
        log.warn(`A IA nao respondeu: ${String(erro)}`);
        return null;
    } finally {
        clearTimeout(relogio);
    }
}

/**
 * Devolve `null` sempre que houver duvida -- chave fora, timeout, JSON quebrado.
 * O chamador cai em `interpreta` e a conversa segue como estava.
 */
export async function extraiComIa(frase: string, catalogo: ItemCatalogo[]): Promise<Intencao | null> {
    if (chave(frase).length < MINIMO_CARACTERES) return null;

    const bruto = await perguntaAoModelo(PROMPT, frase, catalogo);
    return bruto === null ? null : resolve(bruto, catalogo);
}

/**
 * O caminho da CONVERSA: quando a frase nao e' pedido, o modelo responde.
 *
 * `null` quando nao da' para responder, e o chamador tem uma frase pronta para essa
 * hora: ficar sem resposta depois de o cliente esperar e' pior que frase generica.
 */
export async function respondeComIa(
    frase: string,
    catalogo: ItemCatalogo[],
    nomeDaLoja: string
): Promise<string | null> {
    if (chave(frase).length < MINIMO_CARACTERES) return null;

    const bruto = await perguntaAoModelo(
        PROMPT_CONVERSA.replace('{loja}', nomeDaLoja.trim() || 'nosso restaurante'),
        frase,
        catalogo
    );
    if (bruto === null) return null;

    const texto = bruto.replace(/^\s*["'`]|["'`]\s*$/g, '').replace(/\s+/g, ' ').trim();
    if (!texto) return null;

    /*
     * Teto de tamanho: resposta de balmão e' curta. Modelo que sai do trilho e'
     * o mesmo que inventa produto -- e aqui ele iria para o cliente sem passar
     * por nenhum filtro, porque resposta NAO tem como ser casada com o catalogo.
     */
    return texto.length > 400 ? texto.slice(0, 400).trimEnd() + '…' : texto;
}

/**
 * O JSON do modelo passa por achaProduto antes de virar item. E' o filtro que
 * segura a promessa: nome que o dono nao cadastrou nao vira linha no carrinho,
 * vira naoEntendidos, e a cozinha nunca recebe um pedido fantasma.
 */
function resolve(bruto: string, catalogo: ItemCatalogo[]): Intencao | null {
    let lido: { itens?: unknown; naoEntendidos?: unknown };
    try {
        const limpo = bruto.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
        lido = JSON.parse(limpo) as typeof lido;
    } catch (erro) {
        log.warn(`A IA respondeu fora do formato: ${String(erro)}`);
        return null;
    }

    if (!Array.isArray(lido.itens)) return null;

    const itens: IntencaoItem[] = [];
    const naoEntendidos: string[] = [];

    for (const bruto of lido.itens) {
        const item = bruto as { nome?: unknown; qtd?: unknown; modificadores?: unknown };
        const nome = typeof item.nome === 'string' ? item.nome : '';
        if (nome.trim() === '') continue;

        const casamento = achaProduto(nome, catalogo);
        if (!casamento) {
            naoEntendidos.push(nome.trim());
            continue;
        }

        const qtd = Number(item.qtd);
        itens.push({
            id: casamento.item.id,
            nome: casamento.item.nome,
            qtd: Number.isFinite(qtd) && qtd > 0 ? Math.min(99, Math.round(qtd)) : 1,
            modificadores: modificadoresDoModelo(item.modificadores, casamento.item),
            origem: 'nome-exato',
            confianca: 1,
        });
    }

    if (!Array.isArray(lido.naoEntendidos)) lido.naoEntendidos = [];
    const perdidos = lido.naoEntendidos as unknown[];
    for (const perdido of perdidos) {
        if (typeof perdido === 'string' && perdido.trim() !== '') naoEntendidos.push(perdido.trim());
    }

    if (itens.length === 0) return null;
    return { itens, naoEntendidos };
}

/**
 * O modelo devolve nome de opcao; o id sai de `achaModificadores`, que respeita
 * o grupo e o limite de cada um. Montar o `Record` com os nomes do modelo seria
 * gravar um id que talvez nem exista.
 */
function modificadoresDoModelo(bruto: unknown, produto: ItemCatalogo): Record<string, string[]> {
    const textos = Array.isArray(bruto) ? bruto.filter((m): m is string => typeof m === 'string') : [];
    return textos.reduce((saida, texto) => achaModificadores(texto, produto, saida), {} as Record<string, string[]>);
}