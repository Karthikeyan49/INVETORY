<?php
declare(strict_types=1);

/**
 * Spare — spare-parts stock register (R6 / T6). Modelled like Machines/Items,
 * plus a reorder level (low-stock notification) and a consumption ledger
 * (spare_movements) that powers stock-out forecasting. Consuming a spare can
 * reference the machine it was fitted to, linking to machines/movements.
 */
class Spare
{
    public const REASONS = ['receive', 'consume', 'issue', 'adjust'];

    /** @return array{rows: array, total: int, categories: array} */
    public static function all(array $filters = [], int $page = 1, int $limit = 200): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['category'])) {
            $where[] = 'category = ?';
            $params[] = (string)$filters['category'];
        }
        if (!empty($filters['search'])) {
            $where[] = '(name LIKE ? OR part_no LIKE ? OR location LIKE ?)';
            $like = '%' . $filters['search'] . '%';
            array_push($params, $like, $like, $like);
        }
        if (!empty($filters['low_stock'])) {
            $where[] = 'quantity <= reorder_level';
        }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total = Database::count("SELECT COUNT(*) AS cnt FROM spares $clause", $params);
        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT * FROM spares $clause ORDER BY name ASC LIMIT $limit OFFSET $offset",
            $params
        );
        foreach ($rows as &$r) {
            self::cast($r);
        }
        unset($r);
        $cats = Database::fetchAll("SELECT DISTINCT category FROM spares WHERE category IS NOT NULL AND category <> '' ORDER BY category ASC");
        return ['rows' => $rows, 'total' => $total, 'categories' => array_column($cats, 'category')];
    }

    public static function find(int $id): ?array
    {
        $row = Database::fetch("SELECT * FROM spares WHERE id = ? LIMIT 1", [$id]);
        if (!$row) {
            return null;
        }
        self::cast($row);
        return $row;
    }

    private static function cast(array &$r): void
    {
        $r['id'] = (int)$r['id'];
        $r['quantity'] = (int)$r['quantity'];
        $r['reorder_level'] = (int)$r['reorder_level'];
        $r['unit_cost'] = (float)($r['unit_cost'] ?? 0);
        $r['low_stock'] = $r['quantity'] <= $r['reorder_level'];
    }

    public static function categories(): array
    {
        $rows = Database::fetchAll("SELECT DISTINCT category FROM spares WHERE category IS NOT NULL AND category <> '' ORDER BY category ASC");
        return array_column($rows, 'category');
    }

    public static function create(array $data): int
    {
        return Database::insert(
            "INSERT INTO spares (name, part_no, category, quantity, unit, unit_cost, reorder_level, location, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                trim((string)$data['name']),
                isset($data['part_no']) && $data['part_no'] !== '' ? trim((string)$data['part_no']) : null,
                isset($data['category']) && $data['category'] !== '' ? trim((string)$data['category']) : null,
                max(0, (int)($data['quantity'] ?? 0)),
                isset($data['unit']) && $data['unit'] !== '' ? trim((string)$data['unit']) : 'pcs',
                max(0.0, (float)($data['unit_cost'] ?? 0)),
                max(0, (int)($data['reorder_level'] ?? 0)),
                isset($data['location']) && $data['location'] !== '' ? trim((string)$data['location']) : null,
                isset($data['notes']) && $data['notes'] !== '' ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function update(int $id, array $data): bool
    {
        $map = [
            'name' => 'name', 'part_no' => 'part_no', 'category' => 'category', 'quantity' => 'quantity',
            'unit' => 'unit', 'unit_cost' => 'unit_cost', 'reorder_level' => 'reorder_level',
            'location' => 'location', 'notes' => 'notes',
        ];
        $intCols = ['quantity', 'reorder_level'];
        $fields = [];
        $params = [];
        foreach ($map as $in => $col) {
            if (!array_key_exists($in, $data)) {
                continue;
            }
            $value = $data[$in];
            if (in_array($col, $intCols, true)) {
                $value = max(0, (int)$value);
            } elseif ($col === 'unit_cost') {
                $value = max(0.0, (float)$value);
            } elseif ($value === '') {
                $value = null;
            }
            $fields[] = "$col = ?";
            $params[] = $value;
        }
        if (!$fields) {
            return false;
        }
        $params[] = $id;
        return Database::execute("UPDATE spares SET " . implode(', ', $fields) . " WHERE id = ?", $params) >= 0;
    }

    public static function delete(int $id): bool
    {
        Database::execute("DELETE FROM spare_movements WHERE spare_id = ?", [$id]);
        return Database::execute("DELETE FROM spares WHERE id = ?", [$id]) >= 0;
    }

    /**
     * Record a stock movement and adjust quantity. $reason receive=+, consume/issue=−.
     * Returns the new quantity (never below 0).
     */
    public static function move(int $id, int $qty, string $reason, ?int $machineId, ?string $note, ?int $actorId): int
    {
        $spare = self::find($id);
        if (!$spare) {
            Response::error('Spare not found', 404);
        }
        $reason = in_array($reason, self::REASONS, true) ? $reason : 'adjust';
        $qty = abs($qty);
        $delta = in_array($reason, ['consume', 'issue'], true) ? -$qty : $qty;
        $newQty = max(0, $spare['quantity'] + $delta);
        // Store the actual applied change (may be clamped at zero on over-consume).
        $applied = $newQty - $spare['quantity'];

        Database::insert(
            "INSERT INTO spare_movements (spare_id, change_qty, reason, machine_id, note, created_by)
             VALUES (?, ?, ?, ?, ?, ?)",
            [$id, $applied, $reason, $machineId ?: null, $note ?: null, $actorId ?: null]
        );
        Database::execute("UPDATE spares SET quantity = ? WHERE id = ?", [$newQty, $id]);

        // Mirror machine-fitted consumption into the machine movements log where present.
        if ($machineId && $delta < 0 && class_exists('MachineMovement')) {
            MachineMovement::log(
                $machineId,
                'spare_fitted',
                trim(($spare['name'] ?? 'Spare') . ' ×' . $qty . ($note ? " — $note" : '')),
                null,
                null,
                $actorId ?: null
            );
        }
        return $newQty;
    }

    public static function movements(int $id, int $limit = 50): array
    {
        $rows = Database::fetchAll(
            "SELECT sm.*, m.code AS machine_code
             FROM spare_movements sm
             LEFT JOIN machines m ON m.id = sm.machine_id
             WHERE sm.spare_id = ? ORDER BY sm.created_at DESC, sm.id DESC LIMIT $limit",
            [$id]
        );
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['change_qty'] = (int)$r['change_qty'];
        }
        return $rows;
    }

    /** Items at or below reorder level (low-stock notification). */
    public static function lowStock(): array
    {
        $rows = Database::fetchAll(
            "SELECT * FROM spares WHERE quantity <= reorder_level ORDER BY (quantity - reorder_level) ASC, name ASC"
        );
        foreach ($rows as &$r) {
            self::cast($r);
        }
        return $rows;
    }

    /**
     * Stock-out forecast from consumption over a look-back window (default 90d).
     * avg_daily_use → days_to_stockout → suggested reorder to cover lead + buffer.
     */
    public static function forecast(int $windowDays = 90): array
    {
        $rows = Database::fetchAll(
            "SELECT s.*,
                    COALESCE(-SUM(CASE WHEN sm.change_qty < 0 THEN sm.change_qty ELSE 0 END), 0) AS consumed
             FROM spares s
             LEFT JOIN spare_movements sm
               ON sm.spare_id = s.id AND sm.created_at >= (CURRENT_DATE - INTERVAL ? DAY)
             GROUP BY s.id
             ORDER BY s.name ASC",
            [$windowDays]
        );
        $out = [];
        foreach ($rows as $r) {
            self::cast($r);
            $consumed = (int)($r['consumed'] ?? 0);
            $avgDaily = $windowDays > 0 ? round($consumed / $windowDays, 4) : 0.0;
            $daysToStockout = $avgDaily > 0 ? (int)floor($r['quantity'] / $avgDaily) : null;
            // Suggested reorder: cover the window's consumption up to reorder level, min 0.
            $suggested = 0;
            if ($avgDaily > 0) {
                $target = (int)ceil($avgDaily * $windowDays) + $r['reorder_level'];
                $suggested = max(0, $target - $r['quantity']);
            } elseif ($r['low_stock']) {
                $suggested = max(0, ($r['reorder_level'] * 2) - $r['quantity']);
            }
            $out[] = [
                'id' => $r['id'],
                'name' => $r['name'],
                'part_no' => $r['part_no'],
                'category' => $r['category'],
                'quantity' => $r['quantity'],
                'reorder_level' => $r['reorder_level'],
                'low_stock' => $r['low_stock'],
                'consumed_window' => $consumed,
                'avg_daily_use' => $avgDaily,
                'days_to_stockout' => $daysToStockout,
                'suggested_reorder' => $suggested,
                'window_days' => $windowDays,
            ];
        }
        return $out;
    }
}
