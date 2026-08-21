import { create } from 'zustand';
import * as Location from 'expo-location';
import locationApi from '../services/locationApi';
import { extractErrorMessage } from '../services/api';

/**
 * The app's one and only location check.
 *
 * It runs on the Allow Permission page when the app opens: permission, a
 * single GPS fix, and the server's verdict on whether that coordinate is
 * inside Ratnagiri district. Passing it is what lets the user into the app.
 *
 * Nothing after that point checks again — not login, not the business
 * catalogue, not the cart, and not Place Order. Those flows never read this
 * store either; it exists so the permission page can hold its verdict across
 * re-renders and so a second visit to the page does not re-take a fix.
 */

export type LocationGateStatus =
  | 'idle'
  | 'checking'
  /** Inside the district: the user may continue into the app. */
  | 'verified'
  | 'outside'
  | 'permission-denied'
  | 'services-disabled'
  | 'location-error'
  | 'check-failed';

export interface LocationGateResult {
  status: LocationGateStatus;
  message: string;
  district: string | null;
}

interface LocationGateState extends LocationGateResult {
  isChecking: boolean;
  /**
   * Runs the check. Resolves to the outcome, so the caller can act on it
   * without waiting for a re-render.
   *
   * A verdict already reached this app session is reused unless `force` is
   * passed, which is what the Retry button uses.
   */
  verify: (options?: { force?: boolean }) => Promise<LocationGateResult>;
  isVerified: () => boolean;
  reset: () => void;
}

export const PERMISSION_DENIED_MESSAGE =
  'Location permission is required to continue. Please enable location permission and try again.';

export const OUTSIDE_DISTRICT_MESSAGE =
  'Our services are currently available only within Ratnagiri district.';

const INITIAL = {
  status: 'idle' as LocationGateStatus,
  message: '',
  district: null as string | null,
  isChecking: false,
};

/** A fix this old is not worth reusing for a district decision. */
const MAX_FIX_AGE_MS = 60_000;
/** Give up rather than leaving the user staring at a spinner. */
const FIX_TIMEOUT_MS = 15_000;

/** Stops two taps running two checks at once. */
let inFlight: Promise<LocationGateResult> | null = null;

export const useLocationGateStore = create<LocationGateState>((set, get) => ({
  ...INITIAL,

  isVerified: () => get().status === 'verified',

  verify: async (options = {}) => {
    const settle = (next: LocationGateResult) => {
      set({ ...next, isChecking: false });
      return next;
    };

    if (!options.force && get().status === 'verified') {
      const { status, message, district } = get();
      return { status, message, district };
    }

    if (inFlight) return inFlight;

    const run = async (): Promise<LocationGateResult> => {
      try {
        set({ ...INITIAL, status: 'checking', isChecking: true });

        // Location services off at the OS level: asking for a fix would just
        // hang, so say what is actually wrong.
        const servicesOn = await Location.hasServicesEnabledAsync();
        if (!servicesOn) {
          return settle({
            status: 'services-disabled',
            message:
              'Location services are turned off. Please turn on location on your phone and try again.',
            district: null,
          });
        }

        const { status: permission } = await Location.requestForegroundPermissionsAsync();
        if (permission !== Location.PermissionStatus.GRANTED) {
          // A denial is never read as "probably inside" — it blocks.
          return settle({
            status: 'permission-denied',
            message: PERMISSION_DENIED_MESSAGE,
            district: null,
          });
        }

        // A recent fix is good enough and returns instantly; otherwise take a
        // fresh one. Balanced accuracy is plenty to decide which district you
        // are in, and it is far quicker than the highest setting.
        let position = await Location.getLastKnownPositionAsync({ maxAge: MAX_FIX_AGE_MS });
        if (!position) {
          position = await withTimeout(
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            FIX_TIMEOUT_MS
          );
        }

        if (!position) {
          return settle({
            status: 'location-error',
            message: 'Your location could not be found. Please move to an open area and try again.',
            district: null,
          });
        }

        // The device's real coordinates — never a hardcoded pair.
        const { latitude, longitude, accuracy } = position.coords;

        // The server decides. This app never runs the boundary test itself.
        const response = await locationApi.checkServiceArea(
          latitude,
          longitude,
          typeof accuracy === 'number' ? accuracy : undefined
        );
        const result = response.data;

        if (result.allowed) {
          return settle({
            status: 'verified',
            message: 'Location verified',
            district: result.district,
          });
        }

        return settle({
          status: 'outside',
          message: result.message || OUTSIDE_DISTRICT_MESSAGE,
          district: result.district,
        });
      } catch (error: any) {
        // A 403 is a real answer — the server checked and said no.
        if (error?.response?.status === 403) {
          return settle({
            status: 'outside',
            message: error.response.data?.message || OUTSIDE_DISTRICT_MESSAGE,
            district: null,
          });
        }
        // Anything else is "could not check", which must not be mistaken for
        // "you are outside" — the user gets a retry, not a rejection.
        return settle({
          status: 'check-failed',
          message: extractErrorMessage(
            error,
            'We could not check availability in your area. Please try again.'
          ),
          district: null,
        });
      }
    };

    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  },

  reset: () => {
    inFlight = null;
    set({ ...INITIAL });
  },
}));

/** Resolves null instead of hanging forever on a fix that never arrives. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default useLocationGateStore;
