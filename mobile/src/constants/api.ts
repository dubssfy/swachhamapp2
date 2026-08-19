// Swachham App - API Constants

import Constants from 'expo-constants';

const BACKEND_PORT = 5000;
const ENV_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

// The dev machine's LAN IP changes with every DHCP lease, which is what broke
// this before (a stale IP baked into .env). In dev, Expo Go/dev client is
// already connected to Metro over the correct current LAN address — reuse
// that host for the backend instead of trusting a hand-set IP.
function resolveDevHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).expoGoConfig?.debuggerHost ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;
  if (!hostUri) return null;
  const host = String(hostUri).split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return host;
}

function resolveApiBaseUrl(): string {
  if (__DEV__) {
    const host = resolveDevHost();
    if (host) return `http://${host}:${BACKEND_PORT}`;
  }
  return ENV_API_BASE_URL || 'http://10.0.2.2:5000';
}

export const API_BASE_URL = resolveApiBaseUrl();

export const SOCKET_URL = API_BASE_URL;

export const API_TIMEOUT = 15000;

export const API_ENDPOINTS = {
  // Auth
  AUTH_CUSTOMER_REGISTER: '/api/auth/customer/register',
  AUTH_CUSTOMER_LOGIN: '/api/auth/customer/login',
  AUTH_CUSTOMER_VERIFY_MOBILE: '/api/auth/customer/verify-mobile',
  AUTH_CUSTOMER_RESEND_OTP: '/api/auth/customer/resend-otp',
  AUTH_CUSTOMER_FORGOT_PASSWORD: '/api/auth/customer/forgot-password',
  AUTH_CUSTOMER_VERIFY_RESET_OTP: '/api/auth/customer/verify-reset-otp',
  AUTH_CUSTOMER_RESET_PASSWORD: '/api/auth/customer/reset-password',
  AUTH_BUSINESS_LOGIN: '/api/auth/business/login',
  AUTH_ME: '/api/auth/me',
  AUTH_SORTER_LOGIN: '/api/auth/sorter/login',
  AUTH_LOGOUT: '/api/auth/logout',
  AUTH_CHANGE_PASSWORD: '/api/auth/change-password',
  AUTH_BUSINESS_REGISTER: '/api/auth/business/register',
  AUTH_ENTRY_SEND_OTP: '/api/auth/entry/send-otp',
  AUTH_ENTRY_VERIFY_OTP: '/api/auth/entry/verify-otp',
  AUTH_ENTRY_RESEND_OTP: '/api/auth/entry/resend-otp',
  // Profile
  PROFILE_UPDATE: '/api/users/profile',
  PROFILE_ADDRESSES: '/api/users/addresses',
  // Services
  SERVICES: '/api/services',
  SERVICE_CATEGORIES: '/api/services/categories',
  SERVICE_POPULAR: '/api/services/popular',
  // Cart
  CART: '/api/cart',
  CART_VALIDATE_COUPON: '/api/cart/validate-coupon',
  // Orders
  ORDERS: '/api/orders',
  // Notifications
  NOTIFICATIONS: '/api/notifications',
} as const;

export const SOCKET_EVENTS = {
  ORDER_STATUS_UPDATED: 'order:status_updated',
  PRODUCTION_STATUS_UPDATED: 'production:status_updated',
  NOTIFICATION: 'notification',
  JOIN_ORDER_ROOM: 'join:order',
  LEAVE_ORDER_ROOM: 'leave:order',
  JOIN_USER_ROOM: 'join:user',
} as const;
