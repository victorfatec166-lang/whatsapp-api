import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Exporta o sock do WhatsApp para enviar mensagens pelo Dashboard
export let whatsappSocket: any = null;
export function setWhatsappSocket(sock: any) {
  whatsappSocket = sock;
}

// Listar todos os pedidos
router.get('/orders', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        customer: true,
        items: { include: { product: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar pedidos' });
  }
});

// Atualizar status do pedido (Kanban) + Notificar cliente via WhatsApp
router.patch('/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const order = await prisma.order.update({
      where: { id },
      data: { status },
      include: { customer: true }
    });

    // Envia notificação automática no WhatsApp conforme o novo status
    if (whatsappSocket && order.customer?.phone) {
      const phone = order.customer.phone;
      if (status === 'PREPARING') {
        await whatsappSocket.sendMessage(phone, {
          text: `👨‍🍳 *Seu pedido #${order.id.slice(-4)} já está em preparo na cozinha!*`
        });
      } else if (status === 'READY') {
        const msg = order.deliveryType === 'PICKUP'
          ? `🛍️ *Seu pedido #${order.id.slice(-4)} está pronto para retirada no balcão!*`
          : `🛵 *Seu pedido #${order.id.slice(-4)} ficou pronto e saiu para entrega!*`;
        await whatsappSocket.sendMessage(phone, { text: msg });
      } else if (status === 'DELIVERED') {
        await whatsappSocket.sendMessage(phone, {
          text: `🎉 *Pedido #${order.id.slice(-4)} entregue/concluído! Muito obrigado pela preferência e bom apetite!* 🍱`
        });
      }
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar status do pedido' });
  }
});

// Listar produtos
router.get('/products', async (req, res) => {
  try {
    const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

// Cadastrar produto
router.post('/products', async (req, res) => {
  const { name, description, price } = req.body;
  try {
    const product = await prisma.product.create({
      data: {
        name,
        description,
        price: parseFloat(price)
      }
    });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar produto' });
  }
});

// Pausar / Ativar produto
router.patch('/products/:id', async (req, res) => {
  const { id } = req.params;
  const { isAvailable } = req.body;
  try {
    const product = await prisma.product.update({
      where: { id },
      data: { isAvailable }
    });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
});

// Buscar/Salvar configurações de entrega (Endereço e Chave do Google)
router.get('/config', async (req, res) => {
  try {
    let config = await prisma.config.findUnique({ where: { id: 'default' } });
    if (!config) {
      config = await prisma.config.create({ data: { id: 'default' } });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

router.post('/config', async (req, res) => {
  const { originAddress, feePerKm, baseFee, googleApiKey } = req.body;
  try {
    const config = await prisma.config.upsert({
      where: { id: 'default' },
      update: {
        originAddress,
        feePerKm: parseFloat(feePerKm),
        baseFee: parseFloat(baseFee),
        googleApiKey
      },
      create: {
        id: 'default',
        originAddress,
        feePerKm: parseFloat(feePerKm),
        baseFee: parseFloat(baseFee),
        googleApiKey
      }
    });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

export default router;