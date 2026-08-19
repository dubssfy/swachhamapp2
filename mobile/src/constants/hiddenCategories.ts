/**
 * Categories hidden from the app's category selection UI.
 *
 * Presentation-layer only: the records stay untouched in the database and the
 * API keeps returning them, so existing orders and item relationships that
 * reference these categories continue to resolve normally. This list just
 * stops them being offered as a new selection.
 *
 * Matched case-insensitively against the category name and slug.
 */
const HIDDEN_CATEGORY_KEYS = ['f&b production', 'f-and-b-production'];

export function isHiddenCategory(nameOrSlug?: string | null): boolean {
  if (!nameOrSlug) return false;
  return HIDDEN_CATEGORY_KEYS.includes(String(nameOrSlug).trim().toLowerCase());
}

/** Drops hidden entries from a list of categories. */
export function filterHiddenCategories<T extends { name?: string; slug?: string }>(
  categories: T[]
): T[] {
  return categories.filter(
    (category) => !isHiddenCategory(category.name) && !isHiddenCategory(category.slug)
  );
}
