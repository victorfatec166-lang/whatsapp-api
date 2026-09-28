import { renderModal } from './ui/modal';

/**
 * Janela da comanda da cozinha.
 *
 * A comanda e' gerada no servidor, nao no navegador: a tela mostra exatamente o
 * que a cozinha vai receber, e o botao de imprimir entrega o ESC/POS para a
 * impressora do sistema. Quem quiser imprimir em outro lugar -- um agente
 * local, uma impressora de rede -- chama a rota direto e usa o mesmo texto.
 *
 * Esta janela nao e' formulario, entao usa bodyHtml em vez de fields. O
 * esqueleto continua vindo do componente: cabecalho, fechar, rodape.
 */
export const COMANDA_MODAL_ID = 'comandaModal';

export function renderComandaModal(): string {
    return renderModal({
        id: COMANDA_MODAL_ID,
        title: 'Comanda da cozinha',
        icon: 'fa-print',
        description: 'O papel que sai na impressora da cozinha.',
        bodyHtml: `                <div>
                    <p class="text-caption text-ink-3 mb-2">
                        Confira antes de imprimir. Os modificadores saem em linha separada, e a comanda nao leva valor.
                    </p>
                    <pre id="comandaTexto"
                         class="input font-mono text-xs leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-[55vh] bg-sunken cursor-default"
                         aria-label="Conteudo da comanda">carregando...</pre>
                </div>`,
        noSubmit: true,
        onSubmit: 'comandaImprimir',
        submitLabel: 'Imprimir',
        submitIcon: 'fa-print',
        successMessage: '',
        endpoint: '',
    });
}

/**
 * Abre a comanda de um pedido.
 *
 * Busca o texto no servidor porque a comanda e' montada em TypeScript, no
 * servidor. Se ela fosse montada no navegador, a tela e o papel poderiam
 * divergir no detalhe que ninguem revisa ate a cozinha reclamar.
 */
export const COMANDA_SCRIPT = `        <script>
            // Guarda o pedido aberto para o botao de imprimir saber qual e'.
            var comandaPedidoAtual = '';

            async function comandaAbrir(id) {
                comandaPedidoAtual = id;
                var caixa = document.getElementById('comandaTexto');
                if (caixa) caixa.textContent = 'carregando...';
                modalShow('comandaModal');

                try {
                    var r = await fetch('/api/admin/comandas/' + id);
                    if (!r.ok) throw new Error('falha ao buscar a comanda');
                    var dados = await r.json();
                    if (caixa) caixa.textContent = dados.texto;
                } catch (e) {
                    if (caixa) caixa.textContent = 'Nao foi possivel montar a comanda. Tente de novo.';
                    flash('err', 'Erro ao montar a comanda.');
                }
            }

            /*
             * Imprimir.
             *
             * A rota devolve ESC/POS como octet-stream. Quem faz a impressao de
             * verdade e a impressora do sistema operacional, que e' o caminho
             * que funciona sem descobrir porta nem driver em runtime. Um agente
             * local, se existir, consome a mesma rota e imprime do lado dele.
             *
             * Abrir em nova aba e o que entrega o arquivo a fila de impressao do
             * navegador, que por sua vez entrega a impressora padrao. Nao ha
             * como garantir pela web qual e' a impressora padrao -- essa e'
             * exatamente a razao de a impressao ficar do lado de fora.
             */
            function comandaImprimir() {
                if (!comandaPedidoAtual) { flash('err', 'Nenhum pedido selecionado.'); return; }
                window.open('/api/admin/comandas/' + comandaPedidoAtual + '/escpos', '_blank');
            }
        </script>`;
