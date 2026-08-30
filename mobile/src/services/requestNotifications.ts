import * as SecureStore from 'expo-secure-store';
import { CreationRequest } from './superAdminApi';

/**
 * NEW-REQUEST DETECTION for the Super Admin's request sections.
 *
 * THE THREE REQUEST TYPES ARE THE ONES THAT EXIST. `creation_requests` is
 * `enum('BUSINESS','RIDER','SORTER')` and `REQUEST_TYPES` in
 * `creationRequest.service` says the same. A Manager is the person who RAISES
 * these — the Managers tile on the dashboard opens an account screen, not a
 * request queue — so there is no fourth type to notify about.
 *
 * ============================================================
 * NO NEW STORE, AND NO NEW POLLING
 * ============================================================
 *
 * The requests come from `GET /api/super-admin/requests?status=PENDING`, the
 * endpoint the Requests screen already reads, and detection runs inside the
 * dashboard's existing `load()` — on focus and on pull-to-refresh. Nothing new
 * fetches on a timer, because the app has no socket client (`socket.io-client`
 * is not a dependency) and adding one for a badge would be new infrastructure
 * for a problem the existing refresh already solves.
 *
 * ============================================================
 * WHAT MAKES A REQUEST "NEW", AND WHY THERE ARE TWO MARKERS
 * ============================================================
 *
 * Ids are auto-increment, so "higher than the last one we knew about" is a
 * complete and cheap test — no timestamps to compare across clocks, and no
 * list of ids to grow forever.
 *
 *   notified   the highest id a POPUP has already been raised for. Bumped the
 *              moment one is shown, so the same request cannot pop up twice —
 *              not on the next refresh, not on the next app start.
 *
 *   seen       the highest id the admin has actually LOOKED AT, bumped only by
 *              opening that section. This is what the badge counts from.
 *
 * They are separate because dismissing a popup is not reading the request.
 * With one marker, closing the toast would silently clear the badge and the
 * request would be forgotten — which is the failure this feature exists to
 * prevent.
 *
 * FIRST RUN NOTIFIES NOBODY. With nothing stored, both markers are set to the
 * current highest id and no popup is raised, so opening the dashboard for the
 * first time does not announce every request in the backlog.
 */

/** The request sections that actually exist. Mirrors the DB enum. */
export const REQUEST_TYPES = ['BUSINESS', 'RIDER', 'SORTER'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** What each section is called in a notification. */
export const REQUEST_LABELS: Record<RequestType, string> = {
  BUSINESS: 'Business Request',
  RIDER: 'Rider Request',
  SORTER: 'Sorter Request',
};

/** The icon each section already uses on the dashboard. */
export const REQUEST_ICONS: Record<RequestType, string> = {
  BUSINESS: 'business-outline',
  RIDER: 'bicycle-outline',
  SORTER: 'shirt-outline',
};

type Marks = Record<RequestType, number>;

const EMPTY: Marks = { BUSINESS: 0, RIDER: 0, SORTER: 0 };

/*
 * SecureStore, which is the only key-value store this app has —
 * `@react-native-async-storage/async-storage` is not a dependency. These are
 * two integers per device, not secrets; SecureStore is used because it is what
 * is here, not because the values need protecting.
 */
const NOTIFIED_KEY = 'swachham_request_notified';
const SEEN_KEY = 'swachham_request_seen';

/** Reads a marker set, tolerating a missing or corrupt value. */
async function readMarks(key: string): Promise<Marks> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      BUSINESS: Number(parsed?.BUSINESS) || 0,
      RIDER: Number(parsed?.RIDER) || 0,
      SORTER: Number(parsed?.SORTER) || 0,
    };
  } catch {
    // A store that cannot be read means "we know nothing yet", which the
    // first-run rule below then handles safely.
    return { ...EMPTY };
  }
}

async function writeMarks(key: string, marks: Marks): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(marks));
  } catch {
    // Persisting is best-effort. Losing it re-arms the first-run rule, which
    // stays silent rather than replaying old requests as new.
  }
}

/** True once either marker has ever been written on this device. */
const INITIALISED_KEY = 'swachham_request_marks_initialised';

async function isInitialised(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(INITIALISED_KEY)) === '1';
  } catch {
    return false;
  }
}

/** The highest id per type in a list of requests. Missing types stay 0. */
function highestPerType(requests: CreationRequest[]): Marks {
  const marks: Marks = { ...EMPTY };
  for (const request of requests) {
    const type = String(request.request_type) as RequestType;
    if (!REQUEST_TYPES.includes(type)) continue;
    const id = Number(request.id) || 0;
    if (id > marks[type]) marks[type] = id;
  }
  return marks;
}

