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

  /**
   * Deletes the signed-in user's own account.
   *
   * `purged` says which of the two outcomes happened: true when the account
   * row was removed outright, false when past orders had to stay on record and
   * the personal data on the account was erased instead. `message` explains it
   * in the words the person should see.
   */
  deleteAccount: async (): Promise<ApiResponse<{ purged: boolean; message: string }>> => {
    const response = await apiClient.delete<ApiResponse<{ purged: boolean; message: string }>>(
      '/api/customers/me',
      { data: { confirm: 'DELETE' } }
    );
    return response.data;
  },
};

export default customerApi;
