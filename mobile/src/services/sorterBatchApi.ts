import apiClient from './api';
import { ApiResponse } from '../types';

/**
 * Sorter batch processing API.
 *
 * A SEPARATE MODULE from `sorterApi`, deliberately. Everything the Sorter
 * already does — the queue, approval, the order detail, the acceptance and
 * delivery scanners, defects, adjustments, pending items — keeps calling
 * `sorterApi` exactly as it did; nothing in that file was changed for this
 * feature. Batch processing is an additional workflow, so it is an additional
 * module.
 *
 * It uses the same axios client, so the bearer token, base URL and error
 * shaping are the ones the app already has.
 *
 * NOTHING HERE OPTIMISES ANYTHING BY ITSELF. `startBatch` is called from a
 * button press and from nowhere else — never from a render, an effect, a
 * focus listener or a poll.
 */

/** Bath towels wash only with bath towels. Everything else is GENERAL. */
export type WashingGroup = 'TOWEL' | 'GENERAL';

export type MachineStatus = 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'OFFLINE' | 'COMPLETED';

export interface Machine {
  id: string;
  code: string;
  name: string;
  capacity_kg: number;
  status: MachineStatus;
}

/**
 * PROPOSED is what START BATCH returns and is never a stored row — it exists
 * only in the response the Sorter is reviewing. CONFIRMED is the first status
 * a batch actually has in the database.
 */
export type BatchStatus =
  | 'PROPOSED'
  | 'CONFIRMED'
  | 'IN_MACHINE'
  | 'WASHING'
  | 'COMPLETED'
  | 'CANCELLED';

/** One approved, unbatched order line waiting for a machine. */
export interface EligibleLine {
  order_item_id: string;
  order_id: string;
  order_number: string;
  item_name: string;
  washing_group: WashingGroup;
  quantity: number;
  weight_kg: number;
  /** When the SORTER APPROVED the order — the batch priority clock. */
  approved_at: string;
  waiting_minutes: number;
}

/** What the screen shows BEFORE the Sorter presses START BATCH. */
export interface BatchEligibility {
  approved_orders_ready: number;
  eligible_items: number;
  total_weight_kg: number;
  machines: Machine[];
  available_machines: number;
  optimization_window: number;
  lines: EligibleLine[];
}

export interface ProposedItem {
  order_item_id: string;
  order_id: string;
  order_number: string;
  item_name: string;
  /** Pieces of the line THIS drum takes. Less than `ordered_quantity` when split. */
  quantity: number;
  /** Weight of exactly those pieces. */
  weight_kg: number;
  /** True when the line is spread across more than one drum. */
  is_partial?: boolean;
  /** Pieces on the whole line, so the screen can show "13 of 50". */
  ordered_quantity?: number;
  washing_group: WashingGroup;
  approved_at: string;
}

export interface ProposedBatch {
  machine_id: string;
  machine_code: string;
  machine_name: string;
  capacity_kg: number;
  washing_group: WashingGroup;
  total_weight_kg: number;
  remaining_capacity_kg: number;
  /** (total / capacity) * 100, calculated by the server. */
  utilization_percentage: number;
  items: ProposedItem[];
}

export interface BatchProposal {
  proposal_id: string;
  generated_at: string;
  batches: ProposedBatch[];
  /** Eligible lines the plan did not take, each with the reason why. */
  unplaced: Array<ProposedItem & { reason: string }>;
  total_weight_kg: number;
  overall_utilization_percentage: number;
  machines_used: number;
  approved_orders_ready: number;
  eligible_items: number;
  machines: Machine[];
  stats: {
    eligibleItems: number;
    windowSize: number;
    plansEvaluated: number;
    candidatesEvaluated: number;
    executionMs: number;
  };
}

export interface BatchRecord {
  id: string;
  batch_number: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  capacity_kg: number;
  washing_group: WashingGroup;
  total_weight_kg: number;
  item_count: number;
  status: BatchStatus;
  utilization_percentage: number;
  created_by: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  created_at: string;
  items?: Array<{
    id: string;
    order_id: string;
    order_number: string;
    order_item_id: string;
    item_name: string;
    /** Pieces of the line in THIS batch. Less than `ordered_quantity` when split. */
    quantity: number;
    /** Weight of exactly those pieces. */
    weight_kg: number;
    /** True when the line is spread across more than one drum. */
    is_partial?: boolean;
    /** Pieces on the whole line, so a tag can read "13 of 50". */
    ordered_quantity?: number;
    /** For PRINT TAG. */
    establishment_name: string;
  }>;
}

export interface BatchScanStatus {
  batch_id: string;
  batch_number: string;
  status: BatchStatus;
  expected_count: number;
  scanned_count: number;
  remaining_count: number;
  quantity_matched: boolean;
  garments: Array<{
    id: string;
    barcode: string;
    item_name: string;
    order_id: string;
    order_number: string;
    scanned_at: string | null;
  }>;
}

