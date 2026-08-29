-- ============================================================
-- SWACHHAM -- Customer order numbers: SWC#DDMMYYYY######
-- Migration: 050_customer_order_number_sequence.sql
--
-- Idempotent. MySQL 8.
-- ============================================================
--
--
-- 1. WHAT CHANGES
--
-- A customer order was numbered
--
--     CONCAT('ORD#', DDMMYYYY, LPAD(id, 6, '0'))
--
-- which leaks the table's AUTO_INCREMENT: the sixth customer
-- order ever placed reads ...000006 whatever the date, and the
-- first order of a new day continues from wherever the id got
-- to. It also looks nothing like a business order.
--
-- Customer orders now use the SAME format as business ones,
-- with C where a business number carries H or G:
--
--     business hotel     SWH#29082026000001
--     business guest     SWG#29082026000002
--     CUSTOMER           SWC#29082026000001
--
-- SW + code + '#' + DDMMYYYY + a 6-digit sequence that restarts
-- at 000001 every calendar day, in the business timezone.
--
--
-- 2. WHY A SECOND COUNTER RATHER THAN SHARING THE BUSINESS ONE
--
-- `business_order_daily_sequence` is deliberately NOT reused.
-- Hotel and Guest share it, so "the first Business order of a
-- day ends in 000001" -- and if customer orders drew from it
-- too, a day's first business order could be 000007 because six
-- customers ordered before it. That would change how existing
-- business numbering behaves, for no gain.
--
-- With its own counter, business numbering is untouched, and a
-- customer number and a business number can never be confused
-- because the letter differs.
--
--
-- 3. WHY A COUNTER AND NOT MAX()+1
--
-- Identical to migration 034's reasoning for the business
-- table, and the same mechanism, so the two behave the same
-- under load: the row is bumped with one atomic upsert keyed by
-- the date. The primary key serialises concurrent inserts and
-- LAST_INSERT_ID(expr) publishes the new value on the calling
-- connection only, so two orders placed in the same instant
-- cannot read the same number. No MAX()+1 race, no randomness,
-- no timestamp standing in for a sequence.
--
--
-- 4. EXISTING ORDERS
--
-- Nothing is renumbered. An order number is printed on
-- documents and quoted to customers, so a migration must never
-- rewrite one. There are in any case ZERO customer orders in
-- the database -- the flow had never run -- so no ORD# number
-- exists to be inconsistent with.
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_order_daily_sequence (
  sequence_date DATE         NOT NULL,
  last_number   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sequence_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
