-- ============================================================
-- SWACHHAM — Seed Data
-- Seed: 001_seed_data.sql
-- ============================================================

-- ============================================================
-- SERVICE CATEGORIES
-- ============================================================

INSERT INTO service_categories (id, name, slug, description, icon_name, color, display_order, is_active) VALUES
  (uuid_generate_v4(), 'Wash & Fold',     'wash-fold',     'Professional washing and folding service',                 'local-laundry-service', '#2D6A4F', 1, TRUE),
  (uuid_generate_v4(), 'Dry Cleaning',    'dry-cleaning',  'Expert dry cleaning for delicate fabrics',                 'dry-cleaning',           '#1B4332', 2, TRUE),
  (uuid_generate_v4(), 'Steam Iron',      'steam-iron',    'Crisp and wrinkle-free ironing service',                   'iron',                   '#52B788', 3, TRUE),
  (uuid_generate_v4(), 'Premium Laundry', 'premium',       'Premium care for your finest garments',                    'star',                   '#95D5B2', 4, TRUE),
  (uuid_generate_v4(), 'Household',       'household',     'Curtains, bedsheets, comforters and more',                 'home',                   '#40916C', 5, TRUE),
  (uuid_generate_v4(), 'Express Service', 'express',       '6-hour turnaround for urgent laundry needs',               'bolt',                   '#74C69D', 6, TRUE);

-- ============================================================
-- SERVICES — Wash & Fold
-- ============================================================

INSERT INTO services (id, category_id, name, description, unit, base_price, discounted_price, is_popular, display_order) 
SELECT
  uuid_generate_v4(),
  sc.id,
  svc.name,
  svc.description,
  svc.unit,
  svc.base_price,
  svc.discounted_price,
  svc.is_popular,
  svc.display_order
FROM service_categories sc,
LATERAL (VALUES
  ('Shirt / T-shirt',             'Regular cotton shirts and t-shirts',                'per piece', 25.00, 18.00, TRUE,  1),
  ('Trouser / Jeans',             'Regular trousers, jeans and pants',                 'per piece', 30.00, 22.00, TRUE,  2),
  ('Kurta / Kurti',               'Regular kurta and kurti',                           'per piece', 25.00, 18.00, FALSE, 3),
  ('Salwar / Pyjama',             'Salwar, pyjama and churidar',                       'per piece', 20.00, 15.00, FALSE, 4),
  ('Saree',                       'Cotton sarees — washed and folded',                 'per piece', 50.00, 38.00, FALSE, 5),
  ('Bedsheet (Single)',           'Single bedsheet wash and fold',                     'per piece', 40.00, 30.00, FALSE, 6),
  ('Bedsheet (Double)',           'Double bedsheet wash and fold',                     'per piece', 60.00, 45.00, FALSE, 7),
  ('Pillow Cover',                'Pillow cover wash',                                 'per piece', 10.00,  8.00, FALSE, 8),
  ('Socks',                       'Pair of socks',                                     'per pair',   8.00,  6.00, FALSE, 9),
  ('Underwear / Innerwear',       'Innerwear wash',                                    'per piece',  8.00,  6.00, FALSE,10)
) AS svc(name, description, unit, base_price, discounted_price, is_popular, display_order)
WHERE sc.slug = 'wash-fold';

-- ============================================================
-- SERVICES — Dry Cleaning
-- ============================================================

INSERT INTO services (id, category_id, name, description, unit, base_price, discounted_price, is_popular, display_order) 
SELECT
  uuid_generate_v4(),
  sc.id,
  svc.name,
  svc.description,
  svc.unit,
  svc.base_price,
  svc.discounted_price,
  svc.is_popular,
  svc.display_order
FROM service_categories sc,
LATERAL (VALUES
  ('Suit (2 Piece)',              'Full 2-piece suit dry cleaning',                    'per piece', 350.00, 280.00, TRUE, 1),
  ('Blazer / Coat',              'Blazer and formal coat dry cleaning',               'per piece', 200.00, 160.00, TRUE, 2),
  ('Sherwani',                   'Sherwani dry cleaning and pressing',                'per piece', 400.00, 320.00, FALSE,3),
  ('Saree (Silk)',               'Silk saree dry cleaning',                           'per piece', 150.00, 120.00, TRUE, 4),
  ('Lehenga',                    'Lehenga dry cleaning',                              'per piece', 350.00, 280.00, FALSE,5),
  ('Woolen Sweater',             'Woolen sweater dry cleaning',                       'per piece',  80.00,  65.00, TRUE, 6),
  ('Jacket (Winter)',            'Heavy winter jacket dry cleaning',                  'per piece', 180.00, 140.00, FALSE,7),
  ('Curtain (Per Metre)',        'Curtain dry cleaning per metre',                    'per metre',  60.00,  50.00, FALSE,8),
  ('Comforter (Single)',         'Single comforter dry cleaning',                     'per piece', 250.00, 200.00, FALSE,9),
  ('Comforter (Double)',         'Double comforter dry cleaning',                     'per piece', 350.00, 280.00, FALSE,10)
) AS svc(name, description, unit, base_price, discounted_price, is_popular, display_order)
WHERE sc.slug = 'dry-cleaning';

-- ============================================================
-- SERVICES — Steam Iron
-- ============================================================

INSERT INTO services (id, category_id, name, description, unit, base_price, discounted_price, is_popular, display_order) 
SELECT
  uuid_generate_v4(),
  sc.id,
  svc.name,
  svc.description,
  svc.unit,
  svc.base_price,
  svc.discounted_price,
  svc.is_popular,
  svc.display_order
