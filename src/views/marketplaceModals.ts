import { renderModal, type ModalSpec } from './ui/modal';
import type { Canal } from '../services/marketplace';

/**
 * Declaracoes de dados, com o esqueleto vindo do componente, para nao nascerem diferentes das de
 * caixa so porque foram escritas em outro lugar. Duas janelas porque sao dois momentos:
 * credencial, uma vez; item, a cada entrada nova -- sem ele o pedido chega sem baixa de estoque.
 */

const NOME_CANAL: Record<Canal, string> = {
    ifood: 'iFood',
    '99food': '99Food',
};

/** Prefixo de id das janelas. O canal entra no id porque as duas canais saem
 *  na mesma tela: dois ids iguais colidiria no DOM. */
const idCredencial = (c: Canal) => 'mkCredencial_' + c;
const idItem = (c: Canal) => 'mkItem_' + c;

/** Rota de credencial. O canal faz parte do caminho, e nao do corpo. */
export const rotaCredencial = (c: Canal) => `/api/admin/marketplace/${c}/credencial`;
/** Rota de casamento de item. */
export const rotaItem = (c: Canal) => `/api/admin/marketplace/${c}/itens`;

/**
 * O token de webhook aparece sempre: quem recadastra nao pode perder o recebimento por
 * esquecer que existe um segundo token. A credencial e' texto simples e nao password, para
 * a pessoa conferir o token colado antes de salvar -- e o valor nao volta para a tela.
 */
export function credencialSpec(channel: Canal): ModalSpec {
    return {
        id: idCredencial(channel),
        title: 'Credencial ' + NOME_CANAL[channel],
        icon: 'fa-store',
        description:
            'Cole o que o parceiro entregou. Fica cifrado no banco com a chave do CHANNEL_SECRET e nao aparece de novo nesta tela.',
        fields: [
            {
                name: 'segredo',
                label: 'Credencial / token de acesso',
                hint: 'Vem do painel do parceiro, na area de integracao.',
                autofocus: true,
                required: true,
            },
            {
                name: 'webhookSecret',
                label: 'Token de webhook',
                hint: 'Sem este token o sistema recusa todo pedido. E o que impede pedido falso de baixar estoque.',
            },
        ],
        submitLabel: 'Salvar',
        submitIcon: 'fa-save',
        successMessage: 'Credencial guardada.',
        endpoint: rotaCredencial(channel),
        pendingLabel: 'Guardando...',
    };
}

/**
 * O produto vem como select e nao texto livre: digitar o nome exato da errado em silencio, e
 * item casado com o produto errado baixa o estoque do prato errado. O id do marketplace e'
 * digitado porque vem da plataforma, e nao ha o que sugerir.
 */
export function itemSpec(
    channel: Canal,
    produtos: Array<{ id: string; name: string; price: number }>
): ModalSpec {
    return {
        id: idItem(channel),
        title: 'Casar item do ' + NOME_CANAL[channel],
        icon: 'fa-link',
        description: 'O id do marketplace vai no primeiro campo. O segundo escolhe o produto do catalogo.',
        fields: [
            {
                name: 'externalId',
                label: 'Id do item no ' + NOME_CANAL[channel],
                placeholder: 'ex.: 12345',
                autofocus: true,
                required: true,
            },
            {
                name: 'productId',
                label: 'Produto do catalogo',
                type: 'select',
                placeholder: 'Escolha um produto...',
                options: produtos.map((p) => ({
                    value: p.id,
                    label: `${p.name} — R$ ${p.price.toFixed(2).replace('.', ',')}`,
                })),
                required: true,
                hint: 'Preco do item vira o aviso de divergencia quando o marketplace mudar.',
            },
        ],
        submitLabel: 'Salvar casamento',
        submitIcon: 'fa-link',
        successMessage: 'Item casado.',
        endpoint: rotaItem(channel),
        pendingLabel: 'Salvando...',
    };
}

/**
 * Espera o documento ficar pronto de proposito: o script do layout, onde mora modalBind, e'
 * impresso depois do conteudo, e chamar na hora estouraria ReferenceError -- botao sem funcao.
 */
export function marketplaceModalsScript(canais: readonly Canal[]): string {
    const binds = canais
        .map((c) => {
            const cred = idCredencial(c);
            const item = idItem(c);
            return [
                `                modalBind('${cred}', '${rotaCredencial(c)}', 'Guardando...', 'Credencial guardada.', 'mkAposSalvar');`,
                `                modalBind('${item}', '${rotaItem(c)}', 'Salvando...', 'Item casado.', 'mkAposSalvar');`,
            ].join('\n');
        })
        .join('\n');

    return `        <script>
            document.addEventListener('DOMContentLoaded', function () {
${binds}
            });

            /*
             * Depois de guardar credencial ou casar item, a tela inteira muda:
             * o status da conta, a contagem de itens casados e a lista de
             * pedidos. Recarregar e' mais honesto do que tentar consertar cada
             * pedaco por JavaScript, e a pessoa nao perde nada digitado: a
             * janela ja foi fechada e o valor guardado.
             */
            function mkAposSalvar() {
                setTimeout(function () { window.location.reload(); }, 700);
            }
        </script>`;
}
