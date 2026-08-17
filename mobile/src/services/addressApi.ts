import apiClient from './api';
import { ApiResponse } from '../types';

export interface AddressData {
  id?: string;
  user_id?: string;
  address_label: string;
  full_address: string;
  house_flat?: string;
  area?: string;
  city: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  is_default?: boolean;
  created_at?: string;
  updated_at?: string;
}

export const addressApi = {
  getAddresses: async (): Promise<ApiResponse<AddressData[]>> => {
    const response = await apiClient.get<ApiResponse<AddressData[]>>('/api/addresses');
    return response.data;
  },

  addAddress: async (data: Omit<AddressData, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<ApiResponse<AddressData>> => {
    const response = await apiClient.post<ApiResponse<AddressData>>('/api/addresses', data);
    return response.data;
  },

  updateAddress: async (id: string, data: Partial<AddressData>): Promise<ApiResponse<AddressData>> => {
    const response = await apiClient.put<ApiResponse<AddressData>>(`/api/addresses/${id}`, data);
    return response.data;
  },

  deleteAddress: async (id: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`/api/addresses/${id}`);
    return response.data;
  },

  setDefault: async (id: string): Promise<ApiResponse<AddressData>> => {
    const response = await apiClient.put<ApiResponse<AddressData>>(`/api/addresses/${id}/set-default`);
    return response.data;
  },
};

export default addressApi;
