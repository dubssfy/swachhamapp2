-- ============================================================
-- SWACHHAM — MySQL Full Schema
-- Migration: 003_mysql_full_schema.sql
-- Compatible with Aiven MySQL 8.x
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  mobile_number VARCHAR(15) NOT NULL,
  name          VARCHAR(255) NULL,
  email         VARCHAR(255) NULL,
  password_hash VARCHAR(255) NULL,
  role          ENUM('CUSTOMER','BUSINESS','ADMIN') NOT NULL DEFAULT 'CUSTOMER',
  profile_image VARCHAR(500) NULL,
  is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at DATETIME NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_mobile (mobile_number),
  UNIQUE KEY uk_users_email (email),
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- OTP VERIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_verifications (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NULL,
  mobile_number VARCHAR(15) NOT NULL,
  otp_hash      VARCHAR(255) NOT NULL,
  expires_at    DATETIME NOT NULL,
  attempts      INT NOT NULL DEFAULT 0,
  is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at   DATETIME NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_mobile (mobile_number),
  INDEX idx_otp_verified (is_verified),
  INDEX idx_otp_expires (expires_at),
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CUSTOMER PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_profiles (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  username          VARCHAR(100) NOT NULL,
  profile_image_url VARCHAR(500) NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cp_user (user_id),
  CONSTRAINT fk_cp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
CREATE TABLE IF NOT EXISTS customer_addresses (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  address_label VARCHAR(50) NOT NULL DEFAULT 'Home',
  full_address  TEXT NOT NULL,
  house_flat    VARCHAR(255) NULL,
  area          VARCHAR(255) NULL,
  city          VARCHAR(100) NOT NULL,
  state         VARCHAR(100) NULL,
  pincode       VARCHAR(20) NULL,
  latitude      DECIMAL(10,7) NULL,
  longitude     DECIMAL(10,7) NULL,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ca_user (user_id),
  CONSTRAINT fk_ca_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- BUSINESSES
-- ============================================================
CREATE TABLE IF NOT EXISTS businesses (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name                VARCHAR(255) NOT NULL,
  business_type       ENUM('HOTEL','OTHER') NOT NULL DEFAULT 'HOTEL',
  description         TEXT NULL,
  phone_number        VARCHAR(20) NULL,
  email               VARCHAR(255) NULL,
  address             TEXT NOT NULL,
  area                VARCHAR(255) NULL,
  city                VARCHAR(100) NOT NULL,
  state               VARCHAR(100) NULL,
  pincode             VARCHAR(20) NULL,
  latitude            DECIMAL(10,7) NULL,
  longitude           DECIMAL(10,7) NULL,
  status              ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by_admin_id BIGINT UNSIGNED NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_biz_type (business_type),
  INDEX idx_biz_status (status),
  INDEX idx_biz_city (city),
  CONSTRAINT fk_biz_admin FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- BUSINESS IMAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS business_images (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  business_id BIGINT UNSIGNED NOT NULL,
  image_url   VARCHAR(500) NOT NULL,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bi_business (business_id),
  CONSTRAINT fk_bi_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SERVICE CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS service_categories (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  slug          VARCHAR(100) NOT NULL,
  description   TEXT NULL,
  icon_name     VARCHAR(100) NULL,
  image_url     TEXT NULL,
  color         VARCHAR(7) DEFAULT '#2D6A4F',
  display_order INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sc_slug (slug),
  INDEX idx_sc_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SERVICES
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  category_id      BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(255) NOT NULL,
  description      TEXT NULL,
  unit             VARCHAR(50) NOT NULL DEFAULT 'per piece',
  base_price       DECIMAL(10,2) NOT NULL,
  discounted_price DECIMAL(10,2) NULL,
  image_url        TEXT NULL,
  icon_name        VARCHAR(100) NULL,
  is_popular       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  display_order    INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_svc_category (category_id),
  INDEX idx_svc_active (is_active),
  INDEX idx_svc_popular (is_popular),
  CONSTRAINT chk_svc_price CHECK (base_price > 0),
  CONSTRAINT fk_svc_category FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CARTS
-- ============================================================
CREATE TABLE IF NOT EXISTS carts (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cart_user (user_id),
  CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CART ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS cart_items (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  cart_id      BIGINT UNSIGNED NOT NULL,
  service_id   BIGINT UNSIGNED NOT NULL,
  quantity     INT NOT NULL DEFAULT 1,
  price_at_add DECIMAL(10,2) NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ci_cart_svc (cart_id, service_id),
  INDEX idx_ci_cart (cart_id),
  CONSTRAINT chk_ci_qty CHECK (quantity > 0),
  CONSTRAINT fk_ci_cart FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
  CONSTRAINT fk_ci_svc FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- COUPONS
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code            VARCHAR(50) NOT NULL,
  description     TEXT NULL,
  discount_type   ENUM('PERCENTAGE','FLAT') NOT NULL,
  discount_value  DECIMAL(10,2) NOT NULL,
  min_order_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  max_discount    DECIMAL(10,2) NULL,
  max_uses        INT NULL,
  used_count      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at      DATETIME NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_coupon_code (code),
  INDEX idx_coupon_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_number     VARCHAR(30) NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  address_id       BIGINT UNSIGNED NULL,
  status           ENUM('ORDER_PLACED','PICKUP_SCHEDULED','PICKUP_ASSIGNED','PICKED_UP','RECEIVED_AT_FACILITY','SORTING','WASHING','DRYING','IRONING','QUALITY_CHECK','READY_FOR_DELIVERY','DELIVERY_ASSIGNED','OUT_FOR_DELIVERY','DELIVERED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ORDER_PLACED',
  subtotal         DECIMAL(10,2) NOT NULL,
  delivery_charge  DECIMAL(10,2) NOT NULL DEFAULT 0,
  coupon_id        BIGINT UNSIGNED NULL,
  coupon_discount  DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax              DECIMAL(10,2) NOT NULL DEFAULT 0,
  total            DECIMAL(10,2) NOT NULL,
  payment_status   ENUM('PENDING','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED') NOT NULL DEFAULT 'PENDING',
  payment_method   ENUM('CASH_ON_DELIVERY','UPI','CARD','NET_BANKING','WALLET','ONLINE') NULL,
  payment_ref      VARCHAR(255) NULL,
  special_notes    TEXT NULL,
  cancelled_reason TEXT NULL,
  cancelled_at     DATETIME NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_order_number (order_number),
  INDEX idx_order_user (user_id),
  INDEX idx_order_status (status),
  INDEX idx_order_created (created_at),
  CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_address FOREIGN KEY (address_id) REFERENCES customer_addresses(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ORDER ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS order_items (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id     BIGINT UNSIGNED NOT NULL,
  service_id   BIGINT UNSIGNED NULL,
  service_name VARCHAR(255) NOT NULL,
  unit         VARCHAR(50) NOT NULL,
  quantity     INT NOT NULL,
  unit_price   DECIMAL(10,2) NOT NULL,
  discount     DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_price  DECIMAL(10,2) NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_oi_order (order_id),
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_svc FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ORDER STATUS HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS order_status_history (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id   BIGINT UNSIGNED NOT NULL,
  status     ENUM('ORDER_PLACED','PICKUP_SCHEDULED','PICKUP_ASSIGNED','PICKED_UP','RECEIVED_AT_FACILITY','SORTING','WASHING','DRYING','IRONING','QUALITY_CHECK','READY_FOR_DELIVERY','DELIVERY_ASSIGNED','OUT_FOR_DELIVERY','DELIVERED','COMPLETED','CANCELLED') NOT NULL,
  notes      TEXT NULL,
  changed_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_osh_order (order_id),
  CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_osh_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PRODUCTION ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS production_orders (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id       BIGINT UNSIGNED NOT NULL,
  current_status ENUM('RECEIVED','SORTING','WASHING','DRYING','IRONING','FOLDING','QUALITY_CHECK','PACKED','READY_FOR_DELIVERY') NOT NULL DEFAULT 'RECEIVED',
  assigned_to    BIGINT UNSIGNED NULL,
  priority       INT NOT NULL DEFAULT 0,
  notes          TEXT NULL,
  started_at     DATETIME NULL,
  completed_at   DATETIME NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_po_order (order_id),
  INDEX idx_po_status (current_status),
  CONSTRAINT fk_po_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PRODUCTION STATUS HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS production_status_history (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id     BIGINT UNSIGNED NOT NULL,
  status       ENUM('RECEIVED','SORTING','WASHING','DRYING','IRONING','FOLDING','QUALITY_CHECK','PACKED','READY_FOR_DELIVERY') NOT NULL,
  changed_by   BIGINT UNSIGNED NULL,
  notes        TEXT NULL,
  started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_psh_order (order_id),
  CONSTRAINT fk_psh_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_psh_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PICKUPS
-- ============================================================
CREATE TABLE IF NOT EXISTS pickups (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id        BIGINT UNSIGNED NOT NULL,
  scheduled_date  DATE NOT NULL,
  time_slot_start TIME NOT NULL,
  time_slot_end   TIME NOT NULL,
  assigned_to     BIGINT UNSIGNED NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
  picked_up_at    DATETIME NULL,
  notes           TEXT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pickup_order (order_id),
  INDEX idx_pickup_date (scheduled_date),
  CONSTRAINT fk_pickup_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_pickup_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DELIVERIES
-- ============================================================
CREATE TABLE IF NOT EXISTS deliveries (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id        BIGINT UNSIGNED NOT NULL,
  scheduled_date  DATE NOT NULL,
  time_slot_start TIME NOT NULL,
  time_slot_end   TIME NOT NULL,
  assigned_to     BIGINT UNSIGNED NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
  delivered_at    DATETIME NULL,
  notes           TEXT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_delivery_order (order_id),
  INDEX idx_delivery_date (scheduled_date),
  CONSTRAINT fk_delivery_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  order_id   BIGINT UNSIGNED NULL,
  type       ENUM('ORDER_PLACED','PICKUP_SCHEDULED','PICKUP_COMPLETED','PRODUCTION_STARTED','WASHING_COMPLETED','ORDER_READY','OUT_FOR_DELIVERY','DELIVERED','GENERAL','ORDER_STATUS_UPDATE') NOT NULL DEFAULT 'GENERAL',
  title      VARCHAR(255) NOT NULL,
  body       TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  data       JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id),
  INDEX idx_notif_read (is_read),
  INDEX idx_notif_created (created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  order_id   BIGINT UNSIGNED NOT NULL,
  rating     INT NOT NULL,
  comment    TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_review_order (order_id),
  INDEX idx_review_rating (rating),
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_review_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
