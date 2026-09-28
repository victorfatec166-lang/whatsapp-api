import { escapeHtml } from '../html';

/**
 * Layout de janela pop-up, guardado em dados para ser reaproveitado.
 *
 * Por que um modulo so: ja existem varios pop-ups no projeto (menu do dia,
 * cadastro de produto, modificadores) e cada um reescreve o mesmo esqueleto --
 * fundo, painel, cabecalho com titulo e fechar, corpo, rodape com acoes. Isso
 * faz cada janela nascer um pouco diferente da outra, e para adicionar uma
 * nova e preciso copiar e remexer.
 *
 * Aqui o esqueleto e' gerado a partir de um `ModalSpec`. Uma janela nova vira
 * so uma declaracao de dados, e passa a seguir o mesmo visual sem tocar em
 * CSS. Os nomes de regiao sao fixos para que o JavaScript possa se ligar a
 * eles uma unica vez, para sempre:
 *
 *   #<id>            a janela inteira (fundo + painel)
 *   #<id>-body       a parte rolavel, onde vao os campos
 *   #<id>-submit     o botao de confirmar
 *   [data-modal-cancel]  qualquer botao que fecha a janela
 *
 * O comportamento (abrir, fechar com Esc, enviar) esta em views/layout.ts, e
 * `after` e' o gancho: o nome de uma funcao global chamada com (resposta, id)
 * depois do envio. E' ali que a janela decide o que fazer, para nao ter que
 * duplicar o envio. As janelas nunca mostram dinheiro: quem ve valor e' o
 * administrador, na aba Faturamento, que exige senha.
 */
export type ModalField = {
    name: string;
    label: string;
    /** 'money' so marca o prefixo visual; o valor nao e mascarado. */
    type?: 'text' | 'number' | 'textarea' | 'money';
    placeholder?: string;
    hint?: string;
    step?: string;
    min?: string;
    maxlength?: number;
    /** Foca este campo ao abrir. Use so um por janela. */
    autofocus?: boolean;
    required?: boolean;
    /** Valor inicial, so para campo oculto. */
    value?: string;
    /**
     * Campo que viaja no envio mas nao aparece.
     *
     * Serve para o valor que depende de como a janela foi aberta, e nao do
     * que a pessoa digitou: Sangria e Deposito usam a mesma janela, entao o
     * "saida" ou "entrada" precisa entrar no corpo sem campo visivel.
     */
    hidden?: boolean;
};

export type ModalSpec = {
    id: string;
    title: string;
    description?: string;
    /** Icone do cabecalho. */
    icon?: string;
    /**
     * Campos do formulario.
     *
     * Opcional quando a janela traz bodyHtml: nesse caso os campos sao
     * ignorados, e a ausencia deles e' o que impede o compilador de exigir um
     * formulario que nao existe.
     */
    fields?: ModalField[];
    submitLabel: string;
    submitIcon?: string;
    /** 'danger' destaca a acao que encerra um ciclo (fechar caixa). */
    tone?: 'primary' | 'danger';
    /** Texto do aviso de sucesso, depois do envio. */
    successMessage: string;
    /** Rota chamada com os campos em JSON. */
    endpoint: string;
    /** Texto do botao enquanto a rota responde. */
    pendingLabel?: string;
    /** Funcao global chamada com (resposta, spec) apos o envio. */
    after?: string;
    /**
     * Corpo pronto, no lugar dos campos.
     *
     * Serve para janela que nao e' formulario -- a comanda da cozinha e'
     * somente leitura, e inventar um campo desabilitado so para carregar um
     * <pre> seria pior que falar o que a janela quer. Com isso, o esqueleto
     * continua vindo do componente e so o miolo troca.
     *
     * Quando vem preenchido, `fields` e' ignorado e nao ha envio: a janela
     * cuida do botao por conta propria.
     */
    bodyHtml?: string;
    /** Quando true, o formulario nao e' enviado, e o botao vira acao do window. */
    noSubmit?: boolean;
    /** Funcao global chamada pelo botao, so quando noSubmit esta ligado. */
    onSubmit?: string;
};

/**
 * Gera um campo.
 *
 * `janelaId` entra no id do input, e isso nao e cosmetico. Duas janelas na
 * mesma tela usam os mesmos nomes de campo -- Sangria e Deposito pedem
 * "amount" e "note" -- e id repetido no DOM e' HTML invalido: o `for` do label
 * aponta para o input errado e qualquer getElementById devolve a primeira
 * ocorrencia da pagina, nao a da janela que esta aberta. O `name` continua
 * igual, porque e' ele que o envio le, e o envio percorre o formulario da
 * janela, que ja e' o escopo certo.
 */
