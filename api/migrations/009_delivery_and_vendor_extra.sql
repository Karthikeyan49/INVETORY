-- ============================================================
-- Migration 009: Delivery challans + vendor-side extra amount
--   Line 6  → delivery bill / challan
--   Line 8  → missing-part warning surfaces at delivery generation
--   Line 14 → sales/delivery linked to machine inventory
--   Line 2/18 → second "extra" figure (received FROM vendor) alongside
--               extra_amount (given TO customer)
-- Idempotent: CREATE TABLE IF NOT EXISTS + information_schema guards.
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_notes (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  challan_no    VARCHAR(40)  NOT NULL,
  customer_id   BIGINT UNSIGNED NULL,
  customer_name VARCHAR(160) NULL,
  machine_id    BIGINT UNSIGNED NULL COMMENT 'Machine being delivered (links delivery ↔ inventory)',
  category      VARCHAR(100) NULL,
  items         TEXT NULL COMMENT 'Free-text / JSON extra line items',
  status        ENUM('draft','issued','delivered','cancelled') NOT NULL DEFAULT 'draft',
  delivery_date DATE NULL,
  missing_flag  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Snapshot: machine was missing parts when issued',
  notes         TEXT NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_challan (challan_no),
  KEY idx_dn_machine (machine_id),
  KEY idx_dn_status  (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Second extra figure: what the dealer receives FROM the vendor (extra_amount = given TO customer)
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=DATABASE() AND table_name='machines' AND column_name='extra_from_vendor');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN extra_from_vendor DECIMAL(15,2) NULL COMMENT ''Off-books extra received from vendor — extended view only'' AFTER extra_amount', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
