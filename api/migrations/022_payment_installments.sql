-- ============================================================
-- Migration 022: reusable installment payment ledger (R12 / T3)
--   A polymorphic ledger so any document (purchase order, stamping,
--   purchase, incentive, invoice) can record advance + N installments
--   with a payment category (Bank Transfer / Cash / UPI) and UTR number,
--   and derive a live outstanding = grand_total − SUM(installments).
--   Also retrofits a `utr_no` column onto the existing payments &
--   purchases tables (R12 UTR tracking).
-- Idempotent: CREATE TABLE IF NOT EXISTS + information_schema guards.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_installments (
    id           BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    ref_type     VARCHAR(30)  NOT NULL,                 -- 'purchase_order' | 'stamping' | 'purchase' | 'incentive' | 'invoice'
    ref_id       BIGINT(20) UNSIGNED NOT NULL,          -- id of the owning document
    seq          INT          NOT NULL DEFAULT 0,        -- 0 = advance, 1 = 1st, 2 = 2nd ...
    label        VARCHAR(40)  NULL,                      -- 'Advance' | '1st Installment' ...
    amount       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    category     VARCHAR(20)  NOT NULL DEFAULT 'Cash',   -- Bank Transfer | Cash | UPI
    utr_no       VARCHAR(60)  NULL,                      -- transaction / UTR reference
    paid_on      DATE         NOT NULL,
    notes        VARCHAR(255) NULL,
    created_by   BIGINT(20) UNSIGNED NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ref (ref_type, ref_id),
    KEY idx_paid_on (paid_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Retrofit UTR onto the existing payments table.
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='payments' AND column_name='utr_no');
SET @s := IF(@c=0, "ALTER TABLE payments ADD COLUMN utr_no VARCHAR(60) NULL AFTER reference_no", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Retrofit UTR + payment category onto vendor purchases.
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='purchases' AND column_name='utr_no');
SET @s := IF(@c=0, "ALTER TABLE purchases ADD COLUMN utr_no VARCHAR(60) NULL AFTER payment_method", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
