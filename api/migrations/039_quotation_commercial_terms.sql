-- ============================================================
-- Migration 039: per-quotation commercial terms (B15)
--   The four Sri Vari quotation formats print DIFFERENT commercial
--   terms (Retail/Service: Payment Terms; Industrial: + Validity,
--   Contact Person, Contact Number; Stamping: + Quotation validity).
--   Until now these were hard-coded in the PDF template, so every quote
--   printed the same placeholder values. Store them per-quotation so the
--   distinct field-set each format needs is captured and rendered.
--   All columns nullable/additive. Idempotent: information_schema guards.
-- ============================================================

SET @c1 := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quotations' AND column_name='payment_terms');
SET @s1 := IF(@c1=0, "ALTER TABLE quotations ADD COLUMN payment_terms VARCHAR(190) NULL AFTER terms", 'SELECT 1');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

SET @c2 := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quotations' AND column_name='delivery_schedule');
SET @s2 := IF(@c2=0, "ALTER TABLE quotations ADD COLUMN delivery_schedule VARCHAR(190) NULL AFTER payment_terms", 'SELECT 1');
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;

SET @c3 := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quotations' AND column_name='validity');
SET @s3 := IF(@c3=0, "ALTER TABLE quotations ADD COLUMN validity VARCHAR(190) NULL AFTER delivery_schedule", 'SELECT 1');
PREPARE st FROM @s3; EXECUTE st; DEALLOCATE PREPARE st;

SET @c4 := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quotations' AND column_name='contact_person');
SET @s4 := IF(@c4=0, "ALTER TABLE quotations ADD COLUMN contact_person VARCHAR(190) NULL AFTER validity", 'SELECT 1');
PREPARE st FROM @s4; EXECUTE st; DEALLOCATE PREPARE st;

SET @c5 := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quotations' AND column_name='contact_number');
SET @s5 := IF(@c5=0, "ALTER TABLE quotations ADD COLUMN contact_number VARCHAR(120) NULL AFTER contact_person", 'SELECT 1');
PREPARE st FROM @s5; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
