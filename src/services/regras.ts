/**
 * As regras que o servidor e a tela precisam concordar: regra escrita nos dois
 * lados e' duas fontes, e a segunda diverge sem ninguem reclamar -- ja aconteceu
 * de o navegador recusar o primeiro acesso que o servidor aceitava.
 */

/**
 * E-mail valido. `algo@localhost` e' a unica excecao, e e' nomeada: `voce@empresa`
 * continua invalido, porque quase sempre e' erro de digitacao. O ultimo rotulo
 * do dominio so com letras recusa `a@b..com`, que a versao anterior aceitava.
 */
export const REGRA_EMAIL_JS =
    '^(?:[^\\s@]+@localhost|[^\\s@]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})$';

/** A mesma regra em TypeScript, para comparar sem passar por string. */
export const REGRA_EMAIL_TS = /^(?:[^\s@]+@localhost|[^\s@]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})$/;

/**
 * Senha nova aceitavel: oito caracteres e tres classes. Oito e' o minimo que
 * segura contra forca bruta e lista vazada -- os ataques que existem em senha
 * escolhida por gente. A funcao mora aqui para a tela recusar com a mesma frase.
 */
export function problemaDaSenha(senha: string): string | null {
    if (senha.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
    if (senha.length > 200) return 'A senha e longa demais.';
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(senha)).length;
    if (classes < 3) return 'Use pelo menos tres tipos: minuscula, maiuscula, numero ou simbolo.';
    return null;
}
