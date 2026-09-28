import { renderModal, type ModalSpec } from './ui/modal';

/**
 * Janelas de caixa.
 *
 * Ficam em um modulo so porque sao as mesmas acoes, usadas de dois lugares: o
 * atalho da Home e a tela completa dentro de Faturamento. Antes cada uma tinha
 * seu proprio jeito de pedir os mesmos tres campos, e o do Faturamento usava
 * prompt() do navegador, que nao segue o layout do resto e nao tem o prefixo de
 * moeda pegando a expressao do input.
 *
 * O layout vem de ui/modal.ts, entao aqui so existe declaracao de dados.
 *
 * Regra que vale para as janelas de caixa: quando o pedido tem um campo so, o
 * campo fica visivel na propria tela e nao vira janela. Janela se justifica
 * quando ha dois campos ou quando o valor de referencia precisa aparecer junto
 * do que se digita. Por isso abrir turno continua com o input na tela, e
 * fechar e movimento viraram janela.
 */

export const ENDPOINT_ABRIR = '/api/admin/cash/shift/open';
export const ENDPOINT_FECHAR = '/api/admin/cash/shift/close';
export const ENDPOINT_MOVIMENTO = '/api/admin/cash/movement';

/**
 * Abrir turno.
 *
 * A Home mostra a mesma janela. O campo e' unico, mas a Home nao tem onde
 * hosting um input, entao la a janela e' a unica opcao.
 */
export function cashOpenSpec(): ModalSpec {
    return {
        id: 'cashOpenModal',
        title: 'Abrir caixa',
        icon: 'fa-cash-register',
        description:
            'Informe quanto dinheiro entra na gaveta para comecar o turno. Esse valor e o ponto de partida da conferencia.',
        fields: [
            {
                name: 'openingFloat',
                label: 'Valor na gaveta',
                type: 'money',
                placeholder: '0,00',
                hint: 'Pode ser zero se o caixa comecar sem fundo.',
                autofocus: true,
                required: true,
            },
        ],
        submitLabel: 'Abrir turno',
        submitIcon: 'fa-lock-open',
        successMessage: 'Turno aberto.',
        endpoint: ENDPOINT_ABRIR,
        pendingLabel: 'Abrindo...',
        after: 'cashAposSalvar',
    };
}

/**
 * Fechar turno.
 *
 * Quando a tela ja sabe o esperado, ele entra na descricao. O dono precisa
 * comparar com o que contou antes de confirmar, e pedir isso em duas janelas
 * separadas (uma para conferir, outra para salvar) faz ele decorar o numero.
 *
 * Aqui o valor de money e' permitido: esta tela esta em Faturamento, que e' o
 * lugar protegido por senha.
 */
export function cashCloseSpec(esperado?: number): ModalSpec {
    return {
        id: 'cashCloseModal',
        title: 'Fechar caixa',
        icon: 'fa-lock',
        description:
            typeof esperado === 'number' && esperado > 0
                ? `Esperado na gaveta: ${esperado.toFixed(2)}. Conte o dinheiro e informe o total para o sistema calcular a diferenca.`
                : 'Conte o dinheiro da gaveta e informe o total. O sistema compara com o esperado e guarda a diferenca.',
        fields: [
            {
                name: 'countedCash',
                label: 'Total contado na gaveta',
                type: 'money',
                placeholder: '0,00',
                hint: 'Some as notas, moedas e o troco.',
                autofocus: true,
                required: true,
            },
            {
                name: 'note',
                label: 'Observacao (opcional)',
                type: 'textarea',
                maxlength: 140,
                placeholder: 'Faltou troco, trocou uma nota, conferi com o Pedro...',
            },
        ],
        submitLabel: 'Fechar turno',
        submitIcon: 'fa-lock',
        tone: 'danger',
        successMessage: 'Turno fechado.',
        endpoint: ENDPOINT_FECHAR,
        pendingLabel: 'Fechando...',
        // O retorno traz a diferenca. Mostrar no aviso evita um confirm() do
        // navegador depois do envio, que hoje e' o que interrompe o fluxo.
        after: 'cashAposFechar',
    };
}

