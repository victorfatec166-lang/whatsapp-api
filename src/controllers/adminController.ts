import { Request, Response } from 'express';
import { prisma } from '../database/prisma';

export const adminController = {
  // --- GESTÃO DE PRODUTOS ---
  async getProducts(req: Request, res: Response) {
    try {
      const products = await prisma.product.findMany({
        orderBy: { createdAt: 'desc' }
      });
      return res.json(products);
    } catch (error) {
      console.error('Erro ao buscar produtos:', error);
      return res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
  },

  async createProduct(req: Request, res: Response) {
    try {
      const { name, description, price } = req.body; // isAvailable ignorado (não no schema)

      // Validate price before parsing to prevent NaN
      if (price === undefined || price === '' || isNaN(parseFloat(price))) {
        return res.status(400).json({ error: 'Preço inválido ou ausente.' });
      }

      if (!name) {
        return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
      }

      const product = await prisma.product.create({
        data: {
          name,
          description: description || '',
          price: parseFloat(price)
        }
      });

      return res.status(201).json(product);
    } catch (error) {
      console.error('Erro ao criar produto:', error);
      return res.status(400).json({ error: 'Erro ao criar produto' });
    }
  },

  async updateProduct(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { name, description, price } = req.body; // isAvailable ignorado

      // Validate price before parsing to prevent NaN
      if (price !== undefined && price !== '' && isNaN(parseFloat(price))) {
        return res.status(400).json({ error: 'Preço inválido ou ausente.' });
      }

      const product = await prisma.product.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(price !== undefined && { price: parseFloat(price) })
        }
      });

      return res.json(product);
    } catch (error) {
      console.error('Erro ao atualizar produto:', error);
      return res.status(400).json({ error: 'Erro ao atualizar produto' });
    }
  },

  // --- GESTÃO DE PEDIDOS ---
  async getOrders(req: Request, res: Response) {
    try {
      const orders = await prisma.order.findMany({
        orderBy: { createdAt: 'desc' }
      });
      return res.json(orders);
    } catch (error) {
      console.error('Erro ao buscar pedidos:', error);
      return res.status(500).json({ error: 'Erro ao buscar pedidos' });
    }
  },

  async updateOrderStatus(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'O novo status é obrigatório.' });
      }

      const order = await prisma.order.update({
        where: { id },
        data: { status }
      });

      // Notify web clients via SSE if connected phone exists
      if (order.clientPhone) {
        console.log(`Order ${order.id} status updated to ${status} - notifyClients would be triggered`);
      }

      return res.json(order);
    } catch (error) {
      console.error('Erro ao atualizar status do pedido:', error);
      return res.status(400).json({ error: 'Erro ao atualizar status do pedido' });
    }
  },

  // --- GESTÃO DE CONFIGURAÇÕES ---
  async getConfig(req: Request, res: Response) {
    return res.status(501).json({ error: 'Configurações desativadas (modelo Config não existe)' });
  },

  async saveConfig(req: Request, res: Response) {
    return res.status(501).json({ error: 'Configurações desativadas (modelo Config não existe)' });
  }
};