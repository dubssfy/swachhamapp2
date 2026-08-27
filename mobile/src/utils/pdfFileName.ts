/**
 * File names for the Business Account's two PDFs.
 *
 * WHY THIS EXISTS ON THE CLIENT AT ALL. The server sets a correct
 * `Content-Disposition: attachment; filename="..."` on both downloads — and
 * it is ignored. `FileSystem.downloadAsync(url, target)` writes the body to
 * the path IT is given, so the name the user ends up sharing is whatever the
 * app chose, not what the server suggested. Naming the target file is
 * therefore the only thing that actually decides the name.
 *
 * The shape mirrors `backend/src/services/pdfTheme.ts` deliberately, so a
 * file saved from the app and one fetched straight from the API are called
 * the same thing.
 */

/** Everything Windows and POSIX reject in a file name. */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g;

/**
 * One component of a file name: readable, and safe on every platform.
 *
 *   "The Taj, Mumbai"  ->  "The_Taj_Mumbai"
 */
export function safeFileNamePart(value: string | null | undefined): string {
  return (
    Array.from(String(value ?? ''))
      // Control characters, dropped by codepoint rather than by a regex
      // escape — an escape for these is easy to mangle into the literal byte
      // it stands for, which is a thing a source file must never contain.
      .filter((ch) => (ch.codePointAt(0) ?? 0) > 31)
      .join('')
  )
    .replace(INVALID_FILENAME_CHARS, '')
    // Commas and dots read as separators in a file name, and a trailing dot
    // is rejected outright by Windows.
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '_')
    .slice(0, 60)
    .replace(/_+$/, '');
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "2026-08-01" -> "01-Aug-2026". */
export function dMonY(iso: string): string {
  const [y, m, d] = String(iso ?? '').split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${d}-${month}-${y}` : String(iso ?? '');
}

/** "01-Aug-2026_to_15-Aug-2026". */
export function periodFileNamePart(from: string, to: string): string {
  return `${dMonY(from)}_to_${dMonY(to)}`;
}

/**
 * The name for one of the two Business Account documents.
 *
 *   invoice  ->  The_Taj_Mumbai_01-Aug-2026_to_15-Aug-2026_Hotel_Laundry.pdf
 *   summary  ->  The_Taj_Mumbai_01-Aug-2026_to_15-Aug-2026_Hotel_Laundry_Order_Summary.pdf
 *
 * ESTABLISHMENT NAME FIRST, then the period: a folder of downloads then
 * sorts and reads by business and date, which is how an accounts inbox is
 * actually searched. The laundry type is included because Hotel and Guest
 * are two different documents over the same business and dates, and would
 * otherwise overwrite each other in the cache.
 */
export function businessDocumentFileName(options: {
  establishmentName: string;
  from: string;
  to: string;
  laundryTypeLabel?: string | null;
  kind: 'invoice' | 'summary';
}): string {
  const name = safeFileNamePart(options.establishmentName) || 'Business';
  const period = periodFileNamePart(options.from, options.to);
  const type = options.laundryTypeLabel
    ? `_${safeFileNamePart(options.laundryTypeLabel)}`
    : '';
  const suffix = options.kind === 'summary' ? '_Order_Summary' : '';
  return `${name}_${period}${type}${suffix}.pdf`;
}
