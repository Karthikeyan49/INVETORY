-- ============================================================
-- Migration 029: quotation item specs (capacity/accuracy/platform_size)
--   Weighing-scale attributes needed by the Retail/Industrial/Stamping
--   Sri Vari quotation formats. Nullable, additive. Idempotent guard.
-- ============================================================

SET @c1 := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quotation_items' AND column_name='capacity');
SET @s1 := IF(@c1=0, "ALTER TABLE quotation_items ADD COLUMN capacity VARCHAR(50) NULL AFTER specifications", 'SELECT 1');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

SET @c2 := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quotation_items' AND column_name='accuracy');
SET @s2 := IF(@c2=0, "ALTER TABLE quotation_items ADD COLUMN accuracy VARCHAR(50) NULL AFTER capacity", 'SELECT 1');
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;

SET @c3 := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quotation_items' AND column_name='platform_size');
SET @s3 := IF(@c3=0, "ALTER TABLE quotation_items ADD COLUMN platform_size VARCHAR(50) NULL AFTER accuracy", 'SELECT 1');
PREPARE st FROM @s3; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