/**
 * Sangria (saida) e deposito (entrada).
 *
 * Sao duas janelas, e nao uma com tipo dinamico, por dois motivos: o id do
 * DOM tem de ser unico, e o titulo e o tom mudam de verdade. Deposito nao e o
 * mesmo gesto que sangria com o sinal trocado, entao cada uma merece a sua.
 */
export function cashMovementSpec(tipo: 'entrada' | 'saida'): ModalSpec {
    const entrada = tipo === 'entrada';
    const rotulo = entrada ? 'Deposito' : 'Sangria';
    return {
        id: entrada ? 'cashDepositoModal' : 'cashSangriaModal',
        title: rotulo,
        icon: entrada ? 'fa-arrow-down' : 'fa-arrow-up',
        description: entrada
            ? 'Dinheiro que entrou na gaveta fora de venda, como troco de um cliente.'
            : 'Dinheiro que saiu da gaveta, como pagamento de fornecedor ou retirada.',
        fields: [
            {
                name: 'amount',
                label: 'Valor',
                type: 'money',
                placeholder: '0,00',
                autofocus: true,
                required: true,
            },
            {
                name: 'note',
                label: 'Motivo (opcional)',
                type: 'textarea',
                maxlength: 140,
                placeholder: entrada ? 'Troco do cliente Joao' : 'Pagamento do fornecedor de caixas',
            },
        ],
        submitLabel: 'Registrar ' + rotulo.toLowerCase(),
        submitIcon: entrada ? 'fa-arrow-down' : 'fa-arrow-up',
        tone: entrada ? undefined : 'danger',
        successMessage: rotulo + ' registrada.',
        endpoint: ENDPOINT_MOVIMENTO,
        pendingLabel: 'Registrando...',
        after: 'cashAposSalvar',
    };
}

/**
 * Liga as janelas ao comportamento padrao de ui/modal.ts.
 *
 * A ligacao espera o documento ficar pronto de proposito: o script
 * compartilhado do layout, onde mora modalBind, e' impresso depois do
 * conteudo, entao quem chamasse modalBind na hora estouraria ReferenceError e
 * os botoes ficariam sem funcao.
 */
export function cashModalsScript(): string {
    return `        <script>
            document.addEventListener('DOMContentLoaded', function () {
                modalBind('cashOpenModal', '${ENDPOINT_ABRIR}', 'Abrindo...', 'Turno aberto.', 'cashAposSalvar');
                modalBind('cashCloseModal', '${ENDPOINT_FECHAR}', 'Fechando...', 'Turno fechado.', 'cashAposFechar');
                modalBind('cashSangriaModal', '${ENDPOINT_MOVIMENTO}', 'Registrando...', 'Sangria registrada.', 'cashAposSalvar');
                modalBind('cashDepositoModal', '${ENDPOINT_MOVIMENTO}', 'Registrando...', 'Deposito registrado.', 'cashAposSalvar');
            });

            function cashAposSalvar() {
                // Deixa o aviso aparecer e so entao recarrega.
                setTimeout(function () { window.location.reload(); }, 700);
            }

            // Fechar turno: o servidor devolve a diferenca, entao o aviso
            // substitui o confirm() que existia antes.
            function cashAposFechar(res) {
                var d = (res && res.data && res.data.report && res.data.report.difference) || 0;
                var texto = d === 0
                    ? 'Turno fechado. O caixa bateu.'
                    : (d > 0
                        ? 'Turno fechado. Sobrou ' + d.toFixed(2) + ' na gaveta.'
                        : 'Turno fechado. Faltou ' + Math.abs(d).toFixed(2) + ' na gaveta.');
                flash(d === 0 ? 'ok' : 'err', texto);
                setTimeout(function () { window.location.reload(); }, 1400);
            }
        </script>`;
}
