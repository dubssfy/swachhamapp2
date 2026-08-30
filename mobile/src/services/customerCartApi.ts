import apiClient from './api';
import { ApiResponse } from '../types';

/**
 * The CUSTOMER cart, typed as the server actually returns it.
 *
 * `types/index.ts` already declares `Cart` and `CartItem`, but in camelCase
 * (`deliveryCharge`, `basePrice`, a nested `service` object) while the API
 * sends snake_case (`delivery_charge`, `price`, `service_name`). Those types
 * describe a response nothing produces — a leftover from before the flow was
 * wired — so using them would mean every field reading `undefined` at
 * runtime while TypeScript said it was fine.
 *
 * These match `cart.service.ts` field for field.
 */

export interface CustomerCartItem {
  id: string;
  cart_id: string;
  service_id: string;
  service_name: string;
  /** The live customer price. Null when the item has none configured. */
  price: number | null;
  unit: string;
  image_url?: string | null;
  quantity: number;
  /** price x quantity, computed by the server. */
  item_total: number | null;
}

export interface CustomerCart {
  id: string;
  user_id: string;
  items: CustomerCartItem[];
  subtotal: number;
  /*
   * DELIVERY IS DISTANCE-BASED, not a flat fee: free within 10 km of the
   * collecting branch, then 7 rupees per kilometre (or part) beyond.
   *
   * `delivery_charge_resolved` is FALSE when there was no address with
   * coordinates to measure from. The charge is 0 then, and the screen must
   * say "calculated at checkout" rather than "free" -- an order to a far
   * address WILL be charged, and promising free here is a lie the order
   * would contradict.
   */
  delivery_charge: number;
  delivery_distance_km: number | null;
  delivery_charge_resolved: boolean;
  delivery_free_up_to_km: number;
  delivery_rate_per_km: number;
  total: number;
}

/** What delivery will cost to one pickup point, before the order exists. */
export interface DeliveryQuote {
  charge: number;
  distance_km: number | null;
  store_id: string | null;
  store_name: string | null;
  /** False when there was nothing to measure from. */
  resolved: boolean;
  free_up_to_km: number;
  rate_per_km: number;
}

export const customerCartApi = {
  getCart: async (): Promise<CustomerCart> => {
    const res = await apiClient.get<ApiResponse<CustomerCart>>('/api/cart');
    return res.data.data;
  },

  /**
   * Adds an item.
   *
   * The server refuses an item with no customer price, with a message naming
   * it — that error is shown to the customer rather than swallowed, because
   * the alternative is a basket that cannot be checked out.
   */
  addItem: async (
    serviceId: string,
    quantity: number,
    /**
     * The laundry SERVICE chosen for this item — Wash and Fold or Dry Clean.
     * It decides the price, so a cart line without one is priced from the
     * item's fallback rate.
     */
    laundryServiceId?: string | null
  ): Promise<CustomerCart> => {
    const res = await apiClient.post<ApiResponse<CustomerCart>>('/api/cart/items', {
      serviceId, quantity, laundryServiceId: laundryServiceId ?? null,
    });
    return res.data.data;
  },

  /** The route takes the CART ITEM id, despite the `:serviceId` path name. */
  updateItem: async (cartItemId: string, quantity: number): Promise<CustomerCart> => {
    const res = await apiClient.put<ApiResponse<CustomerCart>>(
      `/api/cart/items/${cartItemId}`, { quantity }
    );
    return res.data.data;
  },

  removeItem: async (cartItemId: string): Promise<CustomerCart> => {
    const res = await apiClient.delete<ApiResponse<CustomerCart>>(
      `/api/cart/items/${cartItemId}`
    );
    return res.data.data;
  },

  clearCart: async (): Promise<void> => {
    await apiClient.delete('/api/cart');
  },
};

/**
 * The payment methods the CUSTOMER app offers.
 *
 * A subset of what `orders.payment_method` accepts — these are the two the
 * business actually settles in. The server validates against the full enum,
 * so adding one here needs no backend change.
 */
