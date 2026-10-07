import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { logDoModulo } from './logger';

const log = logDoModulo('maquina');

/**
 * Amarracao da sessao a esta instalacao. Nao amarra o QR: vigia a pasta da sessao
 * ser COPIADA, que cria um segundo aparelho com a identidade identica. Cano contra
 * ACIDENTE: avisa em vez de bloquear, porque reinstalar o Windows e' legitimo.
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
 * Impressao digital da Windows: o `MachineGuid` do registro, criado na instalacao
 * e estavel enquanto ela existir -- MAC e serial de disco mudam na troca de
 * hardware. Fora do Windows devolve string vazia, e nao um id inventado.
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
        /*
 * O sal e' deste projeto. Veio `omniroute-amarracao` de outro codigo, e a pasta
 * de sessao gravada antes da troca deixava de casar com a maquina: o painel
 * acusava "sessao de outra maquina" na propria maquina.
 */
return createHash('sha256').update('deliveryadmin-amarracao:' + achado[1]).digest('hex').slice(0, 32);
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
 * `null` tambem quando nao ha o que conferir; `motivo` diz o que aconteceu e
 * `podeAparear` se a acao e' escanear o QR de novo.
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
