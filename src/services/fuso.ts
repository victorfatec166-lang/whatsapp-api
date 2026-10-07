/**
 * Fuso do dono. O Render roda em UTC, e `getHours()` ou `toLocaleTimeString` sem
 * `timeZone` leem o fuso da maquina que gerou a tela -- 3 horas atrasadas de Sao
 * Paulo. A loja nao tem fuso guardado e o produto e' brasileiro: FUSO_PADRAO cobre o resto.
 */
export const FUSO = process.env.FUSO_PADRAO?.trim() || 'America/Sao_Paulo';

/** Hora no fuso do dono. As opcoes sao as do `toLocaleTimeString`, sem o fuso. */
export function horaDoDono(
    d: Date,
    opcoes: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
): string {
    return d.toLocaleTimeString('pt-BR', { ...opcoes, timeZone: FUSO });
}