export interface RequestAlert {
  type: RequestType;
  /** "Business Request". */
  label: string;
  icon: string;
  /** How many new ones arrived for this type in this pass. */
  count: number;
  /** The newest one, for naming who it is from. */
  latest: CreationRequest;
}

export interface DetectionResult {
  /** Unseen count per type, for the badges. */
  badges: Marks;
  /**
   * One alert per type that has genuinely new requests, newest first.
   * Empty on first run, and empty for a type whose requests have all already
   * been popped up for.
   */
  alerts: RequestAlert[];
}

/**
 * Compares the pending requests just fetched against what this device has
 * already notified and seen.
 *
 * PURE APART FROM THE MARKERS: it takes the list rather than fetching it, so
 * the caller's existing request already serves both the screen and this.
 *
 * EACH TYPE IS COMPLETELY SEPARATE. Every count, marker and alert is computed
 * per type from that type's own rows, so a new Business request cannot raise a
 * Rider badge or a Sorter popup.
 */
export async function detectNewRequests(
  pending: CreationRequest[]
): Promise<DetectionResult> {
  const highest = highestPerType(pending);

  // FIRST RUN: adopt the current state as the baseline and say nothing.
  if (!(await isInitialised())) {
    await writeMarks(NOTIFIED_KEY, highest);
    await writeMarks(SEEN_KEY, highest);
    try { await SecureStore.setItemAsync(INITIALISED_KEY, '1'); } catch { /* best effort */ }
    return { badges: { ...EMPTY }, alerts: [] };
  }

  const notified = await readMarks(NOTIFIED_KEY);
  const seen = await readMarks(SEEN_KEY);

  const badges: Marks = { ...EMPTY };
  const alerts: RequestAlert[] = [];

  for (const type of REQUEST_TYPES) {
    const mine = pending
      .filter((r) => String(r.request_type) === type)
      .sort((a, b) => Number(b.id) - Number(a.id));

    // The badge counts what has not been LOOKED AT.
    badges[type] = mine.filter((r) => Number(r.id) > seen[type]).length;

    // The popup fires only for what has not been ANNOUNCED.
    const fresh = mine.filter((r) => Number(r.id) > notified[type]);
    if (fresh.length > 0) {
      alerts.push({
        type,
        label: REQUEST_LABELS[type],
        icon: REQUEST_ICONS[type],
        count: fresh.length,
        latest: fresh[0],
      });
    }
  }

  /*
   * The notified marker moves as soon as the alerts are handed back — not
   * when the popup is dismissed. A dismissal that never happens (the app is
   * backgrounded, the screen unmounts) would otherwise leave the same request
   * popping up forever.
   *
   * `seen` is deliberately NOT touched here: only opening a section marks a
   * request read. See `markSectionSeen`.
   */
  if (alerts.length > 0) {
    await writeMarks(NOTIFIED_KEY, {
      BUSINESS: Math.max(notified.BUSINESS, highest.BUSINESS),
      RIDER: Math.max(notified.RIDER, highest.RIDER),
      SORTER: Math.max(notified.SORTER, highest.SORTER),
    });
  }

  return { badges, alerts };
}

/**
 * Marks one section read, which is what clears its badge.
 *
 * Called when the admin OPENS that section — from the tile or from a popup —
 * because that is the moment they have actually been shown the requests. It
 * touches only the type given, so opening Business leaves the Rider and
 * Sorter badges exactly as they were.
 *
 * NOTHING ABOUT THE REQUEST ITSELF CHANGES. This writes a local marker; it
 * approves nothing, rejects nothing and calls no request API.
 */
export async function markSectionSeen(
  type: RequestType,
  pending: CreationRequest[]
): Promise<void> {
  const highest = highestPerType(pending);
  const seen = await readMarks(SEEN_KEY);
  const notified = await readMarks(NOTIFIED_KEY);
  await writeMarks(SEEN_KEY, { ...seen, [type]: Math.max(seen[type], highest[type]) });
  // Reading a section also counts as having been told about it, so a popup
  // cannot arrive afterwards for something already on screen.
  await writeMarks(NOTIFIED_KEY, {
    ...notified,
    [type]: Math.max(notified[type], highest[type]),
  });
}

/** Test seam: forgets every marker, so the next detection is a first run. */
export async function resetRequestMarks(): Promise<void> {
  for (const key of [NOTIFIED_KEY, SEEN_KEY, INITIALISED_KEY]) {
    try { await SecureStore.deleteItemAsync(key); } catch { /* best effort */ }
  }
}
