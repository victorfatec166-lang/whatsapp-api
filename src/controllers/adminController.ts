import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { sendOrderStatusNotification } from '../services/bot';

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
      const { name, description, price, isAvailable } = req.body;

      if (!name || price === undefined) {
        return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
      }

      const product = await prisma.product.create({
        data: {
          name,
          description: description || '',
          price: parseFloat(price),
          isAvailable: isAvailable ?? true
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
      const { name, description, price, isAvailable } = req.body;

      const product = await prisma.product.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(price !== undefined && { price: parseFloat(price) }),
          ...(isAvailable !== undefined && { isAvailable })
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
        orderBy: { createdAt: 'desc' },
        include: {
          customer: true,
          items: {
            include: { product: true }
          }
        }
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
        data: { status },
        include: { customer: true }
      });

      if (order.customer && order.customer.phone) {
        sendOrderStatusNotification(order.customer.phone, order.id, order.status);
      }

      return res.json(order);
    } catch (error) {
      console.error('Erro ao atualizar status do pedido:', error);
      return res.status(400).json({ error: 'Erro ao atualizar status do pedido' });
    }
  },

  // --- GESTÃO DE CONFIGURAÇÕES ---
  async getConfig(req: Request, res: Response) {
    try {
      let config = await prisma.config.findUnique({ where: { id: 'default' } });
      if (!config) {
        config = await prisma.config.create({
          data: {
            id: 'default',
            originAddress: 'Rua Principal, 100 - Mogi Mirim, SP',
            feePerKm: 2.50,
            baseFee: 3.00,
            googleApiKey: ''
          }
        });
      }
      return res.json(config);
    } catch (error) {
      console.error('Erro ao buscar configurações:', error);
      return res.status(500).json({ error: 'Erro ao buscar configurações' });
    }
  },

  async saveConfig(req: Request, res: Response) {
    try {
      const { originAddress, baseFee, feePerKm, googleApiKey } = req.body;

      const config = await prisma.config.upsert({
        where: { id: 'default' },
        update: {
          ...(originAddress !== undefined && { originAddress }),
          ...(baseFee !== undefined && { baseFee: parseFloat(baseFee) }),
          ...(feePerKm !== undefined && { feePerKm: parseFloat(feePerKm) }),
          ...(googleApiKey !== undefined && { googleApiKey })
        },
        create: {
          id: 'default',
          originAddress: originAddress || 'Rua Principal, 100 - Mogi Mirim, SP',
          baseFee: baseFee ? parseFloat(baseFee) : 3.00,
          feePerKm: feePerKm ? parseFloat(feePerKm) : 2.50,
          googleApiKey: googleApiKey || ''
        }
      });

      return res.json(config);
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      return res.status(400).json({ error: 'Erro ao salvar configurações' });
    }
  }
};