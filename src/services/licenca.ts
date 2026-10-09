/*
 * O aviso de assinatura que a loja ve na tela de entrada.
 *
 * Decisao do dono na F5: sem carencia e sem tela de loja travada -- avisar antes do
 * corte, e o corte vem com o gateway. Por isso isto NAO bloqueia nada.
 */

import { estadoDaLicenca } from './relay';
import type { LicencaDaLoja } from './assinaturas';

/** Quantos dias antes do fim do teste o aviso aparece. */
const AVISO_DIAS = 3;

export type AvisoDeLicenca = {
    tom: 'atencao' | 'erro';
    titulo: string;
    texto: string;
};

/**
 * O aviso, ou `null` quando nao ha o que avisar.
 *
 * Entra: loja paga (nada), teste acabando (aviso) e acesso cortado (erro). Fora: conta
 * sem assinatura e ligada -- interna, ou com teste longe do fim; avisar seria mentira.
 */
export function avisoDeLicenca(licenca: LicencaDaLoja | null | undefined): AvisoDeLicenca | null {
    if (!licenca) return null;
    if (licenca.ativo && licenca.status === 'sem-assinatura') return null;

    if (!licenca.ativo) {
        return {
            tom: 'erro',
            titulo: 'O acesso desta loja esta cortado',
            texto: 'A mensalidade nao esta em dia. Fale com a gente para voltar a usar.',
        };
    }

    if (licenca.diasRestantes > 0 && licenca.diasRestantes <= AVISO_DIAS) {
        const dia = licenca.diasRestantes === 1 ? 'dia' : 'dias';
        return {
            tom: 'atencao',
            titulo: `Seu teste termina em ${licenca.diasRestantes} ${dia}`,
            texto: 'Depois disso o acesso e' + ' cortado ate a mensalidade cair.',
        };
    }

    return null;
}

/** O aviso do PC que esta rodando agora, para a tela de entrada. */
export function avisoDaLicencaLocal(): AvisoDeLicenca | null {
    return avisoDeLicenca(estadoDaLicenca());
}