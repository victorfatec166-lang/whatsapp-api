/*
 * Ponte entre auth.ts e assinaturas.ts, que se importam. Importar direto forma
 * ciclo, e o auth.ts sai com derivaSenha indefinida -- erro que so aparece no
 * boot. Este e' o unico arquivo que ele importa.
 */
import { apagaSenhaDoDono as apaga } from './assinaturas';

/** Apaga a senha de loja quando o dono troca. O dono ja trocou: a provisoria saiu. */
export async function apagaSenhaDoDono(tenantId: string): Promise<void> {
    await apaga(tenantId);
}