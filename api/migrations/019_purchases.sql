-- ============================================================
-- Migration 019: Purchases — a simple purchase register.
--   Record a purchase from a vendor (taxable amount BEFORE GST, GST %, and an
--   off-books extra amount that only the extended tax login may see). Each
--   purchase also posts a matching Expense row so it flows into Profit & Loss.
--   Cash purchases are paid in full; credit purchases track an advance and
--   an outstanding balance.
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS purchases (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  purchase_no    VARCHAR(40) NULL,
  vendor_name    VARCHAR(150) NOT NULL,
  location       VARCHAR(150) NULL,
  purchase_type  ENUM('cash','credit') NOT NULL DEFAULT 'cash',
  taxable        DECIMAL(15,2) NOT NULL DEFAULT 0,   -- pay amount BEFORE gst
  gst_pct        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  gst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  extra_amount   DECIMAL(15,2) NOT NULL DEFAULT 0,   -- off-books, extended login only
  total          DECIMAL(15,2) NOT NULL DEFAULT 0,   -- taxable + gst_amount
  advance        DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount_paid    DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(40) NULL,
  purchase_date  DATE NULL,
  notes          TEXT NULL,
  created_by     INT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pur_vendor (vendor_name),
  KEY idx_pur_location (location)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
