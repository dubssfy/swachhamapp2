/**
 * DEMO SIGN-IN.
 *
 * The whole of it: a string comparison on the device. There is no request, no
 * OTP, no token to obtain and no account to look up, so the demo signs in with
 * the phone in aeroplane mode from the first launch onwards.
 *
 * The "token" below is a fixed marker, not a credential. It exists because the
 * session the app already stores has a token field; it authorises nothing,
 * because in a demo build there is nothing to authorise against — the API
 * client refuses every request outright (see services/api.ts).
 */

import type { User } from '../types';
import { DEMO_EMAIL, DEMO_PASSWORD } from './demoMode';
import { DEMO_PROFILE } from './demoCatalog';

/** Marks a stored session as belonging to the demo. Grants nothing. */
export const DEMO_TOKEN = 'demo-mode-local-session';

/**
 * The signed-in demo user.
 *
 * `role: 'business'` is what puts the navigator on the Business stack — the
 * same value a real business account carries, so the section behaves
 * identically.
 */
export const DEMO_USER: User = {
  id: 'demo-business-user',
  name: DEMO_PROFILE.contact_person_name || 'Demo User',
  email: DEMO_EMAIL,
  mobile: DEMO_PROFILE.mobile_number || '',
  role: 'business',
  business_name: DEMO_PROFILE.business_name,
  businessName: DEMO_PROFILE.business_name,
  establishment_name: DEMO_PROFILE.business_name,
  establishmentName: DEMO_PROFILE.business_name,
  isVerified: true,
  mobileVerified: true,
};

/** What the login screen says when the credentials do not match. */
export const DEMO_CREDENTIALS_MESSAGE =
  'Use the demo credentials shown below to sign in.';

/**
 * Whether these are the demo credentials.
 *
 * The email is compared case-insensitively and trimmed, because a phone
 * keyboard will capitalise the first letter of an email field; the password is
 * compared exactly.
 */
export function isDemoCredential(email: string, password: string): boolean {
  return email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD;
}
