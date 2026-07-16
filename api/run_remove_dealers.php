<?php
declare(strict_types=1);
// Remove dealers: back up, then empty dealer-only tables and remove dealer accounts.
// Tables are EMPTIED (not dropped) because kept customer-analytics + inventory-engine
// code references them; empty tables read as "no dealers" and never break.
// Dealer users with existing orders are DEACTIVATED (not deleted) to protect order/invoice history.
define('ROOT_PATH', __DIR__);
require_once ROOT_PATH . '/config/app.php';
require_once ROOT_PATH . '/config/database.php';
require_once ROOT_PATH . '/core/AppException.php';
require_once ROOT_PATH . '/core/Database.php';

function tableExists(string $t): bool {
    $r = Database::fetch(
        "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
        [$t]
    );
    return (int)($r['c'] ?? 0) > 0;
}

$dealerTables = ['dealer_customers', 'dealer_price_lists', 'inventory_dealer_demand'];
$backup = "-- dealer removal backup " . date('Y-m-d H:i:s') . "\n";

// dealer users
$dealerUsers = Database::fetchAll("SELECT * FROM users WHERE LOWER(user_type) = 'dealer'");
$backup .= "\n-- ==== dealer users (" . count($dealerUsers) . ") ====\n";
$backup .= "-- ROWS_JSON: " . json_encode($dealerUsers, JSON_UNESCAPED_UNICODE) . "\n";
echo "dealer users: " . count($dealerUsers) . "\n";

foreach ($dealerTables as $t) {
    if (!tableExists($t)) { echo "skip $t (absent)\n"; continue; }
    $rows = Database::fetchAll("SELECT * FROM `$t`");
    $backup .= "\n-- ==== $t (" . count($rows) . " rows) ====\n";
    $backup .= "-- ROWS_JSON: " . json_encode($rows, JSON_UNESCAPED_UNICODE) . "\n";
    echo "$t rows: " . count($rows) . "\n";
}

$backupFile = ROOT_PATH . '/removed_dealers_backup_' . date('Ymd_His') . '.sql';
file_put_contents($backupFile, $backup);
echo "backup written: " . basename($backupFile) . " (" . strlen($backup) . " bytes)\n";

// empty dealer-only tables
foreach ($dealerTables as $t) {
    if (!tableExists($t)) continue;
    Database::execute("DELETE FROM `$t`");
    echo "emptied $t\n";
}

// remove dealer accounts: delete if no orders reference them, else deactivate
$deleted = 0; $deactivated = 0;
foreach ($dealerUsers as $u) {
    $uid = (int)$u['user_id'];
    $ordCnt = Database::count("SELECT COUNT(*) AS cnt FROM orders WHERE user_id = ?", [$uid]);
    if ($ordCnt === 0) {
        try {
            Database::execute("DELETE FROM users WHERE user_id = ?", [$uid]);
            $deleted++;
        } catch (\Throwable $e) {
            Database::execute("UPDATE users SET is_active = 0 WHERE user_id = ?", [$uid]);
            $deactivated++;
        }
    } else {
        Database::execute("UPDATE users SET is_active = 0 WHERE user_id = ?", [$uid]);
        $deactivated++;
    }
}
echo "dealer accounts: deleted=$deleted, deactivated(had orders)=$deactivated\n";
echo "DONE\n";
