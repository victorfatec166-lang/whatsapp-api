#!/usr/bin/env node
/*
 * Verifica o HTML servido: rotulos, nomes acessiveis e nomes de campo.
 *
 * Por que isto existe
 *
 * O painel e' HTML montado no servidor. O `tsc` valida o TypeScript, e nada
 * valida o HTML que sai dele. Duas classes de defeito passam assim:
 *
 * 1. `<label>` sem `for` e `<input>` sem `id`. O campo funciona, o texto do
 *    rotulo funciona, e clicar no texto nao foca o campo -- porque o navegador
 *    so liga os dois pelo `for`/`id`. Em formulario com 15 campos, e' a
 *    diferenca entre preencher rapido e ir campo a campo. E' leitor de tela
 *    que perde a ligacao e anuncia "campo de texto" sem dizer qual.
 *
 * 2. `<button>` ou `<a>` sem nome acessivel. `<button><i class="fa-solid
 *    fa-save"></i></button>` e' um botao que o leitor de tela anuncia como
 *    "botao" e nada mais. O `title` ajuda o mouse, nao o leitor de tela.
 *
 * O que este script NAO verifica, e por que
 *
 * Contraste de cor ja tem quem cuide: `check:contrast` le os tokens do CSS e
 * compara com a WCAG. Fazer aqui seria duplicar com uma versao pior, porque
 * medir cor precisa do arquivo de estilos compilado, e nao do HTML.
 *
 * Como o `check:js`, ele pede as abas ao servidor rodando. Precisa do processo
 * no ar; sem ele, avisa e falha -- nunca da verde falso.
 */

const http = require('node:http');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const ABAS = [
    'home', 'chat', 'config', 'marketplace', 'whatsapp',
    'faturamento', 'estoque', 'pdv', 'kanban', 'calendario',
];

/** Sub-aba do Faturamento, que tem quatro telas dentro da mesma rota. */
const VARIACOES = {
    faturamento: ['resumo', 'caixa', 'clientes', 'pedidos'],
};

function pegar(caminho) {
    return new Promise((resolve, reject) => {
        http
            .get(BASE + caminho, (res) => {
                let corpo = '';
                res.on('data', (d) => (corpo += d));
                res.on('end', () => resolve(corpo));
            })
            .on('error', reject);
    });
}

/** Texto visivel dentro do elemento, para achar nome acessivel. */
function temNomeAcessivel(htmlAteOEstilo) {
    // Remove o atributo style e o que estiver depois: o nome acessivel e' o
    // conteudo e o title/aria-label, nao a apresentacao.
    const semEstilo = htmlAteOEstilo.replace(/\sstyle="[^"]*"/g, '');
    const conteudo = semEstilo.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, '').trim();
    if (conteudo.length > 0) return true;
    return /\b(title|aria-label|aria-labelledby)="[^"]+"/i.test(semEstilo);
}

/** Abre e fecha balanceados, para nao varrer atributo de outro elemento. */
function atributosDe(corpo) {
    const re = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
    const achados = [];
    let m;
    while ((m = re.exec(corpo)) !== null) {
        achados.push({ tag: m[1].toLowerCase(), attrs: m[2], pos: m.index });
    }
    return achados;
}

function attr(attrs, nome) {
    const re = new RegExp(`\\b${nome}\\s*=\\s*"([^"]*)"`, 'i');
    const m = re.exec(attrs);
    return m ? m[1] : null;
}

function fechar(corpo, posAberto) {
    const tag = corpo.slice(posAberto).match(/^<([a-z0-9]+)/i)[1];
    const re = new RegExp(`<(/?)${tag}\\b`, 'gi');
    re.lastIndex = posAberto;
    let nivel = 0;
    let m;
    while ((m = re.exec(corpo)) !== null) {
        nivel += m[1] === '/' ? -1 : 1;
        if (nivel === 0) return m.index + m[0].length;
    }
    return corpo.length;
}

