-- ============================================================
-- Migration 027: HR Incentive Payments (R7 / T10)
--   Output-based pay (per sale / visit / collection / fixed / %) — kept
--   separate from fixed payroll. Off-books extra is extended-login only.
--   When marked paid it posts an expense so it flows into Finance / P&L.
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS incentives (
    id               BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id      BIGINT(20) UNSIGNED NULL,               -- links to employees.employee_id (optional)
    person_name      VARCHAR(160) NOT NULL,                  -- payee name (snapshot / non-registered person)
    basis            VARCHAR(20)  NOT NULL DEFAULT 'per_sale', -- per_sale | per_visit | per_collection | fixed | percentage
    rate             DECIMAL(12,2) NOT NULL DEFAULT 0.00,    -- amount per unit, or percent for 'percentage'
    units            DECIMAL(12,2) NOT NULL DEFAULT 0.00,    -- count of sales/visits/collections
    base_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,    -- turnover base for 'percentage'
    amount           DECIMAL(12,2) NOT NULL DEFAULT 0.00,    -- computed incentive (on-books)
    extra_amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,    -- off-books (extended login only)
    period           VARCHAR(20)  NULL,                      -- e.g. 2026-07 or Q3-2026
    status           VARCHAR(10)  NOT NULL DEFAULT 'unpaid', -- unpaid | paid
    payment_category VARCHAR(20)  NULL,                      -- Bank Transfer | Cash | UPI
    utr_no           VARCHAR(60)  NULL,
    paid_on          DATE         NULL,
    expense_code     VARCHAR(20)  NULL,                      -- expense posted on payment (Finance link)
    notes            VARCHAR(255) NULL,
    created_by       BIGINT(20) UNSIGNED NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_employee (employee_id),
    KEY idx_status (status),
    KEY idx_period (period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
