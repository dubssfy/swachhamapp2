-- ============================================================
-- SWACHHAM — One push per event, enforced by the database
-- Migration: 072_order_notification_events.sql
--
-- Idempotent: safe to re-run.
-- ============================================================
--
--
-- 1. THE PROBLEM THIS SOLVES
--
-- Three moments now push to the customer or the hotel:
--
--     PICKUP_SCHEDULED       a Manager named the collection
--     RIDER_ACCEPTED_PICKUP  a rider took the pickup
--     RIDER_ARRIVED          the rider is at the door
--
-- Each must reach the phone exactly ONCE per actual event. The
-- status transitions that trigger them are already guarded --
-- `acceptOrder` names the pending status in its WHERE clause,
-- `acceptJob` claims the job with a conditional UPDATE, and
-- `updateJobStatus` refuses ARRIVED from anything but EN_ROUTE --
-- so in the ordinary run of things each fires once.
--
-- "In the ordinary run of things" is not good enough for a phone
-- buzzing at a hotel front desk. A retried request, a second
-- server process, a Manager re-saving the same pickup time, a
-- client that sends the arrival twice on a flaky connection:
-- every one of these is a second push for one event, and the
-- guards above are spread across three services that do not know
-- about each other.
--
--
-- 2. WHY A TABLE AND NOT A COLUMN
--
-- A `pickup_notified_at` column on `orders` would answer one of
-- the three, and the next event would want another column. More
-- importantly a column is set by an UPDATE, which succeeds
-- whether or not it changed anything -- so the caller still has
-- to read it back to find out if it was first, and two callers
-- can both read "not yet" before either writes.
--
-- A UNIQUE key turns "has this already been sent?" into the
-- INSERT itself: the first caller inserts, every later one gets
-- a duplicate-key error, and the database decided -- not a
-- read-then-write the two could interleave. That is the same
-- reasoning `push_tokens` uses for `uk_push_token`.
--
--
-- 3. WHAT `event_key` IS
--
-- The notification type plus whatever makes this OCCURRENCE of
-- it distinct, e.g.:
--
--     RIDER_ARRIVED:job=418
--     PICKUP_SCHEDULED:2026-09-14 16:00:00
--
-- The pickup one carries the date and time ON PURPOSE. A Manager
-- who opens an order and saves the SAME collection again is not
-- a new event and must not buzz anyone -- the key is identical,
-- so the insert is refused. A Manager who moves the collection
-- to a different time IS a new event the customer needs to know
-- about, and it makes a different key. The event's own identity
-- does the deduplication; no separate "did it change?" check can
-- drift away from it.
--
-- Arrival is keyed by JOB rather than by order because a pickup
-- and a dispatch are separate jobs against one order, and both
-- have a rider arriving at a door. Keying on the order alone
-- would silence the delivery because the pickup already rang.
--
--
-- 4. THIS TABLE NEVER DECIDES WHETHER A MESSAGE WAS DELIVERED
--
-- It records that an event was CLAIMED for notification, not
-- that FCM accepted it. Push is best-effort by nature (see
-- `push.service`), and a row here means "we have already tried
-- this one" -- which is exactly the question duplicate
-- suppression needs answered. The durable `notifications` and
-- `business_messages` rows remain the record of what was said.
-- ============================================================

CREATE TABLE IF NOT EXISTS order_notification_events (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

  order_id    BIGINT UNSIGNED NOT NULL,

  /*
   * The event, and what makes this occurrence of it distinct.
   * See section 3. 191 characters so the column can carry a
   * utf8mb4 unique key within InnoDB's 3072-byte index limit
   * alongside `order_id`.
   */
  event_key   VARCHAR(191) NOT NULL,

  /*
   * The notification type on its own (PICKUP_SCHEDULED, ...),
   * denormalised out of `event_key` so "how many arrival pushes
   * did we send last week" is a GROUP BY rather than a LIKE.
   */
  event_type  VARCHAR(64) NOT NULL,

  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  /*
   * THE WHOLE POINT OF THE TABLE. The second attempt at an event
   * fails here rather than reaching a phone.
   */
  UNIQUE KEY uk_order_event (order_id, event_key),
  INDEX idx_one_type (event_type, created_at),

  CONSTRAINT fk_one_order FOREIGN KEY (order_id)
    REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
