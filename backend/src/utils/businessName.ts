/**
 * The name a business is shown under: the ESTABLISHMENT name.
 *
 * A business carries two names and they are not interchangeable. `name` (and
 * `legal_name`) is the registered entity — what appears on a GST certificate.
 * `establishment_name` is what the place is actually called, and it is the one
 * the business's own staff recognise. Everything the business user sees, from
 * the login screen to their profile to an order record, uses the establishment
 * name; the legal name stays where it belongs, on tax documents.
 *
 * ONE DEFINITION, TWO FORMS. `BUSINESS_DISPLAY_NAME_SQL` is for queries that
 * select the name directly; `displayBusinessName` is for rows already in hand.
 * They must agree, so they live in the same file — a COALESCE written out by
 * hand in one more query is how the two names drift apart again.
 *
 * BOTH FALL BACK TO `name`. An establishment name that is null, or blank after
 * trimming, is not a name; the legal name is shown rather than an empty
 * heading. That is a display fallback only and never rewrites stored data.
 */

/**
 * The establishment name, falling back to the legal name.
 *
 * Expects the `businesses` table aliased as `b`. Pair it with an alias at the
 * call site, e.g. `${BUSINESS_DISPLAY_NAME_SQL} AS business_name`.
 */
export const BUSINESS_DISPLAY_NAME_SQL = `COALESCE(NULLIF(TRIM(b.establishment_name), ''), b.name)`;

/** The same rule for a row that has already been read. */
export function displayBusinessName(row: {
  name?: string | null;
  establishment_name?: string | null;
}): string {
  const establishment = typeof row.establishment_name === 'string' ? row.establishment_name.trim() : '';
  const legal = typeof row.name === 'string' ? row.name.trim() : '';
  return establishment || legal || 'Business';
}
