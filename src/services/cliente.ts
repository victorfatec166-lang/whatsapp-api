import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/*
 * O cliente de desktop nao vive na nuvem: o build do Render free (512 MB) morre com os
 * 367 MB do Electron, e o que ele montasse ainda morreria no deploy seguinte. O
 * instalador e' publicado como release do repositorio e a rota redireciona para ca.
 */

const RAIZ = resolve(__dirname, '..', '..');

/** Onde o `electron-builder` deixa o instalador, que e' build de `npm run cliente:instalador`. */
export const INSTALADOR_CLIENTE = join(RAIZ, 'release-cliente', 'DeliveryAdmin-Setup.exe');

/** O que o navegador recebe: o mesmo nome do arquivo na release, sem versao dentro. */
export const NOME_DO_PACOTE = 'DeliveryAdmin-Setup.exe';

/**
 * Endereco de onde o pacote pode ser baixado, ou `null` se `CLIENTE_DOWNLOAD_URL=off`.
 *
 * Release SEM o nome do arquivo e' a pagina da release (que abre no navegador), e o
 * `.env` da maquina apontava assim: o `/download/<arquivo>` e' completado aqui.
 */
export function urlDoPacote(): string | null {
    const configurado = process.env.CLIENTE_DOWNLOAD_URL?.trim();
    if (configurado === 'off') return null;
    const url =
        configurado ||
        'https://github.com/victorfatec166-lang/whatsapp-api/releases/latest/download/DeliveryAdmin-Setup.exe';
    return /\/releases\/(latest|tag\/[^/]+)$/.test(url) ? `${url}/download/${NOME_DO_PACOTE}` : url;
}

/**
 * O instalador em disco, ou `null` -- estado normal de quem developing sem ter gerado.
 *
 * Nao ha montagem na hora: o `electron-builder` baixa binarios proprios e leva minutos,
 * coisa para acontecer dentro de um pedido HTTP.
 */
export function instaladorDoCliente(): string | null {
    return existsSync(INSTALADOR_CLIENTE) ? INSTALADOR_CLIENTE : null;
}

/** Tamanho em bytes, para o `Content-Length`: sem ele o navegador mostra barra de progresso em branco. */
export function tamanhoDoInstalador(): number | null {
    const caminho = instaladorDoCliente();
    return caminho ? statSync(caminho).size : null;
}