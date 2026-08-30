import * as Location from 'expo-location';

/**
 * "USE MY CURRENT LOCATION" — one implementation, for every address form.
 *
 * There are two places a customer types an address: the Address screen, and
 * the inline form at checkout. Both call this, so the permission wording, the
 * fallbacks and the shape of what comes back cannot drift apart between them.
 *
 * IT USES THE APP'S EXISTING GEOLOCATION, `expo-location` — the same module
 * checkout already uses to take the device fix that the service-area check
 * runs on. Nothing new is introduced to ask the phone where it is.
 *
 * THE COORDINATES ARE THE POINT, NOT THE TEXT. The delivery charge is
 * measured from `latitude`/`longitude`; the street, city and PIN are for the
 * rider to read. So a fix whose reverse-geocode fails is still a SUCCESS —
 * the coordinates come back with whatever text could be resolved, and the
 * customer fills the rest in. Throwing that fix away because a name lookup
 * failed would lose the only part that affects the bill.
 */

export interface DetectedAddress {
  /** House, street and locality, as one line for the `full_address` field. */
  full_address: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

export type DetectLocationResult =
  | { ok: true; address: DetectedAddress }
  /**
   * `denied` is not a failure to report as an error — it is the customer's
   * answer. The caller says so plainly and leaves the manual fields alone.
   */
  | { ok: false; reason: 'denied' | 'unavailable'; message: string };

/** Joins the parts of an address line, dropping the ones that are missing. */
function line(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join(', ');
}

/**
 * Asks the phone where it is and turns that into address fields.
 *
 * Never throws: every outcome is one of the two result shapes, because a
 * button that can leave a form in an unknown state is worse than one that
 * reports what happened.
 */
export async function detectCurrentAddress(): Promise<DetectLocationResult> {
  let position: Location.LocationObject | null = null;

  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      return {
        ok: false,
        reason: 'denied',
        message:
          'Location permission was not given, so we could not detect your address. ' +
          'You can type it in below instead.',
      };
    }

    /*
     * A recent cached fix first, then a live one. Asking for a live fix
     * outright makes the button sit there for several seconds on a cold GPS,
     * and a fix from the last two minutes is the same address.
     */
    position =
      (await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  } catch {
    position = null;
  }

  if (!position) {
    return {
      ok: false,
      reason: 'unavailable',
      message:
        'Your location could not be found. Move to an open area and try again, ' +
        'or type your address in below.',
    };
  }

  const { latitude, longitude } = position.coords;

  // The name lookup is allowed to fail. The fix is what matters.
  let place: Location.LocationGeocodedAddress | null = null;
  try {
    place = (await Location.reverseGeocodeAsync({ latitude, longitude }))[0] ?? null;
  } catch {
    place = null;
  }

  return {
    ok: true,
    address: {
      full_address: line(
        place?.name,
        // `name` is often the street number and street already; street is
        // added only when it says something the name did not.
        place?.street && place.street !== place?.name ? place.street : null,
        place?.district
      ),
      area: (place?.district || place?.subregion || '').trim(),
      city: (place?.city || place?.subregion || place?.district || '').trim(),
      state: (place?.region || '').trim(),
      pincode: (place?.postalCode || '').trim(),
      latitude,
      longitude,
    },
  };
}

export default detectCurrentAddress;
