-- ============================================================
-- SWACHHAM — PostgreSQL Initial Schema
-- Migration: 001_initial_schema.sql
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('USER', 'ADMIN', 'PRODUCTION', 'DELIVERY');

CREATE TYPE order_status AS ENUM (
  'ORDER_PLACED',
  'PICKUP_SCHEDULED',
  'PICKUP_ASSIGNED',
  'PICKED_UP',
  'RECEIVED_AT_FACILITY',
  'SORTING',
  'WASHING',
  'DRYING',
  'IRONING',
  'QUALITY_CHECK',
  'READY_FOR_DELIVERY',
  'DELIVERY_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE production_status AS ENUM (
  'RECEIVED',
  'SORTING',
  'WASHING',
  'DRYING',
  'IRONING',
  'FOLDING',
  'QUALITY_CHECK',
  'PACKED',
  'READY_FOR_DELIVERY'
);

CREATE TYPE payment_status AS ENUM (
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED'
);

CREATE TYPE payment_method AS ENUM (
  'CASH_ON_DELIVERY',
  'UPI',
  'CARD',
  'NET_BANKING',
  'WALLET'
);

CREATE TYPE discount_type AS ENUM ('PERCENTAGE', 'FLAT');

CREATE TYPE notification_type AS ENUM (
  'ORDER_PLACED',
  'PICKUP_SCHEDULED',
  'PICKUP_COMPLETED',
  'PRODUCTION_STARTED',
  'WASHING_COMPLETED',
  'ORDER_READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'GENERAL'
);

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(255) NOT NULL,
  email           VARCHAR(255) UNIQUE,
  mobile          VARCHAR(20) UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            user_role NOT NULL DEFAULT 'USER',
  profile_image   TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_or_mobile CHECK (email IS NOT NULL OR mobile IS NOT NULL)
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_mobile ON users(mobile);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- ADDRESSES
-- ============================================================

CREATE TABLE addresses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       VARCHAR(50) NOT NULL DEFAULT 'Home',
  line1       VARCHAR(255) NOT NULL,
  line2       VARCHAR(255),
  city        VARCHAR(100) NOT NULL,
  state       VARCHAR(100) NOT NULL,
  pincode     VARCHAR(10) NOT NULL,
  landmark    VARCHAR(255),
  latitude    DECIMAL(10, 8),
  longitude   DECIMAL(11, 8),
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_addresses_user_id ON addresses(user_id);

-- ============================================================
-- SERVICE CATEGORIES
-- ============================================================

CREATE TABLE service_categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(100) NOT NULL,
  slug          VARCHAR(100) NOT NULL UNIQUE,
  description   TEXT,
  icon_name     VARCHAR(100),
  image_url     TEXT,
  color         VARCHAR(7) DEFAULT '#2D6A4F',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_categories_slug ON service_categories(slug);
CREATE INDEX idx_service_categories_active ON service_categories(is_active);

-- ============================================================
-- SERVICES
-- ============================================================

CREATE TABLE services (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id       UUID NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  unit              VARCHAR(50) NOT NULL DEFAULT 'per piece',
  base_price        DECIMAL(10, 2) NOT NULL,
  discounted_price  DECIMAL(10, 2),
  image_url         TEXT,
  icon_name         VARCHAR(100),
  is_popular        BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  display_order     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT services_price_positive CHECK (base_price > 0),
  CONSTRAINT services_discounted_price CHECK (discounted_price IS NULL OR discounted_price <= base_price)
);

CREATE INDEX idx_services_category_id ON services(category_id);
CREATE INDEX idx_services_active ON services(is_active);
CREATE INDEX idx_services_popular ON services(is_popular);

-- ============================================================
-- CARTS
-- ============================================================

CREATE TABLE carts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_carts_user_id ON carts(user_id);

-- ============================================================
-- CART ITEMS
-- ============================================================

CREATE TABLE cart_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cart_id       UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  quantity      INTEGER NOT NULL DEFAULT 1,
  price_at_add  DECIMAL(10, 2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT cart_items_unique UNIQUE (cart_id, service_id)
);

CREATE INDEX idx_cart_items_cart_id ON cart_items(cart_id);

-- ============================================================
-- COUPONS
-- ============================================================

