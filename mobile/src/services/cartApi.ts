// Swachham App - Cart API Service

import apiClient from './api';
import { ApiResponse, Cart, CartItem, Coupon } from '../types';

export const cartApi = {
  getCart: async (): Promise<ApiResponse<Cart>> => {
    const response = await apiClient.get<ApiResponse<Cart>>('/api/cart');
    return response.data;
  },

  addCartItem: async (
    serviceId: string,
    quantity: number,
  ): Promise<ApiResponse<{ cart: Cart; item: CartItem }>> => {
    const response = await apiClient.post<ApiResponse<{ cart: Cart; item: CartItem }>>(
      '/api/cart/items',
      { serviceId, quantity },
    );
    return response.data;
  },

  updateCartItem: async (
    itemId: string,
    quantity: number,
  ): Promise<ApiResponse<{ cart: Cart; item: CartItem }>> => {
    const response = await apiClient.put<ApiResponse<{ cart: Cart; item: CartItem }>>(
      `/api/cart/items/${itemId}`,
      { quantity },
    );
    return response.data;
  },

  removeCartItem: async (itemId: string): Promise<ApiResponse<Cart>> => {
    const response = await apiClient.delete<ApiResponse<Cart>>(`/api/cart/items/${itemId}`);
    return response.data;
  },

  clearCart: async (): Promise<ApiResponse<{ message: string }>> => {
    const response = await apiClient.delete<ApiResponse<{ message: string }>>('/api/cart');
    return response.data;
  },

  validateCoupon: async (code: string): Promise<ApiResponse<Coupon>> => {
    const response = await apiClient.post<ApiResponse<Coupon>>('/api/cart/validate-coupon', {
      code,
    });
    return response.data;
  },

  applyCoupon: async (code: string): Promise<ApiResponse<Cart>> => {
    const response = await apiClient.post<ApiResponse<Cart>>('/api/cart/apply-coupon', { code });
    return response.data;
  },

  removeCoupon: async (): Promise<ApiResponse<Cart>> => {
    const response = await apiClient.delete<ApiResponse<Cart>>('/api/cart/coupon');
    return response.data;
  },
};

export default cartApi;
