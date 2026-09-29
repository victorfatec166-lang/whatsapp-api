import { renderPairing, type PairData } from './pairing';
import { renderBot, type BotData } from './tabs';

/**
 * WhatsApp: conexao + textos do bot numa unica tela.
 *
 * Antes eram dois itens da sidebar. Sao o mesmo subsistema e a mesma sessao, e
 * o botao "Reconectar" aparecia nas duas. Agora a conexao fica sempre no topo
 * (e o que importa 99% das vezes) e os textos do bot ficam numa secao
 * colapsavel, que o dono consulta poucas vezes por ano.
 */
export function renderWhatsApp(d: { pair: PairData; bot: BotData }): string {
    return `${renderPairing(d.pair)}

        <details id="textos-bot" class="card mt-5">
            <summary class="cursor-pointer px-5 py-4 font-bold text-ink flex items-center gap-2 select-none">
                <i class="fa-solid fa-comment-dots text-accent"></i>
                Textos do bot
                <span class="badge-neutral ml-1">${Object.keys(d.bot.mensagens).length} mensagens</span>
                <i class="fa-solid fa-chevron-down ml-auto text-caption text-ink-3"></i>
            </summary>
            <div class="px-5 pb-5 border-t border-line pt-5">
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
