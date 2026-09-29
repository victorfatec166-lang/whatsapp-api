/**
 * Valida o contraste dos tokens de src/styles/app.css contra a WCAG.
 *
 * Nao confia em numero digitado a mao: le o arquivo, extrai os valores de cada
 * tema e calcula. Assim, se alguem mudar um hex, o build quebra em vez de
 * degradar a acessibilidade em silencio.
 *
 *   node scripts/check-contrast.js
 */

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '..', 'src', 'styles', 'app.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

/** Extrai o bloco de um seletor: :root { ... } ou .dark { ... } */
function bloco(seletor) {
    const re = new RegExp(seletor.replace('.', '\\.') + '\\s*\\{([\\s\\S]*?)\\n\\}');
    const m = css.match(re);
    if (!m) throw new Error(`Bloco ${seletor} nao encontrado em ${CSS_PATH}`);
    const vars = {};
    for (const line of m[1].split('\n')) {
        // Remove comentarios de retorno: "--text-1: #1c1917;  /* 17.7:1 */"
        const limpo = line.replace(/\/\*[\s\S]*?\*\//g, '');
        const v = limpo.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);?\s*$/);
        if (v) vars[v[1].replace(/^--/, '')] = v[2].trim();
    }
    return vars;
}

function hex(v) {
    let h = String(v).replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}

function lum([r, g, b]) {
    const f = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contraste(a, b) {
    const ha = hex(a);
    const hb = hex(b);
    if (ha === null || hb === null) return null;
    const la = lum(ha);
    const lb = lum(hb);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** [nome, cor, fundo, minimo, porque] */
const REGRAS = {
    claro: [
        ['texto principal', 'text-1', 'surface', 4.5, 'corpo de texto'],
        ['texto principal no fundo', 'text-1', 'bg', 4.5, 'corpo de texto'],
        ['texto secundario', 'text-2', 'surface', 4.5, 'rotulos e descricoes'],
        ['texto terciario', 'text-3', 'surface', 4.5, 'metadados e legendas'],
        ['texto terciario em superficie-2', 'text-3', 'surface-2', 4.5, 'linhas de tabela'],
        ['texto terciario no fundo', 'text-3', 'bg', 4.5, 'kpis'],
        ['botao primario', 'surface', 'accent', 4.5, 'rotulo do botao'],
        ['acento como texto', 'accent', 'surface', 4.5, 'precos em destaque'],
        ['borda de input', 'border-input', 'surface', 3, 'limite do campo'],
        ['foco', 'focus', 'surface', 3, 'indicador de foco'],
        ['item inativo da nav', 'nav-ink', 'nav', 4.5, 'item da sidebar'],
        ['item ativo da nav', 'text-1', 'accent-soft', 4.5, 'item selecionado'],
        ['chip', 'chip-ink', 'chip-bg', 4.5, 'atalho'],
        ['badge sucesso', 'success-ink', 'success-bg', 4.5, 'etiqueta de status'],
        ['badge aviso', 'warning-ink', 'warning-bg', 4.5, 'etiqueta de status'],
        ['badge perigo', 'danger-ink', 'danger-bg', 4.5, 'etiqueta de status'],
        ['badge info', 'info-ink', 'info-bg', 4.5, 'etiqueta de status'],
        ['badge neutro', 'neutral-ink', 'neutral-bg', 4.5, 'etiqueta de status'],
    ],
    escuro: [
        ['texto principal', 'text-1', 'surface', 4.5, 'corpo de texto'],
        ['texto secundario', 'text-2', 'surface', 4.5, 'rotulos e descricoes'],
        ['texto terciario', 'text-3', 'surface', 4.5, 'metadados e legendas'],
        ['texto terciario em superficie-2', 'text-3', 'surface-2', 4.5, 'linhas de tabela'],
        ['texto terciario no fundo', 'text-3', 'bg', 4.5, 'kpis'],
        ['botao primario', 'surface', 'accent', 4.5, 'rotulo do botao'],
        ['acento como texto', 'accent', 'surface', 4.5, 'destaques'],
        ['borda de input', 'border-input', 'surface', 3, 'limite do campo'],
        ['foco', 'focus', 'surface', 3, 'indicador de foco'],
        ['item inativo da nav', 'nav-ink', 'nav', 4.5, 'item da sidebar'],
        ['item ativo da nav', 'text-1', 'accent-soft', 4.5, 'item selecionado'],
        ['chip', 'chip-ink', 'chip-bg', 4.5, 'atalho'],
        ['badge sucesso', 'success-ink', 'success-bg', 4.5, 'etiqueta de status'],
        ['badge aviso', 'warning-ink', 'warning-bg', 4.5, 'etiqueta de status'],
        ['badge perigo', 'danger-ink', 'danger-bg', 4.5, 'etiqueta de status'],
        ['badge info', 'info-ink', 'info-bg', 4.5, 'etiqueta de status'],
        ['badge neutro', 'neutral-ink', 'neutral-bg', 4.5, 'etiqueta de status'],
    ],
};

let falhas = 0;
let total = 0;

for (const [tema, regras] of Object.entries(REGRAS)) {
    const vars = bloco(tema === 'claro' ? ':root' : '.dark');
    console.log(`\n=== TEMA ${tema.toUpperCase()} ===\n`);

    for (const [nome, cor, fundo, minimo, porque] of regras) {
        const c = vars[cor];
        const f = vars[fundo];
        if (!c || !f) {
            console.log(`  FALHA  ${nome.padEnd(30)} token ausente (--${cor} ou --${fundo})`);
            falhas++;
            continue;
        }
        const r = contraste(c, f);
        if (r === null) {
            console.log(`  FALHA  ${nome.padEnd(30)} cor nao hex: --${cor}=${c} --${fundo}=${f}`);
            falhas++;
            continue;
        }
        total++;
        const ok = r >= minimo;
        if (!ok) falhas++;
        console.log(
            `  ${ok ? 'ok   ' : 'FALHA'}  ${nome.padEnd(30)} ${r.toFixed(2).padStart(6)}:1  (min ${minimo}:1)  ${porque}`
        );
    }
}

/*
 * Segunda parte: cor de botao escrita a mao no HTML.
 *
 * O bloco acima mede os tokens do CSS, e nao acha cor nenhuma no TypeScript.
 * Era ai que o defeito vivia: seis botoes com `bg-amber-600 hover:bg-amber-700
 * text-white`, que no tema claro ficava bom e no escuro dava 3,7:1 -- lido por
 * ninguem, porque o script nao olhava para la.
 *
 * Por que nao basta "medir de novo em cima": a cor esta escrita no HTML, nao em
 * variavel, e medir exigiria compilar o CSS e resolver herdanca. A pergunta
 * util nao e' "qual e' o contraste desta classe", e' "esta classe existe em
 * algum botao". Classe que nao vem de token nao tem dupla cor por tema, e por
 * isso nao tem como estar certa nos dois.
 *
 * A lista e' curta e nomeada. `bg-amber-600` sozinho nao e' falha: checkbox de
 * selecao usa `accent-amber-600`, que e' outra coisa. E o que se procura e' a
 * cor de FUNDO de botao escrita direto, com o texto branco junto.
 */

const VIEWS_DIR = path.join(__dirname, '..', 'src', 'views');
const CORES_FIXAS = /(?<!accent-)\b(?:bg|text|border)-(?:amber|red|green|emerald|blue|indigo|purple|pink|slate|zinc|stone|gray)-[0-9]{2,3}\b/;

function arquivosView(dir) {
    const saida = [];
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) saida.push(...arquivosView(completo));
        else if (entrada.name.endsWith('.ts')) saida.push(completo);
    }
    return saida;
}

