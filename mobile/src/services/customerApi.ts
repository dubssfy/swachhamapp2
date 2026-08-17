import apiClient from './api';
import { ApiResponse, User } from '../types';

export interface CustomerProfileData {
  id?: string;
  user_id?: string;
  username: string;
  profile_image_url?: string;
  created_at?: string;
  updated_at?: string;
}

export const customerApi = {
  getProfile: async (): Promise<ApiResponse<CustomerProfileData>> => {
    const response = await apiClient.get<ApiResponse<CustomerProfileData>>('/api/customers/profile');
    return response.data;
  },

  updateProfile: async (data: Partial<CustomerProfileData>): Promise<ApiResponse<CustomerProfileData>> => {
    const response = await apiClient.put<ApiResponse<CustomerProfileData>>('/api/customers/profile', data);
    return response.data;
  },

  setupProfile: async (data: { name: string; role: string }): Promise<ApiResponse<User>> => {
    const response = await apiClient.post<ApiResponse<User>>('/api/customers/setup', data);
    return response.data;
  },
};

export default customerApi;