export interface BatchScanResult {
  success: true;
  barcode: string;
  garment: { id: string; item_name: string; order_number: string };
  batch_id: string;
  batch_number: string;
  scannedCount: number;
  expectedCount: number;
  remainingCount: number;
  quantityMatched: boolean;
  message: string;
}

export const sorterBatchApi = {
  /**
   * How much approved laundry is waiting, and what the machines are doing.
   *
   * A READ ONLY. Opening the Batch Processing screen must not start an
   * optimisation, so this endpoint does not run one.
   */
  getEligibility: async (): Promise<ApiResponse<BatchEligibility>> => {
    const response = await apiClient.get<ApiResponse<BatchEligibility>>(
      '/api/sorter/batch-eligible-orders'
    );
    return response.data;
  },

  /**
   * START BATCH — and REGENERATE, which is the same call.
   *
   * The server calculates the distribution and returns it. NOTHING IS
   * WRITTEN: no batch, no machine reservation, no order status. Call this
   * from a button press only.
   */
  startBatch: async (): Promise<ApiResponse<BatchProposal>> => {
    const response = await apiClient.post<ApiResponse<BatchProposal>>(
      '/api/sorter/batches/optimize'
    );
    return response.data;
  },

  /**
   * CONFIRM BATCH — the only call that makes the distribution permanent.
   *
   * Sends machine ids and order line ids and nothing else: the weights, the
   * washing groups and the eligibility are all re-read and re-checked on the
   * server, inside a transaction, so this request cannot assert any of them.
   *
   * A 409 means the proposal went stale — a machine was taken, or another
   * sorter batched one of these lines. The screen's answer to that is
   * REGENERATE.
   */
  confirmBatch: async (
    batches: Array<{ machineId: string; lines: Array<{ orderItemId: string; quantity: number }> }>
  ): Promise<ApiResponse<{ batches: BatchRecord[]; total_weight_kg: number }>> => {
    const response = await apiClient.post<
      ApiResponse<{ batches: BatchRecord[]; total_weight_kg: number }>
    >('/api/sorter/batches/confirm', { batches });
    return response.data;
  },

  /** The batches on the floor. `status` narrows the list. */
  getBatches: async (status?: BatchStatus): Promise<ApiResponse<BatchRecord[]>> => {
    const response = await apiClient.get<ApiResponse<BatchRecord[]>>('/api/sorter/batches', {
      params: status ? { status } : undefined,
    });
    return response.data;
  },

  getBatchById: async (batchId: string): Promise<ApiResponse<BatchRecord>> => {
    const response = await apiClient.get<ApiResponse<BatchRecord>>(
      `/api/sorter/batches/${batchId}`
    );
    return response.data;
  },

  /**
   * Moves a batch along. The server validates the transition, so an
   * out-of-order request comes back as an error rather than being applied.
   */
  updateBatchStatus: async (
    batchId: string,
    status: BatchStatus
  ): Promise<ApiResponse<BatchRecord>> => {
    const response = await apiClient.patch<ApiResponse<BatchRecord>>(
      `/api/sorter/batches/${batchId}/status`,
      { status }
    );
    return response.data;
  },

  getMachines: async (): Promise<ApiResponse<Machine[]>> => {
    const response = await apiClient.get<ApiResponse<Machine[]>>('/api/sorter/machines');
    return response.data;
  },

  updateMachineStatus: async (
    machineId: string,
    status: MachineStatus
  ): Promise<ApiResponse<Machine>> => {
    const response = await apiClient.patch<ApiResponse<Machine>>(
      `/api/sorter/machines/${machineId}/status`,
      { status }
    );
    return response.data;
  },

  /* ---- Batch barcode scanning ----
   *
   * The existing order scanners in `sorterApi` are untouched and keep their
   * own counts. These read and write the batch stage only.
   */

  getBatchScanStatus: async (batchId: string): Promise<ApiResponse<BatchScanStatus>> => {
    const response = await apiClient.get<ApiResponse<BatchScanStatus>>(
      `/api/sorter/batches/${batchId}/scan-status`
    );
    return response.data;
  },

  /**
   * One barcode against one batch.
   *
   * The counts come back from the server — the screen never adds anything up
   * itself, which is what makes a repeated read of the same label harmless.
   * A rejection is an error whose message is already user-facing: "WRONG
   * BATCH — …", "ALREADY SCANNED — …".
   */
  scanBatchGarment: async (
    batchId: string,
    barcode: string
  ): Promise<ApiResponse<BatchScanResult>> => {
    const response = await apiClient.post<ApiResponse<BatchScanResult>>(
      `/api/sorter/batches/${batchId}/scan`,
      { barcode }
    );
    return response.data;
  },
};

/** How each batch status is labelled and coloured across the batch screens. */
export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  PROPOSED: 'PROPOSED',
  CONFIRMED: 'CONFIRMED',
  IN_MACHINE: 'IN MACHINE',
  WASHING: 'WASHING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

/** The washing group, in the words the shop floor uses. */
export const WASHING_GROUP_LABEL: Record<WashingGroup, string> = {
  TOWEL: 'TOWEL',
  GENERAL: 'GENERAL',
};

export default sorterBatchApi;
