import { body } from 'express-validator';

const addCartItemValidation = [
  body('service_id')
    .trim()
    .notEmpty()
    .withMessage('service_id is required')
    .isUUID()
    .withMessage('service_id must be a valid UUID'),

  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ min: 1, max: 99 })
    .withMessage('Quantity must be an integer between 1 and 99')
    .toInt(),
];

const updateCartItemValidation = [
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ min: 1, max: 99 })
    .withMessage('Quantity must be an integer between 1 and 99')
    .toInt(),
];

const couponValidation = [
  body('code')
    .trim()
    .notEmpty()
    .withMessage('Coupon code is required')
    .isLength({ min: 1, max: 50 })
    .withMessage('Coupon code must be between 1 and 50 characters')
    .toUpperCase(),
];

export { addCartItemValidation, updateCartItemValidation, couponValidation };