/** O campo esta DENTRO do rotulo? Entao o rotulo ja o alcanca. */
function envolveCampo(html, posDoLabel) {
    const fim = fechar(html, posDoLabel);
    if (fim <= posDoLabel) return false;
    const dentro = html.slice(posDoLabel, fim);
    return /<(input|select|textarea)\b/i.test(dentro);
}

/**
 * Este campo esta dentro de algum rotulo?
 *
 * Different de `envolveCampo`, que pergunta o contrario. Varre para tras ate
 * um `<label>` aberto cujo fechamento esteja depois deste ponto.
 */
function estaEmRotulo(html, pos) {
    const antes = html.slice(0, pos);
    const aberto = antes.lastIndexOf('<label');
    if (aberto < 0) return false;
    // O rotulo foi fechado antes do campo? Entao nao o envolve.
    const tag = antes.match(/<label\b[^>]*>$/i);
    if (!tag) {
        const fechamento = antes.lastIndexOf('</label>');
        if (fechamento > aberto) return false;
    }
    return true;
}

function verifica(html, nomeDaAba) {
    const problemas = [];
    /*
     * Tira `<script>` e `<style>` antes de varrer.
     *
     * Sem isso, o codigo JavaScript embutido era lido como HTML: as tres
     * ocorrencias de "<img" da aba de Conversas vinham de uma string que
     * CONSTRUI a imagem, nao de uma imagem de verdade. Um verificador que
     * acusa codigo como se fosse marcação vira encher ruido, e ruido e' a
     * razao pela qual as pessoas desistem de rodar o verificador.
     *
     * Substitui pelo conteudo do `<head>`, que nao tem elementos do corpo, e o
     * numero de linha deixa de bater -- a saida usa o caminho da aba, nao a
     * linha, justamente por isso.
     */
    const corpo = html
        .replace(/<script\b[\s\S]*?<\/script>/gi, '<script></script>')
        .replace(/<style\b[\s\S]*?<\/style>/gi, '<style></style>');
    const elementos = atributosDe(corpo);

    const ids = new Set();
    for (const el of elementos) {
        const id = attr(el.attrs, 'id');
        if (id) ids.add(id);
    }

    for (const el of elementos) {
        const { tag, attrs, pos } = el;

        // 1. Rotulo sem `for`, ou apontando para um id que nao existe.
        //
        // Um `<label>` que ENVOLVE o campo e' valido e acessivel: o navegador
        // liga os dois pela hierarquia, e clicar no texto foca o campo. A
        // primeira versao deste script acusava todo rotulo sem `for`, e a
        // metade dos casos era essa. Um verificador que acusa o que esta certo
        // treina a ignorar a saida inteira -- foi o que aconteceu na primeira
        // rodada, com 4 falsos positivos so na Home.
        if (tag === 'label') {
            const forDe = attr(attrs, 'for');
            if (forDe === null) {
                if (!envolveCampo(corpo, pos)) {
                    problemas.push({
                        tipo: 'label-sem-for',
                        detalhe: 'rotulo sem for e sem o campo dentro: clicar no texto nao foca nada',
                    });
                }
            } else if (!ids.has(forDe)) {
                problemas.push({
                    tipo: 'label-for-quebrado',
                    detalhe: `for="${forDe}" aponta para um id que nao existe`,
                });
            }
        }

        // 2. Campo sem id.
        //
        // So e' defeito quando NINGUEM alcanca o campo. Dentro de um rotulo que
        // o envolve, o navegador liga os dois pela hierarquia e o id e'
        // desnecessario -- e a lista de modificadores do PDV monta dezenas de
        // caixas dentro de um rotulo cada, onde um id por item seria trabalho
        // sem resultado.
        //
        // Sem `for` e sem rotulo em volta, o campo nao tem nome: e' o caso da
        // coluna de saldo na tabela de estoque, que Announces "campo de texto,
        // 12" para quem usa leitor de tela.
        if ((tag === 'input' || tag === 'select' || tag === 'textarea') && !attr(attrs, 'id')) {
            const tipo = attr(attrs, 'type');
            const invisivel = tipo === 'hidden' || tipo === 'submit';
            if (!invisivel && !estaEmRotulo(corpo, pos)) {
                const nome = attr(attrs, 'aria-label');
                if (nome === null || nome === '') {
                    problemas.push({
                        tipo: 'campo-sem-nome',
                        detalhe: `${tag}${tipo ? ' type="' + tipo + '"' : ''} sem id, sem aria-label e fora de um rotulo`,
                    });
                }
            }
        }

        // 3. Controle sem nome acessivel.
        if (tag === 'button' || (tag === 'a' && attr(attrs, 'href') !== null)) {
            if (!temNomeAcessivel(corpo.slice(pos, fechar(corpo, pos)))) {
                problemas.push({
                    tipo: 'controle-sem-nome',
                    detalhe: `<${tag}> sem texto, title ou aria-label`,
                });
            }
        }

        // 4. Imagem sem alt. `alt=""` e' valido e e' o correto para decorativa;
        // a ausencia do atributo e' que e' o defeito.
        if (tag === 'img' && attr(attrs, 'alt') === null) {
            problemas.push({ tipo: 'img-sem-alt', detalhe: 'img sem alt' });
        }
    }

    return { nomeDaAba, problemas };
}

