import apiClient from './api';
import { ApiResponse } from '../types';

/**
 * Sorter API.
 *
 * Uses the same axios client as every other module, so the bearer token, base
 * URL and error shaping are the ones the app already has.
 */

/** The three stages the Sorter works with, in workflow order. */
export type SorterStage = 'confirmed' | 'accepted' | 'ready' | 'out_for_delivery';

export interface SorterOrderSummary {
  id: string;
  order_number: string;
  customer_name: string;
  customer_contact: string | null;
  laundry_type: string | null;
  order_type: string | null;
  /** The raw pipeline status, e.g. ORDER_PLACED. */
  status: string;
  /** That status expressed as a Sorter stage. */
  stage: SorterStage | null;
  item_count: number;
  total_quantity: number;
  total_weight_kg: number;
  has_confirmation_pdf: boolean;
  created_at: string;
  accepted_at: string | null;
  ready_at: string | null;
}

export interface SorterOrderItem {
  id: string;
  item_name: string;
  /** The laundry service for this line; null when it cannot be resolved. */
  laundry_service_name: string | null;
  category_name: string | null;
  quantity: number;
  unit: string;
  weight_kg: number | null;
  total_weight_kg: number;
}

export interface SorterOrderDetail extends SorterOrderSummary {
  items: SorterOrderItem[];
  confirmation_pdf_url: string | null;
}

export interface SorterQueue {
  orders: SorterOrderSummary[];
  counts: { confirmed: number; accepted: number; ready: number; active: number };
}

export interface Garment {
  id: string;
  order_id: string;
  barcode: string;
  item_name: string;
  service_name: string | null;
  weight_kg: number | null;
  piece_no: number;
  /** Set once this piece has been scanned for that stage. */
  accepted_scan_at: string | null;
  delivery_scan_at: string | null;
}

export interface ScanStatus {
  order_id: string;
  order_number: string;
  status: string;
  expected_count: number;
  acceptance_scanned: number;
  delivery_scanned: number;
  acceptance_matched: boolean;
  delivery_matched: boolean;
  garments: Garment[];
}

export interface ScanResult {
  success: true;
  barcode: string;
  garment: { id: string; item_name: string; service_name: string | null };
  scannedCount: number;
  expectedCount: number;
  remainingCount: number;
  quantityMatched: boolean;
  message: string;
}

export type ScanStageName = 'acceptance' | 'delivery';

export const sorterApi = {
  getOrders: async (stage?: SorterStage): Promise<ApiResponse<SorterQueue>> => {
    const response = await apiClient.get<ApiResponse<SorterQueue>>('/api/sorter/orders', {
      params: stage ? { stage } : undefined,
    });
    return response.data;
  },

  getOrderById: async (orderId: string): Promise<ApiResponse<SorterOrderDetail>> => {
    const response = await apiClient.get<ApiResponse<SorterOrderDetail>>(
      `/api/sorter/orders/${orderId}`
    );
    return response.data;
  },

  /**
   * Requests one workflow step. The server validates the transition, so an
   * out-of-order request comes back as an error rather than being applied.
   */
  updateStatus: async (
    orderId: string,
    status: Exclude<SorterStage, 'confirmed'>
  ): Promise<ApiResponse<{ id: string; order_number: string; status: string; stage: SorterStage }>> => {
    const response = await apiClient.patch<
      ApiResponse<{ id: string; order_number: string; status: string; stage: SorterStage }>
    >(`/api/sorter/orders/${orderId}/status`, { status });
    return response.data;
  },

  /** Counts for both stages plus every garment's scan state. */
  getScanStatus: async (orderId: string): Promise<ApiResponse<ScanStatus>> => {
    const response = await apiClient.get<ApiResponse<ScanStatus>>(
      `/api/sorter/orders/${orderId}/scan-status`
    );
    return response.data;
  },

  getGarments: async (orderId: string): Promise<ApiResponse<Garment[]>> => {
    const response = await apiClient.get<ApiResponse<Garment[]>>(
      `/api/sorter/orders/${orderId}/garments`
    );
    return response.data;
  },

  /** Idempotent: an order that already has barcodes keeps them. */
  generateGarments: async (
    orderId: string
  ): Promise<ApiResponse<ScanStatus & { created: number }>> => {
    const response = await apiClient.post<ApiResponse<ScanStatus & { created: number }>>(
      `/api/sorter/orders/${orderId}/garments/generate`
    );
    return response.data;
  },

  /**
   * Sends one barcode. The server decides whether it counts — the screen never
   * increments a local tally.
   */
  scan: async (
    orderId: string,
    stage: ScanStageName,
    barcode: string
  ): Promise<ApiResponse<ScanResult>> => {
    const response = await apiClient.post<ApiResponse<ScanResult>>(
      `/api/sorter/orders/${orderId}/scan/${stage}`,
      { barcode }
    );
    return response.data;
  },

  /**
   * The confirmation document. Returns the stored URL when the order has one,
   * along with the order detail the shared PDF template renders from.
   */
  getConfirmationPdf: async (
    orderId: string
  ): Promise<ApiResponse<{ url: string | null; order: SorterOrderDetail }>> => {
    const response = await apiClient.get<
      ApiResponse<{ url: string | null; order: SorterOrderDetail }>
    >(`/api/sorter/orders/${orderId}/pdf`);
    return response.data;
  },
};

export default sorterApi;
