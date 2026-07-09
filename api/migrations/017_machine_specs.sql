-- ============================================================
-- Migration 017: machine spec + date fields (requirements set 2)
--   accuracy, platform_size, capacity — type-once dropdown fields
--   invoice_date, stamping_date — stamping_date optional (blank => pending)
-- Idempotent: information_schema guards.
-- ============================================================

SET @t := 'machines';

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='accuracy');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN accuracy VARCHAR(60) NULL AFTER category', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='platform_size');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN platform_size VARCHAR(60) NULL AFTER accuracy', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='capacity');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN capacity VARCHAR(60) NULL AFTER platform_size', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='invoice_date');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN invoice_date DATE NULL AFTER purchase_date', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='stamping_date');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN stamping_date DATE NULL AFTER invoice_date', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
