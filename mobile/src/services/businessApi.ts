import apiClient from './api';
import { ApiResponse } from '../types';
import { DEMO_MODE } from '../demo/demoMode';

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
  /**
   * The PUBLIC directory of establishments — a customer-side listing.
   *
   * A demo build answers with an empty page rather than calling out. The
   * Business home mounts this call on load, and the demo has no directory to
   * show: an empty list is the honest answer, and it keeps the demo's console
   * clean of a blocked-request warning on every launch.
   */
  getBusinesses: async (params?: Record<string, any>): Promise<ApiResponse<{ businesses: BusinessData[]; pagination: any }>> => {
    if (DEMO_MODE) {
      return { success: true, data: { businesses: [], pagination: { page: 1, total: 0 } } };
    }
    const response = await apiClient.get('/api/businesses/public', { params });
    return response.data;
  },

  getBusiness: async (id: string): Promise<ApiResponse<BusinessData>> => {
    const response = await apiClient.get(`/api/businesses/public/${id}`);
    return response.data;
  },
};

export default businessApi;
