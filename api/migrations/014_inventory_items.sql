-- ============================================================
-- Migration 014: Inventory Items — a simple stock register.
--   Add an item (name, category, unit) and how many are in stock (quantity),
--   shown in a table just like the Machines page.
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_items (
  id         BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(180) NOT NULL,
  category   VARCHAR(120) NULL,
  sku        VARCHAR(80) NULL,
  quantity   INT(11) NOT NULL DEFAULT 0,
  unit       VARCHAR(30) NOT NULL DEFAULT 'Nos',
  location   VARCHAR(150) NULL,
  notes      TEXT NULL,
  created_by INT(11) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ii_category (category),
  KEY idx_ii_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
