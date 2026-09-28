import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { logDoModulo } from '../services/logger';
const log = logDoModulo('adminController');

export const adminController = {
  // --- GESTÃO DE PRODUTOS ---
  async getProducts(req: Request, res: Response) {
    try {
      const products = await prisma.product.findMany({
        orderBy: { createdAt: 'desc' }
      });
      return res.json(products);
    } catch (error) {
      log.error('Erro ao buscar produtos:', error);
      return res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
  },

  async createProduct(req: Request, res: Response) {
    try {
      const { name, description, price, category, isAvailable, trackStock, stock, minStock, costPrice } = req.body;

      // Validate price before parsing to prevent NaN
      if (price === undefined || price === '' || isNaN(parseFloat(price))) {
        return res.status(400).json({ error: 'Preço inválido ou ausente.' });
      }

      const parsedPrice = parseFloat(price);
      if (parsedPrice < 0) {
        return res.status(400).json({ error: 'Preço não pode ser negativo.' });
      }

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
      }

      const track = trackStock === true || trackStock === 'true';
      const safeInt = (v: unknown) => {
        const n = typeof v === 'number' ? v : parseInt(String(v ?? '0'), 10);
        return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
      };
      const parsedCost = costPrice === undefined || costPrice === '' ? 0 : parseFloat(costPrice);
      const safeCost = Number.isFinite(parsedCost) ? Math.max(0, parsedCost) : 0;
      if (safeCost > parsedPrice) {
        return res.status(400).json({ error: 'Preço de custo não pode ser maior que o de venda.' });
      }

      const product = await prisma.product.create({
        data: {
          name: String(name).trim(),
          description: description ? String(description) : '',
          price: parsedPrice,
          costPrice: safeCost,
          category: category && String(category).trim() ? String(category).trim() : 'Geral',
          isAvailable: isAvailable === undefined ? true : isAvailable === true || isAvailable === 'true',
          trackStock: track,
          stock: track ? safeInt(stock) : 0,
          minStock: track ? safeInt(minStock) : 0
        }
      });

      return res.status(201).json(product);
    } catch (error) {
      log.error('Erro ao criar produto:', error);
      return res.status(400).json({ error: 'Erro ao criar produto' });
    }
  },

  /** Cria uma copia do produto, util para variantes ("X-Burguer" -> "X-Burguer Duplo"). */
  async duplicateProduct(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const source = await prisma.product.findUnique({ where: { id } });
      if (!source) {
        return res.status(404).json({ error: 'Produto não encontrado.' });
      }
      const copy = await prisma.product.create({
        data: {
          name: `${source.name} (cópia)`,
          price: source.price,
          costPrice: source.costPrice,
          description: source.description,
          category: source.category,
          // Cópia começa pausada para ninguém vender sem conferir.
          isAvailable: false,
          trackStock: source.trackStock,
          stock: 0,
          minStock: source.minStock
        }
      });
      return res.status(201).json(copy);
    } catch (error) {
      log.error('Erro ao duplicar produto:', error);
      return res.status(400).json({ error: 'Erro ao duplicar produto' });
    }
  },

  async toggleAvailability(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const current = await prisma.product.findUnique({ where: { id } });
      if (!current) {
        return res.status(404).json({ error: 'Produto não encontrado.' });
      }
      const product = await prisma.product.update({
        where: { id },
        data: { isAvailable: !current.isAvailable }
      });
      return res.json(product);
    } catch (error) {
      log.error('Erro ao alterar disponibilidade:', error);
      return res.status(400).json({ error: 'Erro ao alterar disponibilidade' });
    }
  },

  async updateProduct(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { name, description, price, category, isAvailable, minStock, costPrice, trackStock } = req.body;

      if (price !== undefined && price !== '' && isNaN(parseFloat(price))) {
        return res.status(400).json({ error: 'Preço inválido ou ausente.' });
      }

      const parsedCost = costPrice === undefined || costPrice === '' ? undefined : parseFloat(costPrice);
      if (parsedCost !== undefined && (isNaN(parsedCost) || parsedCost < 0)) {
        return res.status(400).json({ error: 'Preço de custo inválido.' });
      }
      if (parsedCost !== undefined && price !== undefined && parsedCost > parseFloat(price)) {
        return res.status(400).json({ error: 'Preço de custo não pode ser maior que o de venda.' });
      }

      const parsedMin = minStock === undefined || minStock === ''
        ? undefined
        : Math.max(0, Math.round(parseFloat(String(minStock)) || 0));

      const product = await prisma.product.update({
        where: { id },
        data: {
          ...(name && { name: String(name).trim() }),
          ...(description !== undefined && { description: String(description) }),
          ...(price !== undefined && price !== '' && { price: parseFloat(price) }),
          ...(category !== undefined && { category: String(category).trim() || 'Geral' }),
          ...(isAvailable !== undefined && { isAvailable: isAvailable === true || isAvailable === 'true' }),
          ...(parsedMin !== undefined && { minStock: parsedMin }),
          ...(parsedCost !== undefined && { costPrice: parsedCost }),
          ...(trackStock !== undefined && { trackStock: trackStock === true || trackStock === 'true' })
        }
      });

      return res.json(product);
    } catch (error) {
      log.error('Erro ao atualizar produto:', error);
      return res.status(400).json({ error: 'Erro ao atualizar produto' });
    }
  },

  async deleteProduct(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      await prisma.product.delete({ where: { id } });
      return res.json({ success: true });
    } catch (error) {
      log.error("Erro ao deletar produto:", error);
      return res.status(400).json({ error: "Erro ao deletar produto" });
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
      log.error('Erro ao buscar pedidos:', error);
      return res.status(500).json({ error: 'Erro ao buscar pedidos' });
    }
  },

  async updateOrderStatus(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { status } = req.body;

      const allowed = ['pendente', 'preparando', 'entrega', 'concluido'];
      if (!status) {
        return res.status(400).json({ error: 'O novo status é obrigatório.' });
      }
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `Status inválido. Use: ${allowed.join(', ')}.` });
      }

      const order = await prisma.order.update({
        where: { id },
        data: { status }
      });

      return res.json(order);
    } catch (error) {
      log.error('Erro ao atualizar status do pedido:', error);
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