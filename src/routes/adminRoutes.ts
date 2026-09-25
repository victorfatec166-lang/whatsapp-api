import { Router } from 'express';
import { adminController } from '../controllers/adminController';

const router = Router();

// Produtos
router.get('/products', adminController.getProducts);
router.post('/products', adminController.createProduct);
router.patch('/products/:id', adminController.updateProduct);

// Pedidos
router.get('/orders', adminController.getOrders);
router.patch('/orders/:id/status', adminController.updateOrderStatus);

// Configurações
router.get('/config', adminController.getConfig);
router.post('/config', adminController.saveConfig);

export default router;