import { Router, Request, Response, NextFunction } from 'express';
import { createOrder, getOrders, getOrderById, cancelOrder, getOrderTracking } from '../services/order.service';
import { sendSuccess } from '../utils/response';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requireServiceArea } from '../middleware/serviceArea';
import { getSlotsForDate, slotStartMinutes } from '../services/pickupSlot.service';
import { quoteForAddress, quoteForPoint } from '../services/deliveryFee.service';

const router = Router();
router.use(authenticate);

// Same gate as the business flow: coordinates decide, not a claimed district.
router.post('/', requireServiceArea, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // The number is taken from the SESSION -- whatever the body says about
    // `placed_by_mobile` is ignored, so an order cannot be stamped with a
    // number the caller did not prove by OTP.
    /*
     * The coordinates come from the body `requireServiceArea` has already
     * validated, and are passed on as the FALLBACK the delivery charge is
     * measured from when the chosen address has none of its own.
     */
    const order = await createOrder(authReq.user!.id, req.body, authReq.user!.mobile);
    sendSuccess(res, order, 'Order created successfully', 201);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/time-slots?date=YYYY-MM-DD
 *
 * The pickup slots a CUSTOMER can book, and whether each is still open on
 * that day.
 *
 * The same list the business flow uses, from `pickupSlot.service` -- there is
 * ONE working day, not one per audience, and a second copy of these hours
 * would drift from the first. The business route for it sits behind
 * `authorize('BUSINESS')`, which is why a customer needs its own way in
 * rather than calling that one.
 *
 * DECLARED BEFORE '/:id'. Express matches in registration order, so below it
 * this path would be read as an order whose id is "time-slots".
 */
router.get('/time-slots', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slots = await getSlotsForDate(req.query.date);
    sendSuccess(
      res,
      slots.map((slot) => ({
        id: slot.id,
        label: slot.label,
        /* The SQL TIME values the order is booked with. The app sends these
           straight back, so the slot it displayed and the slot stored on the
           pickup are the same thing rather than two parsings of a label. */
        start: slot.start,
        end: slot.end,
        // Minutes since midnight, so the app can apply the same cutoff
        // between polls without re-fetching.
        start_minutes: slotStartMinutes(slot),
        available: slot.available,
      })),
      'Time slots fetched successfully'
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/delivery-quote?address_id=&latitude=&longitude=
 *
 * What delivery will cost to a given pickup point, BEFORE the order exists.
 *
 * Checkout has to state the total the customer is agreeing to, and it cannot
 * do that without this: the charge depends on how far the address is from the
 * collecting branch, which only the server can work out.
 *
 * `address_id` is preferred and is scoped to the caller. The coordinates are
 * the fallback for an address saved before the app captured them.
 *
 * IT IS ONLY A QUOTE. The order recomputes the charge from the address it is
 * actually placed for, so a stale or tampered quote cannot change the bill.
 *
 * DECLARED BEFORE '/:id', or it is read as an order with that id.
 */
router.get('/delivery-quote', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const addressId = req.query.address_id;
    const fallback = { latitude: Number(req.query.latitude), longitude: Number(req.query.longitude) };

    const quote = addressId
      ? await quoteForAddress(authReq.user!.id, addressId, fallback)
      : await quoteForPoint(fallback.latitude, fallback.longitude);

    sendSuccess(res, quote, 'Delivery quote fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const orders = await getOrders(authReq.user!.id, req.query.status as string, page, limit);
    sendSuccess(res, orders, 'Orders fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const order = await getOrderById(authReq.user!.id, req.params.id);
    sendSuccess(res, order, 'Order fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id/tracking', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tracking = await getOrderTracking(req.params.id);
    sendSuccess(res, tracking, 'Tracking info fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const order = await cancelOrder(authReq.user!.id, req.params.id, req.body.reason);
    sendSuccess(res, order, 'Order cancelled successfully');
  } catch (error) {
    next(error);
  }
});

export default router;
