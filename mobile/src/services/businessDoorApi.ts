import apiClient from './api';
import { ApiResponse } from '../types';

/**
 * DOOR TICKETS AND RIDER MESSAGES — the business's side.
 *
 * When a rider takes a load WITHOUT counting it, they raise a ticket and then
 * WAIT. Nothing moves until the business accepts it here, so this is not a
 * passive inbox: the accept call is what releases a rider standing at the
 * door.
 *
 * The business is taken from the bearer token on the server — there is no id
 * to pass and no way to name another business's ticket.
 *
 * WHY THIS IS NOT `notifications`. A business account lives in
 * `business_users`, and the `notifications` table's `user_id` is a foreign key
 * to `users` — a different table with its own ids — so a business has never
 * been addressable there. These endpoints read `business_messages`, which
 * exists for exactly that reason. See migration 062.
 */

export type DoorTicketStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface DoorTicket {
  ticket_id: string;
  order_id: string;
  order_number: string | null;
  job_id: string;
  status: DoorTicketStatus;
  created_at: string;
  accepted_at: string | null;
  rejected_at?: string | null;
  rider_name: string | null;
  address_text: string | null;
  item_count: number;
  weight_kg: number;
}

/**
 * A quantity mismatch from the rider's item-by-item check.
 *
 * Accepting sets that order line to `checked_quantity`; rejecting leaves it
 * alone and the rider has to recheck before the order moves on.
 */
export interface DoorItemTicket {
  check_id: string;
  order_id: string;
  order_number: string | null;
  order_item_id: string;
  job_id: string;
  item_name: string;
  ordered_quantity: number;
  checked_quantity: number;
  /** checked - ordered. Negative when fewer pieces were found. */
  difference: number;
  remark: 'DAMAGED_ITEM' | 'QUANTITY_MISMATCHED' | 'OTHER' | null;
  remark_label: string | null;
  /** The rider's own words when the remark is Other. */
  remark_note?: string | null;
  ticket_status: DoorTicketStatus | null;
  quantity_before: number | null;
  created_at: string;
  resolved_at: string | null;
  /** A recheck has since replaced this line. */
  superseded: boolean;
  rider_name: string | null;
  rider_mobile: string | null;
}

export interface BusinessMessage {
  id: string;
  order_id: string | null;
  order_number: string | null;
  ticket_id: string | null;
  /** DOOR_CHECKED or DOOR_UNCOUNTED_AGREED. */
  type: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export interface InboxCounts {
  unread_messages: number;
  /** Uncounted pickups waiting on the business. */
  pending_tickets: number;
  /** Quantity mismatches waiting on the business. Absent on an older server. */
  pending_item_tickets?: number;
}

const businessDoorApi = {
  /** Tickets waiting on this business. A rider is blocked on each one. */
  getPendingTickets: async (): Promise<ApiResponse<DoorTicket[]>> => {
    const response = await apiClient.get('/api/businesses/door-tickets');
    return response.data;
  },

  /**
   * Accept a ticket.
   *
   * This releases the rider AND sends them the mismatch notice. Accepting a
   * ticket that is already accepted is not an error — it reports the same
   * ticket back with `messaged: false`, so a double tap cannot post the
   * notice twice.
   */
  acceptTicket: async (
    ticketId: string
  ): Promise<ApiResponse<{ ticket: DoorTicket; messaged: boolean }>> => {
    const response = await apiClient.post(`/api/businesses/door-tickets/${ticketId}/accept`);
    return response.data;
  },

  /**
   * Reject an uncounted pickup. The order does not proceed on it: the rider is
   * sent back to count the load item by item.
   */
  rejectTicket: async (ticketId: string): Promise<ApiResponse<{ ticket: DoorTicket }>> => {
    const response = await apiClient.post(`/api/businesses/door-tickets/${ticketId}/reject`);
    return response.data;
  },

  /** Uncounted pickups answered in the last 30 days. */
  getRecentTickets: async (): Promise<ApiResponse<DoorTicket[]>> => {
    const response = await apiClient.get('/api/businesses/door-tickets', {
      params: { scope: 'recent' },
    });
    return response.data;
  },

  /** Quantity mismatches — pending (the queue) or recent (answered). */
  getItemTickets: async (
    scope: 'pending' | 'recent' = 'pending'
  ): Promise<ApiResponse<DoorItemTicket[]>> => {
    const response = await apiClient.get('/api/businesses/door-item-tickets', {
      params: { scope },
    });
    return response.data;
  },

  /** That order line takes the rider's checked quantity. */
  acceptItemTicket: async (
    checkId: string
  ): Promise<ApiResponse<{ ticket: DoorItemTicket; updated: boolean }>> => {
    const response = await apiClient.post(`/api/businesses/door-item-tickets/${checkId}/accept`);
    return response.data;
  },

  /** The quantity stays as ordered, and the rider must recheck the item. */
  rejectItemTicket: async (checkId: string): Promise<ApiResponse<{ ticket: DoorItemTicket }>> => {
    const response = await apiClient.post(`/api/businesses/door-item-tickets/${checkId}/reject`);
    return response.data;
  },

  getMessages: async (): Promise<ApiResponse<BusinessMessage[]>> => {
    const response = await apiClient.get('/api/businesses/messages');
    return response.data;
  },

  getInboxCounts: async (): Promise<ApiResponse<InboxCounts>> => {
    const response = await apiClient.get('/api/businesses/inbox-counts');
    return response.data;
  },

  markMessagesRead: async (): Promise<ApiResponse<{ updated: number }>> => {
    const response = await apiClient.post('/api/businesses/messages/read');
    return response.data;
  },
};

export default businessDoorApi;
