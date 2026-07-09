-- ============================================================
-- Migration 007: Machines + machine parts (requirement.txt — Module 1)
-- Weighing machines as tracked inventory units made of parts.
-- Run once: import via phpMyAdmin or execute directly in MySQL.
-- ============================================================

CREATE TABLE IF NOT EXISTS machines (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(60)  NOT NULL COMMENT 'Serial / asset code (unique)',
  model         VARCHAR(150) NULL,
  category      VARCHAR(100) NULL COMMENT 'Free-text category (matches inventory_products.category convention)',
  customer_id   BIGINT UNSIGNED NULL COMMENT 'Owner once sold (users.user_id)',
  zone_id       BIGINT UNSIGNED NULL COMMENT 'Current inventory_zones location',
  status        ENUM('in_stock','reserved','on_delivery','delivered') NOT NULL DEFAULT 'in_stock',
  purchase_date DATE NULL COMMENT 'Date the customer bought the machine (drives stamping renewal)',
  sold_date     DATE NULL,
  notes         TEXT NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_machines_code (code),
  KEY idx_machines_status   (status),
  KEY idx_machines_category (category),
  KEY idx_machines_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS machine_parts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  machine_id BIGINT UNSIGNED NOT NULL,
  part_name  VARCHAR(120) NOT NULL COMMENT 'e.g. Battery, Display, Load cell',
  product_id BIGINT UNSIGNED NULL COMMENT 'Optional link to inventory_products',
  qty        DECIMAL(15,3) NOT NULL DEFAULT 1,
  status     ENUM('present','missing','transferred') NOT NULL DEFAULT 'present',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_mparts_machine (machine_id),
  KEY idx_mparts_status  (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
