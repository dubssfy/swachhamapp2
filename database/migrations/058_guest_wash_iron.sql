-- ============================================================
-- SWACHHAM — Guest Laundry: Wash & Iron for everything but towels
-- Migration: 058_guest_wash_iron.sql
--
-- Idempotent. MySQL 8.
-- ============================================================
--
-- 1. THE RULE, which is the one Hotel Laundry has followed since 052
--
--   TOWELS      -> Wash & Fold, and nothing else
--   NON-TOWELS  -> Wash & Iron, plus Dry Clean where the item already
--                  allows it (Dry Clean is deliberately untouched)
--
--
-- 2. THE RULE ITSELF IS NOT IN THIS FILE
--
-- Guest Laundry reads the CUSTOMER catalogue -- catalogueScope('guest') is
-- 'CUSTOMER' -- so its items and their `item_service_types` rows are the SAME
-- rows the customer app reads. Migration 052 section 5 moved every customer
-- item onto Wash & Fold ON PURPOSE, to keep the customer app's own labels and
-- prices intact; that is why Guest shows "Wash & Fold" against a blazer today.
--
-- Rewriting those mappings would fix Guest by changing the Customer side.
-- So the mapping table is LEFT ALONE and the rule is applied at the Guest
-- rate in code (`guestServiceCodes` in guestCatalogue.ts), the same way the
-- Guest category filter and the Guest category labels already work.
--
-- NOTHING in this migration adds, removes or moves an `item_service_types`
-- row, and the customer catalogue is not touched at all.
--
--
-- 3. WHAT THIS FILE IS ACTUALLY FOR
--
-- Two kinds of row NAME a service and would otherwise point at one the Guest
-- rate no longer offers, which makes them unreadable:
--
--   * `business_price_list` rows at laundry_type='guest' sitting on Wash &
--     Fold for a non-towel. `lookupBusinessPrice` matches the exact service
--     and then the item's NULL-service fallback -- a row for a DIFFERENT
--     service is never a candidate -- so such a price would simply stop being
--     found and the item would be refused at checkout as unpriced.
--
--   * live Guest `cart_items` on Wash & Fold for a non-towel, which
--     `resolveItemServiceId` would refuse when the line was next touched.
--
-- Both are moved to Wash & Iron, which is what the rule now offers them.
--
--
-- 4. WHAT IS DELIBERATELY NOT TOUCHED
--
--   * `customer_price_list` -- the Customer side keeps every price and label.
--   * customer `cart_items` (a cart with no business_user_id).
--   * `order_items.laundry_service_id` and `orders.service_type`. An order
--     records what was sold at the time, the way `unit_price` does; rewriting
--     history to match a rule introduced afterwards would make issued
--     invoices disagree with the documents already sent.
--   * Dry Clean, at either rate.
--   * Hotel Laundry, in every respect.
-- ============================================================

SET @wash_iron := (SELECT id FROM services WHERE code = 'wash_iron' AND kind = 'SERVICE_TYPE');
SET @wash_fold := (SELECT id FROM services WHERE code = 'wash_fold' AND kind = 'SERVICE_TYPE');


-- ============================================================
-- GUEST PRICES: Wash & Fold -> Wash & Iron, non-towels only
--
-- Scoped to laundry_type='guest', so a Hotel price is never matched. Only
-- rows currently on Wash & Fold are touched, so a re-run matches nothing.
-- ============================================================
UPDATE business_price_list
   SET service_id = @wash_iron
 WHERE laundry_type = 'guest'
   AND service_id = @wash_fold
   AND item_id IN (
     SELECT id FROM services
      WHERE kind = 'ITEM'
        AND COALESCE(washing_group, '') <> 'TOWEL'
   );


-- ============================================================
-- LIVE GUEST BASKETS: the same move
--
-- `c.business_user_id IS NOT NULL AND c.laundry_type = 'guest'` is what keeps
-- this off the customer app's carts, which share this table.
-- ============================================================
UPDATE cart_items ci
  JOIN carts c ON c.id = ci.cart_id
   SET ci.laundry_service_id = @wash_iron
 WHERE c.business_user_id IS NOT NULL
   AND c.laundry_type = 'guest'
   AND ci.laundry_service_id = @wash_fold
   AND ci.service_id IN (
     SELECT id FROM services
      WHERE kind = 'ITEM'
        AND COALESCE(washing_group, '') <> 'TOWEL'
   );
