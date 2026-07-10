-- ============================================================
-- Migration 023: Purchase Order register (R10 / T4)
--   Lightweight credit-purchase register — marketing gives the record,
--   staff enters it: vendor, category, items, taxable + off-books extra,
--   payment category + UTR, location, status. Advance + N installments and
--   the live outstanding come from the reusable payment_installments ledger
--   (ref_type = 'po_register'), NOT stored here.
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS po_register (
    id             BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    po_no          VARCHAR(30)  NOT NULL,
    vendor_name    VARCHAR(160) NOT NULL,
    category       VARCHAR(80)  NULL,
    location       VARCHAR(120) NULL,
    taxable        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    gst_pct        DECIMAL(6,2)  NOT NULL DEFAULT 0.00,
    gst_amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    extra_amount   DECIMAL(12,2) NOT NULL DEFAULT 0.00,   -- off-books (extended login only)
    other_charges  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total          DECIMAL(12,2) NOT NULL DEFAULT 0.00,   -- taxable + gst + other (tax view total; extra added at read time)
    payment_category VARCHAR(20) NULL,                    -- Bank Transfer | Cash | UPI (default for installments)
    utr_no         VARCHAR(60)  NULL,
    status         VARCHAR(20)  NOT NULL DEFAULT 'open',  -- open | closed | cancelled
    notes          VARCHAR(255) NULL,
    created_by     BIGINT(20) UNSIGNED NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_po_no (po_no),
    KEY idx_category (category),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS po_register_items (
    id           BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    po_id        BIGINT(20) UNSIGNED NOT NULL,
    description  VARCHAR(200) NOT NULL,
    qty          DECIMAL(12,2) NOT NULL DEFAULT 1.00,
    unit_price   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    amount       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    PRIMARY KEY (id),
    KEY idx_po (po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
