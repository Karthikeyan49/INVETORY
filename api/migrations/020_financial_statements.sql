-- ============================================================
-- Migration 020: Financial Statements ("single frame") support
--   • funding_entries      — Capital & Loans ledger (equity, loans in/out)
--   • inventory_items.unit_cost — value spare-part stock
--   • finance_config seed  — opening_cash, depreciation_rate_pct, fixed_assets_gross
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS funding_entries (
  id          BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_type  ENUM('capital','loan_in','loan_repaid') NOT NULL,
  amount      DECIMAL(15,2) NOT NULL DEFAULT 0,
  entry_date  DATE NULL,
  party       VARCHAR(150) NULL,
  notes       TEXT NULL,
  created_by  INT(11) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fund_type (entry_type),
  KEY idx_fund_date (entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Spare-item stock cost (for inventory valuation on the Balance Sheet).
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=DATABASE() AND table_name='inventory_items' AND column_name='unit_cost');
SET @s := IF(@c=0, 'ALTER TABLE inventory_items ADD COLUMN unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER quantity', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Seed manual finance-setup keys (insert only if missing; never overwrite).
INSERT INTO finance_config (config_key, config_value)
SELECT * FROM (SELECT 'opening_cash' AS k, '0' AS v) t
WHERE NOT EXISTS (SELECT 1 FROM finance_config WHERE config_key = 'opening_cash');
INSERT INTO finance_config (config_key, config_value)
SELECT * FROM (SELECT 'depreciation_rate_pct' AS k, '0' AS v) t
WHERE NOT EXISTS (SELECT 1 FROM finance_config WHERE config_key = 'depreciation_rate_pct');
INSERT INTO finance_config (config_key, config_value)
SELECT * FROM (SELECT 'fixed_assets_gross' AS k, '0' AS v) t
WHERE NOT EXISTS (SELECT 1 FROM finance_config WHERE config_key = 'fixed_assets_gross');

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
