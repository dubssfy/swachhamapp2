/**
 * THE DEMO SWITCH.
 *
 * ONE flag, decided at BUILD time, that separates two worlds that must never
 * touch:
 *
 *   Production build   DEMO_MODE === false   real API  -> real database
 *   Demo build         DEMO_MODE === true    local mock data -> device storage
 *
 * `process.env.EXPO_PUBLIC_*` is INLINED by Metro when the bundle is built —
 * it is not read at runtime. In a production build the string below is
 * literally replaced with `undefined`, so `DEMO_MODE` is a compile-time
 * `false`, every `if (DEMO_MODE)` branch is dead code, and nothing about the
 * production app changes. The demo APK is built with the variable set to '1'
 * by the `demo` profile in eas.json, and nothing else in the project sets it.
 *
 * WRITE THE EXPRESSION EXACTLY AS IT IS. Metro matches the literal text
 * `process.env.EXPO_PUBLIC_...`; assigning it to a variable first, or reading
 * it through a computed key, defeats the substitution and the flag would
 * silently be false in the built APK.
 */
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === '1';

/**
 * The credentials shown on, and accepted by, the demo login screen.
 *
 * They are checked entirely on the device (see `demoAuth.ts`). No account
 * with this address exists in the production database, and no request is made
 * to look for one.
 */
export const DEMO_EMAIL = 'demo@hotel.com';
export const DEMO_PASSWORD = 'demo123';

/** The wording of the small badge carried through the demo app. */
export const DEMO_BADGE_LABEL = 'BUSINESS DEMO';

/**
 * Thrown by the API client if anything at all attempts a network request
 * while the demo build is running. It is a developer-facing safety net: in a
 * correct demo build no code path reaches it, because every Business call is
 * served locally.
 */
export const DEMO_NETWORK_BLOCKED_MESSAGE =
  'Demo Mode is offline by design — this build never contacts a server.';
