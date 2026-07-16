<?php
declare(strict_types=1);
// One-shot: back up (CREATE TABLE + rows as JSON) then DROP the 6 removed-feature
// tables and their sub-tables. Backup is written above web root and kept.
define('ROOT_PATH', __DIR__);
require_once ROOT_PATH . '/config/app.php';
require_once ROOT_PATH . '/config/database.php';
require_once ROOT_PATH . '/core/AppException.php';
require_once ROOT_PATH . '/core/Database.php';

// children before parents (FK-safe), checks disabled anyway
$tables = [
    'task_comments', 'tasks',
    'sop_versions', 'sops',
    'workflow_history', 'workflows',
    'meeting_media', 'meeting_attendees', 'meetings',
    'faqs',
    'quote_requests',
];

function tableExists(string $t): bool {
    $r = Database::fetch(
        "SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?",
        [$t]
    );
    return (int)($r['c'] ?? 0) > 0;
}

$backup = "-- removed-ops-modules backup " . date('Y-m-d H:i:s') . "\n";
$existing = [];
foreach ($tables as $t) {
    if (!tableExists($t)) { echo "skip $t (absent)\n"; continue; }
    $existing[] = $t;
    $cr = Database::fetch("SHOW CREATE TABLE `$t`");
    $createSql = $cr['Create Table'] ?? '';
    $rows = Database::fetchAll("SELECT * FROM `$t`");
    $backup .= "\n-- ==== $t (" . count($rows) . " rows) ====\n";
    $backup .= $createSql . ";\n";
    $backup .= "-- ROWS_JSON: " . json_encode($rows, JSON_UNESCAPED_UNICODE) . "\n";
    echo "backed up $t (" . count($rows) . " rows)\n";
}

if (!$existing) { echo "nothing to drop\n"; exit(0); }

$backupFile = ROOT_PATH . '/removed_ops_backup_' . date('Ymd_His') . '.sql';
file_put_contents($backupFile, $backup);
echo "backup written: " . basename($backupFile) . " (" . strlen($backup) . " bytes)\n";

Database::execute("SET FOREIGN_KEY_CHECKS=0");
foreach ($existing as $t) {
    Database::execute("DROP TABLE IF EXISTS `$t`");
    echo "dropped $t\n";
}
Database::execute("SET FOREIGN_KEY_CHECKS=1");

$still = [];
foreach ($existing as $t) {
    if (tableExists($t)) $still[] = $t;
}
echo "remaining (should be empty): " . implode(',', $still) . "\n";
echo "DONE\n";
