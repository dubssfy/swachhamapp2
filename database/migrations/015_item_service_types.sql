-- ============================================================
-- SWACHHAM — Which laundry service each Business item supports
-- Migration: 015_item_service_types.sql
--
-- Until now nothing recorded which service an item can be given.
-- Select Items needs to filter by Wash & Iron / Dry Clean, and not
-- every item supports both: a carpet is only dry cleaned, a bath
-- towel is only washed and ironed, a uniform can be either.
--
-- The link is a many-to-many between an item (services.kind='ITEM')
-- and a service type (services.kind='SERVICE_TYPE', i.e. the
-- existing Wash & Iron / Dry Clean rows). No new service names are
-- invented — both sides reference rows that already exist.
--
-- Seeding is derived from the existing catalogue (category slug +
-- item name), documented per rule below. It is INSERT IGNORE, so
-- re-running a migration never deletes or overwrites a mapping that
-- was changed later; it only fills in what is missing.
--
-- Only live items (is_active = 1) are mapped, so the retired
-- "Express Service" row from 014 gets no mapping and stays invisible.
--
-- Idempotent. MySQL syntax only. No data outside this table changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS item_service_types (
  item_id    BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (item_id, service_id),
  INDEX idx_ist_service (service_id),
  CONSTRAINT fk_ist_item FOREIGN KEY (item_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT fk_ist_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- WASH & IRON
--
-- The default for the catalogue: everything is washable except the
-- items below, which are dry-clean goods.
--   * carpets and rugs
--   * curtains, blinds and curtain lining — except cotton and shower
--     curtains, which are ordinary washables
--   * blankets / comforters / quilts / duvets — but NOT their covers,
--     which are ordinary washable linen
--   * sofa covers and sofa throws (the fitted upholstery pieces;
--     "Sofa Cushion Cover" is a washable cover and is not matched)
--   * the bare pads, "Pillow" and "Cushion", as opposed to the
--     "Pillow Cover" / "Cushion Cover" that go over them
--
-- The JOIN to the service row means that if Wash & Iron were ever
-- missing or inactive, this inserts nothing instead of failing.
-- ------------------------------------------------------------
INSERT IGNORE INTO item_service_types (item_id, service_id)
SELECT s.id, st.id
FROM services s
JOIN service_categories c ON c.id = s.category_id
JOIN services st ON st.code = 'wash_iron' AND st.kind = 'SERVICE_TYPE' AND st.is_active = 1
WHERE s.scope = 'BUSINESS' AND s.kind = 'ITEM' AND s.is_active = 1
  AND c.kind = 'ITEM_CATEGORY'
  AND NOT (
        c.slug = 'carpet-and-rugs'
     OR (LOWER(s.name) REGEXP 'curtain|blind' AND LOWER(s.name) NOT REGEXP 'cotton|shower')
     OR (LOWER(s.name) REGEXP 'blanket|comforter|quilt|duvet' AND LOWER(s.name) NOT LIKE '%cover%')
     OR LOWER(s.name) REGEXP 'sofa cover|sofa throw'
     OR LOWER(s.name) REGEXP '^pillow$|^cushion$'
  );

-- ------------------------------------------------------------
-- DRY CLEAN
--
-- Categories whose contents are dry-clean goods (carpets, heavy
-- linens, furnishings, upholstery), garments that can go either way
-- (staff uniforms, industrial wear), and the Special Services
-- treatments, which apply to whichever service is ordered.
--
-- Plus the individual pieces that need it although their category
-- is otherwise washable: bath robes, the bare Pillow / Cushion pads,
-- and banquet chair covers and table frills.
-- ------------------------------------------------------------
INSERT IGNORE INTO item_service_types (item_id, service_id)
SELECT s.id, st.id
FROM services s
JOIN service_categories c ON c.id = s.category_id
JOIN services st ON st.code = 'dry_clean' AND st.kind = 'SERVICE_TYPE' AND st.is_active = 1
WHERE s.scope = 'BUSINESS' AND s.kind = 'ITEM' AND s.is_active = 1
  AND c.kind = 'ITEM_CATEGORY'
  AND (
        c.slug IN ('carpet-and-rugs', 'blanket-and-heavy-linens', 'room-furnishing',
                   'living-room', 'staff-uniform', 'industrial', 'special-services')
     OR LOWER(s.name) REGEXP '^pillow$|^cushion$|robe|chair cover|table frill'
  );
