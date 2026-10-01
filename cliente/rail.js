const $ = (id) => document.getElementById(id);

/*
 * A barra nao sabe o que e' iFood nem onde fica o painel. Ela pede ao processo
 * principal e reage ao que ele responde -- o que esta no centro mora em um lugar so,
 * senao a barra fica com uma marca acesa no item errado depois de um F5.
 */
const api = window.cliente;

function marcar(ativo) {
    for (const item of ['painel', 'ifood', 'nfood', 'whatsapp']) {
        $(item).setAttribute('aria-pressed', item === ativo ? 'true' : 'false');
    }
}

$('painel').addEventListener('click', () => api.irParaPainel());
$('ifood').addEventListener('click', () => api.abrirCanal('ifood'));
$('nfood').addEventListener('click', () => api.abrirCanal('nfood'));
$('whatsapp').addEventListener('click', () => api.abrirCanal('whatsapp'));
$('recarregar').addEventListener('click', () => api.recarregar());
$('sair').addEventListener('click', () => api.sair());

// O principal avisa quando algo troca o centro (atalho de teclado, por exemplo).
api.aoMudarConteudo(marcar);