import { body } from 'express-validator';

const PAYMENT_METHODS = ['CASH_ON_DELIVERY', 'ONLINE', 'WALLET'] as const;

/*
 * NOT MOUNTED ON ANY ROUTE, and deliberately left that way.
 *
 * `POST /api/orders` validates inside `order.service.createOrder`, where the
 * cart, the price list and the business clock are all available — none of
 * which express-validator can see. This list is kept because the remaining
 * rules are worth stating, and is corrected here rather than left describing
 * a contract that no longer exists: wiring a stale validator onto the route
 * would reject every valid booking the app sends.
 *
 * WHAT CHANGED, AND WHY:
 *
 *   address_id       no longer required, and never a UUID — ids in this
 *                    schema are BIGINT. An order may instead carry
 *                    `manual_address`, and `resolveOrderAddress` is what
 *                    enforces "exactly one of the two".
 *
 *   pickup_*         no longer required at all. The customer does not choose
 *                    a collection; a Manager assigns it on approval. See
 *                    `pickupSlot.provisionalPickup`.
 */
const createOrderValidation = [
  body('address_id')
    .optional()
    .trim()
    .matches(/^\d+$/)
    .withMessage('address_id must be an order address id'),

  body('manual_address')
    .optional()
    .isObject()
    .withMessage('manual_address must be an object'),

  body('payment_method')
    .notEmpty()
    .withMessage('Payment method is required')
    .isIn(PAYMENT_METHODS)
    .withMessage(`Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),

  body('coupon_code')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Coupon code must be between 1 and 50 characters')
    .toUpperCase(),
];

const cancelOrderValidation = [
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Cancellation reason cannot exceed 500 characters'),
];

export { createOrderValidation, cancelOrderValidation };
