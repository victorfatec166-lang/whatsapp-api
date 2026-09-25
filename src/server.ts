import express from 'express';
import { initBot, sendWhatsAppMessage } from './services/bot';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sseClients: any[] = [];

// Rota de Server-Sent Events (SSE) para tempo real
app.get('/admin/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);

    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
    });
});

// Função para notificar todos os navegadores abertos no painel
function notifyClients() {
    sseClients.forEach(client => {
        client.write('data: update\n\n');
    });
}

// Rota para atualizar o status do pedido via painel Kanban
app.post('/admin/order/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const updatedOrder = await prisma.order.update({
            where: { id },
            data: { status }
        });

        if (updatedOrder.clientPhone) {
            if (status === 'preparando') {
                const message = 
                    `🔥 *O seu pedido foi confirmado e foi para a cozinha!* 👨‍🍳\n\n` +
                    `A nossa equipa já começou a preparar o seu pedido:\n` +
                    `• *Item:* ${updatedOrder.items}\n` +
                    `• *Total:* R$ ${updatedOrder.total.toFixed(2)}\n\n` +
                    `Em breve teremos novidades! ⏱️`;
                
                await sendWhatsAppMessage(updatedOrder.clientPhone, message);
            }
            else if (status === 'entrega') {
                const message = 
                    `🛵 *O seu pedido saiu para entrega!* 📦\n\n` +
                    `Fique atento, o entregador está a caminho do seu endereço com o seu pedido:\n` +
                    `• *Item:* ${updatedOrder.items}\n` +
                    `• *Total:* R$ ${updatedOrder.total.toFixed(2)}\n\n` +
                    `Bom apetite! 😋`;

                await sendWhatsAppMessage(updatedOrder.clientPhone, message);
            }
            else if (status === 'concluido') {
                const message = 
                    `✅ *Pedido Entregue / Concluído!* 🎉\n\n` +
                    `Esperamos que goste da sua refeição! Muito obrigado pela preferência. Volte sempre! 🍔❤️`;

                await sendWhatsAppMessage(updatedOrder.clientPhone, message);
            }
        }

        notifyClients();
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao atualizar status do pedido:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar pedido' });
    }
});

// Rota para criar produto
app.post('/admin/products', async (req, res) => {
    try {
        const { name, price, description } = req.body;
        await prisma.product.create({
            data: {
                name,
                price: parseFloat(price),
                description: description || ''
            }
        });
        notifyClients();
        res.redirect('/admin?tab=products');
    } catch (error) {
        console.error('Erro ao criar produto:', error);
        res.status(500).send('Erro ao criar produto');
    }
});

// Rota para apagar produto
app.post('/admin/products/:id/delete', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.product.delete({ where: { id } });
        notifyClients();
        res.redirect('/admin?tab=products');
    } catch (error) {
        console.error('Erro ao apagar produto:', error);
        res.status(500).send('Erro ao apagar produto');
    }
});

