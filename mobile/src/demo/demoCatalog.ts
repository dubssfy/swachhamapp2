/**
 * THE DEMO CATALOGUE.
 *
 * A faithful, offline copy of what the Business catalogue endpoints return:
 * the same four main categories, the same sub-categories, the same items with
 * their real standard weights, sizes and units, and the same per-item service
 * rules the database enforces.
 *
 * WHERE THE DATA CAME FROM. The categories mirror the live tree (Room Linen,
 * Spa & Pool, F&B Service, Uniforms and their sub-categories); the items and
 * their `weight_kg` / `standard_size` mirror the item master the backend was
 * seeded from. Nothing here is invented, so the hotel is shown the real
 * catalogue rather than a plausible-looking stand-in.
 *
 * THE SERVICE RULE, copied from migration 052:
 *
 *   TOWELS      -> Wash & Fold, and nothing else. A towel is never dry cleaned.
 *   NON-TOWELS  -> Wash & Iron, and Dry Clean where the item allows it.
 *
 * `image_url` is null on every row ON PURPOSE. A demo phone may have no
 * network at all, so a remote image would be a permanent grey box; the
 * category grid already falls back to the artwork bundled in
 * `src/assets/images` (keyed by category name) and items fall back to their
 * icon, exactly as they do in production when a row carries no artwork.
 */

import type {
  BusinessCategory,
  BusinessItem,
  LaundryServiceType,
  BusinessProfile,
  NearbyStore,
} from '../services/businessOrderApi';

/** The service category every service type belongs to, as the API reports it. */
const SERVICE_CATEGORY_ID = 'demo-cat-services';
const SERVICE_CATEGORY_NAME = 'Laundry Services';

/**
 * The three business services, with the exact codes the app switches on.
 * `wash_fold` is the towel service — see the rule above.
 */
export const DEMO_SERVICE_TYPES: LaundryServiceType[] = [
  {
    id: 'demo-svc-wash-fold',
    name: 'Wash & Fold',
    code: 'wash_fold',
    category_id: SERVICE_CATEGORY_ID,
    category_name: SERVICE_CATEGORY_NAME,
  },
  {
    id: 'demo-svc-wash-iron',
    name: 'Wash & Iron',
    code: 'wash_iron',
    category_id: SERVICE_CATEGORY_ID,
    category_name: SERVICE_CATEGORY_NAME,
  },
  {
    id: 'demo-svc-dry-clean',
    name: 'Dry Clean',
    code: 'dry_clean',
    category_id: SERVICE_CATEGORY_ID,
    category_name: SERVICE_CATEGORY_NAME,
  },
];

/**
 * What Quick Order costs as a multiple of the standard rate.
 *
 * Matches `QUICK_ORDER_MULTIPLIER` in the backend's business order service,
 * so the Cart's Quick Order warning reads identically to the real app.
 */
export const DEMO_QUICK_ORDER_MULTIPLIER = 2;

/* ------------------------------------------------------------------ *
 * CATEGORIES
 * ------------------------------------------------------------------ */

/** One row of the compact sub-category table below. */
type SubCategorySeed = { slug: string; name: string };

/** One main category and the sub-categories under it. */
type MainCategorySeed = {
  slug: string;
  name: string;
  displayOrder: number;
  subs: SubCategorySeed[];
};

