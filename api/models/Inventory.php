<?php
declare(strict_types=1);

class Inventory
{
    public static function list(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['low_stock'])) {
            $where[] = 'si.on_hand < si.reorder_level';
        }
        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(p.product_name LIKE ? OR p.category LIKE ?)';
            array_push($params, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count(
            "SELECT COUNT(*) AS cnt
             FROM stock_items si
             JOIN products p ON p.product_id = si.product_id
             JOIN inventory_locations l ON l.location_id = si.location_id
             WHERE $whereClause",
            $params
        );
        $rows = Database::fetchAll(
            "SELECT si.*, p.product_name, p.category, p.unit, l.name AS location_name
             FROM stock_items si
             JOIN products p ON p.product_id = si.product_id
             JOIN inventory_locations l ON l.location_id = si.location_id
             WHERE $whereClause
             ORDER BY p.product_name ASC, l.name ASC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'formatStockItem'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit),
            ],
        ];
    }

    public static function movements(int $productId, ?int $locationId, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(200, max(1, $limit));
        $where = ['sm.product_id = ?'];
        $params = [$productId];
        if ($locationId !== null) {
            $where[] = 'sm.location_id = ?';
            $params[] = $locationId;
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM stock_movements sm WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT sm.*, p.product_name, l.name AS location_name, u.name AS created_by_name
             FROM stock_movements sm
             JOIN products p ON p.product_id = sm.product_id
             JOIN inventory_locations l ON l.location_id = sm.location_id
             LEFT JOIN users u ON u.user_id = sm.created_by
             WHERE $whereClause
             ORDER BY sm.created_at DESC, sm.movement_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'formatMovement'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit),
            ],
        ];
    }

    public static function postMovement(array $data): int
    {
        $productId = (int)$data['product_id'];
        $locationId = (int)($data['location_id'] ?: self::defaultLocationId());
        $direction = (string)$data['direction'];
        $quantity = round((float)$data['quantity'], 3);
        $unitCost = isset($data['unit_cost']) && $data['unit_cost'] !== null ? round((float)$data['unit_cost'], 2) : null;

        if (!in_array($direction, ['in', 'out'], true)) {
            Response::error('direction must be in or out', 422);
        }
        if ($productId <= 0 || $quantity <= 0) {
            Response::error('product_id and positive quantity are required', 422);
        }
        if (!Database::fetch('SELECT product_id FROM products WHERE product_id = ? LIMIT 1', [$productId])) {
            Response::error('Product not found', 404);
        }

        self::ensureStockItem($productId, $locationId);
        $stock = Database::fetch(
            'SELECT * FROM stock_items WHERE product_id = ? AND location_id = ? LIMIT 1 FOR UPDATE',
            [$productId, $locationId]
        );
        if (!$stock) {
            Response::error('Stock item not available', 500);
        }

        $onHand = (float)$stock['on_hand'];
        $avgCost = (float)$stock['avg_cost'];

        if ($direction === 'out' && $onHand + 0.0005 < $quantity && !self::allowNegativeStock()) {
            Response::error('Insufficient stock for this movement', 409);
        }

        if ($direction === 'in') {
            $costForAverage = $unitCost ?? $avgCost;
            $newOnHand = $onHand + $quantity;
            $newAvgCost = $newOnHand > 0
                ? (($onHand * $avgCost) + ($quantity * $costForAverage)) / $newOnHand
                : $avgCost;
        } else {
            $newOnHand = $onHand - $quantity;
            $newAvgCost = $avgCost;
            $unitCost ??= $avgCost;
        }

        $movementId = Database::insert(
            'INSERT INTO stock_movements
                (product_id, location_id, direction, quantity, unit_cost, ref_type, ref_id, note, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $productId,
                $locationId,
                $direction,
                $quantity,
                $unitCost,
                $data['ref_type'],
                $data['ref_id'] ?? null,
                $data['note'] ?? null,
                $data['created_by'] ?? null,
            ]
        );

        Database::execute(
            'UPDATE stock_items SET on_hand = ?, avg_cost = ?, updated_at = NOW() WHERE stock_id = ?',
            [round($newOnHand, 3), round($newAvgCost, 2), (int)$stock['stock_id']]
        );

        return $movementId;
    }

    public static function reconcile(): array
    {
        $rows = Database::fetchAll(
            "SELECT si.stock_id, si.product_id, si.location_id, si.on_hand,
                    COALESCE(SUM(CASE WHEN sm.direction = 'in' THEN sm.quantity ELSE -sm.quantity END), 0) AS ledger_qty
             FROM stock_items si
             LEFT JOIN stock_movements sm ON sm.product_id = si.product_id AND sm.location_id = si.location_id
             GROUP BY si.stock_id"
        );

        $fixed = [];
        foreach ($rows as $row) {
            $current = (float)$row['on_hand'];
            $ledger = (float)$row['ledger_qty'];
            if (abs($current - $ledger) <= 0.0005) {
                continue;
            }

            Database::execute('UPDATE stock_items SET on_hand = ?, updated_at = NOW() WHERE stock_id = ?', [$ledger, (int)$row['stock_id']]);
            $fixed[] = [
                'stock_id' => (int)$row['stock_id'],
                'product_id' => (int)$row['product_id'],
                'location_id' => (int)$row['location_id'],
                'before' => $current,
                'after' => $ledger,
            ];
        }

        return [
            'checked' => count($rows),
            'fixed' => count($fixed),
            'discrepancies' => $fixed,
        ];
    }

    public static function valuation(): array
    {
        $rows = Database::fetchAll(
            "SELECT p.category,
                    COUNT(*) AS item_count,
                    SUM(si.on_hand * si.avg_cost) AS value
             FROM stock_items si
             JOIN products p ON p.product_id = si.product_id
             GROUP BY p.category
             ORDER BY value DESC"
        );
        $total = 0.0;
        foreach ($rows as &$row) {
            $row['item_count'] = (int)$row['item_count'];
            $row['value'] = round((float)$row['value'], 2);
            $total += $row['value'];
        }

        return [
            'total_value' => round($total, 2),
            'by_category' => $rows,
        ];
    }

    public static function locations(): array
    {
        return Database::fetchAll(
            'SELECT location_id, name, is_default, is_active, created_at FROM inventory_locations ORDER BY is_default DESC, name ASC'
        );
    }

    public static function defaultLocationId(): int
    {
        $row = Database::fetch('SELECT location_id FROM inventory_locations WHERE is_default = 1 LIMIT 1');
        if ($row) {
            return (int)$row['location_id'];
        }

        return Database::insert(
            'INSERT INTO inventory_locations (name, is_default, is_active, created_at) VALUES ("Main Store", 1, 1, NOW())'
        );
    }

    public static function ensureStockItem(int $productId, int $locationId): void
    {
        Database::execute(
            'INSERT IGNORE INTO stock_items (product_id, location_id, on_hand, reorder_level, avg_cost, updated_at)
             VALUES (?, ?, 0, 0, 0, NOW())',
            [$productId, $locationId]
        );
    }

    public static function formatStockItem(array $row): array
    {
        $onHand = (float)$row['on_hand'];
        $reorderLevel = (float)$row['reorder_level'];
        $avgCost = (float)$row['avg_cost'];

        return [
            'stock_id' => (int)$row['stock_id'],
            'product_id' => (int)$row['product_id'],
            'product_name' => $row['product_name'] ?? null,
            'category' => $row['category'] ?? null,
            'unit' => $row['unit'] ?? null,
            'location_id' => (int)$row['location_id'],
            'location_name' => $row['location_name'] ?? null,
            'on_hand' => $onHand,
            'reorder_level' => $reorderLevel,
            'avg_cost' => $avgCost,
            'stock_value' => round($onHand * $avgCost, 2),
            'is_low_stock' => $reorderLevel > 0 && $onHand < $reorderLevel,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }

    public static function formatMovement(array $row): array
    {
        return [
            'movement_id' => (int)$row['movement_id'],
            'product_id' => (int)$row['product_id'],
            'product_name' => $row['product_name'] ?? null,
            'location_id' => (int)$row['location_id'],
            'location_name' => $row['location_name'] ?? null,
            'direction' => $row['direction'],
            'quantity' => (float)$row['quantity'],
            'unit_cost' => $row['unit_cost'] !== null ? (float)$row['unit_cost'] : null,
            'ref_type' => $row['ref_type'],
            'ref_id' => $row['ref_id'] ? (int)$row['ref_id'] : null,
            'note' => $row['note'],
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_by_name' => $row['created_by_name'] ?? null,
            'created_at' => $row['created_at'],
        ];
    }

    private static function allowNegativeStock(): bool
    {
        $row = Database::fetch('SELECT setting_value FROM settings WHERE setting_key = "allow_negative_stock" LIMIT 1');
        return (bool)(int)($row['setting_value'] ?? 0);
    }
}
