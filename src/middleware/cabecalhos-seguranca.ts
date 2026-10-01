import type { Request, Response, NextFunction } from 'express';

/*
 * `unsafe-inline` em `script-src` e' deliberado: sao 24 `<script>` e 93 `onclick=`
 * inline, e `nonce` nao serve -- atributo de evento nao o aceita. Valem aqui o
 * `frame-ancestors` (clickjacking), o `object-src 'none'` e o `base-uri 'self'`.
 */

const FONTES_ESTILO = 'https://cdnjs.cloudflare.com https://fonts.googleapis.com';
const FONTES_ARQUIVO = 'https://fonts.gstatic.com';

export function cabecalhosDeSeguranca(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline' ${FONTES_ESTILO}`,
            `style-src 'self' 'unsafe-inline' ${FONTES_ESTILO}`,
            `font-src 'self' ${FONTES_ARQUIVO} ${FONTES_ESTILO}`,
            // `data:` para as fotos de produto em base64; `blob:` para o canvas do upload.
            "img-src 'self' data: blob:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ].join('; ')
    );

    // Clickjacking. `frame-ancestors` acima é o que vale nos navegadores atuais;
    // este é o fallback para o que ainda não o implementa.
    res.setHeader('X-Frame-Options', 'DENY');

    // Sem isto o navegador pode adivinhar que um `.json` ou um upload é texto e
    // executar conteúdo que o servidor devolveu como dado.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    /*
     * A URL do painel não tem segredo — é `?tab=` e `?aba=`. Mas o painel é
     * embedado em contexto de cliente (Electron) e a tela de entrada chega por link
     * de e-mail; sem isto, a origem completa do painel acompanha a navegação para fora.
     */
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
}