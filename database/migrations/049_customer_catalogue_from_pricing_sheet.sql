-- ============================================================
-- SWACHHAM -- Customer catalogue from the pricing sheet
-- Migration: 049_customer_catalogue_from_pricing_sheet.sql
--
-- Source: pricing (1).xlsx, supplied 29 Aug 2026.
-- Idempotent. MySQL 8. Re-running refreshes prices; it never
-- duplicates an item and never deletes one.
-- ============================================================
--
--
-- 1. WHAT THIS LOADS
--
-- The four CUSTOMER categories created by migration 047 were
-- EMPTY -- 0 items, 0 customer prices. Every one of the 165
-- items in `services` is scope='BUSINESS', so a customer opening
-- the app saw four categories with nothing in them and could not
-- put anything in a cart (`cart.service` refuses an item with no
-- customer price).
--
-- This loads 83 items and 117 prices from the sheet.
--
--
-- 2. READING THE SPREADSHEET'S COLUMNS
--
-- Its headers do not mean what they say, so for the record:
--
--   `type`         is the LAUNDRY SERVICE -- Wash Only / Wash &
--                  Fold / Dry Clean
--   `category`     is the ITEM NAME -- Blazer, Bedsheet single
--   `service_name` is the CATEGORY -- Men's Wear, Women's Wear,
--                  Household, Others, Hotel Linen
--   `original_price` is the struck-through "was" figure,
--   `discount_price` is what the customer actually pays.
--
-- So `original_price` -> customer_price_list.original_price and
-- `discount_price` -> customer_price_list.customer_price. No row
-- in the sheet has a discount above its original, so nothing is
-- clamped here.
--
--
-- 3. "WASH ONLY" AND "WASH & FOLD" ARE LOADED AS ONE SERVICE
--
-- The sheet names three services; the database has two service
-- types (85 'Wash and Fold' / wash_iron, 87 'Dry Clean' /
-- dry_clean). Wash Only is mapped onto wash_iron. Two reasons:
--
--   a) NO ITEM IN THE SHEET USES BOTH. Household items are
--      priced "Wash Only" and garments "Wash & Fold" -- they are
--      the same slot under two names, never two choices on one
--      item. Checked across all 118 rows: zero overlap. So no
--      price is lost or merged; each item keeps the exact figure
--      the sheet gives it.
--
--   b) A THIRD SERVICE TYPE WOULD SHOW UP ON THE BUSINESS SIDE.
--      `priceList.listServiceTypes()` selects every SERVICE_TYPE
--      with no scope filter, so a new row would appear in the
--      Super Admin business price-list selector, and
--      `businessCart` / `businessCatalog` / `businessOrder` all
--      hard-code ['wash_iron','dry_clean'] and would reject it.
--      Adding one would change the business app, which is out of
--      scope here.
--
-- If a distinct "Wash Only" label is wanted later it is a new
-- SERVICE_TYPE row plus a scope filter on `listServiceTypes` --
-- not a change to any of the data below.
--
--
-- 4. THE HOTEL LINEN ROW
--
-- One row (Shirt / T-Shirt, Wash Only, 35 -> 25) is filed under
-- "Hotel Linen". There is no such CUSTOMER category -- hotel vs
-- guest is a business concept, and the customer side was
-- deliberately given four categories. It is loaded into OTHERS
-- so the entry is not silently lost. Delete it from Super Admin
-- if it does not belong in the retail list.
--
--
-- 5. THE ONE DUPLICATE
--
-- Dry Clean / Trouser / Men's Wear appears TWICE in the sheet,
-- at 95->85 and at 107->89. The LOWER pair is kept. That is
-- deterministic and never over-charges off the back of a
-- duplicated row; correct the price from Super Admin if the
-- higher one was intended.
--
--
-- 6. ITEM NAMES ARE NOT UNIQUE ON THEIR OWN
--
-- Blazer, Jacket and Waist Coat each appear under both Men's
-- Wear and Women's Wear at different prices. They are separate
-- items, which is exactly what `services` UNIQUE KEY
-- (category_id, name) allows.
--
--
-- 7. WHAT IS NOT TOUCHED
--
-- Nothing scope='BUSINESS' is read or written. No item is
-- deleted or deactivated. `business_price_list`, orders, carts
-- and the four category rows themselves are untouched. Items
-- added by hand since are left alone -- the upserts key on
-- (category_id, name) and only refresh the rows named here.
-- ============================================================


