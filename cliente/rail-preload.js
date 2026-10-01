/**
 * O que a BARRA pode pedir ao shell.
 *
 * Superficie nomeada e minima, porque e' a unica pagina com origem local: um preload
 * que expoe `require` aqui daria shell a qualquer script que entrasse no arquivo.
 * `abrirCanal` e' o unico com parametro, e ele e' um id de lista -- nunca uma URL.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cliente', {
    abrirCanal: (canal) => ipcRenderer.invoke('canal:abrir', String(canal)),
    irParaPainel: () => ipcRenderer.invoke('painel:ir'),
    recarregar: () => ipcRenderer.invoke('painel:recarregar'),
    sair: () => ipcRenderer.invoke('app:sair'),
    aoMudarConteudo: (fn) => ipcRenderer.on('conteudo:mudou', (_e, alvo) => fn(alvo)),
});