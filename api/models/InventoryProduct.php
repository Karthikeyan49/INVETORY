<?php
declare(strict_types=1);

/**
 * Smart Inventory — product master (inventory_products).
 *
 * Note on field mapping: the Prompt-2 API speaks in {product_id, unit_of_measure,
 * cost_price}, but the Prompt-1 schema columns are {inv_product_id, uom,
 * standard_cost}. Controllers pass through the API names; this model maps them to
 * the real columns. Output rows expose both the raw column and a friendly alias so
 * the frontend contract can use either without another query.
 */
class InventoryProduct
{
    public const UNITS = ['kg', 'litre', 'piece', 'box', 'bag'];

    public static function create(array $data): int
    {
        return Database::insert(
            "INSERT INTO inventory_products
                (source_product_id, name, sku, category, uom, hsn_code,
                 reorder_level, reorder_quantity, standard_cost, selling_price,
                 is_active, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                isset($data['source_product_id']) && $data['source_product_id'] !== ''
                    ? (int)$data['source_product_id'] : null,
                trim((string)$data['name']),
                trim((string)$data['sku']),
                isset($data['category']) ? trim((string)$data['category']) : null,
                trim((string)($data['unit_of_measure'] ?? $data['uom'] ?? 'piece')),
                isset($data['hsn_code']) && $data['hsn_code'] !== '' ? trim((string)$data['hsn_code']) : null,
                (float)($data['reorder_level'] ?? 0),
                (float)($data['reorder_quantity'] ?? 0),
                (float)($data['cost_price'] ?? $data['standard_cost'] ?? 0),
                (float)($data['selling_price'] ?? 0),
                isset($data['is_active']) ? (int)(bool)$data['is_active'] : 1,
                isset($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function update(int $id, array $data): bool
    {
        $fields = [];
        $params = [];

        $map = [
            'name'             => 'name',
            'sku'              => 'sku',
            'category'         => 'category',
            'unit_of_measure'  => 'uom',
            'uom'              => 'uom',
            'hsn_code'         => 'hsn_code',
            'reorder_level'    => 'reorder_level',
            'reorder_quantity' => 'reorder_quantity',
            'cost_price'       => 'standard_cost',
            'standard_cost'    => 'standard_cost',
            'selling_price'    => 'selling_price',
            'source_product_id'=> 'source_product_id',
            'is_active'        => 'is_active',
        ];

        foreach ($map as $in => $col) {
            if (!array_key_exists($in, $data)) {
                continue;
            }
            $value = $data[$in];
            if (in_array($col, ['reorder_level', 'reorder_quantity', 'standard_cost', 'selling_price'], true)) {
                $value = (float)$value;
            } elseif (in_array($col, ['source_product_id', 'is_active'], true)) {
                $value = $value === '' || $value === null ? null : (int)$value;
            } else {
                $value = $value === null ? null : trim((string)$value);
            }
            $fields[] = "$col = ?";
            $params[] = $value;
        }

        if (!$fields) {
            return false;
        }

        $params[] = $id;
        return Database::execute(
            "UPDATE inventory_products SET " . implode(', ', $fields) . "
             WHERE inv_product_id = ? AND is_deleted = 0",
            $params
        ) >= 0;
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetch(
            "SELECT * FROM inventory_products
             WHERE inv_product_id = ? AND is_deleted = 0
             LIMIT 1",
            [$id]
        );
        return $row ? self::format($row) : null;
    }

    public static function findBySku(string $sku): ?array
    {
        $row = Database::fetch(
            "SELECT * FROM inventory_products
             WHERE sku = ? AND is_deleted = 0
             LIMIT 1",
            [trim($sku)]
        );
        return $row ? self::format($row) : null;
    }

    public static function getAll(array $filters = []): array
    {
        $where = ['is_deleted = 0'];
        $params = [];

        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(name LIKE ? OR sku LIKE ? OR category LIKE ?)';
            array_push($params, $like, $like, $like);
        }
        if (!empty($filters['category'])) {
            $where[] = 'category = ?';
            $params[] = trim((string)$filters['category']);
        }
        if (isset($filters['is_active']) && $filters['is_active'] !== '') {
            $where[] = 'is_active = ?';
            $params[] = (int)(bool)$filters['is_active'];
        }

        $whereClause = implode(' AND ', $where);
        $rows = Database::fetchAll(
            "SELECT p.*,
                    COALESCE(s.current_quantity, 0)   AS current_quantity,
                    COALESCE(s.available_quantity, 0) AS available_quantity,
                    COALESCE(s.health_score, 0)       AS health_score
             FROM inventory_products p
             LEFT JOIN (
                 SELECT inv_product_id,
                        SUM(current_quantity)   AS current_quantity,
                        SUM(available_quantity) AS available_quantity,
                        CASE WHEN SUM(current_quantity) > 0
                             THEN SUM(health_score * current_quantity) / SUM(current_quantity)
                             ELSE AVG(health_score)
                        END AS health_score
                 FROM inventory_stock
                 GROUP BY inv_product_id
             ) s ON s.inv_product_id = p.inv_product_id
             WHERE $whereClause
             ORDER BY p.name ASC, p.inv_product_id DESC",
            $params
        );

        return array_map([self::class, 'format'], $rows);
    }

    public static function softDelete(int $id): bool
    {
        return Database::execute(
            "UPDATE inventory_products
             SET is_deleted = 1, is_active = 0
             WHERE inv_product_id = ? AND is_deleted = 0",
            [$id]
        ) > 0;
    }

    public static function existsBySku(string $sku, int $excludeId = 0): bool
    {
        return Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_products
             WHERE sku = ? AND is_deleted = 0 AND inv_product_id <> ?",
            [trim($sku), $excludeId]
        ) > 0;
    }

    private static function format(array $row): array
    {
        // Expose both the real column and the API alias so either contract works.
        $row['product_id']      = (int)$row['inv_product_id'];
        $row['unit_of_measure'] = $row['uom'];
        $row['cost_price']      = $row['standard_cost'];
        $row['is_active']       = (int)$row['is_active'] === 1;
        return $row;
    }
}