console.log(`\n=== COR FIXA EM BOTAO (src/views) ===\n`);

let corFixa = 0;
for (const arquivo of arquivosView(VIEWS_DIR)) {
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((linha, i) => {
        // Botao e' o que a pessoa clica. Link, chip e badge tem seus proprios
        // pares medidos, e mexer neles aqui seria alarme falso.
        if (!/<button\b/.test(linha) && !/btn-primary/.test(linha)) return;
        if (!CORES_FIXAS.test(linha)) return;

        const achados = linha.match(new RegExp(CORES_FIXAS, 'g')) || [];
        const nome = path.basename(arquivo);
        console.log(`  FALHA  ${nome}:${i + 1}  ${[...new Set(achados)].join(', ')}`);
        console.log(`         use btn btn-primary: o par dos dois temas ja' e' medido acima.`);
        corFixa++;
    });
}

const falhasTotais = falhas + corFixa;

console.log(`\n${total - falhas}/${total} combinacoes conformes; ${corFixa} cor(es) fixa(s) em botao`);

if (falhasTotais > 0) {
    console.error(`\n${falhasTotais} falha(s). Tokens em src/styles/app.css; botoes em src/views/*.ts.`);
    process.exit(1);
}
console.log('Todos os tokens atendem a WCAG AA, e nenhum botao escapa do token.');
