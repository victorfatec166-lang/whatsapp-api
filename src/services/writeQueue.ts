/**
 * Fila de escrita.
 *
 * O SQLite aceita uma escrita por vez. Quando varias tentam no mesmo instante,
 * uma das duas coisas acontece: espera, ou volta com "database is locked".
 * Em dezesseis gravacoes simultaneas o resultado medido foi oito timeout --
 * metade das vendas perdida por causa de concorrencia, nao por causa de negocio.
 *
 * A solucao aqui nao e' aumentar timeout, e' nao disputar. Como o sistema roda
 * local, em um processo so, dá para deixar todas as escritas passarem uma por
 * uma, em fila. Ninguem trava, ninguem da timeout, e o commit continua tendo
 * o mesmo conteudo.
 *
 * O que muda para quem usa: a gravacao comeca quando a da frente termina. No
 * pico isso e' invisivel -- sao milissegundos de banco -- e evita a venda
 * duplicada, o oversell e o pedido sem estoque.
 *
 * Isto nao e' transacao. A fila e' so a porta de entrada; a atomicidade de cada
 * gravacao continua sendo responsabilidade do $transaction. As duas coisas se
 * completam.
 *
 * Quando chegar multi-loja, ou mais de um processo apontando para o mesmo
 * arquivo, a fila local deixa de valer -- dois processos nao compartilham
 * memoria. A saida e' migrar o banco para um que aceite escritas concorrentes
 * (Postgres) ou passar a serializar por um lock externo. Por enquanto, um
 * processo e' exatamente o caso de uso.
 */

type Tarefa<T> = () => Promise<T>;

/**
 * corrente guarda a ultima tarefa enfileirada. Cada nova entra atrás dela.
 * Uma Promise e' o suficiente: a propria cadeia e' a fila.
 */
let corrente: Promise<unknown> = Promise.resolve();

/** Quantas tarefas estao esperando ou rodando agora. Serve para log. */
let pendentes = 0;

export function filaPendentes(): number {
    return pendentes;
}

/**
 * Executa `tarefa` depois de todas as que ja foram enfileiradas.
 *
 * A ordem e' a ordem de chamada. Nao ha prioridade: no balcao local, primeiro
 * que chega primeiro sai, e nao existe tarefa mais urgente que outra.
 *
 * A corrente nunca rejeita, entao uma tarefa que falha nao quebra a fila para
 * as proximas.
 */
export function emFila<T>(tarefa: Tarefa<T>): Promise<T> {
    pendentes++;

    const resultado = corrente.then(
        () => tarefa(),
        // Se a anterior falhou, a corrente ja foi tratada abaixo; mesmo assim
        // o segundo handler garante que a proxima tarefa rode.
        () => tarefa()
    );

    // isolar o erro: a corrente precisa continuar sempre resolvida.
    corrente = resultado.then(
        () => {
            pendentes--;
        },
        () => {
            pendentes--;
        }
    );

    return resultado;
}