export const CUSTOMER_PAYMENT_METHODS = [
  { value: 'CASH_ON_DELIVERY', label: 'Cash on Delivery', icon: 'cash-outline' },
  { value: 'UPI', label: 'UPI / Online Payment', icon: 'phone-portrait-outline' },
] as const;

export type CustomerPaymentMethod = (typeof CUSTOMER_PAYMENT_METHODS)[number]['value'];

/** One bookable pickup window, as `GET /api/orders/time-slots` returns it. */
export interface PickupSlotOption {
  /** e.g. "09-11". */
  id: string;
  /** e.g. "9:00 AM - 11:00 AM". */
  label: string;
  /** SQL TIME, sent straight back on the order. */
  start: string;
  end: string;
  start_minutes: number;
  /** False for a window that has already begun today. */
  available: boolean;
}

export interface PlaceOrderInput {
  address_id: string;
  pickup_date: string;
  /** The slot's own `start` / `end`, unparsed — see `PickupSlotOption`. */
  pickup_slot_start: string;
  pickup_slot_end: string;
  /*
   * THE DELIVERY LEG. Optional, and all three go together or none do --
   * `order.service` only writes the `deliveries` row when it has the day AND
   * both ends of the window.
   */
  delivery_date?: string;
  delivery_slot_start?: string;
  delivery_slot_end?: string;
  payment_method: CustomerPaymentMethod;
  coupon_code?: string;
  notes?: string;
  /*
   * WHERE THE ORDER IS BEING PLACED FROM.
   *
   * `POST /api/orders` runs behind `requireServiceArea`, which reads these
   * from the BODY and answers 428 — "Your location is required before an
   * order can be placed" — when they are missing. They were not on this type
   * at all, so no call this client could build was ever accepted.
   *
   * The device's real fix, never a hardcoded pair: the server decides whether
   * the point is inside the service area.
   */
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export const customerOrderApi = {
  /** Creates the order from the current cart. The server prices it. */
  placeOrder: async (input: PlaceOrderInput): Promise<any> => {
    const res = await apiClient.post<ApiResponse<any>>('/api/orders', input);
    return res.data.data;
  },

  getOrder: async (orderId: string): Promise<any> => {
    const res = await apiClient.get<ApiResponse<any>>(`/api/orders/${orderId}`);
    return res.data.data;
  },

  /**
   * This customer's orders, newest first.
   *
   * `GET /api/orders` is scoped to the signed-in user by the server — the id
   * comes from the token, never from the client — so there is nothing to pass
   * and no way to ask for somebody else's.
   */
  listOrders: async (page = 1, limit = 20): Promise<{ orders: any[]; total: number }> => {
    const res = await apiClient.get<ApiResponse<{ orders: any[]; total: number }>>(
      '/api/orders',
      { params: { page, limit } }
    );
    return res.data.data ?? { orders: [], total: 0 };
  },

  /**
   * The tracking view of ONE order: its status, both schedules, and the
   * history of every status it has been through.
   *
   * Scoped to the signed-in customer server-side, like `getOrder`.
   */
  getOrderTracking: async (orderId: string): Promise<any> => {
    const res = await apiClient.get<ApiResponse<any>>(`/api/orders/${orderId}/tracking`);
    return res.data.data;
  },

  /**
   * Cancels one order, through the existing endpoint.
   *
   * The server owns the rule: it re-checks the status, refuses with 409 and a
   * readable reason when the order has moved past cancelling, writes the
   * CANCELLED status and records it in `order_status_history`. Nothing is
   * decided here — the caller re-reads the order afterwards.
   */
  cancelOrder: async (orderId: string, reason?: string): Promise<any> => {
    const res = await apiClient.post<ApiResponse<any>>(
      `/api/orders/${orderId}/cancel`,
      reason ? { reason } : {}
    );
    return res.data.data;
  },

  /**
   * The pickup windows bookable on a given day.
   *
   * The list is the SERVER'S — the same one the business flow books against.
   * Hardcoding these hours in the app would mean the two drift the first time
   * the working day changes.
   */
  /**
   * What delivery will cost to a given address.
   *
   * Checkout must state the total the customer is agreeing to, and only the
   * server can work out how far the address is from the collecting branch.
   * The order recomputes it anyway, so this is a quote and not the bill.
   */
  getDeliveryQuote: async (
    addressId: string,
    fallback?: { latitude: number; longitude: number }
  ): Promise<DeliveryQuote> => {
    const res = await apiClient.get<ApiResponse<DeliveryQuote>>(
      '/api/orders/delivery-quote',
      { params: { address_id: addressId, ...(fallback ?? {}) } }
    );
    return res.data.data;
  },

  getPickupSlots: async (date: string): Promise<PickupSlotOption[]> => {
    const res = await apiClient.get<ApiResponse<PickupSlotOption[]>>(
      '/api/orders/time-slots', { params: { date } }
    );
    return res.data.data;
  },
};

/* ===================================================================
 * THE CUSTOMER CATALOGUE
 *
 * Categories and items come from the SAME endpoints the rest of the app
 * uses; there is no customer-only catalogue table. `scope=CUSTOMER` is what
 * separates the four customer categories from the hotel ones.
 * =================================================================== */

export interface CustomerCategory {
  id: string;
  name: string;
  slug: string;
  icon_name: string | null;
  image_url: string | null;
  item_count: number;
}

export interface CustomerItem {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  /** The LOWEST price across the item's services — a "from" figure. */
  price: number | null;
  unit: string;
  image_url: string | null;
  /** The service codes this item is offered for. */
  service_types: string[];
}

/** One service an item can be bought for, and what it costs. */
export interface ItemServiceOption {
  service_id: string;
  name: string;
  code: string;
  /** Null when no price is configured — the item cannot be ordered. */
  price: number | null;
}

export const customerCatalogueApi = {
  /** The four customer categories. */
  getCategories: async (): Promise<CustomerCategory[]> => {
    const res = await apiClient.get<ApiResponse<CustomerCategory[]>>(
      '/api/services/categories', { params: { scope: 'CUSTOMER' } }
    );
    return res.data.data;
  },

  /**
   * The items filed under one category.
   *
   * THE PARAMETER IS `category_id`, NOT `categoryId`.
   *
   * It was sent as `categoryId`, which the route does not read -- so the
   * filter was silently dropped and the call returned the FIRST PAGE OF THE
   * WHOLE CATALOGUE, business items included. Those have no customer price,
   * so they fell back to `services.base_price`, which holds 0.00 / 1.00
   * placeholders: the customer saw a list of the wrong items at Rs 0 and
   * Rs 1. Nothing about the prices themselves was wrong.
   *
   * `scope` is sent for the same reason -- the catalogue holds the customer
   * list and the hotel list in one table, and only scope separates them.
   *
   * `limit` is 100 because the server clamps it there; asking for 200 was
   * quietly cut to 100 anyway, and the largest customer category has 30.
   */
  getItems: async (categoryId: string): Promise<CustomerItem[]> => {
    const res = await apiClient.get<any>('/api/services', {
      params: { category_id: categoryId, scope: 'CUSTOMER', limit: 100 },
    });
    // The list endpoint paginates, so the rows sit under `data`.
    return res.data.data ?? [];
  },

  /**
   * The services this item offers, each with its own price.
   *
   * This is what makes "Wash and Fold ₹40 / Dry Clean ₹80" possible: the
   * list endpoint can only give one figure per item, because the price
   * depends on a service the customer has not chosen yet.
   */
  getItemServiceOptions: async (itemId: string): Promise<ItemServiceOption[]> => {
    const res = await apiClient.get<ApiResponse<{ options: ItemServiceOption[] }>>(
      `/api/services/${itemId}/options`
    );
    return res.data.data.options;
  },
};

export default customerCartApi;
