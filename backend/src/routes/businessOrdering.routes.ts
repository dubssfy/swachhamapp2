import { Router, Request, Response, NextFunction } from 'express';
import {
  getCategories,
  getItemsByCategory,
  searchItems,
  getServiceCategory,
  getServiceTypes,
} from '../services/businessCatalog.service';
import {
  getCart,
  addItem,
  setCartContext,
  setCartService,
  updateItemQuantity,
  removeItem,
  clearCart,
} from '../services/businessCart.service';
import { getNearbyStores } from '../services/store.service';
import {
  createOrder,
  getOrders,
  getOrderById,
  getOrderTracking,
  repeatOrder,
  cancelOrder,
} from '../services/businessOrder.service';
import { getProfile, updateProfile } from '../services/businessProfile.service';
import { sendSuccess } from '../utils/response';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(authorize('BUSINESS'));

// ---- Business profile ----

router.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const profile = await getProfile(authReq.user!.id);
    sendSuccess(res, profile, 'Profile fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.put('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const profile = await updateProfile(authReq.user!.id, req.body);
    sendSuccess(res, profile, 'Profile updated successfully');
  } catch (error) {
    next(error);
  }
});

// ---- Laundry service structure ----

router.get('/services', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [category, serviceTypes] = await Promise.all([getServiceCategory(), getServiceTypes()]);
    sendSuccess(res, { category, serviceTypes }, 'Laundry services fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await getCategories();
    sendSuccess(res, categories, 'Categories fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/categories/:categoryId/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await getItemsByCategory(
      req.params.categoryId,
      req.query.serviceType as string | undefined
    );
    sendSuccess(res, items, 'Items fetched successfully');
  } catch (error) {
    next(error);
  }
});

// `serviceType` filters the catalogue to items that support that service.
// Leaving it off is the "All" case and returns the whole catalogue.
router.get('/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await searchItems({
      search: req.query.search as string | undefined,
      categoryId: req.query.categoryId as string | undefined,
      serviceType: req.query.serviceType as string | undefined,
    });
    sendSuccess(res, items, 'Items fetched successfully');
  } catch (error) {
    next(error);
  }
});

// ---- Store locator ----

router.get('/stores/nearby', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stores = await getNearbyStores({
      latitude: req.query.latitude,
      longitude: req.query.longitude,
      radiusKm: req.query.radiusKm,
    });
    sendSuccess(res, stores, 'Nearby stores fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/cart', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const cart = await getCart(authReq.user!.id);
    sendSuccess(res, cart, 'Cart fetched successfully');
  } catch (error) {
    next(error);
  }
});

// Order Type + Laundry Type, chosen together on one page before the catalogue.
router.put('/cart/context', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { laundryType, orderType } = req.body;
    const cart = await setCartContext(authReq.user!.id, laundryType, orderType);
    sendSuccess(res, cart, 'Cart updated');
  } catch (error) {
    next(error);
  }
});

// Service is selected in the Cart, before the order can be confirmed.
router.put('/cart/service', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const cart = await setCartService(authReq.user!.id, req.body?.serviceType);
    sendSuccess(res, cart, 'Service selected');
  } catch (error) {
    next(error);
  }
});

router.post('/cart/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // `serviceType` is the cart-level context; `itemServiceType` is the
    // service this one line is added for.
    const { itemId, quantity, laundryType, orderType, serviceType, itemServiceType } = req.body;
    const cart = await addItem(
      authReq.user!.id,
      itemId,
      Number(quantity),
      laundryType,
      orderType,
      serviceType,
      itemServiceType
    );
    sendSuccess(res, cart, 'Item added to cart');
  } catch (error) {
    next(error);
  }
});

// Updates a cart line: quantity, its service, or both.
router.put('/cart/items/:itemId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { quantity, itemServiceType } = req.body;
    const cart = await updateItemQuantity(
      authReq.user!.id,
      req.params.itemId,
      quantity === undefined ? undefined : Number(quantity),
      itemServiceType
    );
    sendSuccess(res, cart, 'Cart item updated');
  } catch (error) {
    next(error);
  }
});

router.delete('/cart/items/:itemId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const cart = await removeItem(authReq.user!.id, req.params.itemId);
    sendSuccess(res, cart, 'Cart item removed');
  } catch (error) {
    next(error);
  }
});

router.delete('/cart', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await clearCart(authReq.user!.id);
    sendSuccess(res, null, 'Cart cleared');
  } catch (error) {
    next(error);
  }
});

router.get('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const orders = await getOrders(authReq.user!.id);
    sendSuccess(res, orders, 'Orders fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:orderId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const order = await getOrderById(authReq.user!.id, req.params.orderId);
    sendSuccess(res, order, 'Order fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:orderId/tracking', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tracking = await getOrderTracking(authReq.user!.id, req.params.orderId);
    sendSuccess(res, tracking, 'Tracking fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:orderId/repeat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await repeatOrder(authReq.user!.id, req.params.orderId);
    sendSuccess(res, result, 'Items added to your cart');
  } catch (error) {
    next(error);
  }
});

router.patch('/orders/:orderId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await cancelOrder(authReq.user!.id, req.params.orderId, req.body?.reason);
    sendSuccess(res, result, 'Order cancelled successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const order = await createOrder(authReq.user!.id);
    sendSuccess(res, order, 'Order placed successfully', 201);
  } catch (error) {
    next(error);
  }
});

export default router;
