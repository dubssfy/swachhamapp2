import fs from 'fs';
import path from 'path';

/**
 * THE ONE PLACE THE BUSINESS ACCOUNT'S PDFs ARE THEMED.
 *
 * The Tax Invoice and the Order Summary are two different documents with two
 * different structures, and they should stay that way — but they are one
 * company's pair, so the palette, the mark's size and the way money, dates
 * and file names are formatted are defined HERE and imported by both. A
 * colour changed in one file and missed in the other is exactly the drift
 * this module exists to prevent.
 */

/**
 * The primary theme colour.
 *
 * White text on this reaches roughly 5.2:1, comfortably past the 4.5:1 needed
 * for body text — which is what lets it carry the banded headers and the
 * table heads with the type reversed out of it.
 */
const PRIMARY = '#3D6F73';

export const THEME = {
  /** Bands, rules, table heads, section headings. */
  PRIMARY,
  /** Body text. Near-black rather than pure, so large areas do not glare. */
  TEXT: '#1B1B1B',
  /** Secondary text: captions, notes, labels that are not the point. */
  MUTED: '#5F6B6C',
  /** Hairline rules inside a table. A desaturated tint of the primary. */
  RULE: '#CFE0E1',
  /** Alternate row fill. Barely there on screen, and prints clean. */
  ZEBRA: '#F1F6F6',
  /** The tinted band behind a totals or section strip. */
  BAND: '#E1EDEE',
} as const;

/**
 * How large the Swachham mark is drawn, in points, on both documents.
 *
 * The source art is SQUARE, and this is used as a square `fit` box, so
 * PDFKit scales the image inside it without ever stretching it — the aspect
 * ratio is preserved by construction rather than by choosing matching
 * numbers. Both documents lay the mark out BESIDE their company block, so
 * this size widens the header rather than pushing the table down the page.
 */
export const LOGO_SIZE = 76;

/** The Swachham mark, when the asset is present. */
export function logoPath(): string | null {
  return firstExisting(['swachham-logo.png']);
}

/**
 * How dark the page watermark is allowed to get.
 *
 * CHOSEN FOR A BLACK-AND-WHITE LASER PRINTER, not for the screen. The mark's
 * own orange sits at about 67% luminance, so at this alpha the darkest pixel
 * the watermark can produce is roughly 97% white — a tint a greyscale printer
 * renders as the faintest dither it has, and often as nothing at all. On a
 * colour screen it reads as a barely-there wash.
 *
 * Raising this is the one change here that can spoil a printed invoice, which
 * is why the number lives beside the palette rather than inline at the draw
 * site, and why `smoke_invoice_watermark` asserts the resulting greyscale
 * value rather than trusting the constant.
 */
export const WATERMARK_OPACITY = 0.1;

/**
 * The image drawn faintly behind every page.
 *
 * PREFERS A DEDICATED WATERMARK ASSET, FALLS BACK TO THE LOGO. The full logo
 * is a badge — mark, wordmark and a solid teal bar — and the bar is far too
 * heavy to sit behind body text even at a low alpha. `swachham-watermark.png`
 * is the mark alone, cropped from that same logo, so this is the existing
 * brand asset rather than a second, unrelated one. If the file is ever
 * removed the logo is still used, so a deployment missing it degrades to a
 * heavier watermark rather than to none.
 */
export function watermarkPath(): string | null {
  return firstExisting(['swachham-watermark.png', 'swachham-logo.png']);
}

/**
 * The first of these asset names that exists, checked in both the layouts the
 * backend runs under: from the repo (`backend/` as cwd, assets in the sibling
 * mobile app) and from a deployment that ships its own `assets/`.
 */
function firstExisting(names: string[]): string | null {
  for (const name of names) {
    const candidates = [
      path.resolve(process.cwd(), `../mobile/assets/${name}`),
      path.resolve(process.cwd(), `assets/${name}`),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found) return found;
  }
  return null;
}

/** 1234.5 -> "1,234.50" with Indian digit grouping. */
export function inr(value: number): string {
  const fixed = Math.abs(value).toFixed(2);
  const [whole, paise] = fixed.split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${value < 0 ? '-' : ''}${grouped}.${paise}`;
}

/** "2026-08-21" -> "21-08-2026", the format the documents print. */
export function dmy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "2026-08-01" -> "01-Aug-2026", the readable form used in file names. */
export function dMonY(iso: string): string {
  const [y, m, d] = String(iso ?? '').split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${d}-${month}-${y}` : String(iso ?? '');
}

/**
 * Everything a filesystem rejects, plus the control characters.
 *
 * `/ \ : * ? " < > |` are the reserved set on Windows; the rest are illegal
 * or invisible. Spaces become underscores separately, so the result is one
 * unbroken token that survives a shell, a URL and an email attachment.
 */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g;

/**
 * One component of a file name: readable, and safe on every platform.
 *
 * "The Taj, Mumbai" -> "The_Taj_Mumbai"
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
    // Commas and dots read as separators in a file name and a trailing dot is
    // rejected outright by Windows, so they go before the spaces are joined.
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '_')
    // Long establishment names would otherwise push the period off the end of
    // what some mail clients show.
    .slice(0, 60)
    .replace(/_+$/, '');
}

/** "01-Aug-2026_to_15-Aug-2026" — the period, as a file-name component. */
export function periodFileNamePart(from: string, to: string): string {
  return `${dMonY(from)}_to_${dMonY(to)}`;
}
