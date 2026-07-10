-- ============================================================
-- Migration 026: quotation format kind (R2 / T7)
--   Selects which Sri Vari quotation format to render:
--   retail | industrial | service | stamping. Defaults to 'retail'.
-- Idempotent: information_schema guard.
-- ============================================================

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quotations' AND column_name='quotation_kind');
SET @s := IF(@c=0, "ALTER TABLE quotations ADD COLUMN quotation_kind VARCHAR(20) NOT NULL DEFAULT 'retail' AFTER system_title", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
