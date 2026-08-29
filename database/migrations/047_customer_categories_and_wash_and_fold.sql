-- ============================================================
-- SWACHHAM — Customer categories, and "Wash and Fold"
-- Migration: 047_customer_categories_and_wash_and_fold.sql
--
-- Idempotent. MySQL 8.
-- ============================================================


-- ============================================================
-- 1. THE FOUR CUSTOMER CATEGORIES
--
-- A customer browses Men's Wear, Women's Wear, Household and
-- Others. None of those existed: every one of the 35 categories
-- was scope='BUSINESS' — Room Linen, Bath Linen, F&B, Uniforms —
-- the hotel catalogue.
--
-- THE BUSINESS CATEGORIES ARE NOT TOUCHED. "Replace" means
-- replace what the CUSTOMER is shown, and the two catalogues are
-- already separated by `scope`: the customer screens read
-- scope='CUSTOMER', the business screens read scope='BUSINESS'.
-- Editing or deleting the hotel categories would break the
-- business side, which is explicitly out of scope.
--
-- CREATED EMPTY, AND DELIBERATELY SO. No item is assigned here.
-- Which of the 165 catalogue items belongs under Men's Wear is a
-- decision about the business, not something a migration should
-- guess — they are assigned through Super Admin, where the choice
-- is visible and reversible.
--
-- `kind` MUST be 'ITEM_CATEGORY'. The column is
-- enum('ITEM_CATEGORY','SERVICE_CATEGORY'), and `getCategories`
-- filters on it -- so a wrong value is silently truncated to ''
-- by MySQL and the category never appears anywhere, with no
-- error to explain why. (It did exactly that on the first run of
-- this migration; the UPDATE below repairs rows written then.)
--
-- INSERT IGNORE against the slug, so re-running changes nothing
-- and a category someone has since renamed or re-ordered keeps
-- exactly what they set.
-- ============================================================
INSERT IGNORE INTO service_categories
  (name, slug, scope, kind, parent_id, display_order, is_active, icon_name)
VALUES
  -- The apostrophe is doubled, not backslash-escaped, and the string is
  -- single-quoted: with ANSI_QUOTES set, "Men's Wear" is read as an
  -- IDENTIFIER and the insert fails with "Unknown column".
  ('Men''s Wear',   'mens-wear',   'CUSTOMER', 'ITEM_CATEGORY', NULL, 1, TRUE, 'shirt-outline'),
  ('Women''s Wear', 'womens-wear', 'CUSTOMER', 'ITEM_CATEGORY', NULL, 2, TRUE, 'woman-outline'),
  ('Household',    'household',   'CUSTOMER', 'ITEM_CATEGORY', NULL, 3, TRUE, 'home-outline'),
  ('Others',       'others',      'CUSTOMER', 'ITEM_CATEGORY', NULL, 4, TRUE, 'ellipsis-horizontal-outline');

-- Repairs the four rows written by the first run of this migration, which
-- carried an invalid `kind` and were therefore invisible to every query.
UPDATE service_categories
   SET kind = 'ITEM_CATEGORY'
 WHERE scope = 'CUSTOMER'
   AND slug IN ('mens-wear', 'womens-wear', 'household', 'others')
   AND kind <> 'ITEM_CATEGORY';


-- ============================================================
-- 2. "Wash & Iron" BECOMES "Wash and Fold"
--
-- Only the DISPLAY NAME changes. The `code` stays `wash_iron`.
--
-- That is not laziness: the code is what
-- `item_service_types`, the price-list screens and
-- `BusinessPrice.service_types` all match on, and it is written
-- into stored rows. Renaming it would mean rewriting every one of
-- those in step, for no gain — nobody sees the code, and the two
-- service types are still told apart by the same id they always
-- were.
--
-- The id (85) does not change either, so every existing price,
-- cart line and order line keeps pointing at the same service and
-- simply prints the new name.
-- ============================================================
UPDATE services
   SET name = 'Wash and Fold'
 WHERE kind = 'SERVICE_TYPE'
   AND code = 'wash_iron'
   AND name <> 'Wash and Fold';


-- ============================================================
-- 3. WHAT THIS DOES NOT DO
--
-- No item is created, moved or re-categorised. No price is
-- written. No business category is altered. A customer opening
-- the app after this migration sees four categories and no items
-- in them, which is the honest state until the catalogue is
-- filled in through Super Admin.
-- ============================================================