-- ============================================================
-- STAGING
--
-- Plain tables, not TEMPORARY, so this applies the same way
-- whichever runner executes it. They are dropped at the end.
-- ============================================================
DROP TABLE IF EXISTS tmp_customer_pricing_049;

CREATE TABLE tmp_customer_pricing_049 (
  category_id    BIGINT UNSIGNED NOT NULL,
  item_name      VARCHAR(255)    NOT NULL,
  service_code   VARCHAR(50)     NOT NULL,
  customer_price DECIMAL(10,2)   NOT NULL,
  original_price DECIMAL(10,2)   NOT NULL,
  PRIMARY KEY (category_id, item_name, service_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS tmp_customer_items_049;

CREATE TABLE tmp_customer_items_049 (
  category_id      BIGINT UNSIGNED NOT NULL,
  item_name        VARCHAR(255)    NOT NULL,
  base_price       DECIMAL(10,2)   NOT NULL,
  discounted_price DECIMAL(10,2)   NOT NULL,
  display_order    INT             NOT NULL,
  PRIMARY KEY (category_id, item_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 1. THE ITEMS
--
-- `base_price` / `discounted_price` are the item's LOWEST
-- figures across its services, so anything still reading them
-- shows an honest "from" price. The real per-service prices are
-- in `customer_price_list` below, which is what the customer app
-- reads.
-- ============================================================
INSERT INTO tmp_customer_items_049
  (category_id, item_name, base_price, discounted_price, display_order)
VALUES
  (332, 'Blazer', 125.00, 99.00, 1),
  (332, 'Cap', 99.00, 79.00, 2),
  (332, 'Coat', 160.00, 150.00, 3),
  (332, 'Jacket', 189.00, 149.00, 4),
  (332, 'Jeans', 55.00, 43.00, 5),
  (332, 'Safari Suit', 260.00, 250.00, 6),
  (332, 'Shirt', 40.00, 30.00, 7),
  (332, 'Sweat Shirts', 125.00, 99.00, 8),
  (332, 'Sweater', 95.00, 85.00, 9),
  (332, 'Sweater Full', 200.00, 190.00, 10),
  (332, 'Sweater Half', 160.00, 150.00, 11),
  (332, 'T shirt', 35.00, 25.00, 12),
  (332, 'Tie', 99.00, 79.00, 13),
  (332, 'Trouser', 50.00, 39.00, 14),
  (332, 'Waist Coat', 109.00, 89.00, 15),
  (333, 'Blazer', 125.00, 79.00, 16),
  (333, 'Blouse / Zari', 55.00, 45.00, 17),
  (333, 'Frock', 45.00, 35.00, 18),
  (333, 'Heavy Blouse', 35.00, 30.00, 19),
  (333, 'Heavy Dupatta', 29.00, 25.00, 20),
  (333, 'Heavy Kurti', 79.00, 49.00, 21),
  (333, 'Heavy Saree', 189.00, 149.00, 22),
  (333, 'Jacket', 60.00, 50.00, 23),
  (333, 'Kurta', 55.00, 45.00, 24),
  (333, 'Kurta / Salwar Comiz', 160.00, 150.00, 25),
  (333, 'Ladies Inner Garment', 50.00, 40.00, 26),
  (333, 'Leggings / Shalwar', 85.00, 75.00, 27),
  (333, 'Lehanga Plain', 220.00, 210.00, 28),
  (333, 'Lehanga/Choli Set', 235.00, 225.00, 29),
  (333, 'Long Dress', 70.00, 60.00, 30),
  (333, 'Lowers/Uppers', 50.00, 40.00, 31),
  (333, 'Plain Blouse', 25.00, 20.00, 32),
  (333, 'Plain Dupatta', 40.00, 30.00, 33),
  (333, 'Plain Kurti', 40.00, 35.00, 34),
  (333, 'Plain Pyjama', 25.00, 20.00, 35),
  (333, 'Plain Saree', 75.00, 70.00, 36),
  (333, 'Saree Cotton', 185.00, 175.00, 37),
  (333, 'Saree Simple', 160.00, 150.00, 38),
  (333, 'Saree Zari', 260.00, 250.00, 39),
  (333, 'Short Dress', 50.00, 40.00, 40),
  (333, 'Top / Kamize', 50.00, 40.00, 41),
  (333, 'Waist Coat', 80.00, 59.00, 42),
  (333, 'petticoat', 30.00, 25.00, 43),
  (334, 'Bedsheet single', 149.00, 119.00, 44),
  (334, 'Bedshhet double', 219.00, 179.00, 45),
  (334, 'Bind Door', 250.00, 169.00, 46),
  (334, 'Blankets', 87.00, 77.00, 47),
  (334, 'Blind Window', 220.00, 149.00, 48),
  (334, 'Carpet/Galicha large', 280.00, 249.00, 49),
  (334, 'Carpet/Galicha small', 190.00, 169.00, 50),
  (334, 'Curtain Linen', 319.00, 249.00, 51),
  (334, 'Curtain Without Linen', 149.00, 119.00, 52),
  (334, 'Cushion Covers', 37.00, 27.00, 53),
  (334, 'Doormat', 99.00, 79.00, 54),
  (334, 'Double Bed Sheet', 43.00, 33.00, 55),
  (334, 'Double Blanket', 439.00, 349.00, 56),
  (334, 'Duvet Double', 280.00, 220.00, 57),
  (334, 'Duvet Single', 200.00, 170.00, 58),
  (334, 'Foot Mats Large', 120.00, 79.00, 59),
  (334, 'Foot Mats Small', 80.00, 59.00, 60),
  (334, 'Four Seater Sofa', 932.00, 922.00, 61),
  (334, 'Pillow/Cusion Covers', 75.00, 59.00, 62),
  (334, 'Quilt Single', 250.00, 199.00, 63),
  (334, 'QuiltDouble', 499.00, 399.00, 64),
  (334, 'Sataranji Big', 280.00, 249.00, 65),
  (334, 'Sataranji Small', 150.00, 119.00, 66),
  (334, 'Shawl', 90.00, 80.00, 67),
  (334, 'Silk Curtains', 262.00, 252.00, 68),
  (334, 'Sofa cover single', 149.00, 119.00, 69),
  (334, 'Sofa cover three seater', 319.00, 249.00, 70),
  (334, 'Table Cloth Large', 200.00, 149.00, 71),
  (334, 'Table Cloth Small', 150.00, 99.00, 72),
  (334, 'Three Seater Sofa', 592.00, 582.00, 73),
  (335, 'Cap', 80.00, 59.00, 74),
  (335, 'Frock (Kids)', 35.00, 25.00, 75),
  (335, 'Jumper Suit', 35.00, 25.00, 76),
  (335, 'Kids Shirt/Pant', 50.00, 40.00, 77),
  (335, 'Muffler', 100.00, 79.00, 78),
  (335, 'Raincoat', 150.00, 119.00, 79),
  (335, 'Shirt / T-Shirt', 35.00, 25.00, 80),
  (335, 'Soft Toy Extra Large', 249.00, 199.00, 81),
  (335, 'Soft Toy Large', 189.00, 149.00, 82),
  (335, 'Soft Toy Small', 99.00, 79.00, 83);

INSERT INTO services
  (category_id, scope, kind, name, unit, base_price, discounted_price,
   display_order, is_active)
SELECT t.category_id, 'CUSTOMER', 'ITEM', t.item_name, 'per piece',
       t.base_price, t.discounted_price, t.display_order, 1
  FROM tmp_customer_items_049 t
ON DUPLICATE KEY UPDATE
  base_price       = VALUES(base_price),
  discounted_price = VALUES(discounted_price),
  display_order    = VALUES(display_order),
  is_active        = 1;


-- ============================================================
-- 2. THE PRICES, one row per (item, service)
-- ============================================================
INSERT INTO tmp_customer_pricing_049
  (category_id, item_name, service_code, customer_price, original_price)
VALUES
  (332, 'Blazer', 'dry_clean', 249.00, 299.00),
  (332, 'Blazer', 'wash_iron', 99.00, 125.00),
  (332, 'Cap', 'dry_clean', 79.00, 99.00),
  (332, 'Coat', 'dry_clean', 150.00, 160.00),
  (332, 'Jacket', 'dry_clean', 149.00, 189.00),
  (332, 'Jeans', 'dry_clean', 99.00, 120.00),
  (332, 'Jeans', 'wash_iron', 43.00, 55.00),
  (332, 'Safari Suit', 'dry_clean', 380.00, 390.00),
  (332, 'Safari Suit', 'wash_iron', 250.00, 260.00),
  (332, 'Shirt', 'dry_clean', 89.00, 107.00),
  (332, 'Shirt', 'wash_iron', 30.00, 40.00),
  (332, 'Sweat Shirts', 'dry_clean', 99.00, 125.00),
  (332, 'Sweater', 'dry_clean', 85.00, 95.00),
  (332, 'Sweater Full', 'dry_clean', 190.00, 200.00),
  (332, 'Sweater Half', 'dry_clean', 150.00, 160.00),
  (332, 'T shirt', 'dry_clean', 79.00, 99.00),
  (332, 'T shirt', 'wash_iron', 25.00, 35.00),
  (332, 'Tie', 'dry_clean', 79.00, 99.00),
  (332, 'Trouser', 'dry_clean', 85.00, 95.00),
  (332, 'Trouser', 'wash_iron', 39.00, 50.00),
  (332, 'Waist Coat', 'dry_clean', 129.00, 169.00),
  (332, 'Waist Coat', 'wash_iron', 89.00, 109.00),
  (333, 'Blazer', 'dry_clean', 249.00, 299.00),
  (333, 'Blazer', 'wash_iron', 79.00, 125.00),
  (333, 'Blouse / Zari', 'dry_clean', 110.00, 120.00),
  (333, 'Blouse / Zari', 'wash_iron', 45.00, 55.00),
  (333, 'Frock', 'dry_clean', 50.00, 60.00),
  (333, 'Frock', 'wash_iron', 35.00, 45.00),
  (333, 'Heavy Blouse', 'dry_clean', 119.00, 149.00),
  (333, 'Heavy Blouse', 'wash_iron', 30.00, 35.00),
  (333, 'Heavy Dupatta', 'dry_clean', 99.00, 136.00),
  (333, 'Heavy Dupatta', 'wash_iron', 25.00, 29.00),
  (333, 'Heavy Kurti', 'dry_clean', 99.00, 136.00),
  (333, 'Heavy Kurti', 'wash_iron', 49.00, 79.00),
  (333, 'Heavy Saree', 'dry_clean', 299.00, 369.00),
  (333, 'Heavy Saree', 'wash_iron', 149.00, 189.00),
  (333, 'Jacket', 'dry_clean', 149.00, 189.00),
  (333, 'Jacket', 'wash_iron', 50.00, 60.00),
  (333, 'Kurta', 'dry_clean', 85.00, 95.00),
  (333, 'Kurta', 'wash_iron', 45.00, 55.00),
  (333, 'Kurta / Salwar Comiz', 'dry_clean', 150.00, 160.00),
  (333, 'Ladies Inner Garment', 'wash_iron', 40.00, 50.00),
  (333, 'Leggings / Shalwar', 'dry_clean', 150.00, 160.00),
  (333, 'Leggings / Shalwar', 'wash_iron', 75.00, 85.00),
  (333, 'Lehanga Plain', 'wash_iron', 210.00, 220.00),
  (333, 'Lehanga/Choli Set', 'dry_clean', 475.00, 485.00),
  (333, 'Lehanga/Choli Set', 'wash_iron', 225.00, 235.00),
  (333, 'Long Dress', 'dry_clean', 149.00, 199.00),
  (333, 'Long Dress', 'wash_iron', 60.00, 70.00),
  (333, 'Lowers/Uppers', 'wash_iron', 40.00, 50.00),
  (333, 'Plain Blouse', 'dry_clean', 79.00, 107.00),
  (333, 'Plain Blouse', 'wash_iron', 20.00, 25.00),
  (333, 'Plain Dupatta', 'dry_clean', 79.00, 107.00),
  (333, 'Plain Dupatta', 'wash_iron', 30.00, 40.00),
  (333, 'Plain Kurti', 'dry_clean', 79.00, 107.00),
  (333, 'Plain Kurti', 'wash_iron', 35.00, 40.00),
  (333, 'Plain Pyjama', 'dry_clean', 79.00, 107.00),
  (333, 'Plain Pyjama', 'wash_iron', 20.00, 25.00),
  (333, 'Plain Saree', 'dry_clean', 169.00, 228.00),
  (333, 'Plain Saree', 'wash_iron', 70.00, 75.00),
  (333, 'Saree Cotton', 'wash_iron', 175.00, 185.00),
  (333, 'Saree Simple', 'dry_clean', 250.00, 260.00),
  (333, 'Saree Simple', 'wash_iron', 150.00, 160.00),
  (333, 'Saree Zari', 'dry_clean', 385.00, 395.00),
  (333, 'Saree Zari', 'wash_iron', 250.00, 260.00),
  (333, 'Short Dress', 'dry_clean', 89.00, 120.00),
  (333, 'Short Dress', 'wash_iron', 40.00, 50.00),
  (333, 'Top / Kamize', 'dry_clean', 80.00, 90.00),
  (333, 'Top / Kamize', 'wash_iron', 40.00, 50.00),
  (333, 'Waist Coat', 'dry_clean', 129.00, 169.00),
  (333, 'Waist Coat', 'wash_iron', 59.00, 80.00),
  (333, 'petticoat', 'dry_clean', 79.00, 107.00),
  (333, 'petticoat', 'wash_iron', 25.00, 30.00),
  (334, 'Bedsheet single', 'wash_iron', 119.00, 149.00),
  (334, 'Bedshhet double', 'wash_iron', 179.00, 219.00),
  (334, 'Bind Door', 'wash_iron', 169.00, 250.00),
  (334, 'Blankets', 'dry_clean', 152.00, 162.00),
  (334, 'Blankets', 'wash_iron', 77.00, 87.00),
  (334, 'Blind Window', 'wash_iron', 149.00, 220.00),
  (334, 'Carpet/Galicha large', 'wash_iron', 249.00, 280.00),
  (334, 'Carpet/Galicha small', 'wash_iron', 169.00, 190.00),
  (334, 'Curtain Linen', 'wash_iron', 249.00, 319.00),
  (334, 'Curtain Without Linen', 'wash_iron', 119.00, 149.00),
  (334, 'Cushion Covers', 'dry_clean', 46.00, 56.00),
  (334, 'Cushion Covers', 'wash_iron', 27.00, 37.00),
  (334, 'Doormat', 'wash_iron', 79.00, 99.00),
  (334, 'Double Bed Sheet', 'wash_iron', 33.00, 43.00),
  (334, 'Double Blanket', 'wash_iron', 349.00, 439.00),
  (334, 'Duvet Double', 'wash_iron', 220.00, 280.00),
  (334, 'Duvet Single', 'wash_iron', 170.00, 200.00),
  (334, 'Foot Mats Large', 'wash_iron', 79.00, 120.00),
  (334, 'Foot Mats Small', 'wash_iron', 59.00, 80.00),
  (334, 'Four Seater Sofa', 'dry_clean', 922.00, 932.00),
  (334, 'Pillow/Cusion Covers', 'wash_iron', 59.00, 75.00),
  (334, 'Quilt Single', 'wash_iron', 199.00, 250.00),
  (334, 'QuiltDouble', 'wash_iron', 399.00, 499.00),
  (334, 'Sataranji Big', 'wash_iron', 249.00, 280.00),
  (334, 'Sataranji Small', 'wash_iron', 119.00, 150.00),
  (334, 'Shawl', 'dry_clean', 80.00, 90.00),
  (334, 'Silk Curtains', 'dry_clean', 252.00, 262.00),
  (334, 'Sofa cover single', 'wash_iron', 119.00, 149.00),
  (334, 'Sofa cover three seater', 'wash_iron', 249.00, 319.00),
  (334, 'Table Cloth Large', 'wash_iron', 149.00, 200.00),
  (334, 'Table Cloth Small', 'wash_iron', 99.00, 150.00),
  (334, 'Three Seater Sofa', 'dry_clean', 582.00, 592.00),
  (335, 'Cap', 'wash_iron', 59.00, 80.00),
  (335, 'Frock (Kids)', 'wash_iron', 25.00, 35.00),
  (335, 'Jumper Suit', 'dry_clean', 50.00, 60.00),
  (335, 'Jumper Suit', 'wash_iron', 25.00, 35.00),
  (335, 'Kids Shirt/Pant', 'dry_clean', 80.00, 90.00),
  (335, 'Kids Shirt/Pant', 'wash_iron', 40.00, 50.00),
  (335, 'Muffler', 'wash_iron', 79.00, 100.00),
  (335, 'Raincoat', 'wash_iron', 119.00, 150.00),
  (335, 'Shirt / T-Shirt', 'wash_iron', 25.00, 35.00),
  (335, 'Soft Toy Extra Large', 'wash_iron', 199.00, 249.00),
  (335, 'Soft Toy Large', 'wash_iron', 149.00, 189.00),
  (335, 'Soft Toy Small', 'wash_iron', 79.00, 99.00);


-- ============================================================
-- 3. WHICH SERVICES EACH ITEM SUPPORTS
--
-- `getItemServiceOptions` reads this to decide which buttons the
-- item screen offers, so an item with no mapping shows none.
-- ============================================================
INSERT IGNORE INTO item_service_types (item_id, service_id)
SELECT i.id, st.id
  FROM tmp_customer_pricing_049 t
  JOIN services i  ON i.category_id = t.category_id
                  AND i.name = t.item_name
                  AND i.kind = 'ITEM' AND i.scope = 'CUSTOMER'
  JOIN services st ON st.code = t.service_code
                  AND st.kind = 'SERVICE_TYPE';


-- ============================================================
-- 4. THE CUSTOMER PRICE LIST
--
-- `service_id` is set explicitly on every row -- no NULL
-- fallback rows -- so each service carries its own price and
-- nothing falls through to another service's figure.
-- ============================================================
INSERT INTO customer_price_list
  (item_id, service_id, customer_price, original_price, is_active)
SELECT i.id, st.id, t.customer_price, t.original_price, 1
  FROM tmp_customer_pricing_049 t
  JOIN services i  ON i.category_id = t.category_id
                  AND i.name = t.item_name
                  AND i.kind = 'ITEM' AND i.scope = 'CUSTOMER'
  JOIN services st ON st.code = t.service_code
                  AND st.kind = 'SERVICE_TYPE'
ON DUPLICATE KEY UPDATE
  customer_price = VALUES(customer_price),
  original_price = VALUES(original_price),
  is_active      = 1;


-- ============================================================
-- 5. CLEAN UP
-- ============================================================
DROP TABLE IF EXISTS tmp_customer_pricing_049;
DROP TABLE IF EXISTS tmp_customer_items_049;
