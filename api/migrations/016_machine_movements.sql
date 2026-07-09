-- ============================================================
-- Migration 016: Machine Movements — a per-machine activity log.
--   Records what happened to a machine (added, status change, part moved,
--   dispatched, billed) so the Machines page can show its movement history.
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS machine_movements (
  id            BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id    BIGINT(20) UNSIGNED NOT NULL,
  movement_type VARCHAR(30) NOT NULL,          -- added | status_change | part_out | part_in | invoice | challan | issue
  description   VARCHAR(255) NULL,
  from_status   VARCHAR(30) NULL,
  to_status     VARCHAR(30) NULL,
  created_by    INT(11) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mm_machine (machine_id),
  KEY idx_mm_created (created_at),
  CONSTRAINT fk_mm_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
