-- ============================================================
-- SWACHHAM — Restore the three washing machines
-- Migration: 048_restore_washing_machines.sql
--
-- Idempotent. MySQL 8.
-- ============================================================


-- ============================================================
-- 1. WHAT HAPPENED
--
-- `machines` was seeded with exactly three rows by migration
-- 036. The table is now EMPTY (0 rows) -- all three were
-- deleted, not just some. Batching cannot run without them:
-- `batchOptimizer.service` plans against the AVAILABLE machines,
-- so with none there is nothing to plan onto.
--
-- This restores the same three, keyed on the same `code` values
-- (M60 / M30 / M15) that 036 used. The code is the machine's
-- identity and the table's unique key; the name is a label.
--
--
-- 2. THE NAMES
--
-- 036 seeded them as 'Machine 1', 'Machine 2', 'Machine 3'.
-- They are restored here as 'Washing Machine - 60 KG' and so on,
-- which is what they were asked to be called and is more use to
-- anyone choosing one from a list.
--
-- That is safe: the name is DISPLAY ONLY. Nothing matches on it
-- -- `batchOptimizer` and every query key off `id`, `code`,
-- `capacity_kg` and `status`, and the only place the old names
-- appear in code is `scripts/test_batch_optimizer.ts`, which
-- builds its own fixtures and never reads this table.
--
--
-- 3. IDEMPOTENT, AND IT WILL NOT UNDO ANYONE'S WORK
--
-- ON DUPLICATE KEY UPDATE refreshes the name and capacity of the
-- same three rows rather than seeding a fourth.
--
-- `status` is deliberately NOT in the UPDATE clause -- the same
-- decision 036 made, for the same reason: a machine someone has
-- put into MAINTENANCE must not be quietly returned to AVAILABLE
-- by a migration re-run. It is only set on INSERT, where the row
-- is new and AVAILABLE is the right starting state.
--
-- No existing machine is modified or deleted; with the table
-- empty there are none, and were any added since, they keep a
-- different `code` and are untouched.
-- ============================================================
INSERT INTO machines (code, name, capacity_kg, status) VALUES
  ('M60', 'Washing Machine - 60 KG', 60.000, 'AVAILABLE'),
  ('M30', 'Washing Machine - 30 KG', 30.000, 'AVAILABLE'),
  ('M15', 'Washing Machine - 15 KG', 15.000, 'AVAILABLE')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  capacity_kg = VALUES(capacity_kg);