CREATE TABLE coupons (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            VARCHAR(50) NOT NULL UNIQUE,
  description     TEXT,
  discount_type   discount_type NOT NULL,
  discount_value  DECIMAL(10, 2) NOT NULL,
  min_order_value DECIMAL(10, 2) NOT NULL DEFAULT 0,
  max_discount    DECIMAL(10, 2),
  max_uses        INTEGER,
  used_count      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coupons_code ON coupons(code);
CREATE INDEX idx_coupons_active ON coupons(is_active);

-- ============================================================
-- ORDERS
-- ============================================================

CREATE TABLE orders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number      VARCHAR(30) NOT NULL UNIQUE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  address_id        UUID REFERENCES addresses(id) ON DELETE SET NULL,
  status            order_status NOT NULL DEFAULT 'ORDER_PLACED',
  subtotal          DECIMAL(10, 2) NOT NULL,
  delivery_charge   DECIMAL(10, 2) NOT NULL DEFAULT 0,
  coupon_id         UUID REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_discount   DECIMAL(10, 2) NOT NULL DEFAULT 0,
  tax               DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total             DECIMAL(10, 2) NOT NULL,
  payment_status    payment_status NOT NULL DEFAULT 'PENDING',
  payment_method    payment_method,
  payment_ref       VARCHAR(255),
  special_notes     TEXT,
  cancelled_reason  TEXT,
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- ============================================================
-- ORDER ITEMS
-- ============================================================

CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name  VARCHAR(255) NOT NULL,
  unit          VARCHAR(50) NOT NULL,
  quantity      INTEGER NOT NULL,
  unit_price    DECIMAL(10, 2) NOT NULL,
  discount      DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total_price   DECIMAL(10, 2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- ============================================================
-- ORDER STATUS HISTORY
-- ============================================================

CREATE TABLE order_status_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      order_status NOT NULL,
  notes       TEXT,
  changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_status_history_order_id ON order_status_history(order_id);

-- ============================================================
-- PRODUCTION ORDERS
-- ============================================================

CREATE TABLE production_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  current_status  production_status NOT NULL DEFAULT 'RECEIVED',
  assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
  priority        INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_production_orders_order_id ON production_orders(order_id);
CREATE INDEX idx_production_orders_status ON production_orders(current_status);

-- ============================================================
-- PRODUCTION STATUS HISTORY
-- ============================================================

CREATE TABLE production_status_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status        production_status NOT NULL,
  changed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_production_status_history_order_id ON production_status_history(order_id);

-- ============================================================
-- PICKUPS
-- ============================================================

CREATE TABLE pickups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  scheduled_date  DATE NOT NULL,
  time_slot_start TIME NOT NULL,
  time_slot_end   TIME NOT NULL,
  assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
  picked_up_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pickups_order_id ON pickups(order_id);
CREATE INDEX idx_pickups_scheduled_date ON pickups(scheduled_date);

-- ============================================================
-- DELIVERIES
-- ============================================================

CREATE TABLE deliveries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  scheduled_date  DATE NOT NULL,
  time_slot_start TIME NOT NULL,
  time_slot_end   TIME NOT NULL,
  assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
  delivered_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deliveries_order_id ON deliveries(order_id);
CREATE INDEX idx_deliveries_scheduled_date ON deliveries(scheduled_date);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  type        notification_type NOT NULL DEFAULT 'GENERAL',
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================================
-- REVIEWS
-- ============================================================

CREATE TABLE reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_order_id ON reviews(order_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);

-- ============================================================
-- ORDER NUMBER SEQUENCE
-- ============================================================

CREATE SEQUENCE order_number_seq START 1 INCREMENT 1;

-- Function to generate order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  year_part TEXT;
  seq_part  TEXT;
BEGIN
  year_part := EXTRACT(YEAR FROM NOW())::TEXT;
  seq_part  := LPAD(nextval('order_number_seq')::TEXT, 6, '0');
  RETURN 'SWC-' || year_part || '-' || seq_part;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_addresses_updated_at
  BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_service_categories_updated_at
  BEFORE UPDATE ON service_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_carts_updated_at
  BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_cart_items_updated_at
  BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_production_orders_updated_at
  BEFORE UPDATE ON production_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_pickups_updated_at
  BEFORE UPDATE ON pickups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_deliveries_updated_at
  BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
