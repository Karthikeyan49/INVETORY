<?php
declare(strict_types=1);
// One-shot idempotent migration runner for the cash_bills table (034).
// Bootstraps like the app, runs CREATE TABLE IF NOT EXISTS, prints result, then is deleted.
define('ROOT_PATH', __DIR__);
require_once ROOT_PATH . '/config/app.php';
require_once ROOT_PATH . '/config/database.php';
require_once ROOT_PATH . '/core/AppException.php';
require_once ROOT_PATH . '/core/Database.php';

try {
    Database::execute(
        "CREATE TABLE IF NOT EXISTS cash_bills (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            bill_no       VARCHAR(40)   NOT NULL,
            customer_id   INT           NULL,
            customer_name VARCHAR(255)  NULL,
            cell_no       VARCHAR(40)   NULL,
            machine_id    INT           NULL,
            description   TEXT          NULL,
            qty           VARCHAR(40)   NULL,
            amount        DECIMAL(12,2) NULL,
            total         DECIMAL(12,2) NULL,
            bill_date     DATE          NULL,
            notes         TEXT          NULL,
            created_by    INT           NULL,
            created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_cash_bills_customer (customer_id),
            INDEX idx_cash_bills_created  (created_at)
        )"
    );
    $exists = Database::fetch(
        "SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'cash_bills'"
    );
    echo "OK cash_bills present=" . (int)($exists['c'] ?? 0) . "\n";
} catch (\Throwable $e) {
    echo "ERR " . get_class($e) . ": " . $e->getMessage() . "\n";
    exit(1);
}
