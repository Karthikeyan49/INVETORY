-- ============================================================
-- Migration 031: drop coal/fuel product attributes
--   These columns are leftovers from a fuel-trading template and are foreign to
--   a weighing-machine ERP. All code references were removed; drop the columns.
--   Idempotent via DROP COLUMN IF EXISTS (MariaDB/MySQL 8+).
-- ============================================================

ALTER TABLE products
  DROP COLUMN IF EXISTS gcv,
  DROP COLUMN IF EXISTS ash_content,
  DROP COLUMN IF EXISTS moisture_content,
  DROP COLUMN IF EXISTS suitable_for;

-- ============================================================
-- DONE — restart PHP (opcache) after deploying the code change.
-- ============================================================
