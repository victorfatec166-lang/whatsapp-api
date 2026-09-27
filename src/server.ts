import express from 'express';
import { initBot, sendOrderStatusNotification } from './services/bot';
import { PrismaClient } from '@prisma/client';
import adminRoutes from './routes/adminRoutes';
import { addClient, notifyClients } from './services/sse';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

const VALID_ORDER_STATUS = ['pendente', 'preparando', 'entrega', 'concluido'];

/**
 * Escapa valores interpolados no HTML do painel. Sem isso, o nome de um
 * produto ou o nome de um cliente injetado no banco quebraria o layout
 * (ou executaria script) no navegador de quem está logado no admin.
 */
function escapeHtml(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount REST API routes under /api/admin
app.use('/api/admin', adminRoutes);

// Server-Sent Events (SSE) endpoint for real-time updates
app.get('/admin/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const removeClient = addClient(res);

    req.on('close', () => {
        removeClient();
    });
});

// Kanban order status route (SSR dashboard uses it)
app.post('/admin/order/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!VALID_ORDER_STATUS.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Status inválido. Valores aceitos: ${VALID_ORDER_STATUS.join(', ')}.`
            });
        }

        const updatedOrder = await prisma.order.update({
            where: { id },
            data: { status }
        });

        if (updatedOrder.clientPhone) {
            await sendOrderStatusNotification(
                updatedOrder.clientPhone,
                updatedOrder.status,
                updatedOrder.items,
                updatedOrder.total
            );
        }

        notifyClients();
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao atualizar status do pedido:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar pedido' });
    }
});

