<?php
declare(strict_types=1);

/**
 * Smart Inventory — warehouse zones (inventory_zones).
 */
class InventoryZone
{
    public const TYPES = [
        'RAW_MATERIAL',
        'PRODUCTION',
        'READY_STOCK',
        'DEALER_RESERVED',
        'DAMAGED',
        'EMERGENCY_BUFFER',
    ];

    public static function create(array $data): int
    {
        return Database::insert(
            "INSERT INTO inventory_zones
                (zone_name, zone_code, zone_type, warehouse_location, capacity, is_active)
             VALUES (?, ?, ?, ?, ?, ?)",
            [
                trim((string)$data['zone_name']),
                trim((string)$data['zone_code']),
                trim((string)$data['zone_type']),
                isset($data['warehouse_location']) && $data['warehouse_location'] !== ''
                    ? trim((string)$data['warehouse_location']) : null,
                (float)($data['capacity'] ?? 0),
                isset($data['is_active']) ? (int)(bool)$data['is_active'] : 1,
            ]
        );
    }

    public static function update(int $id, array $data): bool
    {
        $fields = [];
        $params = [];

        $map = [
            'zone_name'          => 'zone_name',
            'zone_code'          => 'zone_code',
            'zone_type'          => 'zone_type',
            'warehouse_location' => 'warehouse_location',
            'capacity'           => 'capacity',
            'is_active'          => 'is_active',
        ];

        foreach ($map as $in => $col) {
            if (!array_key_exists($in, $data)) {
                continue;
            }
            $value = $data[$in];
            if ($col === 'capacity') {
                $value = (float)$value;
            } elseif ($col === 'is_active') {
                $value = (int)(bool)$value;
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
            "UPDATE inventory_zones SET " . implode(', ', $fields) . " WHERE zone_id = ?",
            $params
        ) >= 0;
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetch(
            "SELECT * FROM inventory_zones WHERE zone_id = ? LIMIT 1",
            [$id]
        );
        return $row ? self::format($row) : null;
    }

    public static function findByCode(string $code): ?array
    {
        $row = Database::fetch(
            "SELECT * FROM inventory_zones WHERE zone_code = ? LIMIT 1",
            [trim($code)]
        );
        return $row ? self::format($row) : null;
    }

    public static function getAll(array $filters = []): array
    {
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['zone_type'])) {
            $where[] = 'zone_type = ?';
            $params[] = trim((string)$filters['zone_type']);
        }
        if (isset($filters['is_active']) && $filters['is_active'] !== '') {
            $where[] = 'is_active = ?';
            $params[] = (int)(bool)$filters['is_active'];
        }
        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(zone_name LIKE ? OR zone_code LIKE ?)';
            array_push($params, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $rows = Database::fetchAll(
            "SELECT z.*,
                    COALESCE(s.current_quantity, 0) AS current_quantity
             FROM inventory_zones z
             LEFT JOIN (
                 SELECT zone_id, SUM(current_quantity) AS current_quantity
                 FROM inventory_stock
                 GROUP BY zone_id
             ) s ON s.zone_id = z.zone_id
             WHERE $whereClause
             ORDER BY z.zone_name ASC, z.zone_id ASC",
            $params
        );

        return array_map([self::class, 'format'], $rows);
    }

    public static function getActiveZones(): array
    {
        $rows = Database::fetchAll(
            "SELECT * FROM inventory_zones
             WHERE is_active = 1
             ORDER BY zone_name ASC",
            []
        );
        return array_map([self::class, 'format'], $rows);
    }

    public static function existsByCode(string $code, int $excludeId = 0): bool
    {
        return Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_zones
             WHERE zone_code = ? AND zone_id <> ?",
            [trim($code), $excludeId]
        ) > 0;
    }

    /** Resolve a zone by its type (first active match) — used to route damaged stock. */
    public static function findByType(string $type): ?array
    {
        $row = Database::fetch(
            "SELECT * FROM inventory_zones
             WHERE zone_type = ? AND is_active = 1
             ORDER BY zone_id ASC
             LIMIT 1",
            [trim($type)]
        );
        return $row ? self::format($row) : null;
    }

    private static function format(array $row): array
    {
        $row['zone_id']   = (int)$row['zone_id'];
        $row['is_active'] = (int)$row['is_active'] === 1;
        return $row;
    }
}
