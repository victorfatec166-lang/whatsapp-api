/**
 * O que a pagina do painel pode pedir ao shell.
 *
 * Regra do preload: expoe-se METODO, nunca objeto. E' o motivo de o objeto existir:
 * se a pagina roller acesso a `require`, a `process` e ao filesystem, um XSS no
 * painel deixa de ser XSS e passa a ser shell.
 *
 * `tentarNovamente` existe para a tela de "painel fora do ar" -- que e' HTML gerado
 * pelo processo principal e carregado na MESMA view do painel. Sem este metodo a
 * pagina carregada por `data:` fica sem `contextBridge` (preload nao roda em `data:`),
 * e o botao de tentar de novo seria um botao morto.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deliveryAdmin', {
    versaoCliente: '1',
});

contextBridge.exposeInMainWorld('clienteRecarregar', () => ipcRenderer.invoke('painel:ir'));