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
  'Room Linen': require('../assets/images/room-linen.png'),
  'Spa & Pool': require('../assets/images/spa.png'),
  'F&B Service': require('../assets/images/F&B.png'),
  Uniforms: require('../assets/images/Uniform.png'),
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
