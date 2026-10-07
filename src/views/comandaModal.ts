import { renderModal } from './ui/modal';

/**
 * A comanda e' gerada no servidor, nao no navegador: a tela mostra exatamente o que a cozinha
 * vai receber, e quem quiser imprimir em outro lugar chama a rota e usa o mesmo texto. Nao e'
 * formulario, entao usa bodyHtml -- o esqueleto continua vindo do componente.
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
 * Busca o texto no servidor porque a comanda e' montada em TypeScript, la. Montada no
 * navegador, a tela e o papel divergiriam no detalhe que ninguem revisa ate a cozinha
 * reclamar.
 */
export const COMANDA_SCRIPT = `        <script>
            // O Close do X e' derivado pelo modalBind do layout. Sem esta chamada o
            // botao existe na tela e nao faz nada, e o noSubmit sozinho nao fecha
            // janela nenhuma. DOMContentLoaded porque o script do layout vem depois.
            document.addEventListener('DOMContentLoaded', function () {
                modalBind('${COMANDA_MODAL_ID}', '', '', '');
            });

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

            function comandaImprimir() {
                if (!comandaPedidoAtual) { flash('err', 'Nenhum pedido selecionado.'); return; }
                window.open('/api/admin/comandas/' + comandaPedidoAtual + '/escpos', '_blank');
            }
        </script>`;