// Rota Principal / Admin
app.get('/admin', async (req, res) => {
    try {
        const activeTab = req.query.tab === 'products' ? 'products' : 'kanban';
        const products = await prisma.product.findMany();
        const orders = await prisma.order.findMany({
            orderBy: { createdAt: 'desc' }
        });

        const pendentes = orders.filter(o => o.status === 'pendente');
        const preparando = orders.filter(o => o.status === 'preparando');
        const entrega = orders.filter(o => o.status === 'entrega');
        const concluido = orders.filter(o => o.status === 'concluido');

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Painel Administrativo - WhatsApp Delivery</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <script>
                    // Conexão em tempo real via Server-Sent Events (SSE)
                    const evtSource = new EventSource('/admin/events');
                    evtSource.onmessage = function(event) {
                        if (event.data === 'update') {
                            location.reload();
                        }
                    };

                    async function updateStatus(orderId, newStatus) {
                        try {
                            const response = await fetch('/admin/order/' + orderId + '/status', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: newStatus })
                            });
                            if (!response.ok) {
                                alert('Erro ao atualizar pedido');
                            }
                        } catch (err) {
                            console.error(err);
                            alert('Erro de conexão');
                        }
                    }
                </script>
            </head>
            <body class="bg-amber-50/40 font-sans text-gray-900">
                <div class="flex h-screen overflow-hidden">
                    <!-- Sidebar -->
                    <aside class="w-64 bg-stone-900 text-white flex flex-col hidden md:flex">
                        <div class="p-6 text-2xl font-bold tracking-wider flex items-center gap-3 border-b border-stone-800">
                            <i class="fa-solid fa-burger text-amber-500"></i> DeliveryAdmin
                        </div>
                        <nav class="flex-1 p-4 space-y-2">
                            <a href="/admin?tab=kanban" class="flex items-center gap-3 px-4 py-3 ${activeTab === 'kanban' ? 'bg-amber-600 text-white shadow-md' : 'text-stone-400 hover:bg-stone-800 hover:text-white'} rounded-lg font-medium transition">
                                <i class="fa-solid fa-chart-pie"></i> Pedidos Kanban
                            </a>
                            <a href="/admin?tab=products" class="flex items-center gap-3 px-4 py-3 ${activeTab === 'products' ? 'bg-amber-600 text-white shadow-md' : 'text-stone-400 hover:bg-stone-800 hover:text-white'} rounded-lg font-medium transition">
                                <i class="fa-solid fa-utensils"></i> Produtos (${products.length})
                            </a>
                        </nav>
                        <div class="p-4 border-t border-stone-800 text-xs text-stone-500 text-center">
                            WhatsApp Bot v1.0.0
                        </div>
                    </aside>

                    <!-- Main Content -->
                    <main class="flex-1 flex flex-col overflow-y-auto">
                        <header class="bg-white shadow-sm h-16 flex items-center justify-between px-8 border-b border-amber-100">
                            <h1 class="text-xl font-bold text-stone-800">
                                ${activeTab === 'kanban' ? 'Gestão de Pedidos em Tempo Real' : 'Gestão do Cardápio / Produtos'}
                            </h1>
                            <div class="flex items-center gap-3">
                                <span class="flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-sm font-semibold border border-amber-200">
                                    <span class="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></span> Tempo Real Ativo
                                </span>
                                <button onclick="location.reload()" class="bg-amber-100 hover:bg-amber-200 text-amber-900 px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-2">
                                    <i class="fa-solid fa-rotate"></i> Atualizar
                                </button>
                            </div>
                        </header>

                        <!-- Content Area -->
                        <div class="p-8 max-w-7xl mx-auto w-full flex-1 flex flex-col">
                            ${activeTab === 'kanban' ? `
                                <!-- KANBAN VIEW -->
                                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1">
                                    <!-- Pendentes -->
                                    <div class="bg-white/80 p-4 rounded-2xl shadow-sm border border-amber-100 flex flex-col">
                                        <div class="flex items-center justify-between pb-3 border-b border-amber-100 mb-3">
                                            <h3 class="font-bold text-stone-700 text-sm flex items-center gap-2">
                                                <i class="fa-solid fa-clock text-amber-500"></i> Pendentes
                                            </h3>
                                            <span class="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-bold">${pendentes.length}</span>
                                        </div>
                                        <div class="space-y-3 flex-1 overflow-y-auto">
                                            ${pendentes.length === 0 ? '<p class="text-xs text-stone-400 text-center py-4">Nenhum pedido</p>' : ''}
                                            ${pendentes.map(o => `
                                                <div class="bg-white p-3 rounded-xl border border-amber-200 shadow-sm">
                                                    <div class="flex justify-between font-semibold text-stone-800 text-sm mb-1">
                                                        <span>${o.clientName || 'Cliente'}</span>
                                                        <span class="text-amber-700">R$ ${o.total.toFixed(2)}</span>
                                                    </div>
                                                    <p class="text-xs text-stone-500 mb-2">${o.items}</p>
                                                    <p class="text-[10px] text-stone-400 mb-2">Tel: ${o.clientPhone.replace('@s.whatsapp.net', '')}</p>
                                                    <button onclick="updateStatus('${o.id}', 'preparando')" class="w-full bg-amber-500 hover:bg-amber-600 text-white text-xs py-1.5 rounded-lg font-medium transition">
                                                        Preparar <i class="fa-solid fa-arrow-right ml-1"></i>
                                                    </button>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>

                                    <!-- Preparando -->
                                    <div class="bg-white/80 p-4 rounded-2xl shadow-sm border border-amber-100 flex flex-col">
                                        <div class="flex items-center justify-between pb-3 border-b border-amber-100 mb-3">
                                            <h3 class="font-bold text-stone-700 text-sm flex items-center gap-2">
                                                <i class="fa-solid fa-fire-burner text-orange-500"></i> Na Cozinha
                                            </h3>
                                            <span class="bg-orange-100 text-orange-800 text-xs px-2 py-0.5 rounded-full font-bold">${preparando.length}</span>
                                        </div>
                                        <div class="space-y-3 flex-1 overflow-y-auto">
                                            ${preparando.length === 0 ? '<p class="text-xs text-stone-400 text-center py-4">Nenhum pedido</p>' : ''}
                                            ${preparando.map(o => `
                                                <div class="bg-white p-3 rounded-xl border border-orange-200 shadow-sm">
                                                    <div class="flex justify-between font-semibold text-stone-800 text-sm mb-1">
                                                        <span>${o.clientName || 'Cliente'}</span>
                                                        <span class="text-orange-600">R$ ${o.total.toFixed(2)}</span>
                                                    </div>
                                                    <p class="text-xs text-stone-500 mb-2">${o.items}</p>
                                                    <button onclick="updateStatus('${o.id}', 'entrega')" class="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs py-1.5 rounded-lg font-medium transition">
                                                        Enviar p/ Entrega <i class="fa-solid fa-arrow-right ml-1"></i>
                                                    </button>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>

                                    <!-- Em Entrega -->
                                    <div class="bg-white/80 p-4 rounded-2xl shadow-sm border border-amber-100 flex flex-col">
                                        <div class="flex items-center justify-between pb-3 border-b border-amber-100 mb-3">
                                            <h3 class="font-bold text-stone-700 text-sm flex items-center gap-2">
                                                <i class="fa-solid fa-motorcycle text-emerald-500"></i> Em Entrega
                                            </h3>
                                            <span class="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full font-bold">${entrega.length}</span>
                                        </div>
                                        <div class="space-y-3 flex-1 overflow-y-auto">
                                            ${entrega.length === 0 ? '<p class="text-xs text-stone-400 text-center py-4">Nenhum pedido</p>' : ''}
                                            ${entrega.map(o => `
                                                <div class="bg-white p-3 rounded-xl border border-emerald-200 shadow-sm">
                                                    <div class="flex justify-between font-semibold text-stone-800 text-sm mb-1">
                                                        <span>${o.clientName || 'Cliente'}</span>
                                                        <span class="text-emerald-600">R$ ${o.total.toFixed(2)}</span>
                                                    </div>
                                                    <p class="text-xs text-stone-500 mb-2">${o.items}</p>
                                                    <button onclick="updateStatus('${o.id}', 'concluido')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs py-1.5 rounded-lg font-medium transition">
                                                        Concluir <i class="fa-solid fa-check ml-1"></i>
                                                    </button>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>

                                    <!-- Concluídos -->
                                    <div class="bg-white/80 p-4 rounded-2xl shadow-sm border border-amber-100 flex flex-col">
                                        <div class="flex items-center justify-between pb-3 border-b border-amber-100 mb-3">
                                            <h3 class="font-bold text-stone-700 text-sm flex items-center gap-2">
                                                <i class="fa-solid fa-circle-check text-stone-500"></i> Concluídos
                                            </h3>
                                            <span class="bg-stone-200 text-stone-800 text-xs px-2 py-0.5 rounded-full font-bold">${concluido.length}</span>
                                        </div>
                                        <div class="space-y-3 flex-1 overflow-y-auto">
                                            ${concluido.length === 0 ? '<p class="text-xs text-stone-400 text-center py-4">Nenhum pedido</p>' : ''}
                                            ${concluido.map(o => `
                                                <div class="bg-white p-3 rounded-xl border border-stone-200 shadow-sm opacity-75">
                                                    <div class="flex justify-between font-semibold text-stone-800 text-sm mb-1">
                                                        <span>${o.clientName || 'Cliente'}</span>
                                                        <span class="text-stone-600">R$ ${o.total.toFixed(2)}</span>
                                                    </div>
                                                    <p class="text-xs text-stone-500 mb-1">${o.items}</p>
                                                    <span class="text-[10px] bg-stone-100 text-stone-600 px-2 py-0.5 rounded font-medium">Entregue</span>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                </div>
                            ` : `
                                <!-- PRODUCTS VIEW -->
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    <!-- Formulário para Criar Produto -->
                                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-amber-100 h-fit">
                                        <h3 class="font-bold text-stone-800 text-base mb-4 flex items-center gap-2">
                                            <i class="fa-solid fa-plus-circle text-amber-600"></i> Adicionar Novo Prato / Item
                                        </h3>
                                        <form action="/admin/products" method="POST" class="space-y-4">
                                            <div>
                                                <label class="block text-xs font-semibold text-stone-600 mb-1">Nome do Produto</label>
                                                <input type="text" name="name" required placeholder="Ex: X-Burguer Especial" class="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
                                            </div>
                                            <div>
                                                <label class="block text-xs font-semibold text-stone-600 mb-1">Preço (R$)</label>
                                                <input type="number" step="0.01" name="price" required placeholder="Ex: 29.90" class="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
                                            </div>
                                            <div>
                                                <label class="block text-xs font-semibold text-stone-600 mb-1">Descrição (Opcional)</label>
                                                <textarea name="description" rows="3" placeholder="Ingredientes, detalhes..." class="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"></textarea>
                                            </div>
                                            <button type="submit" class="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm py-2.5 rounded-lg font-medium transition shadow-sm">
                                                Salvar no Cardápio
                                            </button>
                                        </form>
                                    </div>

                                    <!-- Lista de Produtos Existentes -->
                                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-amber-100 md:col-span-2 flex flex-col">
                                        <h3 class="font-bold text-stone-800 text-base mb-4 flex items-center gap-2">
                                            <i class="fa-solid fa-utensils text-amber-600"></i> Itens Atuais no Cardápio (${products.length})
                                        </h3>
                                        <div class="space-y-3 overflow-y-auto max-h-[500px]">
                                            ${products.length === 0 ? '<p class="text-sm text-stone-400 text-center py-8">Nenhum produto cadastrado ainda.</p>' : ''}
                                            ${products.map(p => `
                                                <div class="flex items-center justify-between p-4 rounded-xl border border-stone-100 bg-stone-50/50 hover:bg-amber-50/30 transition">
                                                    <div>
                                                        <h4 class="font-bold text-stone-800 text-sm">${p.name}</h4>
                                                        <p class="text-xs text-stone-500">${p.description || 'Sem descrição'}</p>
                                                        <span class="inline-block mt-1 font-semibold text-amber-700 text-xs">R$ ${p.price.toFixed(2)}</span>
                                                    </div>
                                                    <form action="/admin/products/${p.id}/delete" method="POST" onsubmit="return confirm('Tem certeza que deseja apagar este produto?')">
                                                        <button type="submit" class="bg-red-100 hover:bg-red-200 text-red-700 p-2 rounded-lg text-xs transition">
                                                            <i class="fa-solid fa-trash"></i>
                                                        </button>
                                                    </form>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                </div>
                            `}
                        </div>
                    </main>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Erro ao carregar painel administrativo:', error);
        res.status(500).send('Erro interno ao carregar o painel.');
    }
});

app.listen(PORT, async () => {
    console.log(`🚀 Servidor HTTP rodando na porta ${PORT}`);
    console.log(`🌐 Dashboard disponível em: http://localhost:${PORT}/admin`);
    console.log('🤖 A iniciar o robô do WhatsApp...');
    
    // Passamos a função notifyClients para o bot. Assim, sempre que um cliente 
    // pedir algo no WhatsApp, o painel web atualiza na hora!
    await initBot(notifyClients);
});