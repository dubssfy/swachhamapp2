-- ============================================================
-- SWACHHAM — "A rider accepted your pickup" as a storable type
-- Migration: 073_rider_acceptance_notification_types.sql
--
-- Idempotent. MySQL 8. Purely additive: no existing enum value
-- is removed or renamed, and no row is touched.
-- ============================================================
--
--
-- 1. THE BUG THIS FIXES
--
-- `notifications.type` is an ENUM, not free text. A notification
-- written with a value outside the list is REJECTED by the
-- insert — and `notification.service.createNotification`
-- deliberately swallows its own failures, because a notification
-- must never take down the status change it is reporting on.
--
-- Those two facts together are silent data loss: the rider's
-- acceptance push went out, the event was recorded, and the
-- DURABLE row the customer reads on their own screen was never
-- written. Nothing in the log said so above debug level.
--
-- The three other types this work sends were already in the
-- list and were unaffected:
--
--     PICKUP_SCHEDULED   present since the original schema
--     RIDER_ARRIVED      added by the rider module
--     PICKUP_COMPLETED   present since the original schema
--
--
-- 2. WHY TWO VALUES AND NOT ONE
--
-- A PICKUP and a DISPATCH are separate workflows, and the
-- requirement is that they stay separate. "A rider is coming to
-- collect from you" and "a rider is bringing your laundry back"
-- are different messages about different legs of the order, and
-- an app deciding which screen to open should not have to unpick
-- which from a shared type and a side field.
--
--
-- 3. WHY EXTEND THE ENUM RATHER THAN REUSE A VALUE
--
-- `RIDER_JOB_TAKEN` and `RIDER_JOB_ASSIGNED` already exist and
-- look close enough to borrow. They are not: both are addressed
-- to RIDERS — "this job is yours", "someone else took it" — and
-- are how a rider's own notification list is built. Writing a
-- customer-facing message under one of them would put it in a
-- category whose every other member means something else, and
-- any future query that groups by type would report nonsense.
--
--
-- 4. WHY AN ENUM AT ALL IS NOT REVISITED HERE
--
-- Widening the column to VARCHAR would remove this class of
-- problem permanently, and it is the right eventual answer. It
-- is not this change: the column is read by existing queries
-- and dashboards, and swapping its type is a migration with its
-- own risk profile that has nothing to do with the notifications
-- being added. Two values are added; the question is left open.
-- ============================================================


-- ---- notifications.type += RIDER_ACCEPTED_PICKUP / _DELIVERY ----
--
-- Guarded on the value being absent from the column definition,
-- so re-running is a no-op. The full list is restated because
-- MODIFY COLUMN replaces the definition rather than adding to
-- it — every existing value is carried over unchanged, in its
-- original order, with the two new ones appended.
SET @sql := (
  SELECT IF(
    (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'notifications'
        AND COLUMN_NAME = 'type') LIKE '%RIDER_ACCEPTED_PICKUP%',
    'SELECT ''notifications.type already carries the rider-acceptance values''',
    -- SINGLE-quoted with doubled inner quotes, like every other migration
    -- here. A double-quoted SQL string is an IDENTIFIER on a server running
    -- with ANSI_QUOTES, and this one does -- the statement then fails with
    -- "Unknown column 'ALTER TABLE ...'", which reads like anything but a
    -- quoting problem.
    'ALTER TABLE notifications
       MODIFY COLUMN type ENUM(
         ''ORDER_PLACED'',''PICKUP_SCHEDULED'',''PICKUP_COMPLETED'',
         ''PRODUCTION_STARTED'',''WASHING_COMPLETED'',''ORDER_READY'',
         ''OUT_FOR_DELIVERY'',''DELIVERED'',''GENERAL'',''ORDER_STATUS_UPDATE'',
         ''RIDER_JOB_OFFER'',''RIDER_JOB_ASSIGNED'',''RIDER_JOB_TAKEN'',
         ''RIDER_NEARBY_ORDER'',''RIDER_ARRIVED'',''PICKUP_ASSIGNED'',
         ''RIDER_ACCEPTED_PICKUP'',''RIDER_ACCEPTED_DELIVERY''
       ) NOT NULL DEFAULT ''GENERAL'''
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
