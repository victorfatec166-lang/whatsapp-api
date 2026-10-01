/**
 * O que a pagina do painel pode pedir ao shell.
 *
 * Regra do preload: expoe-se METODO, nunca objeto. E o motivo e' o mesmo da janela
 * -- se a pagina roller acesso a `require`, a `process` e ao filesystem, um XSS no
 * painel deixa de ser XSS e passa a ser shell.
 *
 * Hoje nao ha nenhum metodo de verdade: o painel funciona sozinho e o Electron
 * so' serve de moldura. O objeto fica vazio de proposito -- um preload vazio e' o
 * estado inicial correto, e grows junto com a primeira coisa que precisar dele.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('deliveryAdmin', {
    versaoCliente: '1',
});