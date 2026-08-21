import * as SecureStore from 'expo-secure-store';

/**
 * Stable per-install device identifier, used to bind an OTP to the handset
 * that requested it.
 *
 * The backend records a hash of this value when it issues an OTP and refuses
 * to verify that OTP from anywhere else, so a code read on one phone cannot
 * be typed into the app on another.
 *
 * It lives in the secure store (Keystore on Android, Keychain on iOS) rather
 * than AsyncStorage: that keeps it out of reach of other apps and of a plain
 * filesystem backup. It is a random value, not a hardware serial — nothing
 * about the user or the handset can be recovered from it.
 */
const DEVICE_ID_KEY = 'swachham.device_id';

/** Cached for the lifetime of the process so the keystore is hit once. */
let cachedDeviceId: string | null = null;

/**
 * Random, URL-safe, 32 characters — comfortably inside the 16..128 range the
 * API accepts, and drawn from the same alphabet its validator allows.
 */
function generateDeviceId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 32; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

/**
 * Returns this install's device id, creating and persisting one the first
 * time it is asked for.
 *
 * If the secure store is unavailable the id is still returned so the OTP flow
 * is never blocked outright — it simply will not survive a restart, which
 * shows up as "request a new OTP on this device" rather than a hard failure.
 */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
  } catch (error) {
    if (__DEV__) console.warn('[deviceId] could not read secure store', error);
  }

  const created = generateDeviceId();
  cachedDeviceId = created;

  try {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  } catch (error) {
    if (__DEV__) console.warn('[deviceId] could not persist device id', error);
  }

  return created;
}
