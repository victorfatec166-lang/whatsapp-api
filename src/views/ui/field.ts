import { escapeHtml } from '../html';

/**
 * A regra de e-mail, em um lugar so.
 *
 * Ela precisa existir em dois lados: o navegador, para dar a mensagem antes de
 * round-trip, e o servidor, que e' quem decide de verdade. E a versao do
 * servidor esta em `services/auth.ts` (emailValido).
 *
 * Ter as duas escrito a mao e' o que aconteceu: a conta do primeiro acesso e'
 * `admin@localhost`, o navegador recusou por falta de ponto no dominio, e o
 * primeiro acesso do produto ficou impossivel com o sistema inteiro funcionando.
 * Nao ha teste que pegue isso, porque cada lado passa no seu proprio teste.
 *
 * Por isso `tests/auth.test.ts` roda a MESMA lista de casos pelos dois lados e
 * exige o mesmo veredito. Divergir e' falha de teste, nao defeito em producao.
 *
 * A forma da regra: `local` para o primeiro acesso, e para o resto um dominio
 * com pontos onde CADA rotulo tem pelo menos um caractere e o ultimo e' so
 * letras com dois ou mais. Esse ultimo detalhe e' o que recusa `a@b..com`, que
 * a versao anterior aceitava: dominio com rotulo vazio nao existe em DNS, e o
 * teste que compara os dois lados foi o que achou isso.
 */

/** A expressao, como texto, para o JavaScript da tela. */
export const REGRA_EMAIL_JS =
    '^(?:[^\\s@]+@localhost|[^\\s@]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})$';

/** A mesma regra em TypeScript, para comparar sem passar por string. */
export const REGRA_EMAIL_TS = /^(?:[^\s@]+@localhost|[^\s@]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})$/;

/**
 * Os campos da tela de login.
 *
 * Ficam num modulo proprio porque sao a unica parte da tela de entrada que tem
 * regra de verdade -- rotulo, erro, obrigatoriedade, mostrar senha -- e essa
 * regra e' identica no login, na troca de senha e no cadastro. Escrever tres
 * vezes o mesmo bloco de `<label>` + erro e' o jeito mais rapido de divergir os
 * tres: o erro do cadastro fica sem `aria-describedby` e o leitor de tela anuncia
 * "campo de senha, inválido" sem dizer qual.
 *
 * Todos usam a classe `.input` do design system, que ja resolve fundo, cor e
 * borda nos dois temas. Nada aqui escreve cor de campo na mao.
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
 * Mensagem de erro.
 *
 * Fica DENTRO do grupo do campo, e o `aria-describedby` do campo aponta para
 * ela. Fora do campo, o leitor de tela anuncia "campo de senha, inválido" e a
 * pessoa nao descobre se o e-mail ou a senha -- que e' justamente o que ela
 * precisa saber para corrigir.
 *
 * Nao depende so da cor: vem com icone e com a palavra do que aconteceu
 * ("invalido", "obrigatorio", "incorreta"), porque ~4% dos homens tem alguma
 * deficiencia de visao de cores e a cor, sozinha, nao chega.
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
 * Campo de senha com o botao de mostrar e esconder.
 *
 * O botao e' `type="button"`: dentro de um `<form>`, um botao sem type vira
 * submit, e clicar para ver a senha tentaria entrar no sistema. O icone troca
 * entre olho e olho-riscado, e o `aria-pressed` acompanha -- para quem usa
 * leitor de tela, "mostrar senha" e' um estado, nao um icone.
 *
 * O campo recebe o valor digitado de volta no JavaScript (`data-mirror`), e nao
 * no atributo: recarregar a pagina depois de errar a senha perderia o e-mail
 * digitado, que e' a parte longa e chata de digitar de novo.
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
 * Botao principal com estado de carregamento.
 *
 * O estado nao e' uma classe: e' `disabled` de verdade, mais o texto trocado. Um
 * botao que so muda de cor durante a espera deixa a pessoa clicar de novo -- e
 * clicar duas vezes em "Entrar" cria duas sessoes, das quais uma fica aberta
 * sem ninguem saber.
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
 * Caixa de erro geral.
 *
 * Para o que nao pertence a um campo: "senha incorreta", "conta bloqueada por
 * cinco minutos", "nao foi possivel falar com o servidor". Fica acima do botao
 * e com `role="alert"`, que faz o leitor de tela anunciar na hora -- um erro que
 * so aparece por mudanca de cor nao e' erro acessivel.
 */
export function erroGeral(texto: string | null): string {
    if (!texto) return '';
    return `        <div role="alert" data-erro-geral
            class="flex items-start gap-2.5 rounded-card border border-accent-red bg-danger-bg p-3">
            <i class="fa-solid fa-triangle-exclamation text-accent-red mt-0.5 shrink-0" aria-hidden="true"></i>
            <p class="text-caption font-medium text-accent-red">${escapeHtml(texto)}</p>
        </div>`;
}