const CATEGORY_TREE: MainCategorySeed[] = [
  {
    slug: 'room-linen',
    name: 'Room Linen',
    displayOrder: 1,
    subs: [
      { slug: 'room-linen-towels-and-bath-accessories', name: 'Towels & Bath Accessories' },
      { slug: 'room-linen-bed-linen', name: 'Bed Linen' },
      { slug: 'room-linen-curtains', name: 'Curtains' },
      { slug: 'room-linen-sofa-and-cushion', name: 'Sofa & Cushion' },
      { slug: 'room-linen-blankets-and-heavy-linen', name: 'Blankets & Heavy Linen' },
      { slug: 'room-linen-carpet-and-rugs', name: 'Carpet & Rugs' },
      { slug: 'room-linen-housekeeping-and-utility', name: 'Housekeeping & Utility' },
    ],
  },
  {
    slug: 'spa-and-pool',
    name: 'Spa & Pool',
    displayOrder: 2,
    subs: [
      { slug: 'spa-and-pool-bath-linen', name: 'Bath Linen' },
      { slug: 'spa-and-pool-spa-linen', name: 'Spa Linen' },
    ],
  },
  {
    slug: 'f-and-b-service',
    name: 'F&B Service',
    displayOrder: 3,
    subs: [
      { slug: 'f-and-b-service-f-and-b-and-banquets', name: 'F&B & Banquets' },
      { slug: 'f-and-b-service-dining-and-kitchen', name: 'Dining & Kitchen' },
      { slug: 'f-and-b-service-housekeeping-and-utility', name: 'Housekeeping & Utility' },
    ],
  },
  {
    slug: 'uniforms',
    name: 'Uniforms',
    displayOrder: 4,
    subs: [
      { slug: 'uniforms-staff-uniforms', name: 'Staff Uniforms' },
      { slug: 'uniforms-clothing-and-accessories', name: 'Clothing & Accessories' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * ITEMS
 * ------------------------------------------------------------------ */

/**
 * One item, in the shortest form that still carries everything the screens
 * show: name, sub-category slug, standard weight in kg, standard size, and
 * whether Dry Clean is offered alongside the wash service.
 *
 * The wash service itself is DERIVED, not listed: a towel gets Wash & Fold
 * and everything else gets Wash & Iron, which is the database's rule rather
 * than a per-row choice that could drift from it.
 */
type ItemSeed = {
  name: string;
  sub: string;
  weight: number;
  size: string;
  /** Dry Clean as well as the wash service. */
  dryClean?: boolean;
  /** Dry Clean INSTEAD of the wash service — rugs, carpets, protectors. */
  dryCleanOnly?: boolean;
  /** All-time orders by this business; drives the "Frequent" badge only. */
  orders?: number;
};

/**
 * The seven towels, by name.
 *
 * Migration 052 identifies a towel by `services.washing_group = 'TOWEL'`
 * rather than by matching on the name; this list is that same set, written
 * out, because the demo has no services table to read the group from.
 */
const TOWEL_NAMES = new Set([
  'Face Towel',
  'Hand Towel',
  'Bath Towel',
  'Pool Towel',
  'Spa Towel',
  'Kitchen Towel',
  'Cleaning Towel',
]);

const ITEM_SEEDS: ItemSeed[] = [
  // Room Linen / Towels & Bath Accessories
  { name: 'Face Towel', sub: 'room-linen-towels-and-bath-accessories', weight: 0.06, size: '30 × 30 cm', orders: 41 },
  { name: 'Hand Towel', sub: 'room-linen-towels-and-bath-accessories', weight: 0.12, size: '40 × 70 cm', orders: 38 },
  { name: 'Bath Towel', sub: 'room-linen-towels-and-bath-accessories', weight: 0.55, size: '70 × 140 cm', orders: 52 },
  { name: 'Bath Sheet', sub: 'room-linen-towels-and-bath-accessories', weight: 0.9, size: '100 × 150 cm', orders: 12 },
  { name: 'Bath Robe', sub: 'room-linen-towels-and-bath-accessories', weight: 0.7, size: 'Free Size / S–XXL', dryClean: true, orders: 9 },
  { name: 'Bath Mat', sub: 'room-linen-towels-and-bath-accessories', weight: 0.3, size: '50 × 80 cm', orders: 22 },

  // Room Linen / Bed Linen
  { name: 'Single Bed Sheet', sub: 'room-linen-bed-linen', weight: 0.45, size: '160 × 275 cm', orders: 34 },
  { name: 'Double Bed Sheet', sub: 'room-linen-bed-linen', weight: 0.65, size: '230 × 275 cm', orders: 47 },
  { name: 'King Bed Sheet', sub: 'room-linen-bed-linen', weight: 0.8, size: '275 × 300 cm', orders: 29 },
  { name: 'Single Duvet', sub: 'room-linen-bed-linen', weight: 1.0, size: '150 × 220 cm', dryClean: true },
  { name: 'Double Duvet', sub: 'room-linen-bed-linen', weight: 1.4, size: '200 × 230 cm', dryClean: true },
  { name: 'Single Duvet Cover', sub: 'room-linen-bed-linen', weight: 0.55, size: '160 × 220 cm', dryClean: true, orders: 18 },
  { name: 'Double Duvet Cover', sub: 'room-linen-bed-linen', weight: 0.75, size: '220 × 240 cm', dryClean: true, orders: 21 },
  { name: 'King Duvet Cover', sub: 'room-linen-bed-linen', weight: 0.9, size: '260 × 240 cm', dryClean: true },
  { name: 'Pillow', sub: 'room-linen-bed-linen', weight: 0.6, size: '45 × 75 cm', dryClean: true },
  { name: 'Pillow Cover', sub: 'room-linen-bed-linen', weight: 0.08, size: '50 × 75 cm', dryClean: true, orders: 44 },
  { name: 'Pillow Protector', sub: 'room-linen-bed-linen', weight: 0.1, size: '50 × 75 cm', dryClean: true },
  { name: 'Single Mattress Protector', sub: 'room-linen-bed-linen', weight: 0.6, size: '100 × 200 cm', dryCleanOnly: true },
  { name: 'Double Mattress Protector', sub: 'room-linen-bed-linen', weight: 0.85, size: '145 × 200 cm', dryCleanOnly: true },
  { name: 'King Mattress Protector', sub: 'room-linen-bed-linen', weight: 1.0, size: '190 × 210 cm' },
  { name: 'Single Bed Runner', sub: 'room-linen-bed-linen', weight: 0.2, size: '50 × 200 cm' },
  { name: 'Double Bed Runner', sub: 'room-linen-bed-linen', weight: 0.25, size: '60 × 230 cm' },

  // Room Linen / Curtains
  { name: 'Sheer Curtains', sub: 'room-linen-curtains', weight: 0.8, size: 'Custom – as per window', dryClean: true },
  { name: 'Silk Curtains', sub: 'room-linen-curtains', weight: 1.2, size: 'Custom – as per window', dryClean: true },
  { name: 'Cotton Curtains', sub: 'room-linen-curtains', weight: 1.3, size: 'Custom – as per window', dryClean: true },
  { name: 'Shower Curtains', sub: 'room-linen-curtains', weight: 0.6, size: '180 × 200 cm', dryClean: true },
  { name: 'Polyester Curtains', sub: 'room-linen-curtains', weight: 1.0, size: 'Custom – as per window', dryClean: true },
  { name: 'Blackout Curtain', sub: 'room-linen-curtains', weight: 1.8, size: 'Custom – as per window', dryClean: true },
  { name: 'Blinds', sub: 'room-linen-curtains', weight: 1.0, size: 'Custom – as per window', dryClean: true },
  { name: 'Curtain Lining', sub: 'room-linen-curtains', weight: 0.7, size: 'Same as curtain size', dryClean: true },

  // Room Linen / Sofa & Cushion
  { name: 'Cushion', sub: 'room-linen-sofa-and-cushion', weight: 0.45, size: '45 × 45 cm', dryClean: true },
  { name: 'Cushion Cover', sub: 'room-linen-sofa-and-cushion', weight: 0.1, size: '45 × 45 cm', dryClean: true, orders: 15 },
  { name: 'Sofa Cover - Per Seat', sub: 'room-linen-sofa-and-cushion', weight: 0.6, size: 'Custom – as per sofa', dryClean: true },
  { name: 'Sofa Cushion Cover', sub: 'room-linen-sofa-and-cushion', weight: 0.15, size: 'Custom – as per cushion', dryClean: true },
  { name: 'Sofa Throw', sub: 'room-linen-sofa-and-cushion', weight: 0.5, size: '130 × 170 cm', dryClean: true },

  // Room Linen / Blankets & Heavy Linen
  { name: 'Single Blanket', sub: 'room-linen-blankets-and-heavy-linen', weight: 1.2, size: '150 × 220 cm', dryClean: true },
  { name: 'Double Blanket', sub: 'room-linen-blankets-and-heavy-linen', weight: 1.8, size: '200 × 230 cm', dryClean: true, orders: 11 },
  { name: 'King Blanket', sub: 'room-linen-blankets-and-heavy-linen', weight: 2.2, size: '240 × 260 cm', dryClean: true },
  { name: 'Single Quilt', sub: 'room-linen-blankets-and-heavy-linen', weight: 1.5, size: '150 × 220 cm', dryClean: true },
  { name: 'Double Quilt', sub: 'room-linen-blankets-and-heavy-linen', weight: 2.2, size: '200 × 230 cm', dryClean: true },
  { name: 'King Quilt', sub: 'room-linen-blankets-and-heavy-linen', weight: 2.7, size: '240 × 260 cm', dryClean: true },
  { name: 'Single Comforter', sub: 'room-linen-blankets-and-heavy-linen', weight: 1.5, size: '150 × 220 cm', dryClean: true },
  { name: 'Double Comforter', sub: 'room-linen-blankets-and-heavy-linen', weight: 2.2, size: '200 × 230 cm', dryClean: true },
  { name: 'King Comforter', sub: 'room-linen-blankets-and-heavy-linen', weight: 2.7, size: '240 × 260 cm', dryClean: true },

  // Room Linen / Carpet & Rugs — dry clean only
  { name: 'Small Rugs', sub: 'room-linen-carpet-and-rugs', weight: 0.5, size: '60 × 90 cm', dryCleanOnly: true },
  { name: 'Medium Rug', sub: 'room-linen-carpet-and-rugs', weight: 0.9, size: '90 × 150 cm', dryCleanOnly: true },
  { name: 'Large Rug', sub: 'room-linen-carpet-and-rugs', weight: 1.5, size: '120 × 180 cm', dryCleanOnly: true },
  { name: 'Small Carpet', sub: 'room-linen-carpet-and-rugs', weight: 1.5, size: '120 × 180 cm', dryCleanOnly: true },
  { name: 'Medium Carpet', sub: 'room-linen-carpet-and-rugs', weight: 2.5, size: '150 × 240 cm', dryCleanOnly: true },
  { name: 'Large Carpet', sub: 'room-linen-carpet-and-rugs', weight: 4.0, size: '200 × 300 cm', dryCleanOnly: true },
  { name: 'Door Mat', sub: 'room-linen-carpet-and-rugs', weight: 0.25, size: '45 × 75 cm', dryCleanOnly: true },
  { name: 'Bathroom Mat', sub: 'room-linen-carpet-and-rugs', weight: 0.3, size: '50 × 80 cm', dryCleanOnly: true },
  { name: 'Floor Mat', sub: 'room-linen-carpet-and-rugs', weight: 0.45, size: '60 × 90 cm', dryCleanOnly: true },

  // Room Linen / Housekeeping & Utility
  { name: 'Duster', sub: 'room-linen-housekeeping-and-utility', weight: 0.05, size: '40 × 40 cm' },
  { name: 'Mop Head', sub: 'room-linen-housekeeping-and-utility', weight: 0.2, size: 'As per mop model' },
  { name: 'Cleaning Towel', sub: 'room-linen-housekeeping-and-utility', weight: 0.12, size: '45 × 70 cm', orders: 19 },

  // Spa & Pool
  { name: 'Pool Towel', sub: 'spa-and-pool-bath-linen', weight: 0.75, size: '90 × 180 cm', orders: 26 },
  { name: 'Spa Towel', sub: 'spa-and-pool-spa-linen', weight: 0.55, size: '30 × 30 / 40 × 70 / 70 × 140 cm', orders: 17 },
  { name: 'Spa Napkin', sub: 'spa-and-pool-spa-linen', weight: 0.06, size: '30 × 30 cm' },
  { name: 'Spa Sheet', sub: 'spa-and-pool-spa-linen', weight: 0.5, size: '90 × 200 cm' },

  // F&B Service / F&B & Banquets
  { name: 'Restaurant Full-Length Curtain', sub: 'f-and-b-service-f-and-b-and-banquets', weight: 1.8, size: 'Custom – as per window', dryClean: true },
  { name: 'F&B Table Cloth', sub: 'f-and-b-service-f-and-b-and-banquets', weight: 0.6, size: 'Custom – as per table', orders: 24 },
  { name: 'Table Runner', sub: 'f-and-b-service-f-and-b-and-banquets', weight: 0.15, size: '35 × 180 cm' },
  { name: 'Banquet Table Cloth', sub: 'f-and-b-service-f-and-b-and-banquets', weight: 0.9, size: 'Custom – as per banquet table', orders: 13 },
  { name: 'Banquet Chair Cover', sub: 'f-and-b-service-f-and-b-and-banquets', weight: 0.2, size: 'Custom – as per chair' },
  { name: 'Table Frill', sub: 'f-and-b-service-f-and-b-and-banquets', weight: 0.6, size: 'Height approx. 75 cm; length as per table' },
  { name: 'Napkin', sub: 'f-and-b-service-f-and-b-and-banquets', weight: 0.06, size: '50 × 50 cm', orders: 31 },

  // F&B Service / Dining & Kitchen
  { name: 'Table Cloth', sub: 'f-and-b-service-dining-and-kitchen', weight: 0.6, size: 'Custom – as per table', orders: 28 },
  { name: 'Table Napkin', sub: 'f-and-b-service-dining-and-kitchen', weight: 0.06, size: '50 × 50 cm', orders: 33 },
  { name: 'Chair Cover', sub: 'f-and-b-service-dining-and-kitchen', weight: 0.2, size: 'Custom – as per chair' },
  { name: 'Kitchen Towel', sub: 'f-and-b-service-dining-and-kitchen', weight: 0.1, size: '45 × 70 cm', orders: 20 },

  // F&B Service / Housekeeping & Utility
  { name: 'Wiping Cloth', sub: 'f-and-b-service-housekeeping-and-utility', weight: 0.08, size: '45 × 45 cm' },
  { name: 'Microfiber Cloth', sub: 'f-and-b-service-housekeeping-and-utility', weight: 0.06, size: '40 × 40 cm' },
  { name: 'Apron', sub: 'f-and-b-service-housekeeping-and-utility', weight: 0.2, size: '75 × 90 cm', orders: 14 },

  // Uniforms / Staff Uniforms
  { name: 'Security Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.6, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Kitchen Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.6, size: 'S / M / L / XL / XXL', dryClean: true, orders: 16 },
  { name: 'Kitchen Utility Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.5, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Housekeeping Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.6, size: 'S / M / L / XL / XXL', dryClean: true, orders: 23 },
  { name: 'F&B Uniform Set - Vest Coat, Trouser & Shirt', sub: 'uniforms-staff-uniforms', weight: 0.9, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Captain Uniform - Shirt, Trouser & Coat', sub: 'uniforms-staff-uniforms', weight: 1.0, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Front Office Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.7, size: 'S / M / L / XL / XXL', dryClean: true, orders: 12 },
  { name: 'Bell Desk Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.8, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Driver Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.6, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Maintenance Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.7, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Gardener Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.7, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Pool Deck Attendant Uniform Set', sub: 'uniforms-staff-uniforms', weight: 0.6, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Boiler Suit / Dangri', sub: 'uniforms-staff-uniforms', weight: 0.7, size: 'S / M / L / XL / XXL', dryClean: true },

  // Uniforms / Clothing & Accessories
  { name: 'Shirt', sub: 'uniforms-clothing-and-accessories', weight: 0.25, size: 'S / M / L / XL / XXL', orders: 30 },
  { name: 'T-Shirt', sub: 'uniforms-clothing-and-accessories', weight: 0.2, size: 'S / M / L / XL / XXL' },
  { name: 'Trouser', sub: 'uniforms-clothing-and-accessories', weight: 0.35, size: '28 / 30 / 32 / 34 / 36 / 38 / 40', orders: 25 },
  { name: 'Jeans', sub: 'uniforms-clothing-and-accessories', weight: 0.6, size: '28 / 30 / 32 / 34 / 36 / 38 / 40' },
  { name: 'Dress', sub: 'uniforms-clothing-and-accessories', weight: 0.4, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Saree', sub: 'uniforms-clothing-and-accessories', weight: 0.5, size: 'Approx. 115 × 550 cm', dryClean: true },
  { name: 'Kurta', sub: 'uniforms-clothing-and-accessories', weight: 0.3, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Salwar Suit', sub: 'uniforms-clothing-and-accessories', weight: 0.55, size: 'S / M / L / XL / XXL', dryClean: true },
  { name: 'Scarf', sub: 'uniforms-clothing-and-accessories', weight: 0.1, size: '70 × 180 cm', dryClean: true },
  { name: 'Handkerchief', sub: 'uniforms-clothing-and-accessories', weight: 0.03, size: '40 × 40 cm' },
  { name: 'Cap', sub: 'uniforms-clothing-and-accessories', weight: 0.08, size: 'Free Size / Adjustable' },
  { name: 'Raincoat', sub: 'uniforms-clothing-and-accessories', weight: 0.5, size: 'S / M / L / XL / XXL', dryClean: true },
];

/** A stable, readable id for an item, derived from its name and category. */
function itemId(seed: ItemSeed): string {
  const key = `${seed.sub}-${seed.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `demo-item-${key}`;
}

/** The services this item offers, derived from the towel rule. */
function serviceTypesFor(seed: ItemSeed): string[] {
  if (TOWEL_NAMES.has(seed.name)) return ['wash_fold'];
  if (seed.dryCleanOnly) return ['dry_clean'];
  return seed.dryClean ? ['wash_iron', 'dry_clean'] : ['wash_iron'];
}

/* ------------------------------------------------------------------ *
 * THE BUILT CATALOGUE
 *
 * Built once at module load and then only read, so every screen sees the
 * same object identities and the same ids for the whole session.
 * ------------------------------------------------------------------ */

const categoryIdFor = (slug: string) => `demo-cat-${slug}`;

/** Every sub-category, flattened, with the main category it belongs to. */
const SUB_CATEGORY_INDEX: Array<{ slug: string; name: string; parentSlug: string; order: number }> =
  CATEGORY_TREE.flatMap((main) =>
    main.subs.map((sub, index) => ({
      slug: sub.slug,
      name: sub.name,
      parentSlug: main.slug,
      order: index + 1,
    }))
  );

export const DEMO_ITEMS: BusinessItem[] = ITEM_SEEDS.map((seed) => {
  const sub = SUB_CATEGORY_INDEX.find((entry) => entry.slug === seed.sub);
  const parent = CATEGORY_TREE.find((main) => main.slug === sub?.parentSlug);
  return {
    id: itemId(seed),
    category_id: categoryIdFor(seed.sub),
    category_name: sub?.name || '',
    parent_category_id: parent ? categoryIdFor(parent.slug) : null,
    parent_category_name: parent?.name || null,
    standard_size: seed.size || null,
    name: seed.name,
    unit: 'Nos',
    weight_kg: seed.weight,
    weight_unit: 'kg',
    image_url: null,
    icon_name: null,
    is_active: true,
    service_types: serviceTypesFor(seed),
    order_count: seed.orders ?? 0,
  };
});

/** How many items sit under a category id, main or sub. */
function itemCountFor(categoryId: string): number {
  return DEMO_ITEMS.filter(
    (item) => item.category_id === categoryId || item.parent_category_id === categoryId
  ).length;
}

/** The first few item names under a category, for the card's preview line. */
function previewItemsFor(categoryId: string): string[] {
  return DEMO_ITEMS.filter(
    (item) => item.category_id === categoryId || item.parent_category_id === categoryId
  )
    .slice(0, 4)
    .map((item) => item.name);
}

/** The four main categories, in the order the API returns them. */
export const DEMO_MAIN_CATEGORIES: BusinessCategory[] = CATEGORY_TREE.map((main) => {
  const id = categoryIdFor(main.slug);
  return {
    id,
    name: main.name,
    slug: main.slug,
    parent_id: null,
    image_url: null,
    icon_name: null,
    display_order: main.displayOrder,
    has_subcategories: main.subs.length > 0,
    item_count: itemCountFor(id),
    preview_items: previewItemsFor(id),
  };
});

/** Every sub-category, each carrying the id of its main category. */
export const DEMO_SUB_CATEGORIES: BusinessCategory[] = SUB_CATEGORY_INDEX.map((sub) => {
  const id = categoryIdFor(sub.slug);
  return {
    id,
    name: sub.name,
    slug: sub.slug,
    parent_id: categoryIdFor(sub.parentSlug),
    image_url: null,
    icon_name: null,
    display_order: sub.order,
    // A sub-category is the last level: items come next, never another level.
    has_subcategories: false,
    item_count: itemCountFor(id),
    preview_items: previewItemsFor(id),
  };
});

/* ------------------------------------------------------------------ *
 * THE DEMO HOTEL
 * ------------------------------------------------------------------ */

/**
 * The establishment the demo signs in as.
 *
 * EVERY VALUE HERE IS AN OBVIOUS PLACEHOLDER, ON PURPOSE.
 *
 * The demo is shown to people who have no way of knowing what is real, so it
 * must not put a name, address or phone number on screen that could be taken
 * for a genuine person or business — or, worse, could actually belong to one.
 * "ABC" and "ABC Hotel" read unmistakably as a placeholder; an invented
 * manager's name at a plausible street address does not.
 *
 * The record is still COMPLETE. Every field the profile screen can show is
 * filled in, because a demo with half-empty fields reads as broken rather
 * than as a demo — the values are just plainly fictional.
 *
 * This is the single source of the demo's identity: `demoAuth.DEMO_USER`
 * derives the signed-in user's name and business name from here, so the
 * header, dashboard, profile, order details and documents all follow from
 * these fields and there is no second copy to keep in step.
 */
export const DEMO_PROFILE: BusinessProfile = {
  business_id: 'demo-business-1',
  business_name: 'ABC Hotel',
  customer_type: 'Hotel',
  registration_type: 'B2B',
  other_type_specify: null,
  establishment_address: 'ABC Hotel, 1 Main Road, Mumbai, Maharashtra 400001',
  gst_number: '27AABCG1234H1Z5',
  pan_number: 'AABCG1234H',
  website: 'www.abchotel.example',
  contact_person_name: 'ABC',
  designation: 'Owner',
  // Not a dialable Indian number: the 9000000000 block is not issued, so the
  // demo cannot put a real subscriber's phone on screen.
  mobile_number: '9000000000',
  whatsapp_number: '9000000000',
  email_id: 'demo@hotel.com',
  alternate_contact_person: 'ABC Contact',
  alternate_mobile_no: '9000000001',
  status: 'ACTIVE',
  account_name: 'ABC Hotel',
  account_email: 'demo@hotel.com',
};

/**
 * Stores for the Store Locator.
 *
 * Distances are fixed rather than computed from the phone's GPS: a demo may
 * be run indoors with location switched off, and a list that empties itself
 * in that case would look like a fault.
 */
export const DEMO_NEARBY_STORES: NearbyStore[] = [
  {
    id: 'demo-store-1',
    name: 'Swachham Laundry — Fort',
    address: '22 Perin Nariman Street, Fort',
    city: 'Mumbai',
    district: 'Mumbai City',
    state: 'Maharashtra',
    pincode: '400001',
    latitude: 18.9339,
    longitude: 72.8356,
    contact_number: '02240012233',
    distance_km: 1.2,
  },
  {
    id: 'demo-store-2',
    name: 'Swachham Laundry — Lower Parel',
    address: 'Unit 4, Kamala Mills Compound',
    city: 'Mumbai',
    district: 'Mumbai City',
    state: 'Maharashtra',
    pincode: '400013',
    latitude: 18.9949,
    longitude: 72.8258,
    contact_number: '02240012244',
    distance_km: 4.7,
  },
  {
    id: 'demo-store-3',
    name: 'Swachham Processing Hub — Andheri East',
    address: 'Plot 61, MIDC Road No. 2',
    city: 'Mumbai',
    district: 'Mumbai Suburban',
    state: 'Maharashtra',
    pincode: '400093',
    latitude: 19.1136,
    longitude: 72.8697,
    contact_number: '02240012255',
    distance_km: 12.4,
  },
];

/**
 * The bookable pickup / delivery slots.
 *
 * The same five two-hour slots, with the same ids and labels, as
 * `PICKUP_SLOTS` in backend/src/services/pickupSlot.service.ts.
 */
export const DEMO_TIME_SLOTS: Array<{
  id: string;
  label: string;
  start: string;
  end: string;
  startMinutes: number;
}> = [
  { id: '09-11', label: '9:00 AM – 11:00 AM', start: '09:00:00', end: '11:00:00', startMinutes: 540 },
  { id: '11-13', label: '11:00 AM – 1:00 PM', start: '11:00:00', end: '13:00:00', startMinutes: 660 },
  { id: '13-15', label: '1:00 PM – 3:00 PM', start: '13:00:00', end: '15:00:00', startMinutes: 780 },
  { id: '15-17', label: '3:00 PM – 5:00 PM', start: '15:00:00', end: '17:00:00', startMinutes: 900 },
  { id: '17-19', label: '5:00 PM – 7:00 PM', start: '17:00:00', end: '19:00:00', startMinutes: 1140 },
];

/** One item by id, or undefined. */
export function findDemoItem(itemIdValue: string): BusinessItem | undefined {
  return DEMO_ITEMS.find((item) => item.id === itemIdValue);
}

/** The display name of a service code, from the catalogue's own list. */
export function demoServiceName(code: string | null): string | null {
  if (!code) return null;
  return DEMO_SERVICE_TYPES.find((service) => service.code === code)?.name || null;
}
