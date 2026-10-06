/*
 * Pagina de privacidade (art. 9 da LGPD): papel do restaurante como controlador,
 * DeliveryAdmin como operador, Groq como terceiro e retencao na virada do dia.
 */

import { tileDaMarca } from './marca';

export function renderPrivacidade(): string {
    return `<!DOCTYPE html>
<html lang="pt-BR" class="h-full">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Privacidade e Proteção de Dados · DeliveryAdmin</title>
    <link rel="stylesheet" href="/styles/tailwind.css">
    <link rel="icon" href="/favicon.ico">
</head>
<body class="min-h-full bg-[#0e1116] text-[#e6edf3] font-sans antialiased p-4 sm:p-8">
    <main class="max-w-2xl mx-auto space-y-8">
        <header class="flex items-center gap-3 border-b border-[#30363d] pb-6">
            ${tileDaMarca(40)}
            <div>
                <h1 class="text-xl font-bold tracking-tight">Privacidade e Proteção de Dados</h1>
                <p class="text-xs text-[#8b949e]">Como tratamos os dados no DeliveryAdmin (LGPD · Lei 13.709/2018)</p>
            </div>
        </header>

        <section class="space-y-4 text-sm leading-relaxed text-[#c9d1d9]">
            <div>
                <h2 class="text-base font-semibold text-white mb-1">1. Quem é quem</h2>
                <p>
                    <strong class="text-white">O Restaurante (sua loja):</strong> é o <em class="text-white">Controlador</em> dos dados dos seus clientes (nome, telefone, endereço, pedidos). É quem decide usar o sistema para atender.
                </p>
                <p class="mt-2">
                    <strong class="text-white">O DeliveryAdmin:</strong> é o <em class="text-white">Operador</em> da plataforma de software, processando os dados exclusivamente para permitir o atendimento e a gestão de pedidos.
                </p>
            </div>

            <div>
                <h2 class="text-base font-semibold text-white mb-1">2. Quais dados são coletados e por quê</h2>
                <ul class="list-disc pl-5 space-y-1.5 mt-2">
                    <li><strong class="text-white">Telefone e nome:</strong> para identificar a conversa no WhatsApp e entregar o pedido certo à pessoa certa (execução de contrato / atendimento ao pedido).</li>
                    <li><strong class="text-white">Endereço de entrega:</strong> quando informado pelo cliente, para envio do pedido pelo motoboy.</li>
                    <li><strong class="text-white">Itens e valores do pedido:</strong> para emissão de comanda e controle financeiro do restaurante.</li>
                </ul>
            </div>

            <div>
                <h2 class="text-base font-semibold text-white mb-1">3. Retenção e exclusão (virada do dia)</h2>
                <p>
                    Para reduzir a exposição de dados, o DeliveryAdmin aplica <strong class="text-white">retenção automática diária</strong>:
                </p>
                <ul class="list-disc pl-5 space-y-1 mt-2">
                    <li>O histórico das conversas do bot é <strong class="text-white">apagado todas as noites à meia-noite</strong>.</li>
                    <li>O registro do <em>Pedido</em> (itens, valor e telefone para contato) é preservado para cumprimento de obrigações fiscais e contábeis do restaurante.</li>
                </ul>
            </div>

            <div>
                <h2 class="text-base font-semibold text-white mb-1">4. Inteligência Artificial e transferência internacional</h2>
                <p>
                    Quando a IA conversacional está <strong class="text-white">ativada pelo restaurante</strong>, o texto digitado pelo cliente é enviado para processamento de linguagem natural no provedor Groq Inc. (servidores nos Estados Unidos).
                </p>
                <p class="mt-2 text-xs text-[#8b949e]">
                    Essa transferência ocorre apenas para interpretação do pedido e resposta imediata. Nenhum dado de cartão de crédito é enviado ou solicitado pela IA. O restaurante pode desativar a IA a qualquer momento na aba WhatsApp do painel.
                </p>
            </div>

            <div>
                <h2 class="text-base font-semibold text-white mb-1">5. Seus direitos como titular</h2>
                <p>
                    O titular dos dados (cliente final) pode solicitar a qualquer momento ao restaurante a confirmação de tratamento, correção de dados incompletos ou exclusão do seu cadastro, pelos canais de contato da loja.
                </p>
            </div>
        </section>

        <footer class="pt-6 border-t border-[#30363d] flex items-center justify-between text-xs text-[#8b949e]">
            <span>DeliveryAdmin SaaS · 2026</span>
            <a href="/entrar" class="text-[#58a6ff] hover:underline">Voltar ao painel</a>
        </footer>
    </main>
</body>
</html>`;
}