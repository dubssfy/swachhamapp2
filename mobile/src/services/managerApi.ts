import apiClient from './api';
import { ApiResponse } from '../types';

/**
 * Manager API.
 *
 * The same axios client every other module uses, so the bearer token, base
 * URL and error shaping are the ones the app already has.
 *
 * A Manager PROPOSES. There is no approve, no reject and no credential call
 * on this client, because there is no such endpoint on the manager router —
 * approval lives entirely on the Super Admin side.
 */

export type RequestType = 'BUSINESS' | 'RIDER' | 'SORTER';
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/*
 * THE FOUR CYCLES A BUSINESS IS REGISTERED ON.
 *
 * Mirrors `REGISTRATION_BILLING_CYCLES` in the backend's
 * `billingCycle.service`, which is the authority — the server validates
 * against it and computes each cycle's invoice period from it.
 *
 * "15 Days" is STORED as FORTNIGHTLY. The label is what the business calls
 * the cycle; the value is what every invoice and payment receipt already
 * raised against it refers to, so it is left alone.
 *
 * QUARTERLY and HALF_YEARLY are no longer offered. They remain valid values
 * on the column so no existing business becomes unreadable — they simply
 * cannot be chosen here.
 */
export const BILLING_CYCLES: Array<{ value: string; label: string }> = [
  { value: 'WEEKLY', label: 'Weekly' },
  // Anchored to the month: the 1st-14th and the 15th-end.
  { value: 'FORTNIGHTLY', label: '15 Days' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
];

/**
 * The BUSINESS HEAD contact — the primary one. Their email becomes the login
 * username, which is why it is required here and nowhere else.
 */
export interface HeadContactForm {
  name: string;
  designation?: string;
  mobile: string;
  /** Not defaulted from `mobile`: they are frequently different numbers. */
  whatsapp?: string;
  email: string;
}

/**
 * An ALTERNATIVE contact: name, designation and mobile, and nothing else.
 *
 * No email and no WhatsApp — the server discards both if they are sent. The
 * mobile number is what lets that person be routed to this business's login
 * page; it is not a credential.
 */
export interface AlternativeContactForm {
  name: string;
  designation: string;
  mobile: string;
}

export interface CreationRequest {
  id: string;
  request_type: RequestType;
  status: RequestStatus;
  requested_by: string;
  requested_by_name: string | null;
  subject_name: string;
  subject_email: string | null;
  payload: any;
  rejection_reason: string | null;
  approved_at: string | null;
  created_entity_id: string | null;
  email_status: 'NOT_SENT' | 'SENT' | 'FAILED';
  email_error: string | null;
  created_at: string;
}

/** What the GST lookup gives the New Business form. */
export interface GstLookup {
  verified: boolean;
  data?: {
    gstin: string;
    /** Derived by the server from GSTIN characters 3-12. Never typed. */
    pan_number: string;
    legalName: string | null;
    tradeName: string | null;
    registrationStatus: string | null;
    state: string | null;
    address: string | null;
    city: string | null;
    pincode: string | null;
  };
  message?: string;
}

/** Which of the Manager's two order tabs a booking belongs to. */
export type OrderRequestSource = 'CUSTOMER' | 'BUSINESS';

/** One booking waiting for the Manager. It IS the order row, at one status. */
export interface PendingOrderRequest {
  id: string;
  order_number: string;
  source: OrderRequestSource;
  customer_name: string;
  customer_contact: string | null;
  status: string;
  total: number;
  item_count: number;
  /** Sum of item weight x quantity, as the order stored it. Null when unknown. */
  total_weight_kg: number | null;
  laundry_type: string | null;
  pickup_date: string | null;
  pickup_slot_start: string | null;
  pickup_slot_end: string | null;
  special_notes: string | null;
  created_at: string;
}

const managerApi = {
  /* ---- Order approval: the two request tabs ----
   *
   * These read and move the ORDER ITSELF; there is no separate request
   * record. Accepting one sets its status to ORDER_PLACED, which is what
   * makes it visible to the Sorter and raises the Rider advisory.
   */

  /** The bookings waiting in one tab, oldest first. */
  getOrderRequests: async (source: OrderRequestSource): Promise<PendingOrderRequest[]> => {
    const res = await apiClient.get<ApiResponse<PendingOrderRequest[]>>(
      `/api/manager/order-requests/${source.toLowerCase()}`
    );
    return res.data.data ?? [];
  },

  /** How many are waiting in each tab, for the badges. */
  getOrderRequestCounts: async (): Promise<{ CUSTOMER: number; BUSINESS: number }> => {
    const res = await apiClient.get<ApiResponse<{ CUSTOMER: number; BUSINESS: number }>>(
      '/api/manager/order-requests/counts'
    );
    return res.data.data ?? { CUSTOMER: 0, BUSINESS: 0 };
  },

  /**
   * Accepts one booking. The server owns the rule: it refuses with 409 if the
   * order has already moved on, and writes ORDER_PLACED plus the history row
   * in one transaction. Nothing about the order is decided here.
   */
  acceptOrderRequest: async (orderId: string): Promise<any> => {
    const res = await apiClient.post<ApiResponse<any>>(
      `/api/manager/order-requests/${orderId}/accept`
    );
    return res.data.data;
  },

  getSummary: async (): Promise<{ counts: Record<string, number> }> => {
    const res = await apiClient.get<ApiResponse<{ counts: Record<string, number> }>>(
      '/api/manager/summary'
    );
    return res.data.data;
  },

  /**
   * Verifies a GSTIN through the backend.
   *
   * No provider key exists in this app: it sends a number and renders the
   * answer, and the PAN comes back already derived.
   */
  verifyGst: async (gstin: string): Promise<GstLookup> => {
    const res = await apiClient.post<ApiResponse<GstLookup>>('/api/manager/gst/verify', { gstin });
    return { ...res.data.data, message: res.data.message };
  },

  submitBusiness: async (payload: Record<string, unknown>): Promise<CreationRequest> => {
    const res = await apiClient.post<ApiResponse<CreationRequest>>(
      '/api/manager/requests/business',
      payload
    );
    return res.data.data;
  },

  submitRider: async (payload: Record<string, unknown>): Promise<CreationRequest> => {
    const res = await apiClient.post<ApiResponse<CreationRequest>>(
      '/api/manager/requests/rider',
      payload
    );
    return res.data.data;
  },

  submitSorter: async (payload: Record<string, unknown>): Promise<CreationRequest> => {
    const res = await apiClient.post<ApiResponse<CreationRequest>>(
      '/api/manager/requests/sorter',
      payload
    );
    return res.data.data;
  },

  /** Own requests only — the server scopes this to the signed-in manager. */
  listRequests: async (filters: { type?: string; status?: string } = {}): Promise<CreationRequest[]> => {
    const res = await apiClient.get<ApiResponse<CreationRequest[]>>('/api/manager/requests', {
      params: filters,
    });
    return res.data.data;
  },

  getRequest: async (id: string): Promise<CreationRequest> => {
    const res = await apiClient.get<ApiResponse<CreationRequest>>(`/api/manager/requests/${id}`);
    return res.data.data;
  },
};

export default managerApi;
