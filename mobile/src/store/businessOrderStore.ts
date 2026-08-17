import { create } from 'zustand';
import businessOrderApi, { BusinessCart, BusinessOrderResult } from '../services/businessOrderApi';
import { extractErrorMessage } from '../services/api';

export type LaundryType = 'hotel' | 'guest';
export type OrderType = 'standard' | 'quick';

/**
 * Exactly two Business services. Wash + Iron is ONE combined service — there
 * is no standalone Wash and no standalone Iron.
 */
export type ServiceType = 'wash_iron' | 'dry_clean';

export const SERVICE_OPTIONS: Array<{ value: ServiceType; label: string }> = [
  { value: 'wash_iron', label: 'Wash & Iron' },
  { value: 'dry_clean', label: 'Dry Clean' },
];

export const SERVICE_REQUIRED_MESSAGE = 'Please select a service before placing your order.';

/** The two Business order types, also offered in the Cart. */
export const ORDER_TYPE_OPTIONS: Array<{ value: OrderType; label: string }> = [
  { value: 'standard', label: 'Standard Order' },
  { value: 'quick', label: 'Quick Order' },
];

export const ORDER_TYPE_REQUIRED_MESSAGE = 'Please select an order type before placing your order.';

interface BusinessOrderState {
  laundryType: LaundryType | null;
  orderType: OrderType | null;
  serviceType: ServiceType | null;
  cart: BusinessCart | null;
  isLoading: boolean;

  setLaundryType: (value: LaundryType) => void;
  setOrderType: (value: OrderType) => void;

  /** Persists the Order Type + Laundry Type page selections onto the cart. */
  saveSelections: () => Promise<void>;
  /** Persists the order type chosen in the Cart, leaving laundry type as is. */
  saveOrderType: (value: OrderType) => Promise<void>;
  /** Persists the service chosen in the Cart. */
  setServiceType: (value: ServiceType) => Promise<void>;

  loadCart: () => Promise<void>;
  /** `itemServiceType` fixes the service for this line only. */
  addItem: (itemId: string, quantity: number, itemServiceType?: string) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  /** Switches one cart line to another service the item supports. */
  setItemService: (itemId: string, itemServiceType: string) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  /** Copies a past order's items into the cart and shows them immediately. */
  repeatIntoCart: (orderId: string) => Promise<number>;
  confirmOrder: () => Promise<BusinessOrderResult>;
  resetFlow: () => void;
}

/** Keeps the in-memory flow state in step with what the server stored. */
function fromCart(cart: BusinessCart) {
  return {
    cart,
    laundryType: (cart.laundry_type as LaundryType | null) ?? null,
    orderType: (cart.order_type as OrderType | null) ?? null,
    serviceType: (cart.service_type as ServiceType | null) ?? null,
  };
}

export const useBusinessOrderStore = create<BusinessOrderState>((set, get) => ({
  laundryType: null,
  orderType: null,
  serviceType: null,
  cart: null,
  isLoading: false,

  setLaundryType: (value) => set({ laundryType: value }),
  setOrderType: (value) => set({ orderType: value }),

  saveSelections: async () => {
    const { laundryType, orderType } = get();
    try {
      set({ isLoading: true });
      const response = await businessOrderApi.setCartContext({
        laundryType: laundryType || undefined,
        orderType: orderType || undefined,
      });
      set(fromCart(response.data));
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to save your selection'));
    } finally {
      set({ isLoading: false });
    }
  },

  saveOrderType: async (value: OrderType) => {
    try {
      set({ isLoading: true });
      // Same cart-context call the Order Type page uses — only order type is
      // sent, so the laundry type already on the cart is left untouched.
      const response = await businessOrderApi.setCartContext({ orderType: value });
      set(fromCart(response.data));
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to select order type'));
    } finally {
      set({ isLoading: false });
    }
  },

  setServiceType: async (value: ServiceType) => {
    try {
      set({ isLoading: true });
      const response = await businessOrderApi.setCartService(value);
      set(fromCart(response.data));
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to select service'));
    } finally {
      set({ isLoading: false });
    }
  },

  loadCart: async () => {
    try {
      set({ isLoading: true });
      const response = await businessOrderApi.getCart();
      set(fromCart(response.data));
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to load cart'));
    } finally {
      set({ isLoading: false });
    }
  },

  addItem: async (itemId: string, quantity: number, itemServiceType?: string) => {
    if (get().isLoading) return;
    const { laundryType, orderType } = get();
    try {
      set({ isLoading: true });
      // The cart-level service is still chosen in the Cart; what travels here
      // is the service for this line, taken from the catalogue filter.
      const response = await businessOrderApi.addCartItem(itemId, quantity, {
        laundryType: laundryType || undefined,
        orderType: orderType || undefined,
        itemServiceType: itemServiceType || undefined,
      });
      set(fromCart(response.data));
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to add item to cart'));
    } finally {
      set({ isLoading: false });
    }
  },

  setItemService: async (itemId: string, itemServiceType: string) => {
    if (get().isLoading) return;
    try {
      set({ isLoading: true });
      const response = await businessOrderApi.setCartItemService(itemId, itemServiceType);
      set(fromCart(response.data));
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to change item service'));
    } finally {
      set({ isLoading: false });
    }
  },

  updateItem: async (itemId: string, quantity: number) => {
    if (get().isLoading) return;
    try {
      set({ isLoading: true });
      const response = await businessOrderApi.updateCartItem(itemId, quantity);
      set(fromCart(response.data));
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to update item'));
    } finally {
      set({ isLoading: false });
    }
  },

  removeItem: async (itemId: string) => {
    if (get().isLoading) return;
    try {
      set({ isLoading: true });
      const response = await businessOrderApi.removeCartItem(itemId);
      set(fromCart(response.data));
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to remove item'));
    } finally {
      set({ isLoading: false });
    }
  },

  repeatIntoCart: async (orderId: string) => {
    try {
      set({ isLoading: true });
      const response = await businessOrderApi.repeatOrder(orderId);
      // The server returns the rebuilt cart, so the Cart screen already has
      // the repeated items the moment the user lands on it.
      set(fromCart(response.data.cart));
      return response.data.item_count;
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to repeat order'));
    } finally {
      set({ isLoading: false });
    }
  },

  confirmOrder: async () => {
    if (get().isLoading) throw new Error('Please wait...');
    if (!get().serviceType) throw new Error(SERVICE_REQUIRED_MESSAGE);
    try {
      set({ isLoading: true });
      const response = await businessOrderApi.confirmOrder();
      set({ cart: null, laundryType: null, orderType: null, serviceType: null });
      return response.data;
    } catch (error: any) {
      throw new Error(extractErrorMessage(error, 'Failed to place order'));
    } finally {
      set({ isLoading: false });
    }
  },

  resetFlow: () => set({ laundryType: null, orderType: null, serviceType: null, cart: null }),
}));
