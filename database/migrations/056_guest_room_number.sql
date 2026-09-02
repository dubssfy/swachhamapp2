-- SWACHHAM — Guest Laundry: who the order is for
-- Migration: 056_guest_room_number.sql
--
-- A Guest Laundry order is placed either FOR A ROOM — and then it has to say
-- which room — or for the hotel's own STAFF. Until now the order recorded
-- neither, so a bag of guest laundry arriving at the facility could not be
-- traced back to the room that sent it.
--
-- TWO COLUMNS, NOT ONE. A single `guest_room_number` with NULL meaning "staff"
-- cannot tell staff laundry apart from a room order whose number was never
-- captured — including every order placed before this migration. The explicit
-- choice is stored beside the number so the three states stay distinct:
--
--   guest_laundry_for = 'ROOM'  + guest_room_number = '205'  -> Room Number: 205
--   guest_laundry_for = 'STAFF' + guest_room_number = NULL   -> Staff Laundry
--   guest_laundry_for = NULL                                 -> not recorded
--
-- HOTEL LAUNDRY IS UNTOUCHED. Hotel orders keep NULL in both columns, as does
-- every order that already exists — the columns are nullable with no default,
-- so this migration rewrites no row and no existing order changes meaning.
ALTER TABLE orders
  ADD COLUMN guest_laundry_for ENUM('ROOM','STAFF') NULL AFTER laundry_type,
  ADD COLUMN guest_room_number VARCHAR(20) NULL AFTER guest_laundry_for;
