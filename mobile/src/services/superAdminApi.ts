import apiClient from './api';
import { ApiResponse } from '../types';

/**
 * Super Admin API.
 *
 * Same axios client as every other module, so the bearer token, base URL
 * and error shaping are the ones the app already has.
 */

export interface ChannelSummary {
  channel: 'B2B' | 'B2C';
  orders: number;
  revenue: number;
  average_order_value: number;
}

export interface SalesSummary {
  from: string;
  to: string;
  channels: ChannelSummary[];
  totals: { orders: number; revenue: number; cancelled_orders: number };
}

export interface SalesPoint {
  period: string;
  b2b_revenue: number;
  b2c_revenue: number;
  b2b_orders: number;
  b2c_orders: number;
}

export interface SalesTimeseries {
  from: string;
  to: string;
  granularity: string;
  points: SalesPoint[];
}

export interface PendingBusiness {
  id: string;
  name: string;
  business_type: string;
  contact_person_name: string | null;
  mobile_number: string | null;
  email: string | null;
  city: string | null;
  gst_number: string | null;
  status: string;
  created_at: string;
}

export interface PendingRider {
  id: string;
  name: string | null;
  email: string | null;
  mobile_number: string;
  approval_status: string | null;
  is_active: boolean;
  created_at: string;
}

export interface MissingField {
  key: string;
  label: string;
}

export interface BusinessCompletenessRow {
  business_id: string;
  business_name: string;
  status: string;
  is_complete: boolean;
  missing_fields: MissingField[];
}

export interface BusinessDetail {
  business_id: string;
  business_name: string;
  customer_type: string | null;
  other_type_specify: string | null;
  establishment_address: string | null;
  gst_number: string | null;
  pan_number: string | null;
  website: string | null;
  contact_person_name: string | null;
  designation: string | null;
  mobile_number: string | null;
  whatsapp_number: string | null;
  email_id: string | null;
  alternate_contact_person: string | null;
  alternate_mobile_no: string | null;
  status: string;
  is_complete: boolean;
  missing_fields: MissingField[];
}

const superAdminApi = {
  getSalesSummary: async (from?: string, to?: string): Promise<SalesSummary> => {
    const res = await apiClient.get<ApiResponse<SalesSummary>>('/api/super-admin/sales/summary', {
      params: { from, to },
    });
    return res.data.data;
  },

  getSalesTimeseries: async (
    from?: string,
    to?: string,
    granularity: 'day' | 'month' = 'day'
  ): Promise<SalesTimeseries> => {
    const res = await apiClient.get<ApiResponse<SalesTimeseries>>(
      '/api/super-admin/sales/timeseries',
      { params: { from, to, granularity } }
    );
    return res.data.data;
  },

  getBusinessApprovals: async (status = 'PENDING'): Promise<PendingBusiness[]> => {
    const res = await apiClient.get<ApiResponse<PendingBusiness[]>>(
      '/api/super-admin/approvals/businesses',
      { params: { status } }
    );
    return res.data.data;
  },

  getRiderApprovals: async (status = 'PENDING'): Promise<PendingRider[]> => {
    const res = await apiClient.get<ApiResponse<PendingRider[]>>(
      '/api/super-admin/approvals/riders',
      { params: { status } }
    );
    return res.data.data;
  },

  decideBusiness: async (id: string, action: 'approve' | 'reject', note?: string) => {
    const res = await apiClient.patch<ApiResponse<{ id: string; status: string }>>(
      `/api/super-admin/approvals/businesses/${id}`,
      { action, note }
    );
    return res.data.data;
  },

  decideRider: async (id: string, action: 'approve' | 'reject', note?: string) => {
    const res = await apiClient.patch<ApiResponse<{ id: string; approval_status: string }>>(
      `/api/super-admin/approvals/riders/${id}`,
      { action, note }
    );
    return res.data.data;
  },

  listBusinesses: async (onlyIncomplete = false): Promise<BusinessCompletenessRow[]> => {
    const res = await apiClient.get<ApiResponse<BusinessCompletenessRow[]>>(
      '/api/super-admin/businesses',
      { params: onlyIncomplete ? { incomplete: 'true' } : {} }
    );
    return res.data.data;
  },

  getBusinessDetail: async (id: string): Promise<BusinessDetail> => {
    const res = await apiClient.get<ApiResponse<BusinessDetail>>(
      `/api/super-admin/businesses/${id}`
    );
    return res.data.data;
  },

  updateBusinessDetail: async (id: string, payload: Record<string, unknown>): Promise<BusinessDetail> => {
    const res = await apiClient.put<ApiResponse<BusinessDetail>>(
      `/api/super-admin/businesses/${id}`,
      payload
    );
    return res.data.data;
  },

  createBusiness: async (payload: Record<string, unknown>) => {
    const res = await apiClient.post<ApiResponse<{ id: string; name: string; status: string }>>(
      '/api/super-admin/businesses',
      payload
    );
    return res.data.data;
  },

  createRider: async (payload: Record<string, unknown>) => {
    const res = await apiClient.post<ApiResponse<{ id: string; name: string }>>(
      '/api/super-admin/riders',
      payload
    );
    return res.data.data;
  },
};

export default superAdminApi;
