/**
 * O banco e' um arquivo ou um servidor: no arquivo esta' a loja, na maquina dela; no
 * servidor esta' a nuvem. Importa `paths` de proposito -- e' ele que le o `.env`, e sem
 * isso o `DATABASE_URL` chegaria vazio num import precoce.
 */
import '../services/paths';

export const ehBancoArquivo = (process.env.DATABASE_URL ?? '').startsWith('file:');