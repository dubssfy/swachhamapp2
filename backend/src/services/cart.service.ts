import { query } from '../config/database';
import { quoteForDefaultAddress, UNKNOWN } from './deliveryFee.service';
import { logger } from '../utils/logger';

/*
 * DELIVERY IS NO LONGER A FLAT FEE.
 *
 * It was `subtotal >= 399 ? 0 : 40` -- a charge that depended on what was in
 * the basket rather than on where it had to go, so a neighbour and someone
 * 40 km away paid the same. It is now free within 10 km of the collecting
 * branch and 7 rupees per kilometre (or part) beyond, from
 * `deliveryFee.service`.
 *
 * The cart quotes against the account's DEFAULT address, which is the one
 * checkout preselects. Choosing a different address there re-quotes, and the
 * order is billed on that -- so this figure is a preview, and the order is
 * the authority.
 */

export interface CartItem {
  id: string;
  cart_id: string;
  /** The ITEM. Named `service_id` because that is the column. */
  service_id: string;
  service_name: string;
  /** The laundry SERVICE chosen for it — Wash & Iron, Dry Clean. */
  laundry_service_id: string | null;
  laundry_service_name: string | null;
  /**
   * The live price for THIS item at THIS service. Null when neither the
   * service nor the item has one configured, which blocks checkout.
   */
  price: number | null;
  unit: string;
  image_url?: string;
  quantity: number;
  item_total: number | null;
}

export interface Cart {
  id: string;
  user_id: string;
  items: CartItem[];
  subtotal: number;
  delivery_charge: number;
  /** Km to the collecting branch. Null when there was nothing to measure. */
  delivery_distance_km: number | null;
  /** False when no address with coordinates was available to quote from. */
  delivery_charge_resolved: boolean;
  delivery_free_up_to_km: number;
  delivery_rate_per_km: number;
  total: number;
}

export interface CouponResult {
  id: string;
  code: string;
  discount_type: 'PERCENTAGE' | 'FIXED';
  discount_value: number;
  discount_amount: number;
  final_total: number;
}

