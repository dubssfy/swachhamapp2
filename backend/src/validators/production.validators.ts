import { body } from 'express-validator';

const PRODUCTION_STATUSES = [
  'RECEIVED',
  'SORTING',
  'WASHING',
  'DRYING',
  'IRONING',
  'FOLDING',
  'QUALITY_CHECK',
  'PACKED',
  'READY_FOR_DELIVERY',
] as const;

const updateProductionStatusValidation = [
  body('status')
    .trim()
    .notEmpty()
    .withMessage('Status is required')
    .isIn(PRODUCTION_STATUSES)
    .withMessage(`Status must be one of: ${PRODUCTION_STATUSES.join(', ')}`),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),
];

export { updateProductionStatusValidation, PRODUCTION_STATUSES };