FROM service_categories sc,
LATERAL (VALUES
  ('Shirt / T-shirt / Trouser / Jeans', 'Steam press for shirts, t-shirts, trousers and jeans', 'per piece', 18.00, 9.00, TRUE, 1),
  ('Plain Top / Kurta / Kurti / Pyjama','Steam press for tops, kurtas, and pyjamas',            'per piece', 18.00, 9.00, TRUE, 2),
  ('Saree',                              'Steam press for sarees',                               'per piece', 30.00,15.00, FALSE,3),
  ('Suit / Blazer',                      'Steam press for suits and blazers',                    'per piece', 50.00,25.00, FALSE,4),
  ('Bed Sheet (Single)',                 'Steam press for single bed sheet',                     'per piece', 25.00,12.00, FALSE,5),
  ('Bed Sheet (Double)',                 'Steam press for double bed sheet',                     'per piece', 35.00,18.00, FALSE,6)
) AS svc(name, description, unit, base_price, discounted_price, is_popular, display_order)
WHERE sc.slug = 'steam-iron';

-- ============================================================
-- SERVICES — Premium Laundry
-- ============================================================

INSERT INTO services (id, category_id, name, description, unit, base_price, discounted_price, is_popular, display_order)
SELECT
  uuid_generate_v4(),
  sc.id,
  svc.name,
  svc.description,
  svc.unit,
  svc.base_price,
  svc.discounted_price,
  svc.is_popular,
  svc.display_order
FROM service_categories sc,
LATERAL (VALUES
  ('Premium Shirt',     'Premium wash + dry + fold + press for shirts',  'per piece', 60.00,  48.00, TRUE, 1),
  ('Premium Suit',      'Full premium treatment for 2-piece suit',       'per piece',450.00, 360.00, TRUE, 2),
  ('Premium Saree',     'Premium saree treatment and packaging',         'per piece',200.00, 160.00, FALSE,3),
  ('Premium Sherwani',  'Premium sherwani cleaning and packaging',       'per piece',600.00, 480.00, FALSE,4)
) AS svc(name, description, unit, base_price, discounted_price, is_popular, display_order)
WHERE sc.slug = 'premium';

-- ============================================================
-- SERVICES — Household
-- ============================================================

INSERT INTO services (id, category_id, name, description, unit, base_price, discounted_price, is_popular, display_order)
SELECT
  uuid_generate_v4(),
  sc.id,
  svc.name,
  svc.description,
  svc.unit,
  svc.base_price,
  svc.discounted_price,
  svc.is_popular,
  svc.display_order
FROM service_categories sc,
LATERAL (VALUES
  ('Curtain (Per Metre)', 'Curtain wash per metre', 'per metre',  40.00, 32.00, FALSE, 1),
  ('Blanket (Single)',    'Single blanket wash',    'per piece',  90.00, 72.00, TRUE,  2),
  ('Blanket (Double)',    'Double blanket wash',    'per piece', 130.00,104.00, TRUE,  3),
  ('Pillow',             'Pillow wash',             'per piece',  40.00, 32.00, FALSE, 4),
  ('Sofa Cover',         'Sofa cover wash',         'per piece',  80.00, 64.00, FALSE, 5),
  ('Towel (Bath)',       'Bath towel wash',         'per piece',  20.00, 16.00, FALSE, 6)
) AS svc(name, description, unit, base_price, discounted_price, is_popular, display_order)
WHERE sc.slug = 'household';

-- ============================================================
-- SERVICES — Express
-- ============================================================

INSERT INTO services (id, category_id, name, description, unit, base_price, discounted_price, is_popular, display_order)
SELECT
  uuid_generate_v4(),
  sc.id,
  svc.name,
  svc.description,
  svc.unit,
  svc.base_price,
  svc.discounted_price,
  svc.is_popular,
  svc.display_order
FROM service_categories sc,
LATERAL (VALUES
  ('Express Shirt',       '6-hour express wash + press for shirts',       'per piece', 45.00, 38.00, TRUE, 1),
  ('Express Trouser',     '6-hour express wash + press for trousers',     'per piece', 50.00, 42.00, TRUE, 2),
  ('Express Kurta/Kurti', '6-hour express wash + press for kurta/kurti',  'per piece', 45.00, 38.00, FALSE,3),
  ('Express Saree',       '6-hour express saree wash and press',          'per piece', 80.00, 68.00, FALSE,4)
) AS svc(name, description, unit, base_price, discounted_price, is_popular, display_order)
WHERE sc.slug = 'express';

-- ============================================================
-- COUPONS
-- ============================================================

INSERT INTO coupons (code, description, discount_type, discount_value, min_order_value, max_discount, max_uses, is_active, expires_at) VALUES
  ('WELCOME50',  'Welcome offer — 50% off on first order',      'PERCENTAGE', 50.00, 100.00, 150.00,  1000, TRUE, NOW() + INTERVAL '1 year'),
  ('SWACHHAM20', 'Flat ₹20 off on all orders',                  'FLAT',       20.00,  60.00,   NULL,  5000, TRUE, NOW() + INTERVAL '6 months'),
  ('NEWUSER',    '30% off for new users',                       'PERCENTAGE', 30.00,  80.00, 100.00,  NULL, TRUE, NOW() + INTERVAL '1 year'),
  ('DRYCLEAN15', '15% off on dry cleaning orders',              'PERCENTAGE', 15.00, 200.00, 200.00, 10000, TRUE, NOW() + INTERVAL '3 months'),
  ('FREESHIP',   'Free delivery on any order',                  'FLAT',       40.00,   0.00,  40.00,  NULL, TRUE, NOW() + INTERVAL '6 months');