async function getCart(userId: string): Promise<Cart> {
  const cartResult = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM carts WHERE user_id = ?`,
    [userId]
  );

  let cart = cartResult.rows[0];
  if (!cart) {
    /*
     * MySQL has no RETURNING, so the new row's id comes back on the result
     * header instead. `user_id` is what was just inserted, so it is carried
     * across rather than read back.
     */
    const newCart = await query(`INSERT INTO carts (user_id) VALUES (?)`, [userId]);
    cart = { id: String(newCart.insertId), user_id: userId };
  }

  /*
   * THE PRICE IS FOR THIS ITEM AT THIS SERVICE.
   *
   * Exact match first, the item's fallback row (service_id NULL) second —
   * the same precedence `resolveCustomerPrices` applies, expressed here as
   * two ordered sub-queries so a line is priced in the listing without a
   * second round trip.
   *
   * A DIFFERENT service's row is never a candidate: each sub-query pins the
   * service, so Dry Clean's rate cannot price a Wash & Iron line.
   *
   * Never from `ci.price_at_add` (a staging value, so a price change is
   * picked up rather than frozen in the basket) and never from
   * `services.base_price` (legacy placeholders).
   */
  const itemsResult = await query<CartItem>(
    `SELECT ci.id, ci.cart_id, ci.service_id, s.name AS service_name,
            ci.laundry_service_id,
            ls.name AS laundry_service_name,
            COALESCE(
              (SELECT cp.customer_price FROM customer_price_list cp
                WHERE cp.item_id = ci.service_id AND cp.is_active = true
                  AND cp.service_id = ci.laundry_service_id
                LIMIT 1),
              (SELECT cp.customer_price FROM customer_price_list cp
                WHERE cp.item_id = ci.service_id AND cp.is_active = true
                  AND cp.service_id IS NULL
                LIMIT 1)
            ) AS price,
            s.unit, s.image_url, ci.quantity,
            COALESCE(
              (SELECT cp.customer_price FROM customer_price_list cp
                WHERE cp.item_id = ci.service_id AND cp.is_active = true
                  AND cp.service_id = ci.laundry_service_id
                LIMIT 1),
              (SELECT cp.customer_price FROM customer_price_list cp
                WHERE cp.item_id = ci.service_id AND cp.is_active = true
                  AND cp.service_id IS NULL
                LIMIT 1)
            ) * ci.quantity AS item_total
     FROM cart_items ci
     JOIN services s ON s.id = ci.service_id
     LEFT JOIN services ls ON ls.id = ci.laundry_service_id
     WHERE ci.cart_id = ?
     ORDER BY ci.created_at ASC`,
    [cart.id]
  );

  const items = itemsResult.rows;
  /*
   * An unpriced line contributes NOTHING to the subtotal rather than NaN.
   * It cannot be checked out either — the order refuses it — and the screen
   * shows it as "Price not set", so the total on screen stays the total of
   * what can actually be bought.
   */
  const subtotal = items.reduce(
    (sum, item) => sum + (item.item_total === null ? 0 : Number(item.item_total)),
    0
  );
  /*
   * An empty cart is never charged for delivery: there is nothing to deliver,
   * and a basket showing a delivery fee on its own reads as a mistake.
   */
  const quote = subtotal > 0 ? await quoteForDefaultAddress(userId) : UNKNOWN;
  const delivery_charge = quote.charge;
  const total = subtotal + delivery_charge;

  return {
    id: cart.id,
    user_id: cart.user_id,
    items,
    subtotal,
    delivery_charge,
    /*
     * HOW THE FIGURE WAS ARRIVED AT, so the app can say "free under 10 km"
     * or "12.4 km" rather than showing a bare number.
     *
     * `delivery_charge_resolved` is FALSE when there was no address with
     * coordinates to measure from. The charge is 0 in that case, and the app
     * must show "calculated at checkout" rather than "free" -- an order to a
     * far address will be charged, and promising free here would be a lie the
     * order then contradicts.
     */
    delivery_distance_km: quote.distance_km,
    delivery_charge_resolved: quote.resolved,
    delivery_free_up_to_km: quote.free_up_to_km,
    delivery_rate_per_km: quote.rate_per_km,
    total,
  };
}

async function addItem(
  userId: string,
  serviceId: string,
  quantity: number,
  /**
   * The laundry SERVICE chosen for this item — Wash & Iron or Dry Clean.
   *
   * Optional: a catalogue where an item is offered for only one service, or
   * a caller that predates the choice, adds the item without one and is
   * priced from the item's fallback rate.
   */
  laundryServiceId?: string | null
): Promise<Cart> {
  logger.debug(
    `[CartService] Adding item ${serviceId} (qty: ${quantity}, service: ${laundryServiceId ?? 'any'}) for user ${userId}`
  );

  /*
   * THE ITEM MUST HAVE A CUSTOMER PRICE BEFORE IT CAN BE ADDED.
   *
   * `cart_items.price_at_add` is NOT NULL, so there is no such thing as a
   * cart line without a price — and that is the right constraint: an item
   * with no price cannot be ordered either, because `requireCustomerPrices`
   * refuses it at checkout. Catching it here means the customer is told
   * while they are looking at the item, rather than at the end after
   * building a basket that cannot be paid for.
   *
   * The price is read from `customer_price_list`, the one global list —
   * never from `services.base_price`, which holds legacy placeholders, and
   * never from `business_price_list`, which is a different customer's rate.
   */
  const chosenService = laundryServiceId === undefined || laundryServiceId === null
    || String(laundryServiceId) === ''
    ? null
    : String(laundryServiceId);

  /*
   * A named service must be one the ITEM IS ACTUALLY OFFERED FOR.
   * `item_service_types` is the mapping the catalogue and the order both
   * resolve through, so a cart line for a service the item is not offered
   * for could never be priced or fulfilled.
   */
  if (chosenService !== null) {
    const offered = await query<{ id: string }>(
      `SELECT st.id
         FROM services st
         JOIN item_service_types m ON m.service_id = st.id
        WHERE st.id = ? AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
          AND m.item_id = ?`,
      [chosenService, serviceId]
    );
    if (!offered.rows[0]) {
      throw new Error('That service is not available for this item.');
    }
  }

  const serviceResult = await query<{
    id: string; is_active: number; name: string; customer_price: string | null;
  }>(
    `SELECT s.id, s.is_active, s.name,
            COALESCE(
              (SELECT cp.customer_price FROM customer_price_list cp
                WHERE cp.item_id = s.id AND cp.is_active = true
                  AND cp.service_id = ?
                LIMIT 1),
              (SELECT cp.customer_price FROM customer_price_list cp
                WHERE cp.item_id = s.id AND cp.is_active = true
                  AND cp.service_id IS NULL
                LIMIT 1)
            ) AS customer_price
       FROM services s
      WHERE s.id = ?`,
    [chosenService, serviceId]
  );
  const service = serviceResult.rows[0];
  if (!service || !service.is_active) {
    throw new Error('Service not found or unavailable');
  }
  if (service.customer_price === null || service.customer_price === undefined) {
    throw new Error(
      `${service.name} has no price set yet, so it cannot be added to the cart.`
    );
  }
  const priceAtAdd = Number(service.customer_price);

  const cartResult = await query<{ id: string }>(
    `SELECT id FROM carts WHERE user_id = ?`,
    [userId]
  );
  let cartId = cartResult.rows[0]?.id;
  if (!cartId) {
    const newCart = await query(`INSERT INTO carts (user_id) VALUES (?)`, [userId]);
    cartId = String(newCart.insertId);
  }

  /*
   * Adding an item already in the cart ADDS to its quantity rather than
   * replacing it, which is what "add to cart" means. MySQL expresses that as
   * ON DUPLICATE KEY UPDATE against `uk_ci_cart_svc` (cart_id, service_id) —
   * the same guarantee Postgres's ON CONFLICT gave.
   */
  /*
   * `price_at_add` records what the item cost WHEN IT WAS ADDED. It is a
   * staging value and is deliberately not what the cart totals or the order
   * are billed from — both re-read the live price, so a price change between
   * adding and ordering is picked up rather than frozen in the basket.
   */
  /*
   * The unique key is (cart, item, service) since migration 046, so adding
   * Shirt/Dry Clean to a cart holding Shirt/Wash & Iron makes a SECOND line
   * rather than incrementing the first. Adding the SAME pair again still
   * accumulates, which is what "add to cart" means.
   */
  await query(
    `INSERT INTO cart_items (cart_id, service_id, laundry_service_id, quantity, price_at_add)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       quantity = quantity + VALUES(quantity),
       price_at_add = VALUES(price_at_add),
       updated_at = NOW()`,
    [cartId, serviceId, chosenService, quantity, priceAtAdd]
  );

  return getCart(userId);
}

async function updateItem(
  userId: string,
  cartItemId: string,
  quantity: number
): Promise<Cart> {
  const ownerCheck = await query<{ id: string }>(
    `SELECT ci.id FROM cart_items ci
     JOIN carts c ON c.id = ci.cart_id
     WHERE ci.id = ? AND c.user_id = ?`,
    [cartItemId, userId]
  );

  if (ownerCheck.rows.length === 0) {
    throw new Error('Cart item not found or access denied');
  }

  await query(
    `UPDATE cart_items SET quantity = ?, updated_at = NOW() WHERE id = ?`,
    [quantity, cartItemId]
  );

  return getCart(userId);
}

async function removeItem(userId: string, cartItemId: string): Promise<Cart> {
  const ownerCheck = await query<{ id: string }>(
    `SELECT ci.id FROM cart_items ci
     JOIN carts c ON c.id = ci.cart_id
     WHERE ci.id = ? AND c.user_id = ?`,
    [cartItemId, userId]
  );

  if (ownerCheck.rows.length === 0) {
    throw new Error('Cart item not found or access denied');
  }

  await query(`DELETE FROM cart_items WHERE id = ?`, [cartItemId]);

  return getCart(userId);
}

async function clearCart(userId: string): Promise<void> {
  await query(
    `DELETE FROM cart_items
     WHERE cart_id = (SELECT id FROM carts WHERE user_id = ?)`,
    [userId]
  );
  logger.debug(`[CartService] Cart cleared for user ${userId}`);
}

async function validateCoupon(
  code: string,
  subtotal: number
): Promise<CouponResult> {
  const result = await query<{
    id: string;
    code: string;
    discount_type: 'PERCENTAGE' | 'FIXED';
    discount_value: number;
    min_order_amount: number;
    max_discount_amount?: number;
    is_active: boolean;
    valid_from: Date;
    valid_until?: Date;
    usage_limit?: number;
    used_count: number;
  }>(
    `SELECT id, code, discount_type, discount_value, min_order_amount,
            max_discount_amount, is_active, valid_from, valid_until,
            usage_limit, used_count
     FROM coupons
     WHERE code = ?`,
    [code.toUpperCase()]
  );

  const coupon = result.rows[0];
  if (!coupon) {
    throw new Error('Invalid coupon code');
  }
  if (!coupon.is_active) {
    throw new Error('This coupon is no longer active');
  }

  const now = new Date();
  if (coupon.valid_from > now) {
    throw new Error('This coupon is not yet valid');
  }
  if (coupon.valid_until && coupon.valid_until < now) {
    throw new Error('This coupon has expired');
  }
  if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) {
    throw new Error('This coupon has reached its usage limit');
  }
  if (subtotal < Number(coupon.min_order_amount)) {
    throw new Error(
      `Minimum order amount of ₹${coupon.min_order_amount} required for this coupon`
    );
  }

  let discountAmount: number;
  if (coupon.discount_type === 'PERCENTAGE') {
    discountAmount = (subtotal * Number(coupon.discount_value)) / 100;
    if (coupon.max_discount_amount) {
      discountAmount = Math.min(discountAmount, Number(coupon.max_discount_amount));
    }
  } else {
    discountAmount = Number(coupon.discount_value);
  }

  discountAmount = Math.min(discountAmount, subtotal);
  const finalTotal = subtotal - discountAmount;

  return {
    id: coupon.id,
    code: coupon.code,
    discount_type: coupon.discount_type,
    discount_value: Number(coupon.discount_value),
    discount_amount: parseFloat(discountAmount.toFixed(2)),
    final_total: parseFloat(finalTotal.toFixed(2)),
  };
}

export { getCart, addItem, updateItem, removeItem, clearCart, validateCoupon };