function field(f: ModalField, janelaId: string): string {
    const campoId = janelaId + '-' + f.name;
    // Campo oculto entra no envio sem existir visualmente, e sem o wrapper de
    // label+input que o resto dos campos usa.
    if (f.hidden) {
        return `                <input type="hidden" name="${escapeHtml(f.name)}" value="${escapeHtml(f.value ?? '')}" id="${escapeHtml(campoId)}">`;
    }

    const req = f.required ? ' required' : '';
    const auto = f.autofocus ? ' autofocus' : '';

    if (f.type === 'textarea') {
        return `                <div>
                    <label class="label" for="${campoId}">${escapeHtml(f.label)}</label>
                    <textarea id="${campoId}" name="${f.name}" rows="3"${f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ''}${f.maxlength ? ` maxlength="${f.maxlength}"` : ''} class="input"></textarea>
                    ${f.hint ? `<p class="text-caption text-ink-3 mt-1">${escapeHtml(f.hint)}</p>` : ''}
                </div>`;
    }

    const ehNumero = f.type === 'number' || f.type === 'money';
    // "money" e' number com prefixo: evita digitar letra e evita o "R$ R$".
    const type = ehNumero ? 'number' : 'text';
    const step = f.step ?? (ehNumero ? '0.01' : undefined);
    const min = f.min ?? (ehNumero ? '0' : undefined);
    const inputmode = ehNumero ? ' inputmode="decimal"' : '';

    return `                <div>
                    <label class="label" for="${campoId}">${escapeHtml(f.label)}${
        f.required ? ' <span class="text-accent-red">*</span>' : ''
    }</label>
                    <div class="flex items-center gap-2">
                        ${
                            f.type === 'money'
                                ? '<span class="text-body text-ink-3 shrink-0" aria-hidden="true">R$</span>'
                                : ''
                        }
                        <input id="${campoId}" name="${f.name}" type="${type}"${step ? ` step="${step}"` : ''}${
        min ? ` min="${min}"` : ''
    }${inputmode}${f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ''}${
        f.maxlength ? ` maxlength="${f.maxlength}"` : ''
    }${auto}${req} class="input">
                    </div>
                    ${f.hint ? `<p class="text-caption text-ink-3 mt-1">${escapeHtml(f.hint)}</p>` : ''}
                </div>`;
}

/** Gera a janela a partir da declaracao. */
export function renderModal(spec: ModalSpec): string {
    const corpo = spec.bodyHtml ?? spec.fields.map((f) => field(f, spec.id)).join('\n');

    return `        <div id="${spec.id}" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="${spec.id}-title">
            <div class="modal-panel">
                <div class="flex items-start justify-between gap-3 mb-1">
                    <h3 id="${spec.id}-title" class="text-title flex items-center gap-2">
                        ${spec.icon ? `<i class="fa-solid ${spec.icon} text-accent"></i>` : ''}${escapeHtml(spec.title)}
                    </h3>
                    <button type="button" data-modal-cancel onclick="${spec.id}Close()" class="btn btn-ghost px-2 -mt-1 -mr-1 shrink-0" aria-label="Fechar">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                ${
                    spec.description
                        ? `<p class="text-caption text-ink-3 mb-4">${escapeHtml(spec.description)}</p>`
                        : ''
                }
                <form id="${spec.id}-form" onsubmit="return ${spec.id}Send(event)">
                    <div id="${spec.id}-body" class="space-y-3">
${corpo}
                    </div>
                    <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
                        <button type="button" data-modal-cancel onclick="${spec.id}Close()" class="btn btn-ghost sm:min-w-[6rem]">
                            ${spec.noSubmit ? 'Fechar' : 'Cancelar'}
                        </button>
                        <button type="${
                            // Janela sem envio usa botao normal: sem ele, o
                            // formulario tentaria submeter e recarregaria a pagina.
                            spec.noSubmit ? 'button' : 'submit'
                        }"
                                id="${spec.id}-submit"
                                onclick="${spec.noSubmit ? spec.onSubmit ?? '' : ''}"
                                class="btn ${spec.tone === 'danger' ? 'btn-danger' : 'btn-primary'} sm:min-w-[9rem]">
                            <i class="fa-solid ${spec.submitIcon ?? 'fa-check'}"></i> ${escapeHtml(spec.submitLabel)}
                        </button>
                    </div>
                </form>
            </div>
        </div>`;
}

/**
 * Comportamento padrao das janelas: fica em views/layout.ts, junto de postJSON
 * e flash, de onde vem o que o envio usa. Nao e' injetado aqui de proposito --
 * a pagina nao deve poder injetar esse script antes (ou depois) do seu, senao a
 * ordem entre os dois <script> passa a decidir se o botao funciona.
 */
