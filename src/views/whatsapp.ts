import { renderPairing, type PairData } from './pairing';
import { renderBot, type BotData } from './tabs';

/**
 * WhatsApp: conexao + textos do bot numa unica tela.
 *
 * Antes eram dois itens da sidebar. Sao o mesmo subsistema e a mesma sessao, e o
 * botao "Reconectar" aparecia nas duas. Agora a conexao fica sempre no topo
 * (e o que importa 99% das vezes) e os textos do bot ficam numa secao
 * colapsavel, que o dono consulta poucas vezes por ano.
 */
export function renderWhatsApp(d: { pair: PairData; bot: BotData }): string {
    /*
     * O botao de voltar ao padrao sobe para o topo da aba.
     *
     * Ele ja existia -- aqui em cima, e um por campo la embaixo -- mas morava
     * dentro de "Textos do bot", que abre recolhido. Resultado: o dono que
     * mudou o jeito de o bot falar, esqueceu como voltou, e nao tinha onde
     * procurar. Botao que so existe dentro de uma secao fechada nao e' botao;
     * e' piada de programador.
     *
     * Aparece sempre, mesmo sem edicao nenhuma, e nesse caso fica desligado e
     * diz por que. Um botao que so aparece quando ha algo a fazer obriga a
     * pessoa a caçar o estado do sistema antes de descobrir que ele existe --
     * e nesse caso o que ela queria era descobrir que nao ha nada a fazer.
     *
     * A funcao mora em tabs.ts, junto dos campos que ela apaga. Chamar de dois
     * lugares e' de graca; duplicar a confirmacao em dois lugares, nao.
     */
    const editadas = Object.values(d.bot.mensagens).filter((m) => m?.editado).length;

    return `<div class="card card-pad mb-4 flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
                <h3 class="text-title flex items-center gap-2">
                    <i class="fa-solid fa-comment-dots text-accent"></i> Textos do bot
                </h3>
                <p class="text-caption text-ink-3">
                    ${
                        editadas === 0
                            ? 'Todos os textos estao como vieram com o programa.'
                            : editadas + ' de ' + Object.keys(d.bot.mensagens).length + ' alteradas. Os textos que o cliente recebe vem daqui.'
                    }
                </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="badge ${editadas > 0 ? 'badge-warn' : 'badge-neutral'}">
                    ${editadas === 0 ? 'Tudo no padrao' : editadas + ' alterada(s)'}
                </span>
                <button type="button" onclick="msgRestaurarTodas()" class="btn ${editadas > 0 ? 'btn-danger' : 'btn-ghost'} btn-sm"
                    ${editadas > 0 ? '' : 'disabled'}
                    title="${
                        editadas > 0
                            ? 'Apaga tudo que foi alterado aqui e volta ao texto original do programa. Nao da para desfazer.'
                            : 'Nao ha nada alterado para desfazer.'
                    }">
                    <i class="fa-solid fa-rotate-left"></i> Voltar ao padrao
                </button>
            </div>
        </div>

        ${renderPairing(d.pair)}

        <details id="textos-bot" class="card">
            <summary class="cursor-pointer text-title flex items-center gap-2 select-none card-pad">
                <i class="fa-solid fa-sliders text-accent"></i>
                Editar os textos do bot
                <span class="text-caption text-ink-3">${Object.keys(d.bot.mensagens).length} mensagens</span>
                <i class="fa-solid fa-chevron-down ml-auto text-caption text-ink-3"></i>
            </summary>
            <div class="px-5 pb-5 border-t border-line pt-4 max-h-[calc(100vh-16rem)] overflow-y-auto">
${renderBot(d.bot)}
            </div>
        </details>

        <script>
            // Abre a secao de textos quando o link antigo ?tab=bot#textos-bot chega.
            if (window.location.hash === '#textos-bot') {
                var bloco = document.getElementById('textos-bot');
                if (bloco) bloco.open = true;
            }
        </script>`;
}
