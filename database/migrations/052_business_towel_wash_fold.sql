-- ============================================================
-- SWACHHAM -- Business side: Wash & Fold for towels,
--             Wash & Iron for everything else
-- Migration: 052_business_towel_wash_fold.sql
--
-- Idempotent. MySQL 8.
-- ============================================================
--
--
-- 1. THE RULE
--
--   TOWELS      -> Wash & Fold          (and NOTHING else)
--   NON-TOWELS  -> Wash & Iron          (was "Wash and Fold")
--               -> Dry Clean            (unchanged)
--
-- There is no Dry Clean for a towel and none is created here.
--
--
-- 2. WHERE THE MAPPING ACTUALLY LIVES
--
-- `item_service_types` (item_id, service_id) is the mapping.
-- Everything reads it: the catalogue's `service_types`, the
-- cart's validation, the order line's `laundry_service_id`, the
-- price list, the sorter and the invoice. Changing a label in
-- the app would leave all of that untouched, so the change is
-- made here.
--
-- A TOWEL IS `services.washing_group = 'TOWEL'` -- the column
-- the batch optimiser already sorts washing by. It is used
-- rather than matching '%towel%' on the name, because the name
-- is free text and the group is the field that means it.
-- All 14 business towels carry it today: Bath, Hand, Face,
-- Pool, Spa, Kitchen and Cleaning Towel.
--
--
-- 3. WHY 85 IS RENAMED RATHER THAN REPLACED
--
-- Service 85 has ALWAYS had the code `wash_iron`, and the
-- business app has always displayed it as "Wash & Iron" from
-- hardcoded labels in `businessOrderStore`, `BusinessOrdersScreen`
-- and `businessOrderPdfHtml`. Only its NAME column said "Wash and
-- Fold" -- migration 047 renamed it for the customer side, which
-- left the database contradicting both its own code and every
-- business screen.
--
-- Renaming it to "Wash & Iron" therefore CHANGES NO BUSINESS
-- SCREEN: it makes the row agree with what those screens were
-- already printing. And it is right for the data already on it:
-- 145 of its business mappings are non-towel garments and linen,
-- as are 19 of the 25 existing order lines.
--
--
-- 4. WHAT MOVES TO THE NEW SERVICE, AND WHAT DOES NOT
--
-- MOVED to Wash & Fold:
--   * 14 business TOWEL rows in `item_service_types`
--   * their 5 rows in `business_price_list`   -- a price left on
--     a service the item no longer offers is a price nothing can
--     ever read, so the towel would lose its rate
--   * any live `cart_items` line for a towel (0 today)
--
--   * ALL 70 CUSTOMER mappings, their 70 `customer_price_list`
--     rows and their 5 live cart lines.
--
--     THIS IS TO PRESERVE THE CUSTOMER SIDE, NOT TO CHANGE IT.
--     The customer catalogue was loaded from the pricing sheet
--     under the name "Wash & Fold" and displays it today. Left on
--     85 it would start reading "Wash & Iron" -- a change to a
--     screen this migration has no business touching. Moving it
--     keeps every customer label and every customer price exactly
--     as they are.
--
-- NOT MOVED:
--   * `order_items.laundry_service_id` on the 25 existing order
--     lines, 6 of them towels. An order records what was sold at
--     the time, the same way `unit_price` does. Rewriting history
--     to match a rule introduced afterwards would make old
--     invoices disagree with the documents already issued.
--   * `orders.service_type` on the one order that carries it,
--     for the same reason.
--
-- NOTHING here changes an item name, a price, a quantity, a
-- category, or any cart or order total.
-- ============================================================


-- ============================================================
-- 1. "Wash and Fold" (85) becomes "Wash & Iron"
--
-- Matched on the CODE, which is the row's stable identity and
-- its unique key -- not on the name, which is what changes.
-- ============================================================
UPDATE services
   SET name = 'Wash & Iron'
 WHERE code = 'wash_iron'
   AND kind = 'SERVICE_TYPE';


-- ============================================================
-- 2. The new Wash & Fold service
--
-- Same category and scope as the other two, so
-- `businessCatalog.getServiceTypes()` -- which filters
-- scope='BUSINESS' AND c.kind='SERVICE_CATEGORY' -- returns it.
--
-- display_order 1, the same as Wash & Iron: a wash service leads
-- and Dry Clean (2) follows. They never appear together on one
-- item, so the tie is never visible.
--
-- ON DUPLICATE KEY UPDATE on the unique `code`, so re-running
-- refreshes the row rather than seeding a second one.
-- ============================================================
INSERT INTO services
  (category_id, scope, kind, code, name, unit, base_price, is_active, display_order)
SELECT c.id, 'BUSINESS', 'SERVICE_TYPE', 'wash_fold', 'Wash & Fold', 'Service', 0.00, 1, 1
  FROM service_categories c
 WHERE c.id = (SELECT category_id FROM services WHERE code = 'wash_iron' AND kind = 'SERVICE_TYPE')
