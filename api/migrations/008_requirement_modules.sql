-- ============================================================
-- Migration 008: requirement.txt Modules 2–6
--   2. Stamping + renewal alerts        → stampings
--   3. Missing-part transfer            → part_transfers (+ machine_parts.status)
--   5. Dual tax login (extra amount)    → machines sale/tax/extra cols + users.tax_view
--   6. Salesperson follow-up alerts     → followups
-- Idempotent: safe to re-run (IF NOT EXISTS + information_schema guards).
-- ============================================================

-- ── Module 2: Stamping certificates + renewal tracking ──────────────────────
CREATE TABLE IF NOT EXISTS stampings (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  machine_id     BIGINT UNSIGNED NOT NULL,
  customer_id    BIGINT UNSIGNED NULL,
  certificate_no VARCHAR(80)  NULL,
  stamp_date     DATE NULL     COMMENT 'Date the machine was last stamped/verified',
  expiry_date    DATE NULL     COMMENT 'Renewal due date (stamp_date + validity, typically 1 year)',
  quarter        VARCHAR(12) NULL COMMENT 'e.g. Q3-2026 — legal metrology quarter',
  status         ENUM('pending','stamped','due','expired','renewed') NOT NULL DEFAULT 'pending',
  notes          TEXT NULL,
  created_by     BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_stampings_machine (machine_id),
  KEY idx_stampings_status  (status),
  KEY idx_stampings_expiry  (expiry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Module 3: Part transfer audit trail (battery moved A → B) ────────────────
CREATE TABLE IF NOT EXISTS part_transfers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  part_id         BIGINT UNSIGNED NULL COMMENT 'Source machine_parts.id (nullable once source deleted)',
  from_machine_id BIGINT UNSIGNED NULL,
  to_machine_id   BIGINT UNSIGNED NULL,
  part_name       VARCHAR(120) NOT NULL,
  qty             DECIMAL(15,3) NOT NULL DEFAULT 1,
  notes           TEXT NULL,
  transferred_by  BIGINT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ptrans_from (from_machine_id),
  KEY idx_ptrans_to   (to_machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Module 6: Salesperson follow-ups (customer reschedules etc.) ─────────────
CREATE TABLE IF NOT EXISTS followups (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id    BIGINT UNSIGNED NULL,
  customer_name  VARCHAR(160) NULL,
  machine_id     BIGINT UNSIGNED NULL,
  assigned_to    BIGINT UNSIGNED NULL COMMENT 'Salesperson (users.user_id)',
  title          VARCHAR(200) NOT NULL,
  note           TEXT NULL,
  followup_date  DATE NULL,
  status         ENUM('open','done','snoozed') NOT NULL DEFAULT 'open',
  created_by     BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_followups_assigned (assigned_to),
  KEY idx_followups_status   (status),
  KEY idx_followups_date     (followup_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Module 5: sale + tax + hidden "extra" amount on machines ─────────────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=DATABASE() AND table_name='machines' AND column_name='sale_price');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN sale_price DECIMAL(15,2) NULL AFTER notes', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=DATABASE() AND table_name='machines' AND column_name='tax_amount');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN tax_amount DECIMAL(15,2) NULL AFTER sale_price', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=DATABASE() AND table_name='machines' AND column_name='extra_amount');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN extra_amount DECIMAL(15,2) NULL COMMENT ''Off-books extra — visible only to tax_view=extended'' AFTER tax_amount', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── Module 5: per-user tax visibility (standard vs extended login) ───────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=DATABASE() AND table_name='users' AND column_name='tax_view');
SET @s := IF(@c=0, 'ALTER TABLE users ADD COLUMN tax_view ENUM(''standard'',''extended'') NOT NULL DEFAULT ''standard''', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