async function main() {
    /*
     * Espera o servidor ficar pronto, em vez de exigir que ele ja estivesse.
     *
     * A primeira versao falhava na hora se o processo acabasse de subir, e a
     * mensagem dizia "rode npm start" para quem ja tinha feito isso um segundo
     * antes. A espera e' curta e o aviso no fim continua valendo: sem servidor,
     * a falha e' a mesma, so que agora nao grita sem motivo.
     */
    let pronto = false;
    for (let tentativa = 0; tentativa < 15; tentativa++) {
        try {
            await fetch(`${BASE}/api/bot-status`);
            pronto = true;
            break;
        } catch {
            await new Promise((r) => setTimeout(r, 500));
        }
    }
    if (!pronto) {
        console.log(`ERRO: servidor nao respondeu em ${BASE} depois de 7s.`);
        console.log('      Suba com "npm start" e rode de novo.');
        process.exitCode = 1;
        return;
    }

    let total = 0;
    const porTipo = new Map();

    for (const aba of ABAS) {
        const variacoes = VARIACOES[aba] || [null];
        for (const variacao of variacoes) {
            const caminho =
                `/admin?tab=${aba}` + (variacao ? `&aba=${variacao}` : '');
            let html;
            try {
                html = await pegar(caminho);
            } catch (e) {
                console.log(`  ERRO    ${caminho}: ${e.message}`);
                total++;
                continue;
            }

            const { nomeDaAba, problemas } = verifica(html, caminho);
            if (problemas.length === 0) {
                console.log(`  ok      ${nomeDaAba}`);
            } else {
                total += problemas.length;
                console.log(`  ${String(problemas.length).padStart(3)}x    ${nomeDaAba}`);
                // Agrupa por tipo, e mostra os tres primeiros de cada um: a
                // lista completa de 40 labels iguais nao ajuda a decidir nada.
                const grupos = new Map();
                for (const p of problemas) {
                    if (!grupos.has(p.tipo)) grupos.set(p.tipo, []);
                    grupos.get(p.tipo).push(p.detalhe);
                }
                for (const [tipo, itens] of grupos) {
                    console.log(`           ${tipo}: ${itens.length}`);
                    for (const d of [...new Set(itens)].slice(0, 3)) {
                        console.log(`             - ${d}`);
                    }
                    porTipo.set(tipo, (porTipo.get(tipo) || 0) + itens.length);
                }
            }
        }
    }

    console.log('');
    if (total === 0) {
        console.log('HTML servido: rotulos, nomes acessiveis e ids em ordem.');
    } else {
        console.log(`${total} problema(s) no HTML servido:`);
        for (const [tipo, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${String(n).padStart(3)}x  ${tipo}`);
        }
        console.log('');
        console.log('Rotulo sem "for" e campo sem "id" e' + ' o primeiro: o campo funciona, mas');
        console.log('clicar no texto do rotulo nao foca ele, e leitor de tela nao diz qual e' + ' o campo.');
        process.exitCode = 1;
    }
}

main();
