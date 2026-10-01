import { escapeHtml } from './html';
import { cardVazio, faixaKpi, kpi } from './ui/card';

/**
 * Fica no grupo de Configuracoes e nao em aba propria: e' tela de dono, aberta uma vez por
 * trimestre. A acao de mudar esta na linha da pessoa, e nao num menu separado -- um clique a
 * menos numa tela que quase sempre e' lida e raramente alterada.
 */

type LinhaUsuario = {
    id: string;
    email: string;
    nome: string;
    papel: string;
    ativo: boolean;
    precisaTrocarSenha: boolean;
    bloqueadoAte: string | null;
    ultimoLogin: string | null;
    criadaEm: string;
    sessoes: number;
};

export type UsuariosData = {
    usuarios: LinhaUsuario[];
    /** Quem esta olhando a tela. Nunca pode se desativar nem rebaixar. */
    euId: string;
    totalAdministradores: number;
};

function quando(iso: string | null): string {
    if (!iso) return 'nunca entrou';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function linha(u: LinhaUsuario, d: UsuariosData): string {
    const souEu = u.id === d.euId;
    const bloqueado = u.bloqueadoAte && new Date(u.bloqueadoAte) > new Date();

    /*
     * As acoes do proprio usuario somem em vez de desabilitar: botao cinza na propria linha
     * e' um botao que a pessoa clica para ver que nao faz nada. Hide evita a tentativa; o
     * exigeAdmin, no servidor, e' o que garante.
     */
    const acoes = souEu
        ? `<span class="text-caption text-ink-3">Voce</span>`
        : `<div class="flex items-center gap-1">
            <button type="button" data-usuario-alternar="${escapeHtml(u.id)}" class="btn btn-ghost btn-sm"
                title="${u.ativo ? 'Desativar: a conta sai do painel, mas continua no historico' : 'Reativar o acesso'}">
                <i class="fa-solid ${u.ativo ? 'fa-user-slash' : 'fa-user-check'}"></i>
                <span class="hidden md:inline">${u.ativo ? 'Desativar' : 'Reativar'}</span>
            </button>
            <button type="button" data-usuario-senha="${escapeHtml(u.id)}" class="btn btn-ghost btn-sm"
                title="Gerar uma senha nova e mostrar uma vez">
                <i class="fa-solid fa-key"></i>
                <span class="hidden md:inline">Gerar senha</span>
            </button>
            ${
                u.sessoes > 0
                    ? `<button type="button" data-usuario-sessoes="${escapeHtml(u.id)}" class="btn btn-ghost btn-icon"
                        title="Encerrar as ${u.sessoes} sessao(oes) abertas desta conta" aria-label="Encerrar sessoes abertas">
                        <i class="fa-solid fa-mobile-screen"></i>
                    </button>`
                    : ''
            }
            <button type="button" data-usuario-papel="${escapeHtml(u.id)}" data-papel="${u.papel === 'admin' ? 'operador' : 'admin'}" class="btn btn-ghost btn-sm"
                title="${u.papel === 'admin' ? 'Rebaixar para operador: deixa de administrar quem entra' : 'Promover a administrador'}">
                <i class="fa-solid ${u.papel === 'admin' ? 'fa-user-minus' : 'fa-user-shield'}"></i>
                <span class="hidden md:inline">${u.papel === 'admin' ? 'Rebaixar' : 'Promover'}</span>
            </button>
        </div>`;

    return `                    <tr data-linha-usuario="${escapeHtml(u.id)}" class="${u.ativo ? '' : 'opacity-60'}">
                        <td>
                            <div class="flex items-center gap-2.5">
                                <span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent-soft text-accent text-caption font-bold shrink-0">
                                    ${escapeHtml(u.nome.slice(0, 2).toUpperCase())}
                                </span>
                                <div class="min-w-0">
                                    <p class="text-body font-medium text-ink truncate">${escapeHtml(u.nome)}</p>
                                    <p class="text-caption text-ink-3 truncate">${escapeHtml(u.email)}</p>
                                </div>
                            </div>
                        </td>
                        <td>
                            <span class="badge ${u.papel === 'admin' ? 'badge-info' : 'badge-neutral'}">
                                ${u.papel === 'admin' ? 'Administrador' : 'Operador'}
                            </span>
                        </td>
                        <td>
                            ${
                                !u.ativo
                                    ? '<span class="badge badge-neutral">Desativada</span>'
                                    : bloqueado
                                      ? '<span class="badge badge-danger">Bloqueada</span>'
                                      : u.precisaTrocarSenha
                                        ? '<span class="badge badge-warn">Senha provisoria</span>'
                                        : `<span class="text-body text-ink-2">${escapeHtml(quando(u.ultimoLogin))}</span>`
                            }
                        </td>
                        <td class="text-center text-body text-ink-2">${u.sessoes}</td>
                        <td>${acoes}</td>
                    </tr>`;
}

export function renderUsuarios(d: UsuariosData): string {
    const ativos = d.usuarios.filter((u) => u.ativo).length;
    const sessoes = d.usuarios.reduce((t, u) => t + u.sessoes, 0);
    const provisorias = d.usuarios.filter((u) => u.ativo && u.precisaTrocarSenha).length;

    return `${faixaKpi([
        kpi('Contas', String(d.usuarios.length), `${ativos} com acesso agora`),
        kpi('Administradores', String(d.usuarios.filter((u) => u.papel === 'admin' && u.ativo).length), 'gerenciam quem entra'),
        kpi('Sessoes abertas', String(sessoes), 'navegadores com o painel aberto', sessoes > 0 ? 'warning' : 'default'),
        kpi('Senha provisoria', String(provisorias), provisorias > 0 ? 'precisam trocar no proximo login' : 'nenhuma', provisorias > 0 ? 'warning' : 'success'),
    ])}

        <div class="card overflow-hidden">
            <div class="card-pad pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line">
                <div>
                    <h3 class="text-title">Quem tem acesso</h3>
                    <p class="text-caption text-ink-3">
                        Operador usa o painel. Administrador tambem cria e desativa contas.
                    </p>
                </div>
                <a href="/criar-conta" class="btn btn-ghost btn-sm ${d.usuarios.length > 0 ? 'hidden' : ''}" title="So fica disponivel na primeira conta">
                    <i class="fa-solid fa-user-plus"></i> Criar conta
                </a>
            </div>

            ${
                d.usuarios.length === 0
                    ? cardVazio('Nenhuma conta cadastrada.', 'fa-user-shield')
                    : `<div class="table-wrap max-h-[calc(100vh-22rem)] overflow-y-auto">
                    <table>
                        <thead class="bg-surface-2 text-ink-3">
                            <tr>
                                <th>Pessoa</th><th>Papel</th><th>Ultimo acesso</th><th class="text-center">Sessoes</th><th></th>
                            </tr>
                        </thead>
                        <tbody class="text-ink">
${d.usuarios.map((u) => linha(u, d)).join('\n')}
                        </tbody>
                    </table>
                </div>`
            }
        </div>

        ${renderModalSenha()}

        <script>${SCRIPT_USUARIOS}</script>`;
}

/**
 * Show-once por desenho: a senha nao volta do servidor, o que existe no banco e' o hash.
 * O aviso diz isso porque quem fecha a janela sem anotar fica sem acesso e sem caminho de
 * recuperacao, a nao ser gerar outra.
 */
function renderModalSenha(): string {
    return `        <div id="senhaModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="senhaModal-titulo">
            <div class="modal-panel">
                <div class="flex items-start justify-between gap-3 mb-1">
                    <h3 id="senhaModal-titulo" class="text-title flex items-center gap-2">
                        <i class="fa-solid fa-key text-accent"></i> Senha gerada
                    </h3>
                    <button type="button" data-modal-cancel onclick="senhaModalFechar()" class="btn btn-ghost px-2 -mt-1 -mr-1" aria-label="Fechar">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <p class="text-caption text-ink-3 mb-4">Anote e repasse. Esta e' a unica vez que ela aparece.</p>
                <code id="senhaGerada" class="block rounded-card border border-line bg-surface-2 p-3 text-center text-title font-mono select-all"></code>
                <div class="flex justify-end gap-2 mt-5">
                    <button type="button" data-modal-cancel onclick="senhaModalFechar()" class="btn btn-ghost sm:min-w-[7rem]">Fechar</button>
                </div>
            </div>
        </div>`;
}

const SCRIPT_USUARIOS = `
            function senhaModalFechar() { modalHide('senhaModal'); }

            /*
             * Delegacao em um listener so.
             *
             * Sao cinco botoes em cada linha, e cada um repetia o id dentro do
             * onclick. Um id interpolado em atributo e' codigo, nao dado: se um
             * deles trouxer uma aspa, o bloco inteiro para de fazer parse e a
             * tela perde TODOS os ouvintes de uma vez -- e o sintoma e' "o botao
             * nao funciona", sem nenhuma pista de por que.
             */
            document.addEventListener('click', function (ev) {
                var alvo = ev.target;
                if (!alvo || !alvo.closest) return;

                var senha = alvo.closest('[data-usuario-senha]');
                if (senha) { geraSenha(senha.dataset.usuarioSenha); return; }

                var alternar = alvo.closest('[data-usuario-alternar]');
                if (alternar) { alterna(alternar.dataset.usuarioAlternar); return; }

                var sessoes = alvo.closest('[data-usuario-sessoes]');
                if (sessoes) { encerraSessoes(sessoes.dataset.usuarioSessoes); return; }

                var papel = alvo.closest('[data-usuario-papel]');
                if (papel) { trocaPapel(papel.dataset.usuarioPapel, papel.dataset.papel); return; }
            });

            async function geraSenha(id) {
                confirmThen(
                    'A senha atual desta conta deixa de valer e as sessoes abertas sao encerradas. ' +
                        'A pessoa vai ter que entrar com a senha nova e escolher outra na troca.',
                    async function () {
                        var r = await postJSON('/api/admin/usuarios/' + encodeURIComponent(id) + '/gerar-senha', {});
                        if (!r.ok) { flash('err', r.data.error || 'Nao foi possivel gerar a senha.'); return; }
                        flash('ok', 'Senha de ' + r.data.email + ': ' + r.data.senha);
                    },
                    { titulo: 'Gerar senha nova?', confirmar: 'Gerar' }
                );
            }

            async function alterna(id) {
                var r = await postJSON('/api/admin/usuarios/' + encodeURIComponent(id) + '/alternar', {});
                if (!r.ok) { flash('err', r.data.error || 'Nao foi possivel mudar o acesso.'); return; }
                location.reload();
            }

            async function encerraSessoes(id) {
                confirmThen(
                    'Os navegadores com o painel aberto nesta conta vao pedir a senha de novo. ' +
                        'Se a pessoa nao trocou de aparelho, e' o caminho.',
                    async function () {
                        var r = await postJSON('/api/admin/usuarios/' + encodeURIComponent(id) + '/encerrar-sessoes', {});
                        if (!r.ok) { flash('err', r.data.error || 'Nao foi possivel encerrar.'); return; }
                        flash('ok', r.data.encerradas + ' sessao(oes) encerrada(s).');
                        setTimeout(function () { location.reload(); }, 700);
                    },
                    { titulo: 'Encerrar sessoes?', confirmar: 'Encerrar' }
                );
            }

            async function trocaPapel(id, papel) {
                var chegado = papel === 'admin' ? 'administrador' : 'operador';
                confirmThen(
                    papel === 'admin'
                        ? 'Esta conta passa a poder criar e desativar contas, e a ver a tela de usuarios.'
                        : 'Esta conta deixa de administrar: nao ve a tela de usuarios nem muda quem entra.',
                    async function () {
                        var r = await postJSON('/api/admin/usuarios/' + encodeURIComponent(id) + '/trocar-papel', { papel: papel });
                        if (!r.ok) { flash('err', r.data.error || 'Nao foi possivel mudar o papel.'); return; }
                        flash('ok', 'Agora e' + chegado + '.');
                        setTimeout(function () { location.reload(); }, 700);
                    },
                    { titulo: 'Mudar o papel?', confirmar: 'Mudar' }
                );
            }
        `;
