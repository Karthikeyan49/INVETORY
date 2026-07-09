<?php
declare(strict_types=1);

/**
 * InventoryItem — a simple stock register (spares, accessories, consumables).
 * Each row is an item plus how many are in stock (quantity), managed just like
 * the Machines page.
 */
class InventoryItem
{
    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 100): array
    {
        $where  = [];
        $params = [];
        if (!empty($filters['category'])) {
            $where[] = 'category = ?';
            $params[] = (string)$filters['category'];
        }
        if (!empty($filters['search'])) {
            $where[] = '(name LIKE ? OR sku LIKE ? OR location LIKE ?)';
            $like = '%' . $filters['search'] . '%';
            array_push($params, $like, $like, $like);
        }
        if (!empty($filters['low_stock'])) {
            $where[] = 'quantity <= 5';
        }

        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM inventory_items $clause", $params);

        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT * FROM inventory_items $clause ORDER BY name ASC LIMIT $limit OFFSET $offset",
            $params
        );
        foreach ($rows as &$r) {
            $r['quantity'] = (int)$r['quantity'];
            $r['unit_cost'] = (float)($r['unit_cost'] ?? 0);
        }
        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        $row = Database::fetch("SELECT * FROM inventory_items WHERE id = ? LIMIT 1", [$id]);
        if ($row) {
            $row['quantity'] = (int)$row['quantity'];
            $row['unit_cost'] = (float)($row['unit_cost'] ?? 0);
        }
        return $row ?: null;
    }

    /** Distinct categories for the type-once-then-dropdown combo. */
    public static function categories(): array
    {
        $rows = Database::fetchAll("SELECT DISTINCT category FROM inventory_items WHERE category IS NOT NULL AND category <> '' ORDER BY category ASC");
        return array_column($rows, 'category');
    }

    public static function create(array $data): int
    {
        return Database::insert(
            "INSERT INTO inventory_items (name, category, sku, quantity, unit_cost, unit, location, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                trim((string)$data['name']),
                isset($data['category']) && $data['category'] !== '' ? trim((string)$data['category']) : null,
                isset($data['sku']) && $data['sku'] !== '' ? trim((string)$data['sku']) : null,
                isset($data['quantity']) && $data['quantity'] !== '' ? max(0, (int)$data['quantity']) : 0,
                isset($data['unit_cost']) && $data['unit_cost'] !== '' ? max(0.0, (float)$data['unit_cost']) : 0,
                isset($data['unit']) && $data['unit'] !== '' ? trim((string)$data['unit']) : 'Nos',
                isset($data['location']) && $data['location'] !== '' ? trim((string)$data['location']) : null,
                isset($data['notes']) && $data['notes'] !== '' ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function update(int $id, array $data): bool
    {
        $map = ['name' => 'name', 'category' => 'category', 'sku' => 'sku',
                'quantity' => 'quantity', 'unit_cost' => 'unit_cost', 'unit' => 'unit', 'location' => 'location', 'notes' => 'notes'];
        $fields = [];
        $params = [];
        foreach ($map as $in => $col) {
            if (!array_key_exists($in, $data)) {
                continue;
            }
            $val = $data[$in];
            if ($col === 'quantity') {
                $val = $val === '' || $val === null ? 0 : max(0, (int)$val);
            } elseif ($col === 'unit_cost') {
                $val = $val === '' || $val === null ? 0 : max(0.0, (float)$val);
            } else {
                $val = ($val === '' || $val === null) ? null : trim((string)$val);
            }
            $fields[] = "$col = ?";
            $params[] = $val;
        }
        if (!$fields) {
            return false;
        }
        $params[] = $id;
        Database::execute("UPDATE inventory_items SET " . implode(', ', $fields) . " WHERE id = ?", $params);
        return true;
    }

    /**
     * When a machine is added, keep a matching stock item in sync: if an item
     * with the same name (model) + category already exists, bump its quantity
     * by one; otherwise create it starting at one. No-op when model is blank.
     */
    public static function incrementForMachine(?string $model, ?string $category): void
    {
        $name = trim((string)$model);
        if ($name === '') {
            return;
        }
        $cat = trim((string)$category);
        try {
            $existing = Database::fetch(
                "SELECT id FROM inventory_items
                 WHERE LOWER(name) = LOWER(?)
                   AND ((category IS NULL AND ? = '') OR LOWER(COALESCE(category,'')) = LOWER(?))
                 LIMIT 1",
                [$name, $cat, $cat]
            );
            if ($existing) {
                Database::execute("UPDATE inventory_items SET quantity = quantity + 1 WHERE id = ?", [(int)$existing['id']]);
            } else {
                self::create(['name' => $name, 'category' => $cat !== '' ? $cat : null, 'quantity' => 1, 'unit' => 'Nos']);
            }
        } catch (\Throwable $e) {
            error_log('[InventoryItem::incrementForMachine] ' . $e->getMessage());
        }
    }

    public static function destroy(int $id): bool
    {
        if (!self::find($id)) {
            return false;
        }
        Database::execute("DELETE FROM inventory_items WHERE id = ?", [$id]);
        return true;
    }
}
