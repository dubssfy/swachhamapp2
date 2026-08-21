import { query } from '../config/database';
import { config } from '../config/env';
import { AppError } from '../utils/appError';

/**
 * Pickup and delivery scheduling for Business orders.
 *
 * Both are stored in the tables the schema already has — `pickups` and
 * `deliveries`, each with `scheduled_date`, `time_slot_start` and
 * `time_slot_end` — which is where the customer order flow already writes
 * its own schedule. No new column and no new table.
 *
 * The slot list lives here and nowhere else. The app fetches it rather than
 * hardcoding it, and the same list validates what comes back, so the two can
 * never drift apart.
 */

export interface PickupSlot {
  /** Stable id the app sends back, e.g. "09-11". */
  id: string;
  /** What the user sees, e.g. "9:00 AM – 11:00 AM". */
  label: string;
  /** SQL TIME values for the pickups row. */
  start: string;
  end: string;
}

/**
 * The working day, in two-hour slots.
 *
 * The project had no business-hours configuration anywhere — no table, no
 * constant — so these are the hours specified for the Business flow. They are
 * defined once, here, so a future hours table can replace this list without
 * touching the app or the order service.
 */
export const PICKUP_SLOTS: PickupSlot[] = [
  { id: '09-11', label: '9:00 AM – 11:00 AM', start: '09:00:00', end: '11:00:00' },
  { id: '11-13', label: '11:00 AM – 1:00 PM', start: '11:00:00', end: '13:00:00' },
  { id: '13-15', label: '1:00 PM – 3:00 PM', start: '13:00:00', end: '15:00:00' },
  { id: '15-17', label: '3:00 PM – 5:00 PM', start: '15:00:00', end: '17:00:00' },
  { id: '17-19', label: '5:00 PM – 7:00 PM', start: '17:00:00', end: '19:00:00' },
];

/** YYYY-MM-DD, the only shape a pickup date is accepted in. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Both note fields are optional; this is as much of one as is stored. */
const MAX_NOTE_LENGTH = 500;

/** Trimmed, capped, and never null — the columns take TEXT or nothing. */
function readNote(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_NOTE_LENGTH) : '';
}

/**
 * One day, two independently chosen slots. The date applies to both: the app
 * asks for a single day and a slot on each side of it.
 */
export interface OrderSchedule {
  date: string;
  pickup: PickupSlot;
  delivery: PickupSlot;
  /** Free text for the driver, e.g. gate code. Empty string when not given. */
  pickupNotes: string;
  /** Free text about the laundry itself, e.g. handling instructions. */
  serviceNotes: string;
}

/**
 * The current business day, from the configured timezone rather than the
 * database server's UTC clock — the same way the order number and the Sorter
 * queue resolve "today", so a pickup booked at 01:00 IST is not rejected for
 * being "yesterday".
 */
async function currentBusinessDate(): Promise<string> {
  const result = await query<{ d: string }>(
    `SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)), '%Y-%m-%d') AS d`,
    [config.BUSINESS_TZ_OFFSET]
  );
  return String(result.rows[0].d);
}

/** Looks one slot up, with the message the user should see if it is missing. */
function requireSlot(value: unknown, missing: string, invalid: string): PickupSlot {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) throw new AppError(missing, 400);

  const slot = PICKUP_SLOTS.find((option) => option.id === id);
  if (!slot) throw new AppError(invalid, 400);

  return slot;
}

/**
 * Validates the day and the two slots chosen in the app.
 *
 * A missing day or slot is a 400 carrying the exact wording the screen shows —
 * the app checks the same three things first, but this is what actually
 * decides, so a direct API call cannot place an unscheduled order.
 *
 * The two slots are independent: the pickup and the delivery are whatever the
 * user picked, and neither constrains the other.
 */
export async function resolveSchedule(input: {
  pickupDate?: unknown;
  pickupSlot?: unknown;
  deliverySlot?: unknown;
  pickupNotes?: unknown;
  serviceNotes?: unknown;
}): Promise<OrderSchedule> {
  const date = typeof input.pickupDate === 'string' ? input.pickupDate.trim() : '';
  if (!date || !DATE_ONLY.test(date)) {
    throw new AppError('Please select a day.', 400);
  }

  const pickup = requireSlot(
    input.pickupSlot,
    'Please select a pickup time.',
    'Please select a valid pickup time.'
  );
  const delivery = requireSlot(
    input.deliverySlot,
    'Please select a delivery time.',
    'Please select a valid delivery time.'
  );

  // Compared as calendar dates, never as timestamps, so a same-day pickup is
  // always allowed regardless of the hour.
  const today = await currentBusinessDate();
  if (date < today) {
    throw new AppError('Pickup date cannot be in the past.', 400);
  }

  // Notes are optional: nothing here refuses an order for leaving them blank.
  return {
    date,
    pickup,
    delivery,
    pickupNotes: readNote(input.pickupNotes),
    serviceNotes: readNote(input.serviceNotes),
  };
}
