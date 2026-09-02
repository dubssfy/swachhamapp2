import type { ImageSourcePropType } from 'react-native';

/**
 * Artwork for the category grids.
 *
 * `require` is used (not a runtime path) so Metro bundles each file — that is
 * what makes them resolve identically in development and in a production
 * build. A runtime string path would silently fail in a release build.
 *
 * Entries may be keyed by slug ("room-linen") or by display name
 * ("Room Linen"); lookup tries the slug first, then the name, so either works.
 * Keys below use the display names the API returns.
 *
 * To add artwork later:
 *   1. drop the file in `src/assets/images/`
 *   2. add one line to the matching map below
 * Anything without artwork falls back to a themed icon — never a broken image.
 */

export const CATEGORY_IMAGES: Record<string, ImageSourcePropType> = {
  /* ---- Hotel Laundry: the establishment's own linen ---- */
  'Room Linen': require('../assets/images/room-linen.jpeg'),
  'Spa & Pool': require('../assets/images/spa.jpeg'),
  'F&B Service': require('../assets/images/F&B.jpeg'),
  Uniforms: require('../assets/images/Uniforms.jpeg'),

  /*
   * ---- Guest Laundry: the customer garment categories ----
   *
   * THE SAME ARTWORK THE CUSTOMER APP USES on its own category buttons
   * (`CustomerHomeScreen.MAIN_CATEGORIES`), because these ARE those
   * categories -- Guest Laundry reads the customer catalogue. One picture per
   * category across both apps, so a guest's Men's card looks like the
   * customer's Men's card.
   *
   * KEYED BY SLUG, NOT BY DISPLAY NAME. The slug is what migration 047 wrote
   * and nothing renames it, whereas the name is editable from Super Admin --
   * and at the Guest rate `others` is displayed as "Kids", so a name key
   * would have to be kept in step with that relabelling. `getCategoryImage`
   * tries the slug first, which is why these resolve.
   *
   * These three slugs exist only in the CUSTOMER catalogue, so no Hotel
   * Laundry card can pick one up.
   */
  'mens-wear': require('../assets/images/mens.png'),
  'womens-wear': require('../assets/images/womens.png'),
  // Shown as "Kids" in Guest Laundry; `others.png` is the customer artwork
  // for the same category.
  others: require('../assets/images/others.png'),
};

/**
 * No sub-category artwork has been supplied yet, so sub-category cards use
 * their icon fallback. Add entries here the same way as above.
 */
export const SUB_CATEGORY_IMAGES: Record<string, ImageSourcePropType> = {
  // 'Bed Linen': require('../assets/images/bed-linen.png'),
};

export function getCategoryImage(slug: string, name?: string): ImageSourcePropType | undefined {
  return CATEGORY_IMAGES[slug] ?? (name ? CATEGORY_IMAGES[name] : undefined);
}

export function getSubCategoryImage(slug: string, name?: string): ImageSourcePropType | undefined {
  return SUB_CATEGORY_IMAGES[slug] ?? (name ? SUB_CATEGORY_IMAGES[name] : undefined);
}
