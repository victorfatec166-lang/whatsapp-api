/**
 * Fila de escrita. O SQLite aceita uma gravacao por vez: disputa vira espera ou
 * "database is locked" (medido: 16 escritas juntas, 8 timeout), e a solucao e' nao
 * disputar. So a porta de entrada: a atomicidade continua sendo do $transaction.
 */

type Tarefa<T> = () => Promise<T>;

/**
 * corrente guarda a ultima tarefa enfileirada. Cada nova entra atras dela.
 * Uma Promise e' o suficiente: a propria cadeia e' a fila.
 */
let corrente: Promise<unknown> = Promise.resolve();

/**
 * Executa `tarefa` depois de todas as que ja foram enfileiradas. A ordem e' a
 * ordem de chamada, sem prioridade. A corrente nunca rejeita, entao uma tarefa
 * que falha nao quebra a fila das proximas.
 */
export function emFila<T>(tarefa: Tarefa<T>): Promise<T> {
    const resultado = corrente.then(
        () => tarefa(),
        // Se a anterior falhou, a corrente ja foi tratada abaixo; mesmo assim
        // o segundo handler garante que a proxima tarefa rode.
        () => tarefa()
    );

    // Isolar o erro: a corrente precisa continuar sempre resolvida. O contador
    // de pendentes que morava aqui foi embora com `filaPendentes` -- ninguem lia,
    // e ele pagava dois incrementos em toda gravacao do banco.
    corrente = resultado.then(
        () => undefined,
        () => undefined
    );

    return resultado;
}
