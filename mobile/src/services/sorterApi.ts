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
  /** How many defects have been reported against this order. */
  defect_count: number;
  /** WhatsApp state of the most recent defect, or null when there is none. */
  latest_defect_whatsapp_status: DefectWhatsAppStatus | null;
}

/** Only SENT means Meta actually accepted the message. */
export type DefectWhatsAppStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface DefectRecord {
  id: string;
  order_id: string;
  /** Server-relative URL, e.g. /uploads/defects/....jpg */
  photo_url: string;
  description: string | null;
  reported_by: string | null;
  reported_at: string;
  whatsapp_status: DefectWhatsAppStatus;
  whatsapp_message_id: string | null;
  whatsapp_error: string | null;
  whatsapp_sent_at: string | null;
  whatsapp_to: string | null;
  /**
   * The same message sent to the Sorter who reported it. A null status means
   * no attempt has been recorded for this row yet.
   */
  sorter_whatsapp_status: DefectWhatsAppStatus | null;
  sorter_whatsapp_message_id: string | null;
  sorter_whatsapp_error: string | null;
  sorter_whatsapp_sent_at: string | null;
  sorter_whatsapp_to: string | null;
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
  /** Newest first. */
  defects: DefectRecord[];
}

export interface SorterQueue {
  orders: SorterOrderSummary[];
  counts: { confirmed: number; accepted: number; ready: number; active: number };
  /**
   * The calendar day the result was narrowed to, YYYY-MM-DD, as the server
   * reckons it from BUSINESS_TZ_OFFSET. null when no day filter applied.
   */
  business_date: string | null;
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

/**
 * A defect endpoint answers 502 when Meta refused a copy, but still returns
 * the saved record in the body — the photo is stored either way.
 *
 * Pulling that record out lets the screens show what really happened instead
 * of a bare network error, and keeps them off a second POST, which would file
 * a duplicate defect. Anything without a record (404, 409, a real 500) is
 * rethrown so it surfaces as an error.
 */
function defectFromFailure(error: any): ApiResponse<DefectRecord> | null {
  const body = error?.response?.data;
  const record = body?.data;
  if (record && typeof record === 'object' && 'whatsapp_status' in record) {
    return { success: false, data: record as DefectRecord, message: body?.message };
  }
  return null;
}

export const sorterApi = {
  /**
   * The queue.
   *
   * `today` asks the server for the current business day; `date`
   * (YYYY-MM-DD) asks for a specific one. Either way the filtering happens in
   * SQL, so Request History never pulls the whole history down to the phone.
   */
  getOrders: async (
    stage?: SorterStage,
    options: { date?: string; today?: boolean; limit?: number } = {}
  ): Promise<ApiResponse<SorterQueue>> => {
    const params: Record<string, string | number> = {};
    if (stage) params.stage = stage;
    // scope=today lets the server decide which day "today" is, from the
    // configured business timezone — the handset clock never decides it.
    if (options.today) params.scope = 'today';
    if (options.date) params.date = options.date;
    if (options.limit) params.limit = options.limit;

    const response = await apiClient.get<ApiResponse<SorterQueue>>('/api/sorter/orders', {
      params: Object.keys(params).length ? params : undefined,
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
   * Reports a defective piece: uploads the photo and asks the backend to
   * notify the customer on WhatsApp.
   *
   * The photo travels as base64 in JSON. Meta credentials live only on the
   * server — this app never holds a WhatsApp token or phone number id.
   *
   * A resolved promise does NOT mean WhatsApp succeeded: check
   * `data.whatsapp_status`, which is only 'SENT' when Meta accepted it.
   */
  reportDefect: async (
    orderId: string,
    payload: { photoBase64: string; mimeType?: string; description?: string }
  ): Promise<ApiResponse<DefectRecord>> => {
    try {
      const response = await apiClient.post<ApiResponse<DefectRecord>>(
        `/api/sorter/orders/${orderId}/defect`,
        {
          photoBase64: payload.photoBase64,
          mimeType: payload.mimeType || 'image/jpeg',
          description: payload.description,
        },
        // A photo takes longer than a JSON call, and the server also has to
        // hand it to Meta before replying.
        { timeout: 60000 }
      );
      return response.data;
    } catch (error) {
      // 502 means the defect was saved but a WhatsApp copy was refused. That
      // is a real outcome to display, not a failed upload to repeat.
      const saved = defectFromFailure(error);
      if (saved) return saved;
      throw error;
    }
  },

  getDefects: async (orderId: string): Promise<ApiResponse<DefectRecord[]>> => {
    const response = await apiClient.get<ApiResponse<DefectRecord[]>>(
      `/api/sorter/orders/${orderId}/defects`
    );
    return response.data;
  },

  /**
   * Retries a failed WhatsApp notification. The server refuses with 409 if it
   * was already sent, unless `force` is passed — that is the duplicate guard.
   */
  retryDefectWhatsApp: async (
    orderId: string,
    defectId: string,
    force = false
  ): Promise<ApiResponse<DefectRecord>> => {
    try {
      const response = await apiClient.post<ApiResponse<DefectRecord>>(
        `/api/sorter/orders/${orderId}/defects/${defectId}/whatsapp`,
        { force },
        { timeout: 60000 }
      );
      return response.data;
    } catch (error) {
      // A refused send comes back 502 with the record; the 409 duplicate
      // guard carries no record and is rethrown as an error.
      const saved = defectFromFailure(error);
      if (saved) return saved;
      throw error;
    }
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
