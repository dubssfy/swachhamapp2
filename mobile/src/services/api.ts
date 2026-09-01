import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL, API_TIMEOUT } from '../constants/api';
import { DEMO_MODE, DEMO_NETWORK_BLOCKED_MESSAGE } from '../demo/demoMode';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * THE DEMO BUILD'S NETWORK KILL SWITCH.
 *
 * In a demo build NOTHING can leave the device through this client, whatever
 * calls it and by whatever path. Two independent stops, because this is the
 * guarantee the whole demo rests on:
 *
 *   1. a request interceptor that rejects every call, and
 *   2. an adapter that refuses as well — the adapter is the only thing that
 *      can actually open a socket, so replacing it holds even if an
 *      interceptor is somehow bypassed or the interceptor chain is reordered.
 *
 * This is belt-and-braces, not the mechanism. The demo serves every Business
 * call locally (see src/demo/), so in a correct demo build no request ever
 * arrives here; if one somehow did — a screen added later, a stray call in
 * shared code — it is refused rather than quietly reaching a production
 * server.
 *
 * `DEMO_MODE` is a build-time constant. In a production build it is `false`,
 * neither stop is installed, and the client behaves exactly as it always has.
 */
if (DEMO_MODE) {
  /** The refusal, shaped like a server response so callers read a message. */
  const blocked = (config: any) => {
    const target = `${config?.method?.toUpperCase() || 'GET'} ${config?.url || ''}`;
    if (__DEV__) console.warn(`[Demo] blocked network request: ${target}`);
    return Promise.reject({
      config,
      isDemoBlocked: true,
      message: DEMO_NETWORK_BLOCKED_MESSAGE,
      response: {
        status: 503,
        data: { success: false, message: DEMO_NETWORK_BLOCKED_MESSAGE },
      },
    });
  };

  apiClient.interceptors.request.use((config) => blocked(config) as any);
  apiClient.defaults.adapter = blocked;
}

// Attach JWT token to authenticated requests
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync(
        'swachham_access_token'
      );

      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Error reading authentication token:', error);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle authentication/server errors
apiClient.interceptors.response.use(
  (response) => response,

  async (error) => {
    if (error.response?.status === 401) {
      try {
        await SecureStore.deleteItemAsync(
          'swachham_access_token'
        );

        await SecureStore.deleteItemAsync(
          'swachham_user'
        );
      } catch (storageError) {
        console.error(
          'Error clearing authentication:',
          storageError
        );
      }
    }

    return Promise.reject(error);
  }
);

// Turns an Axios error into a message safe to show the user, distinguishing
// real network/timeout failures (no response received) from application-level
// errors the server already responded to (which carry their own message).
export function extractErrorMessage(error: any, fallback: string): string {
  if (error?.code === 'ECONNABORTED') {
    return 'Request timed out. Please check your connection and try again.';
  }

  if (!error?.response) {
    return 'Unable to reach the server. Please check your internet connection and try again.';
  }

  if (error.response.status >= 500) {
    return error.response.data?.message || 'Server is currently unavailable. Please try again later.';
  }

  return error.response.data?.message || error.message || fallback;
}

export default apiClient;