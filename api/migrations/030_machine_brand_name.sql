-- ============================================================
-- Migration 030: machine brand name
--   When machine_type = 'brand', lets the actual brand (Essae, Avery,
--   Mettler Toledo, etc.) be recorded and reused via a typable combobox.
--   Nullable, additive. Idempotent guard.
-- ============================================================

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='machines' AND column_name='brand_name');
SET @s := IF(@c=0, "ALTER TABLE machines ADD COLUMN brand_name VARCHAR(100) NULL AFTER machine_type", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE
-- ============================================================
