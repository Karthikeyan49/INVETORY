-- ============================================================
-- Migration 021: machine_type (local | brand) — requirements set 3 (R11/T2)
--   Distinguishes locally-assembled machines from branded units.
-- Idempotent: information_schema guard.
-- ============================================================

SET @t := 'machines';

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=@t AND column_name='machine_type');
SET @s := IF(@c=0, "ALTER TABLE machines ADD COLUMN machine_type VARCHAR(10) NOT NULL DEFAULT 'brand' AFTER category", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
