-- ============================================================
-- Migration 013: Machine Issues (service / fault tracking)
--   A machine with an open issue moves to status 'maintenance' (out of
--   available stock) and appears on the Issues page with its current PLACE
--   (where the machine physically is) and PROCESS (repair stage). When the
--   issue is resolved the machine returns to 'in_stock' — back on Machines.
-- Idempotent: information_schema guards + CREATE TABLE IF NOT EXISTS.
-- ============================================================

-- Add 'maintenance' to the machines.status enum (only if not already present).
SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema=DATABASE() AND table_name='machines'
               AND column_name='status' AND COLUMN_TYPE LIKE '%maintenance%');
SET @s := IF(@has=0,
  "ALTER TABLE machines MODIFY COLUMN status ENUM('in_stock','reserved','on_delivery','delivered','maintenance') NOT NULL DEFAULT 'in_stock'",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS machine_issues (
  id          BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id  BIGINT(20) UNSIGNED NOT NULL,
  title       VARCHAR(200) NOT NULL,
  description TEXT NULL,
  place       VARCHAR(150) NULL,        -- where the machine currently is
  process     VARCHAR(100) NULL,        -- current repair stage
  status      ENUM('open','in_progress','resolved') NOT NULL DEFAULT 'open',
  reported_by INT(11) NULL,
  resolved_at DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mi_machine (machine_id),
  KEY idx_mi_status (status),
  CONSTRAINT fk_mi_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
