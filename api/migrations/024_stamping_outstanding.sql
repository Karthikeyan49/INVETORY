-- ============================================================
-- Migration 024: stamping fee + outstanding (R9 / T5)
--   total_amount = stamping fee charged; extra_amount = off-books (extended
--   login only). Advance + installments and live outstanding come from the
--   shared payment_installments ledger (ref_type = 'stamping').
-- Idempotent: information_schema guards.
-- ============================================================

SET @t := 'stampings';

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='total_amount');
SET @s := IF(@c=0, "ALTER TABLE stampings ADD COLUMN total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER quarter", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='extra_amount');
SET @s := IF(@c=0, "ALTER TABLE stampings ADD COLUMN extra_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER total_amount", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
