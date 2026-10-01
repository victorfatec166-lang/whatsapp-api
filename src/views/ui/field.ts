import { escapeHtml } from '../html';

/**
 * Mesma regra nos dois lados -- navegador e servidor -- porque ter as duas escritas a mao
 * ja quebrou o primeiro acesso. tests/auth.test.ts roda a MESMA lista pelos dois lados:
 * divergir e' falha de teste, e o ultimo rotulo so com letras recusa a@b..com.
 */

/** A expressao, como texto, para o JavaScript da tela. */
export const REGRA_EMAIL_JS =
    '^(?:[^\\s@]+@localhost|[^\\s@]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})$';

/** A mesma regra em TypeScript, para comparar sem passar por string. */
export const REGRA_EMAIL_TS = /^(?:[^\s@]+@localhost|[^\s@]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})$/;

/**
 * Modulo proprio porque e' a unica parte da tela de entrada com regra de verdade, e essa
 * regra e' identica no login, na troca de senha e no cadastro. Escrever tres vezes o mesmo
 * label+erro e' o jeito mais rapido de divergir: o erro do cadastro ficava sem aria-describedby.
 */

/** Identificador unico por campo: dois campos com o mesmo id quebram o `for` do rotulo. */
export type Campo = {
    /** Base do id. O sufixo entra sozinho, e continua unico. */
    id: string;
    rotulo: string;
    /** `texto`, `email` ou `senha`. */
    tipo: 'texto' | 'email' | 'senha';
    placeholder?: string;
    /** Marcado com asterisco e com `required` de verdade. */
    obrigatorio?: boolean;
    autofocus?: boolean;
    /** Fala lida por leitor de tela alem do rotulo. */
    dica?: string;
    autocomplete?: string;
    valor?: string;
    maxlength?: number;
};

/**
 * Fica DENTRO do grupo do campo porque o aria-describedby aponta para ela: fora, o leitor
 * de tela anuncia "invalido" sem dizer qual campo. Nao depende so da cor -- vem com icone e
 * com a palavra do que aconteceu, porque a cor sozinha nao chega para quem tem deficiencia.
 */
export function erroDoCampo(texto: string | null, id: string): string {
    if (!texto) return '';
    return `<p id="${id}-erro" class="flex items-start gap-1.5 text-caption font-medium text-accent-red mt-1.5">
            <i class="fa-solid fa-circle-exclamation mt-px shrink-0" aria-hidden="true"></i>
            <span>${escapeHtml(texto)}</span>
        </p>`;
}

/** O texto lido pelo leitor de tela quando ainda nao ha erro. */
function descricao(c: Campo, id: string): string | null {
    return c.dica ?? null;
}

/**
 * Um campo de texto ou e-mail.
 */
export function campoTexto(c: Campo, valorInvalido = false): string {
    const id = `${c.id}-input`;
    const erroId = `${c.id}-erro`;
    const descritoPor = [descricao(c, id) ? `${c.id}-dica` : null, c.dica === null ? null : null]
        .filter(Boolean)
        .join(' ');

    return `        <div>
            <label class="label" for="${id}">
                ${escapeHtml(c.rotulo)}${c.obrigatorio ? ' <span class="text-accent-red" aria-hidden="true">*</span>' : ''}
            </label>
            <div class="relative">
                <input
                    id="${id}"
                    name="${c.id}"
                    type="${c.tipo}"
                    value="${escapeHtml(c.valor ?? '')}"
                    placeholder="${escapeHtml(c.placeholder ?? '')}"
                    ${c.obrigatorio ? 'required aria-required="true"' : ''}
                    ${c.autofocus ? 'autofocus' : ''}
                    ${c.maxlength ? `maxlength="${c.maxlength}"` : ''}
                    autocomplete="${c.autocomplete ?? (c.tipo === 'email' ? 'username' : 'off')}"
                    aria-invalid="${valorInvalido ? 'true' : 'false'}"
                    ${descritoPor ? `aria-describedby="${descritoPor}"` : ''}
                    class="input ${valorInvalido ? 'border-accent-red' : ''}"
                    data-campo-erro="${c.id}"
                >
            </div>
            ${
                c.dica
                    ? `<p id="${c.id}-dica" class="text-caption text-ink-3 mt-1.5">${escapeHtml(c.dica)}</p>`
                    : ''
            }
        </div>`;
}

/**
 * O botao e' type="button" porque dentro de um form um botao sem type vira submit, e
 * clicar para ver a senha tentaria entrar no sistema. O valor digitado volta pelo
 * data-mirror e nao no atributo: recarregar depois de errar perderia o e-mail.
 */
export function campoSenha(c: Campo, erro: string | null = null): string {
    const id = `${c.id}-input`;
    const temErro = erro !== null;

    return `        <div>
            <label class="label" for="${id}">
                ${escapeHtml(c.rotulo)}${c.obrigatorio ? ' <span class="text-accent-red" aria-hidden="true">*</span>' : ''}
            </label>
            <div class="relative">
                <input
                    id="${id}"
                    name="${c.id}"
                    type="password"
                    placeholder="${escapeHtml(c.placeholder ?? '')}"
                    ${c.obrigatorio ? 'required aria-required="true"' : ''}
                    ${c.autofocus ? 'autofocus' : ''}
                    ${c.maxlength ? `maxlength="${c.maxlength}"` : ''}
                    autocomplete="${c.autocomplete ?? 'current-password'}"
                    aria-invalid="${temErro ? 'true' : 'false'}"
                    ${temErro ? `aria-describedby="${c.id}-erro"` : ''}
                    class="input pr-11 ${temErro ? 'border-accent-red' : ''}"
                    data-campo-erro="${c.id}"
                >
                <button type="button" data-ver-senha="${id}"
                    class="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-control inline-flex items-center justify-center text-ink-3 hover:text-ink hover:bg-surface-2 transition"
                    aria-label="Mostrar a senha" aria-pressed="false" title="Mostrar a senha">
                    <i class="fa-solid fa-eye" aria-hidden="true"></i>
                </button>
            </div>
            ${erroDoCampo(erro, c.id)}
        </div>`;
}

/**
 * O estado nao e' uma classe: e' disabled de verdade, mais o texto trocado. Botao que so
 * muda de cor durante a espera aceita o segundo clique, e dois "Entrar" criam duas sessoes.
 */
export function botaoEntrar(texto = 'Entrar'): string {
    return `        <button type="submit" data-botao-entrar
            class="btn btn-primary w-full py-2.5 font-semibold">
            <i class="fa-solid fa-right-to-bracket" data-icone-normal aria-hidden="true"></i>
            <span data-texto-normal>${escapeHtml(texto)}</span>
            <i class="fa-solid fa-circle-notch fa-spin hidden" data-icone-carregando aria-hidden="true"></i>
            <span data-texto-carregando class="hidden">Entrando...</span>
        </button>`;
}

/**
 * Para o que nao pertence a um campo: "senha incorreta", "conta bloqueada por cinco
 * minutos". Fica acima do botao com role="alert", que faz o leitor de tela anunciar na
 * hora -- erro que so aparece por mudanca de cor nao e' erro acessivel.
 */
export function erroGeral(texto: string | null): string {
    if (!texto) return '';
    return `        <div role="alert" data-erro-geral
            class="flex items-start gap-2.5 rounded-card border border-accent-red bg-danger-bg p-3">
            <i class="fa-solid fa-triangle-exclamation text-accent-red mt-0.5 shrink-0" aria-hidden="true"></i>
            <p class="text-caption font-medium text-accent-red">${escapeHtml(texto)}</p>
        </div>`;
}
