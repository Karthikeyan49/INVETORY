-- ============================================================
-- Migration 028: Daily Call Report (R13 / T11), code F-SVS-01
--   Field-visit report: header (employee, date, area, KM, status) + line
--   items (customer / address / mobile / model / status / type / category /
--   stamping / service / payment / remarks / staff sign). Prospect lines can
--   seed follow-ups (leads).
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS dcr (
    id            BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    dcr_no        VARCHAR(30)  NOT NULL,
    employee_id   BIGINT(20) UNSIGNED NULL,
    employee_name VARCHAR(160) NOT NULL,
    report_date   DATE         NOT NULL,
    area          VARCHAR(120) NULL,
    opening_km    DECIMAL(10,1) NOT NULL DEFAULT 0.0,
    closing_km    DECIMAL(10,1) NOT NULL DEFAULT 0.0,
    total_km      DECIMAL(10,1) NOT NULL DEFAULT 0.0,
    status        VARCHAR(12)  NOT NULL DEFAULT 'submitted', -- submitted | approved
    notes         VARCHAR(255) NULL,
    created_by    BIGINT(20) UNSIGNED NULL,
    approved_by   BIGINT(20) UNSIGNED NULL,
    approved_at   TIMESTAMP    NULL DEFAULT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_dcr_no (dcr_no),
    KEY idx_report_date (report_date),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dcr_lines (
    id            BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    dcr_id        BIGINT(20) UNSIGNED NOT NULL,
    sort_order    INT          NOT NULL DEFAULT 0,
    customer      VARCHAR(160) NULL,
    address       VARCHAR(200) NULL,
    mobile        VARCHAR(30)  NULL,
    model         VARCHAR(80)  NULL,
    cust_status   VARCHAR(20)  NULL,   -- new | existing
    cust_type     VARCHAR(20)  NULL,   -- customer | prospect
    category      VARCHAR(80)  NULL,
    stamping      VARCHAR(60)  NULL,
    service       VARCHAR(60)  NULL,
    payment       VARCHAR(60)  NULL,
    remarks       VARCHAR(255) NULL,
    staff_sign    VARCHAR(80)  NULL,
    followup_id   BIGINT(20) UNSIGNED NULL,  -- lead seeded from this visit (links to followups)
    PRIMARY KEY (id),
    KEY idx_dcr (dcr_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
