import { query } from '../config/database';
import { logger } from './logger';

async function generateOrderNumber(): Promise<string> {
  try {
    const result = await query<{ generate_order_number: string }>(
      'SELECT generate_order_number() AS generate_order_number'
    );
    const orderNumber = result.rows[0]?.generate_order_number;
    if (!orderNumber) {
      throw new Error('Failed to generate order number: empty result from database function');
    }
    logger.debug(`[OrderNumber] Generated order number: ${orderNumber}`);
    return orderNumber;
  } catch (error) {
    logger.error('[OrderNumber] Error generating order number:', error);
    throw error;
  }
}

export { generateOrderNumber };
