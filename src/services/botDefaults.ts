/**
 * Textos padrao do bot. Sao usados quando ainda nao existe valor salvo no
 * banco (primeira execucao) e tambem como fallback em tempo de execucao.
 *
 * Variaveis reconhecidas: {items} e {total}.
 */
export const DEFAULT_BOT_MESSAGES: Record<string, string> = {
    mainMenu:
        '\u{1F354} *BEM-VINDO* \u{1F355}\n' +
        '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n' +
        'Escolha uma opcao:\n\n' +
        '1\uFE0F\u20E3 *Ver Cardapio e Pedir*\n' +
        '2\uFE0F\u20E3 *Consultar Meus Pedidos*\n' +
        '3\uFE0F\u20E3 *Falar com Atendente*\n\n' +
        '\u{1F449} *Responda com o numero* da opcao desejada:',

    menuHeader: '\u{1F37D}\uFE0F *CARDAPIO DIGITAL* \u{1F37D}\uFE0F',

    dailyMenuTitle: '⭐ *MENU DO DIA* ⭐\n',

    regularMenuTitle: '\u{1F4CB} *CARDAPIO* \u{1F4CB}\n',

    menuFooter: '\u{1F449} Digite o *numero do produto* que deseja encomendar (ou digite *menu* para voltar):',

    menuEmpty: '\u26A0\uFE0F O cardapio esta vazio no momento. Cadastre produtos no painel web!',

    orderReceived:
        '\u{1F389} *Pedido Recebido com Sucesso!* \n\n' +
        '\u{1F4E6} *Item:* {items}\n' +
        '\u{1F4B5} *Total:* R$ {total}\n\n' +
        'O seu pedido ja foi registado na cozinha! Digite *2* para consultar os seus pedidos.',

    invalidOption: '\u{1F916} Opcao invalida. Digite *1* para ver o cardapio ou *menu* para ver as opcoes.',

    invalidProduct: '\u274C Numero de produto invalido. Digite um numero valido da lista ou *menu* para voltar.',

    noOrders: '\u{1F4E6} Nao encontramos pedidos recentes. Digite *1* para ver o cardapio ou *menu*.',

    statusPreparando:
        '\u{1F525} *O seu pedido foi confirmado e foi para a cozinha!* \u{1F468}\u200D\u{1F373}\n\n' +
        'A nossa equipa ja comecou a preparar o seu pedido:\n' +
        '\u2022 *Item:* {items}\n' +
        '\u2022 *Total:* R$ {total}\n\n' +
        'Em breve teremos novidades! \u23F1\uFE0F',

    statusEntrega:
        '\u{1F6F5} *O seu pedido saiu para entrega!* \u{1F4E6}\n\n' +
        'Fique atento, o entregador esta a caminho do seu endereco com o seu pedido:\n' +
        '\u2022 *Item:* {items}\n' +
        '\u2022 *Total:* R$ {total}\n\n' +
        'Bom apetite! \u{1F60B}',

    statusConcluido:
        '\u2705 *Pedido Entregue / Concluido!* \u{1F389}\n\n' +
        'Esperamos que goste da sua refeicao! Muito obrigado pela preferencia. Volte sempre! \u{1F354}\u2764\uFE0F',

    attendantMessage:
        '\u{1F468}\u200D\u{1F4BB} A sua solicitacao foi registada. Um atendente humano ira chamar-lo em breve! ' +
        'Digite *menu* a qualquer momento para voltar.',
};
