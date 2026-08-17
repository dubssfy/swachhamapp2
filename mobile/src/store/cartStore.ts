import { create } from 'zustand';

type CartState = {
  // Empty cart state for now, sufficient to render Checkout/Cart
};

export const useCartStore = create<CartState>((set) => ({

}));
