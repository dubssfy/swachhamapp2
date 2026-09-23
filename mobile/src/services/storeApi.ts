import apiClient from './api';
import { ApiResponse } from '../types';

/**
 * The public Store Locator API.
 *
 * Separate from `businessOrderApi.getNearbyStores`, which calls
 * `/api/businesses/stores/nearby` — that route sits behind
 * `authorize('BUSINESS')` and a customer's token is refused by it. This one
 * calls `/api/stores`, which is deliberately public so the locator works for
 * any signed-in role, and before anyone signs in at all.
 *
 * Both read the same `stores` table server-side and both see only rows that
 * are active and not soft-deleted, so the two locators cannot disagree about
 * which stores exist.
 */

export interface PublicStore {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number;
  longitude: number;
  contact_number: string | null;
  email: string | null;
  /** "HH:MM:SS", or null when the store has not published hours. */
  opening_time: string | null;
  closing_time: string | null;
  /** Present only when the request carried coordinates. */
  distance_km?: number;
}

export const storeApi = {
  /**
   * Active stores.
   *
   * With coordinates, the server returns them nearest-first and puts a
   * `distance_km` on each. Without, it returns them ordered by name and with
   * no distance — which is what lets the locator still show something when
   * the location permission is refused or no fix has arrived.
   */
  getStores: async (params?: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
  }): Promise<PublicStore[]> => {
    const response = await apiClient.get<ApiResponse<PublicStore[]>>('/api/stores', {
      params,
    });
    return response.data.data;
  },
};

export default storeApi;
