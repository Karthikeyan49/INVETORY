-- ============================================================
-- Migration 015: off-books "extra amount" on invoices.
--   Carried automatically from the machine when an invoice is created from it.
--   Visible / counted ONLY for the extended (tax) login — the standard login
--   always sees figures WITHOUT the extra. Drives the dual P&L revenue picture.
-- Idempotent: information_schema guard.
-- ============================================================

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=DATABASE() AND table_name='invoices' AND column_name='extra_amount');
SET @s := IF(@c=0, 'ALTER TABLE invoices ADD COLUMN extra_amount DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER total', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
