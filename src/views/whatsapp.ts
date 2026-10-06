import { escapeHtml } from './html';
import { renderPairing, type PairData } from './pairing';
import { renderBot, type BotData } from './tabs';

export type { BotData };

/**
 * A conexao volta a morar aqui, em bloco recolhido no fim. Quem tira o QR e' a
 * loja, nao o dono: se a sessao cair no expediente, ninguem entra no terminal. Fora
 * do topo porque o cliente de desktop ja abre o WhatsApp Web.
 */
export function renderWhatsApp(d: { pair: PairData; bot: BotData }): string {
    /*
     * O botao ja existia, mas morava dentro de "Textos do bot", que abre recolhido: quem mudou
     * o jeito do bot falar esqueceu como voltar e nao tinha onde procurar. Aparece sempre, e sem
     * edicao alguma fica desligado e diz por que. A funcao mora em tabs.ts.
     */
    const editadas = Object.values(d.bot.mensagens).filter((m) => m?.editado).length;
    const ligado = d.bot.ligado !== false;

    /*
     * O interruptor fica ACIMA dos textos, e nao dentro deles: quem quer calar o bot
     * as tres da manha nao esta' com animo de abrir um acorde de configuracao.
     */
    const interruptor = `        <div class="card card-pad mb-4 flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
                <p class="text-title text-ink flex items-center gap-2">
                    <i class="fa-solid ${ligado ? 'fa-robot' : 'fa-robot'} text-accent" aria-hidden="true"></i>
                    Atendimento automatico
                </p>
                <p class="text-caption text-ink-3 mt-1">
                    ${
                        ligado
                            ? 'O bot responde as mensagens dos clientes neste numero.'
                            : 'O bot esta <strong class="text-ink">pausado</strong>. Os clientes recebem o aviso abaixo e o pedido precisa ser feito com a equipe.'
                    }
                </p>
            </div>
            <button type="button" id="alterna-bot" data-ligado="${ligado ? 'true' : 'false'}"
                class="btn ${ligado ? 'btn-ghost' : 'btn-primary'} py-2 font-semibold">
                <i class="fa-solid ${ligado ? 'fa-pause' : 'fa-play'} mr-2" aria-hidden="true"></i>
                <span>${ligado ? 'Pausar bot' : 'Ligar bot'}</span>
            </button>
        </div>
        ${
            ligado
                ? ''
                : `        <div class="card card-pad mb-4">
            <label class="label" for="aviso-pausado">O que o cliente recebe enquanto estiver pausado</label>
            <input id="aviso-pausado" type="text" class="input"
                maxlength="240"
                value="${escapeHtml(d.bot.avisoPausado ?? '')}"
                placeholder="Nosso atendimento automatico esta pausado no momento...">
            <p class="text-caption text-ink-3 mt-1.5">
                Vazio usa o texto padrao. Mudar aqui nao liga nem desliga o bot.
            </p>
        </div>`
        }`;

    return `<div id="interruptor-bot" data-pausado="${ligado ? 'false' : 'true'}">${interruptor}</div>
        <details id="textos-bot" class="card mb-4" open>
            <summary class="cursor-pointer text-title flex items-center gap-2 select-none card-pad">
                <i class="fa-solid fa-comment-dots text-accent"></i>
                Textos que o cliente recebe
                <span class="text-caption text-ink-3">${Object.keys(d.bot.mensagens).length} mensagens</span>
                <i class="fa-solid fa-chevron-down ml-auto text-caption text-ink-3"></i>
            </summary>
            <div class="px-5 pb-5">
                <div class="card card-pad mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div class="min-w-0">
                        <h3 class="text-title flex items-center gap-2">
                            <i class="fa-solid fa-sliders text-accent"></i> Textos do bot
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
${renderBot(d.bot)}
            </div>
        </details>

        <details class="card" id="conexao-bot"${d.pair.state.phase === 'conectado' ? '' : ' open'}>
            <summary class="cursor-pointer text-title flex items-center gap-2 select-none card-pad">
                <i class="fa-brands fa-whatsapp text-accent-emerald"></i>
                Conexao do WhatsApp
                <span class="badge ${d.pair.state.phase === 'conectado' ? 'badge-success' : 'badge-danger'}">${
                    d.pair.state.phase === 'conectado' ? 'conectado' : 'desconectado'
                }</span>
                <i class="fa-solid fa-chevron-down ml-auto text-caption text-ink-3"></i>
            </summary>
            <div class="px-5 pb-5">
                <p class="text-caption text-ink-3 mb-4">
                    O WhatsApp ja abre pelo cliente de desktop. Isto e' para quando a sessao cai
                    e a loja precisa reconectar sem depender do dono.
                </p>
${renderPairing(d.pair)}
            </div>
        </details>

        <script>
            if (window.location.hash === '#textos-bot') {
                var bloco = document.getElementById('textos-bot');
                if (bloco) bloco.open = true;
            }
        </script>`;
}
