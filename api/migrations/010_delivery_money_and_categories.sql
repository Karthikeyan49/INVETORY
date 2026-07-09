-- ============================================================
-- Migration 010: extend "tax vs tax+extra" to delivery billing (lines 14, 18)
--                + categorization on follow-ups (line 20)
-- Idempotent: information_schema guards.
-- ============================================================

-- Delivery challans carry money so tax / tax+extra applies here too (line 18)
SET @t := 'delivery_notes';
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='amount');
SET @s := IF(@c=0, 'ALTER TABLE delivery_notes ADD COLUMN amount DECIMAL(15,2) NULL AFTER items', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='tax_amount');
SET @s := IF(@c=0, 'ALTER TABLE delivery_notes ADD COLUMN tax_amount DECIMAL(15,2) NULL AFTER amount', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='extra_amount');
SET @s := IF(@c=0, 'ALTER TABLE delivery_notes ADD COLUMN extra_amount DECIMAL(15,2) NULL COMMENT ''Extra to customer — extended view only'' AFTER tax_amount', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='extra_from_vendor');
SET @s := IF(@c=0, 'ALTER TABLE delivery_notes ADD COLUMN extra_from_vendor DECIMAL(15,2) NULL COMMENT ''Extra from vendor — extended view only'' AFTER extra_amount', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Categorization on follow-ups (line 20)
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='followups' AND column_name='category');
SET @s := IF(@c=0, 'ALTER TABLE followups ADD COLUMN category VARCHAR(100) NULL AFTER title', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
