-- ============================================================
-- Migration 025: Spares module (R6 / T6)
--   Spare parts stock register (modelled like Machines/Items) with reorder
--   level for low-stock notification, plus a consumption ledger
--   (spare_movements) that drives stock-out forecasting. Consumption can
--   reference the machine the spare was fitted to (links to machines/movements).
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS spares (
    id             BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    name           VARCHAR(160) NOT NULL,
    part_no        VARCHAR(80)  NULL,
    category       VARCHAR(80)  NULL,
    quantity       INT          NOT NULL DEFAULT 0,
    unit           VARCHAR(20)  NULL DEFAULT 'pcs',
    unit_cost      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    reorder_level  INT          NOT NULL DEFAULT 0,
    location       VARCHAR(120) NULL,
    notes          VARCHAR(255) NULL,
    created_by     BIGINT(20) UNSIGNED NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_category (category),
    KEY idx_part_no (part_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS spare_movements (
    id           BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    spare_id     BIGINT(20) UNSIGNED NOT NULL,
    change_qty   INT          NOT NULL,               -- +received, −consumed/issued
    reason       VARCHAR(40)  NOT NULL DEFAULT 'adjust', -- receive | consume | issue | adjust
    machine_id   BIGINT(20) UNSIGNED NULL,            -- machine the spare was fitted to (links to machines)
    note         VARCHAR(255) NULL,
    created_by   BIGINT(20) UNSIGNED NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_spare (spare_id),
    KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
