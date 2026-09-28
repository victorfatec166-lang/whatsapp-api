import { renderModal, type ModalSpec } from './ui/modal';

/**
 * Janelas de abrir e fechar caixa, que ficam na Home.
 *
 * Estao na Home porque sao o primeiro e o ultimo gesto do dia, mas nao mostram
 * dinheiro: quem ve valor e' o administrador, na aba Faturamento, que e' o
 * lugar protegido por senha. Aqui aparece so o que a pessoa digita e a
 * confirmacao em texto -- "Turno aberto", "Turno fechado".
 *
 * O layout vem de ui/modal.ts; aqui sao apenas os dados de cada janela. Mudar
 * a aparencia destas duas, ou de qualquer janela futura, e mexer em um lugar
 * so.
 */

export const CASH_OPEN_SPEC: ModalSpec = {
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
    endpoint: '/api/admin/cash/shift/open',
    pendingLabel: 'Abrindo...',
    after: 'cashAposSalvar',
};

export const CASH_CLOSE_SPEC: ModalSpec = {
    id: 'cashCloseModal',
    title: 'Fechar caixa',
    icon: 'fa-lock',
    description:
        'Conte o dinheiro da gaveta e informe o total. O sistema compara com o esperado e guarda a diferenca.',
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
    successMessage: 'Turno fechado. A conferencia completa fica na aba Faturamento.',
    endpoint: '/api/admin/cash/shift/close',
    pendingLabel: 'Fechando...',
    after: 'cashAposSalvar',
};

export function renderCashModals(): string {
    return `${renderModal(CASH_OPEN_SPEC)}\n\n${renderModal(CASH_CLOSE_SPEC)}`;
}

/**
 * Liga as duas janelas ao comportamento padrao de ui/modal.ts.
 *
 * Depois de salvar, a Home recarrega porque o card do caixa muda de estado
 * ("turno aberto" e o botao vira "fechar caixa"). O aviso aparece antes do
 * recarregamento, como nas outras telas.
 *
 * O `res` da resposta e' ignorado de proposito: fechar turno devolve o
 * relatorio com dinheiro, e a Home nao mostra valor.
 */
export function cashModalsScript(): string {
    return `        <script>
            /*
             * A ligacao espera o documento ficar pronto de proposito.
             *
             * O script compartilhado do layout -- onde mora modalBind -- e'
             * impresso no fim da pagina, depois do conteudo. Um script aqui que
             * chamasse modalBind na hora seria executado antes e estouraria
             * ReferenceError, deixando os botoes sem funcao: era o que
             * acontecia. Esperar o DOM ready deixa a ordem dos blocos de
             * script deixar de importar.
             *
             * (O comentario acima evita escrever a tag de script: um "<" seguido
             * do nome dela dentro de um bloco de script confunde quem le o
             * HTML, mesmo sem quebrar o navegador.)
             */
            document.addEventListener('DOMContentLoaded', function () {
                modalBind(
                    'cashOpenModal',
                    '${CASH_OPEN_SPEC.endpoint}',
                    '${CASH_OPEN_SPEC.pendingLabel}',
                    '${CASH_OPEN_SPEC.successMessage}',
                    'cashAposSalvar'
                );
                modalBind(
                    'cashCloseModal',
                    '${CASH_CLOSE_SPEC.endpoint}',
                    '${CASH_CLOSE_SPEC.pendingLabel}',
                    '${CASH_CLOSE_SPEC.successMessage}',
                    'cashAposSalvar'
                );
            });

            function cashAposSalvar() {
                // Deixa o aviso aparecer e so entao recarrega.
                setTimeout(function () { window.location.reload(); }, 700);
            }
        </script>`;
}
