import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { logDoModulo } from './logger';

const log = logDoModulo('maquina');

/**
 * Amarracao da sessao do WhatsApp a esta instalacao.
 *
 * O que este arquivo NAO faz, e por que
 *
 * Ele nao amarra o QR. O QR ja e' unico por maquina e por tentativa: o WhatsApp
 * emite um `ref` novo a cada reconexao, de uso unico, e a identidade do aparelho
 * vem das chaves privadas em `creds.json`, geradas localmente. Duas maquinas
 * nao produzem as mesmas chaves. Nao havia o que construir.
 *
 * O que ele faz e' cuidar do outro lado da mesma coinidencia: a pasta
 * `auth_info_baileys` ser COPIADA.
 *
 * Copiar essa pasta cria um segundo aparelho com a identidade criptografica
 * identica. O WhatsApp ve o mesmo dispositivo em dois lugares, e o desfecho
 * possivel e um dos dois cair, ou o numero ser sinalizado. E o pior tipo de
 * erro: o app simplesmente conecta, o pedido comeca a falhar, e semanas depois
 * ninguem lembra do `npm install` que rodou na maquina errada.
 *
 * Este e' um cano contra ACIDENTE, nao uma trava. Quem pode copiar uma pasta
 * pode editar esta checagem. Tratar isso como seguranca seria prometer o que
 * nao entrega -- o que e' a mesma mentira das telas que foram removidas do
 * Configuracoes.
 *
 * Por que avisar e nao bloquear
 *
 * Porque o caso legitimo existe e e' comum: reinstalar o Windows, trocar o
 * disco, formatar a maquina. Num bloqueio, a pessoa precisaria descobrir que
 * precisa apagar um arquivo as maos antes de voltar a ter WhatsApp -- sem
 * nenhuma pista de por que. No aviso, a tela diz o que aconteceu e o que fazer,
 * e a pessoa escaneia o QR de novo em um minuto.
 */

const ARQUIVO = 'sessao-maquina.json';
const VERSAO = 1;

export type Amarracao = {
    versao: number;
    /** Impressao digital da maquina, guardada para comparar. */
    id: string;
    /** Quando foi gravada, para a tela explicar a origem. */
    criadoEm: string;
    /** Ultima maquina que autenticou. Util no log quando o id muda. */
    maquinaAnterior?: string;
};

/**
 * Impressao digital da instalacao do Windows.
 *
 * `MachineGuid` do registro: um identificador criado na instalacao do sistema e
 * estavel enquanto ela existir. E' a escolha padrao para amarrar licenca ou
 * sessao a uma maquina.
 *
 * As alternativas foram descartadas por serem piores:
 *
 * - Endereco MAC: troque junto com a placa de rede, e e' trivialmente falsificavel.
 * - Serial do disco: muda com a troca de HD ou SSD, que e' justamente quando a
 *   pessoa nao esta pensando em sessao.
 * - Nome da maquina: o dono muda o nome. e' a primeira pista de que algo mudou.
 *
 * O GUID e' lido de um caminho de registro que nao usa `HKLM:\...` com
 * barras invertidas, para nao depender de como o Node normaliza caminho de
 * registro em cada versao.
 *
 * Quando nao da para ler -- Linux, macOS, container -- devolve string vazia, e
 * o chamador trata como "nao da para amarrar", que e' o honesto. Nao inventa um
 * id.
 */
export function idDaMaquina(): string {
    try {
        const saida = execFileSync(
            'reg',
            [
                'query',
                'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
                '/v',
                'MachineGuid',
            ],
            { encoding: 'utf8', timeout: 3_000, windowsHide: true }
        );
        const achado = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(saida);
        if (!achado) return '';
        // O GUID direto identificaria a maquina em qualquer lugar que este
        // arquivo fosse lido. O hash com um sal fixo do app nao vaza o valor
        // original, e so precisa comparar, nunca ser decodificado.
        return createHash('sha256').update('omniroute-amarracao:' + achado[1]).digest('hex').slice(0, 32);
    } catch (erro) {
        log.debug(`Nao foi possivel ler o id da maquina: ${String(erro)}`);
        return '';
    }
}

function caminhoDoArquivo(pastaSessao: string): string {
    return path.join(pastaSessao, ARQUIVO);
}

/**
 * Confere a sessao contra esta maquina.
 *
 * Devolve `null` quando esta tudo certo, inclusive nos casos em que nao ha o
 * que conferir. `motivo` existe para a tela falar o que aconteceu, e
 * `podeAparear` diz se a pessoa resolve escaneando o QR -- que e' a acao, e o
 * unico custo real.
 */
export function confereAmarracao(
    pastaSessao: string,
    idAtual = idDaMaquina()
): { motivo: string; podeAparear: boolean } | null {
    // Sem id da maquina nao ha o que comparar. Inventar um id faria a checagem
    // passar por engano -- que e' o oposto do que se quer.
    if (!idAtual) return null;

    const arquivo = caminhoDoArquivo(pastaSessao);
    const temSessao = existsSync(path.join(pastaSessao, 'creds.json'));

    if (!existsSync(arquivo)) {
        // Sessao nova, ou sessao copiada de antes desta checagem existir.
        // Nos dois casos o certo e' gravar a marcacao agora e seguir.
        if (temSessao) {
            log.warn(
                `A sessao do WhatsApp veio sem marcacao de maquina -- foi copiada de outra instalacao, ` +
                    `ou e' de antes desta checagem existir. Gravando a marcacao desta maquina.`
            );
        }
        grava(pastaSessao, idAtual);
        return null;
    }

    let guardada: Amarracao;
    try {
        guardada = JSON.parse(readFileSync(arquivo, 'utf8')) as Amarracao;
    } catch {
        // Arquivo corrompido nao pode ser lido, e nao pode ser a razao para
        // impedir o WhatsApp de funcionar. Recomeca a marcacao.
        log.warn('Marcacao de maquina ilegivel; regravando.');
        grava(pastaSessao, idAtual);
        return null;
    }

    if (guardada.id === idAtual) return null;

    log.error(
        `ATENCAO: a sessao do WhatsApp pertence a OUTRA maquina. ` +
            `Dois aparelhos com a mesma identidade podem derrubar o numero. ` +
            `Apague a pasta auth_info_baileys e escaneie o QR de novo nesta maquina.`
    );
    return {
        motivo:
            'A sessao do WhatsApp foi pareada em outra maquina. Conectar as duas ao mesmo tempo ' +
            'pode fazer o WhatsApp desconectar uma delas, ou sinalizar o numero.',
        podeAparear: true,
    };
}

function grava(pastaSessao: string, id: string): void {
    try {
        if (!existsSync(pastaSessao)) return;
        let anterior: string | undefined;
        const arquivo = caminhoDoArquivo(pastaSessao);
        if (existsSync(arquivo)) {
            try {
                anterior = (JSON.parse(readFileSync(arquivo, 'utf8')) as Amarracao).id;
            } catch {
                anterior = undefined;
            }
        }
        const marcacao: Amarracao = {
            versao: VERSAO,
            id,
            criadoEm: new Date().toISOString(),
            ...(anterior ? { maquinaAnterior: anterior } : {}),
        };
        writeFileSync(arquivo, JSON.stringify(marcacao, null, 2), 'utf8');
    } catch (erro) {
        // Gravar a marcacao e' acessorio: se falhar, a sessao funciona igual e
        // a checagem da proxima vez repete o aviso. Falhar aqui derrubaria o
        // WhatsApp por causa de um arquivo de texto.
        log.warn(`Nao foi possivel gravar a marcacao de maquina: ${String(erro)}`);
    }
}
