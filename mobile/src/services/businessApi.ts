import apiClient from './api';
import { ApiResponse } from '../types';

export interface BusinessData {
  id: string;
  name: string;
  business_type: string;
  description?: string;
  phone_number?: string;
  email?: string;
  address: string;
  area?: string;
  city: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  status: string;
  images?: { id: string; image_url: string; sort_order: number }[];
  created_at: string;
}

export const businessApi = {
  getBusinesses: async (params?: Record<string, any>): Promise<ApiResponse<{ businesses: BusinessData[]; pagination: any }>> => {
    const response = await apiClient.get('/api/businesses/public', { params });
    return response.data;
  },

  getBusiness: async (id: string): Promise<ApiResponse<BusinessData>> => {
    const response = await apiClient.get(`/api/businesses/public/${id}`);
    return response.data;
  },
};

export default businessApi;
