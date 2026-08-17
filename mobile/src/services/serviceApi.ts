// Swachham App - Service API

import apiClient from './api';
import { ApiResponse, PaginatedResponse, Service, ServiceCategory } from '../types';

interface ServiceQueryParams {
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
  isPopular?: boolean;
  isFeatured?: boolean;
}

export const serviceApi = {
  getCategories: async (): Promise<ApiResponse<ServiceCategory[]>> => {
    const response = await apiClient.get<ApiResponse<ServiceCategory[]>>(
      '/api/services/categories',
    );
    return response.data;
  },

  getServices: async (params?: ServiceQueryParams): Promise<PaginatedResponse<Service>> => {
    const response = await apiClient.get<PaginatedResponse<Service>>('/api/services', { params });
    return response.data;
  },

  getServiceById: async (id: string): Promise<ApiResponse<Service>> => {
    const response = await apiClient.get<ApiResponse<Service>>(`/api/services/${id}`);
    return response.data;
  },

  getPopularServices: async (): Promise<ApiResponse<Service[]>> => {
    const response = await apiClient.get<ApiResponse<Service[]>>('/api/services/popular');
    return response.data;
  },

  getCategoryServices: async (
    categoryId: string,
    params?: Omit<ServiceQueryParams, 'category'>,
  ): Promise<PaginatedResponse<Service>> => {
    const response = await apiClient.get<PaginatedResponse<Service>>(
      `/api/services/categories/${categoryId}/services`,
      { params },
    );
    return response.data;
  },

  getFeaturedServices: async (): Promise<ApiResponse<Service[]>> => {
    const response = await apiClient.get<ApiResponse<Service[]>>('/api/services/featured');
    return response.data;
  },

  searchServices: async (query: string): Promise<ApiResponse<Service[]>> => {
    const response = await apiClient.get<ApiResponse<Service[]>>('/api/services/search', {
      params: { q: query },
    });
    return response.data;
  },
};

export default serviceApi;
