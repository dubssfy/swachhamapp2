import { body } from 'express-validator';

const addressValidationRules = [
  body('label')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Label must be between 1 and 50 characters'),

  body('line1')
    .trim()
    .notEmpty()
    .withMessage('Address line 1 is required')
    .isLength({ min: 5, max: 200 })
    .withMessage('Address line 1 must be between 5 and 200 characters'),

  body('line2')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Address line 2 cannot exceed 200 characters'),

  body('landmark')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Landmark cannot exceed 100 characters'),

  body('city')
    .trim()
    .notEmpty()
    .withMessage('City is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('City must be between 2 and 100 characters'),

  body('state')
    .trim()
    .notEmpty()
    .withMessage('State is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('State must be between 2 and 100 characters'),

  body('pincode')
    .trim()
    .notEmpty()
    .withMessage('Pincode is required')
    .matches(/^\d{6}$/)
    .withMessage('Pincode must be exactly 6 digits'),
];

const createAddressValidation = addressValidationRules;
const updateAddressValidation = addressValidationRules.map((rule) => rule.optional());

export { createAddressValidation, updateAddressValidation };
