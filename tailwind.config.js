/**
 * Tokens do design system.
 *
 * As cores apontam para variaveis CSS definidas em src/styles/app.css, e nao
 * para hex fixo. Assim o tema claro/escuro e um unico par de Custom
 * Properties, sem duplicar configuracao aqui.
 *
 * Os nomes de cor reproduzem os nomes de classe que ja eram usados nas views
 * (surface, line, ink, badge-*, accent-*) de proposito: o piloto precisa
 * trocar os VALORES sem quebrar o markup das telas que ainda nao foram
 * migradas (pdv, tabs, inventory, pairing).
 */
const token = (name) => `var(--${name})`;

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/**/*.ts'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                page: token('bg'),
                surface: {
                    DEFAULT: token('surface'),
                    2: token('surface-2'),
                },
                sunken: token('sunken'),
                line: {
                    DEFAULT: token('border'),
                    in: token('border-input'),
                },
                ink: {
                    DEFAULT: token('text-1'),
                    2: token('text-2'),
                    3: token('text-3'),
                },
                rail: {
                    DEFAULT: token('nav'),
                    ink: token('nav-ink'),
                    line: token('border'),
                },
                accent: {
                    DEFAULT: token('accent'),
                    strong: token('accent-strong'),
                    emerald: token('success'),
                    orange: token('warning'),
                    red: token('danger'),
                    info: token('info'),
                },
                chip: {
                    DEFAULT: token('chip-bg'),
                    ink: token('chip-ink'),
                },
                'badge-amber': { bg: token('warn-bg'), ink: token('warn-ink') },
                'badge-emerald': { bg: token('success-bg'), ink: token('success-ink') },
                'badge-orange': { bg: token('warning-bg'), ink: token('warning-ink') },
                'badge-red': { bg: token('danger-bg'), ink: token('danger-ink') },
                'badge-slate': { bg: token('neutral-bg'), ink: token('neutral-ink') },
            },

            fontFamily: {
                sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
            },

            fontSize: {
                display: ['1.875rem', { lineHeight: '2.25rem', fontWeight: '700' }],
                title: ['1.125rem', { lineHeight: '1.5rem', fontWeight: '650' }],
                body: ['0.875rem', { lineHeight: '1.3125rem' }],
                small: ['0.8125rem', { lineHeight: '1.125rem' }],
                caption: ['0.75rem', { lineHeight: '1rem' }],
                micro: ['0.6875rem', { lineHeight: '0.875rem', letterSpacing: '0.04em' }],
            },

            borderRadius: {
                card: '10px',
                control: '6px',
            },

            boxShadow: {
                e1: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                e2: '0 4px 12px -2px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
                e3: '0 12px 32px -8px rgb(0 0 0 / 0.16), 0 4px 8px -4px rgb(0 0 0 / 0.06)',
            },

            transitionDuration: {
                DEFAULT: '140ms',
            },
            transitionTimingFunction: {
                DEFAULT: 'cubic-bezier(0.2, 0, 0.2, 1)',
            },

            maxWidth: {
                content: '88rem',
            },
        },
    },
    plugins: [],
};
