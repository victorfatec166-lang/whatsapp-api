/**
 * As regras que o servidor e a tela precisam concordar.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Uma regra de validação escrita nos dois lados -- o navegador para dar a
 * mensagem antes de round-trip, o servidor para decidir de verdade -- e' duas
 * fontes, e a segunda sempre acaba divergindo da primeira sem que nenhum teste
 * reclame, porque cada lado passa no seu proprio teste.
 *
 * Aconteceu aqui. A conta do primeiro acesso e' `admin@localhost`; o navegador
 * exigia ponto no dominio e recusou; o servidor aceitava. Resultado: o primeiro
 * acesso do produto era impossivel, com todo o resto funcionando e todos os
 * testes verdes.
 *
 * Por isso a regra mora aqui, e nao em `services/auth.ts` nem em
 * `views/ui/field.ts`. Um modulo de serviço nao importa de uma view -- a
 * dependencia vai do servidor para a tela, nunca ao contrario -- e por isso o
 * lugar comum dos dois e' aqui.
 *
 * `REGRA_EMAIL_JS` e' o texto que a tela monta em tempo de execucao.
 * `REGRA_EMAIL_TS` e' a mesma coisa em TypeScript, para o servidor e para o
 * teste compararem. `tests/auth.test.ts` roda uma lista de casos pelos dois e
 * exige o mesmo veredito: se as duas formas divergirem, o teste quebra antes de
 * alguem bater na parede.
 */

/**
 * E-mail valido.
 *
 * Duas formas aceitas:
 *
 * 1. `algo@localhost` -- o primeiro acesso de uma instalacao local, antes de
 *    existir e-mail de verdade. E' a unica excecao, e ela e' nomeada: nao e'
 *    "sem ponto", porque `voce@empresa` continua invalido, e quase sempre e'
 *    erro de digitacao e nao endereco.
 *
 * 2. `algo@dominio.com` -- dominio com pontos onde cada rotulo tem pelo menos
 *    um caractere e o ultimo e' so letras, com dois ou mais. Esse ultimo
 *    detalhe recusa `a@b..com`: dominio com rotulo vazio nao existe em DNS, e
 *    a versao anterior aceitava. Quem achou foi o teste que compara os dois
 *    lados, e nao a leitura do codigo.
 */
export const REGRA_EMAIL_JS =
    '^(?:[^\\s@]+@localhost|[^\\s@]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})$';

/** A mesma regra em TypeScript, para comparar sem passar por string. */
export const REGRA_EMAIL_TS = /^(?:[^\s@]+@localhost|[^\s@]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})$/;

/**
 * Senha nova aceitavel.
 *
 * Oito caracteres e tres classes. Oito e' o minimo que segura contra a(forca
 * bruta e a lista vazada -- os dois ataques que existem em senha escolhida por
 * gente. Nao protege contra quem anota a senha num papel, e nada protege disso.
 *
 * A funcao fica aqui pelo mesmo motivo: a tela precisa mostrar a mesma frase
 * que o servidor vai recusar com, e uma das duas mudando sozinha produz o caso
 * CLASSICO de password -- a tela aceita, digita, e o servidor barra com um erro
 * que nao corresponde a nada que a pessoa fez.
 *
 * Devolve a frase pronta, ou `null` quando a senha passa.
 */
export function problemaDaSenha(senha: string): string | null {
    if (senha.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
    if (senha.length > 200) return 'A senha e longa demais.';
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(senha)).length;
    if (classes < 3) return 'Use pelo menos tres tipos: minuscula, maiuscula, numero ou simbolo.';
    return null;
}
