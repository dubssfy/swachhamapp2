/**
 * Calendar-date helpers for the Sorter module.
 *
 * The shop floor works in India, and the API filters by calendar date, not by
 * timestamp. Every helper here therefore stays in the device's local calendar
 * and never routes a date through `toISOString()`, which would shift an IST
 * evening back to the previous UTC day.
 */

/** A calendar day as YYYY-MM-DD — the only shape the API's date filter takes. */
export function toDateKey(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * YYYY-MM-DD back to a local Date at midnight. Built from the parts rather
 * than `new Date(key)`, which parses a bare date string as UTC.
 */
export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Today, as this device reckons it. Never hardcoded, read at call time. */
export function todayKey(): string {
  return toDateKey(new Date());
}

/** The day before `key`. Used as the newest date Previous Requests may pick. */
export function previousDayKey(key: string): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() - 1);
  return toDateKey(date);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "21 August 2026" — the heading format the Sorter screens display. */
export function formatLongDate(key: string): string {
  const date = parseDateKey(key);
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** "August 2026" — the calendar's month heading. */
export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}
