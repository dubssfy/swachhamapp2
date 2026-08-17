import { Router, Request, Response, NextFunction } from 'express';
import { getCart, addItem, updateItem, removeItem, clearCart } from '../services/cart.service';
import { sendSuccess } from '../utils/response';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const cart = await getCart(authReq.user!.id);
    sendSuccess(res, cart, 'Cart fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { serviceId, quantity } = req.body;
    const cart = await addItem(authReq.user!.id, serviceId, quantity);
    sendSuccess(res, cart, 'Item added to cart');
  } catch (error) {
    next(error);
  }
});

router.put('/items/:serviceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { quantity } = req.body;
    const cart = await updateItem(authReq.user!.id, req.params.serviceId, quantity);
    sendSuccess(res, cart, 'Item updated');
  } catch (error) {
    next(error);
  }
});

router.delete('/items/:serviceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const cart = await removeItem(authReq.user!.id, req.params.serviceId);
    sendSuccess(res, cart, 'Item removed');
  } catch (error) {
    next(error);
  }
});

router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await clearCart(authReq.user!.id);
    sendSuccess(res, null, 'Cart cleared');
  } catch (error) {
    next(error);
  }
});

export default router;
