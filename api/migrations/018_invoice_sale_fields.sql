-- ============================================================
-- Migration 018: Sales module fields on invoices
--   sale_type — cash (paid in full) | credit (track advance + outstanding)
--   advance   — amount received up front on a credit sale
--   location  — customer area/location (for location filter in Sales)
-- Idempotent: information_schema guards.
-- ============================================================

SET @t := 'invoices';

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='sale_type');
SET @s := IF(@c=0, "ALTER TABLE invoices ADD COLUMN sale_type ENUM('cash','credit') NOT NULL DEFAULT 'cash' AFTER payment_status", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='advance');
SET @s := IF(@c=0, 'ALTER TABLE invoices ADD COLUMN advance DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER sale_type', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='location');
SET @s := IF(@c=0, 'ALTER TABLE invoices ADD COLUMN location VARCHAR(150) NULL AFTER customer_city', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