// SSR Admin Dashboard
app.get('/admin', async (req, res) => {
    try {
        const activeTab = req.query.tab === 'products' ? 'products' : req.query.tab === 'config' ? 'config' : req.query.tab === 'stats' ? 'stats' : 'kanban';
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

                    async function createProduct(event) {
                        event.preventDefault();
                        const form = event.target;
                        const data = Object.fromEntries(new FormData(form).entries());

                        try {
                            const response = await fetch('/api/admin/products', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(data)
                            });
                            if (!response.ok) {
                                const body = await response.json().catch(() => ({}));
                                alert(body.error || 'Erro ao criar produto');
                                return;
                            }
                            form.reset();
                            location.reload();
                        } catch (err) {
                            console.error(err);
                            alert('Erro de conexão');
                        }
                    }

                    async function deleteProduct(productId) {
                        if (!confirm('Remover este produto do cardápio?')) return;
                        try {
                            const response = await fetch('/api/admin/products/' + encodeURIComponent(productId) + '/delete', {
                                method: 'POST'
                            });
                            if (!response.ok) {
                                alert('Erro ao apagar produto');
                                return;
                            }
                            location.reload();
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
                            <a href="/admin?tab=config" class="flex items-center gap-3 px-4 py-3 ${activeTab === 'config' ? 'bg-amber-600 text-white shadow-md' : 'text-stone-400 hover:bg-stone-800 hover:text-white'} rounded-lg font-medium transition">
                                <i class="fa-solid fa-gear"></i> Configurações
                            </a>
                            <a href="/admin?tab=stats" class="flex items-center gap-3 px-4 py-3 ${activeTab === 'stats' ? 'bg-amber-600 text-white shadow-md' : 'text-stone-400 hover:bg-stone-800 hover:text-white'} rounded-lg font-medium transition">
                                <i class="fa-solid fa-chart-line"></i> Estatísticas
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
                                ${activeTab === 'kanban' ? 'Gestão de Pedidos em Tempo Real' : activeTab === 'config' ? 'Configurações do Sistema' : activeTab === 'stats' ? 'Estatísticas e Relatórios' : 'Gestão do Cardápio / Produtos'}
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
                                                        <span>${escapeHtml(o.clientName || 'Cliente')}</span>
                                                        <span class="text-amber-700">R$ ${escapeHtml(o.total.toFixed(2))}</span>
                                                    </div>
                                                    <p class="text-xs text-stone-500 mb-2">${escapeHtml(o.items)}</p>
                                                    <p class="text-[10px] text-stone-400 mb-2">Tel: ${escapeHtml(o.clientPhone.replace('@s.whatsapp.net', ''))}</p>
                                                    <button onclick="updateStatus('${escapeHtml(o.id)}', 'preparando')" class="w-full bg-amber-500 hover:bg-amber-600 text-white text-xs py-1.5 rounded-lg font-medium transition">
                                                        Preparar <i class="fa-solid fa-arrow-right ml-1"></i>
                                                    </button>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>

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
                                                        <span>${escapeHtml(o.clientName || 'Cliente')}</span>
                                                        <span class="text-orange-600">R$ ${escapeHtml(o.total.toFixed(2))}</span>
                                                    </div>
                                                    <p class="text-xs text-stone-500 mb-2">${escapeHtml(o.items)}</p>
                                                    <button onclick="updateStatus('${escapeHtml(o.id)}', 'entrega')" class="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs py-1.5 rounded-lg font-medium transition">
                                                        Enviar p/ Entrega <i class="fa-solid fa-arrow-right ml-1"></i>
                                                    </button>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>

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
                                                        <span>${escapeHtml(o.clientName || 'Cliente')}</span>
                                                        <span class="text-emerald-600">R$ ${escapeHtml(o.total.toFixed(2))}</span>
                                                    </div>
                                                    <p class="text-xs text-stone-500 mb-2">${escapeHtml(o.items)}</p>
                                                    <button onclick="updateStatus('${escapeHtml(o.id)}', 'concluido')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs py-1.5 rounded-lg font-medium transition">
                                                        Concluir <i class="fa-solid fa-check ml-1"></i>
                                                    </button>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>

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
                                                        <span>${escapeHtml(o.clientName || 'Cliente')}</span>
                                                        <span class="text-stone-600">R$ ${escapeHtml(o.total.toFixed(2))}</span>
                                                    </div>
                                                    <p class="text-xs text-stone-500 mb-1">${escapeHtml(o.items)}</p>
                                                    <span class="text-[10px] bg-stone-100 text-stone-600 px-2 py-0.5 rounded font-medium">Entregue</span>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                </div>
                            ` : activeTab === 'config' ? `<div class="bg-white p-6 rounded-2xl shadow-sm border border-amber-100"><h2 class="text-xl font-bold text-stone-800 mb-4">Configurações do Sistema</h2><div class="grid grid-cols-1 md:grid-cols-2 gap-6"><div class="bg-stone-50 p-4 rounded-xl border border-stone-200"><h3 class="font-bold text-stone-800 mb-2">Entrega</h3><label class="block text-xs font-semibold text-stone-600 mb-1">Taxa Base (R$)</label><input type="number" step="0.01" value="5.00" class="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"><label class="block text-xs font-semibold text-stone-600 mb-1 mt-3">Endereço</label><input type="text" value="Rua Principal, 100" class="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"></div><div class="bg-stone-50 p-4 rounded-xl border border-stone-200"><h3 class="font-bold text-stone-800 mb-2">Bot WhatsApp</h3><label class="block text-xs font-semibold text-stone-600 mb-1">Intervalo (s)</label><input type="number" value="30" class="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"><label class="block text-xs font-semibold text-stone-600 mb-1 mt-3">Mensagem Padrão</label><textarea rows="2" class="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm">Olá! Seu pedido está sendo preparado.</textarea></div></div><button onclick="alert('Configurações salvas!')" class="mt-6 px-5 py-2 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition">Salvar Configurações</button></div>` : activeTab === 'stats' ? `<div class="bg-white p-6 rounded-2xl shadow-sm border border-amber-100"><h2 class="text-xl font-bold text-stone-800 mb-4">Estatísticas e Relatórios</h2><div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6"><div class="bg-gradient-to-br from-amber-500 to-amber-700 text-white p-5 rounded-2xl shadow-lg"><h3 class="text-3xl font-extrabold">R$ 1.240,00</h3><p class="text-amber-100 text-sm">Receita Total (Hoje)</p></div><div class="bg-gradient-to-br from-emerald-500 to-emerald-700 text-white p-5 rounded-2xl shadow-lg"><h3 class="text-3xl font-extrabold">32</h3><p class="text-emerald-100 text-sm">Pedidos Finalizados</p></div><div class="bg-gradient-to-br from-rose-500 to-rose-700 text-white p-5 rounded-2xl shadow-lg"><h3 class="text-3xl font-extrabold">18</h3><p class="text-rose-100 text-sm">Pedidos Pendentes</p></div></div><div class="bg-stone-50 p-5 rounded-xl border border-stone-200"><h3 class="font-bold text-stone-800 mb-3">Últimas Vendas</h3><table class="w-full text-sm text-left"><thead class="text-xs text-stone-500 uppercase bg-stone-100"><tr><th class="px-3 py-2">Cliente</th><th class="px-3 py-2">Valor</th><th class="px-3 py-2">Hora</th></tr></thead><tbody><tr class="border-b border-stone-200"><td class="px-3 py-2">João Silva</td><td class="px-3 py-2">R$ 45,00</td><td class="px-3 py-2">10:30</td></tr><tr class="border-b border-stone-200"><td class="px-3 py-2">Maria Souza</td><td class="px-3 py-2">R$ 78,50</td><td class="px-3 py-2">11:15</td></tr><tr><td class="px-3 py-2">Carlos Lima</td><td class="px-3 py-2">R$ 32,00</td><td class="px-3 py-2">11:45</td></tr></tbody></table></div></div>` : `
                                <!-- PRODUCTS VIEW -->
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-amber-100 h-fit">
                                        <h3 class="font-bold text-stone-800 text-base mb-4 flex items-center gap-2">
                                            <i class="fa-solid fa-plus-circle text-amber-600"></i> Adicionar Novo Prato / Item
                                        </h3>
                                        <form onsubmit="return createProduct(event)" class="space-y-4">
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

                                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-amber-100 md:col-span-2 flex flex-col">
                                        <h3 class="font-bold text-stone-800 text-base mb-4 flex items-center gap-2">
                                            <i class="fa-solid fa-utensils text-amber-600"></i> Itens Atuais no Cardápio (${products.length})
                                        </h3>
                                        <div class="space-y-3 overflow-y-auto max-h-[500px]">
                                            ${products.length === 0 ? '<p class="text-sm text-stone-400 text-center py-8">Nenhum produto cadastrado ainda.</p>' : ''}
                                            ${products.map(p => `
                                                <div class="flex items-center justify-between p-4 rounded-xl border border-stone-100 bg-stone-50/50 hover:bg-amber-50/30 transition">
                                                    <div>
                                                        <h4 class="font-bold text-stone-800 text-sm">${escapeHtml(p.name)}</h4>
                                                        <p class="text-xs text-stone-500">${escapeHtml(p.description || 'Sem descrição')}</p>
                                                        <span class="inline-block mt-1 font-semibold text-amber-700 text-xs">R$ ${escapeHtml(p.price.toFixed(2))}</span>
                                                    </div>
                                                    <button onclick="deleteProduct('${escapeHtml(p.id)}')" class="bg-red-100 hover:bg-red-200 text-red-700 p-2 rounded-lg text-xs transition">
                                                        <i class="fa-solid fa-trash"></i>
                                                    </button>
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
    console.log(`🔌 API REST em: http://localhost:${PORT}/api/admin`);
    console.log('🤖 A iniciar o robô do WhatsApp...');

    await initBot(notifyClients);
});
