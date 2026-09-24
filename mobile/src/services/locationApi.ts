import apiClient from './api';
import { ApiResponse } from '../types';

/**
 * Service-area API.
 *
 * The decision is always the server's: this client sends coordinates and
 * reads the answer. It never sends a district name, because the backend does
 * not read one — the district is derived from the coordinates.
 */

export interface ServiceAreaResult {
  allowed: boolean;
  district: string;
  message?: string;
  /** True when the point was outside but within the GPS tolerance margin. */
  nearBoundary?: boolean;
  distanceM?: number;
}

export const locationApi = {
  /*
   * `accessCode` is the Google Play reviewer's way past the service-area
   * screen, which runs before any sign-in and would otherwise stop a reviewer
   * outside Ratnagiri from ever reaching the app. It is only ever sent when
   * somebody typed one, the server decides whether it is right, and it grants
   * browsing only -- placing an order is still checked against coordinates.
   */
  checkServiceArea: async (
    latitude: number,
    longitude: number,
    accuracy?: number,
    accessCode?: string
  ): Promise<ApiResponse<ServiceAreaResult>> => {
    const response = await apiClient.post<ApiResponse<ServiceAreaResult>>(
      '/api/location/check-service-area',
      { latitude, longitude, accuracy, ...(accessCode ? { accessCode } : {}) },
      // A location check should not hang the order flow.
      { timeout: 15000 }
    );
    return response.data;
  },
};

export default locationApi;
