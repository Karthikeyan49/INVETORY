-- ============================================================
-- Migration 011: machine pricing + HSN
--   buy price + GST%, sale GST% (sale_price already exists), HSN code.
--   These auto-fill from a previously-entered model/category (catalog).
-- Idempotent: information_schema guards.
-- ============================================================

SET @t := 'machines';

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='hsn');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN hsn VARCHAR(20) NULL AFTER category', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='buy_price');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN buy_price DECIMAL(15,2) NULL AFTER hsn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='buy_gst_pct');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN buy_gst_pct DECIMAL(5,2) NULL AFTER buy_price', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='sale_gst_pct');
SET @s := IF(@c=0, 'ALTER TABLE machines ADD COLUMN sale_gst_pct DECIMAL(5,2) NULL AFTER sale_price', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
