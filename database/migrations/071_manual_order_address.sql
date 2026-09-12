-- ============================================================
-- SWACHHAM — The address a customer types at checkout
-- Migration: 071_manual_order_address.sql
--
-- Idempotent. MySQL 8. No table dropped, no row deleted, no
-- existing order's address changed.
-- ============================================================
--
--
-- 1. WHAT THIS ADDS, AND WHY IT IS NOT A `customer_addresses` ROW
--
-- Checkout gains "Enter Address Manually" beside the saved
-- addresses. The obvious implementation is to write the typed
-- address into `customer_addresses` and point `orders.address_id`
-- at it, and that is deliberately NOT what this does. Three
-- reasons, in order of how much they matter:
--
--   IT IS A SNAPSHOT, NOT A PROFILE ENTRY. `customer_addresses`
--   rows are edited and deleted by their owner, and the FK is
--   `ON DELETE SET NULL` -- so an order placed to a one-off
--   address would lose it the moment the customer tidied their
--   address book. A rider disputing where they were sent, and a
--   manager reading an old order, both need the address AS IT WAS
--   WHEN THE ORDER WAS PLACED. Columns on `orders` cannot be
--   edited out from under the order.
--
--   A HOTEL HAS NO `customer_addresses` ROW AT ALL. A business
--   order carries `business_user_id` and no `user_id`, and the
--   table's FK points at `users`. The same reason `notifications`
--   cannot hold a business message. Putting the address on the
--   order is the only shape that serves both flows with one set
--   of columns.
--
--   A ONE-OFF ADDRESS IS NOT A SAVED ADDRESS. Typing where to
--   collect from today should not silently add an entry the
--   customer then has to delete.
--
-- The saved-address flow is untouched: `address_id` still points
-- at `customer_addresses` and is still how most orders carry
-- their address. These columns are the OTHER case, and exactly
-- one of the two is populated on any order.
--
--
-- 2. WHY THE COORDINATES ARE HERE TOO
--
-- The delivery charge is measured from where the laundry is
-- collected (`deliveryFee.service`), and dispatch routes a rider
-- to a point, not to a sentence (`dispatch.resolvePickupPoint`).
-- A typed address that carried no point would fall back to the
-- device's fix at booking time -- which is usually right and
-- occasionally an hour stale. When the customer taps "Use my
-- current location" to fill the form, the fix that filled it is
-- the honest point for that address, so it is stored beside it.
--
-- NULL is a legitimate value here: an address typed from memory
-- for somewhere the customer is not standing has no point, and
-- the existing device-fix fallback covers it.
--
--
-- 3. `manual_contact_name` / `manual_contact_mobile`
--
-- Who the rider asks for at the door. A manual address is by
-- definition somewhere other than the account holder's usual
-- place -- a relative's flat, an office -- so the person meeting
-- the rider may not be the person who booked. Both are optional;
-- `dispatch.resolvePickupPoint` falls back to the account's own
-- name and number exactly as it does today.
--
--
-- 4. NO NEW STATUS, NO NEW FLOW
--
-- Nothing about approval, pickup, dispatch or delivery changes.
-- An order with a typed address travels the same ladder as one
-- with a saved address; the only difference is where the text on
-- the screen is read from.
-- ============================================================


-- ---- orders.manual_address_* ----
--
-- Guarded on the first column being absent, so re-running is a
-- no-op. All of them are added together because they are one
-- fact: an address.
SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'orders'
              AND COLUMN_NAME = 'manual_address_line'),
    'SELECT ''orders.manual_address_line already exists''',
    'ALTER TABLE orders
       ADD COLUMN manual_address_line VARCHAR(255) NULL
         COMMENT ''Flat / building / street, as the customer typed it. NULL = a saved address was used.''
       AFTER address_id,
       ADD COLUMN manual_landmark VARCHAR(255) NULL
         COMMENT ''Optional landmark for the rider.''
       AFTER manual_address_line,
       ADD COLUMN manual_city VARCHAR(100) NULL
         COMMENT ''City, as typed. Required whenever manual_address_line is set.''
       AFTER manual_landmark,
       ADD COLUMN manual_state VARCHAR(100) NULL
         COMMENT ''State, as typed.''
       AFTER manual_city,
       ADD COLUMN manual_pincode VARCHAR(20) NULL
         COMMENT ''PIN code, as typed. Required whenever manual_address_line is set.''
       AFTER manual_state,
       ADD COLUMN manual_contact_name VARCHAR(120) NULL
         COMMENT ''Who the rider asks for at this address, when it is not the account holder.''
       AFTER manual_pincode,
       ADD COLUMN manual_contact_mobile VARCHAR(20) NULL
         COMMENT ''Who the rider calls at this address, when it is not the account holder.''
       AFTER manual_contact_name,
       ADD COLUMN manual_latitude DECIMAL(10,7) NULL
         COMMENT ''The fix that filled the form, when one did. Same precision as customer_addresses.''
       AFTER manual_contact_mobile,
       ADD COLUMN manual_longitude DECIMAL(10,7) NULL
         COMMENT ''The fix that filled the form, when one did.''
       AFTER manual_latitude'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
