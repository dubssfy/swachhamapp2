import { body } from 'express-validator';

const PAYMENT_METHODS = ['CASH_ON_DELIVERY', 'ONLINE', 'WALLET'] as const;

const createOrderValidation = [
  body('address_id')
    .trim()
    .notEmpty()
    .withMessage('Address is required')
    .isUUID()
    .withMessage('address_id must be a valid UUID'),

  body('pickup_date')
    .notEmpty()
    .withMessage('Pickup date is required')
    .isISO8601()
    .withMessage('pickup_date must be a valid ISO 8601 date')
    .custom((value: string) => {
      const date = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) {
        throw new Error('Pickup date cannot be in the past');
      }
      return true;
    }),

  body('pickup_time_slot')
    .notEmpty()
    .withMessage('Pickup time slot is required')
    .isObject()
    .withMessage('pickup_time_slot must be an object'),

  body('pickup_time_slot.start')
    .notEmpty()
    .withMessage('Pickup time slot start is required')
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .withMessage('pickup_time_slot.start must be in HH:MM format'),

  body('pickup_time_slot.end')
    .notEmpty()
    .withMessage('Pickup time slot end is required')
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .withMessage('pickup_time_slot.end must be in HH:MM format')
    .custom((value: string, { req }) => {
      if (value <= req.body.pickup_time_slot?.start) {
        throw new Error('Pickup time slot end must be after start');
      }
      return true;
    }),

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