ON DUPLICATE KEY UPDATE
  name          = VALUES(name),
  is_active     = 1,
  display_order = VALUES(display_order);


-- The two ids, read once so every statement below agrees.
SET @wash_iron := (SELECT id FROM services WHERE code = 'wash_iron' AND kind = 'SERVICE_TYPE');
SET @wash_fold := (SELECT id FROM services WHERE code = 'wash_fold' AND kind = 'SERVICE_TYPE');
SET @dry_clean := (SELECT id FROM services WHERE code = 'dry_clean' AND kind = 'SERVICE_TYPE');


-- ============================================================
-- 3. THE TWO ENUM COLUMNS THAT NAME A SERVICE
--
-- `orders.service_type` and `carts.service_type` are
-- enum('wash_iron','dry_clean'). `businessOrder.createOrder`
-- writes the cart's single service onto the order when every
-- line shares one -- so a basket of nothing but towels would
-- have tried to store 'wash_fold' in a column that does not
-- accept it. MySQL either rejects that outright (strict mode,
-- which is what this server does) or silently truncates it to
-- '' -- an order that had a service and now claims none.
--
-- Widened, not replaced: both existing values are kept in the
-- same order, so no stored row changes and nothing is rewritten.
--
-- Guarded on the current COLUMN_TYPE so a re-run is a no-op
-- rather than a second ALTER of a 25-row-wide table.
-- ============================================================
SET @sql := (
  SELECT IF(
    (SELECT column_type FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'orders' AND column_name = 'service_type')
    LIKE '%wash_fold%',
    'SELECT ''orders.service_type already allows wash_fold''',
    'ALTER TABLE orders
       MODIFY COLUMN service_type
       ENUM(''wash_iron'', ''dry_clean'', ''wash_fold'') NULL'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT column_type FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'carts' AND column_name = 'service_type')
    LIKE '%wash_fold%',
    'SELECT ''carts.service_type already allows wash_fold''',
    'ALTER TABLE carts
       MODIFY COLUMN service_type
       ENUM(''wash_iron'', ''dry_clean'', ''wash_fold'') NULL'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ============================================================
-- 4. BUSINESS TOWELS -> Wash & Fold
--
-- Only rows currently on Wash & Iron are touched, so a re-run
-- matches nothing. Dry Clean rows are not in scope and no towel
-- has one (verified: 0 rows).
-- ============================================================
UPDATE item_service_types
   SET service_id = @wash_fold
 WHERE service_id = @wash_iron
   AND item_id IN (
     SELECT id FROM services
      WHERE kind = 'ITEM' AND scope = 'BUSINESS' AND washing_group = 'TOWEL'
   );

-- Their prices follow the service, or the towel loses its rate.
UPDATE business_price_list
   SET service_id = @wash_fold
 WHERE service_id = @wash_iron
   AND item_id IN (
     SELECT id FROM services
      WHERE kind = 'ITEM' AND scope = 'BUSINESS' AND washing_group = 'TOWEL'
   );

-- Live baskets follow too, or the line names a service its item
-- no longer offers and `businessCart` refuses it at checkout.
UPDATE cart_items
   SET laundry_service_id = @wash_fold
 WHERE laundry_service_id = @wash_iron
   AND service_id IN (
     SELECT id FROM services
      WHERE kind = 'ITEM' AND scope = 'BUSINESS' AND washing_group = 'TOWEL'
   );


-- ============================================================
-- 5. THE CUSTOMER CATALOGUE -> Wash & Fold
--
-- Preservation, not a change: see section 4 of the header. Every
-- customer item keeps the service NAME it shows today and every
-- price keeps its value; only the id behind the name moves.
-- ============================================================
UPDATE item_service_types
   SET service_id = @wash_fold
 WHERE service_id = @wash_iron
   AND item_id IN (
     SELECT id FROM services WHERE kind = 'ITEM' AND scope = 'CUSTOMER'
   );

UPDATE customer_price_list
   SET service_id = @wash_fold
 WHERE service_id = @wash_iron
   AND item_id IN (
     SELECT id FROM services WHERE kind = 'ITEM' AND scope = 'CUSTOMER'
   );

UPDATE cart_items
   SET laundry_service_id = @wash_fold
 WHERE laundry_service_id = @wash_iron
   AND service_id IN (
     SELECT id FROM services WHERE kind = 'ITEM' AND scope = 'CUSTOMER'
   );


-- ============================================================
-- 6. NO TOWEL MAY HOLD DRY CLEAN
--
-- None does. This does not delete anything -- it is here so the
-- migration states the rule it was written for, and so a re-run
-- after someone adds one by hand removes exactly that mistake
-- and nothing else.
--
-- Deliberately NOT the reverse: Dry Clean is never added to a
-- towel, and is never removed from a non-towel.
-- ============================================================
DELETE m FROM item_service_types m
  JOIN services i ON i.id = m.item_id
 WHERE i.kind = 'ITEM'
   AND i.washing_group = 'TOWEL'
   AND m.service_id = @dry_clean;
