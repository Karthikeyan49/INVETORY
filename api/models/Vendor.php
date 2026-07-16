<?php
declare(strict_types=1);

class Vendor
{
    public static function all(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (($filters['active'] ?? null) !== null && $filters['active'] !== '') {
            $where[] = 'is_active = ?';
            $params[] = filter_var($filters['active'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
        }

        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(vendor_code LIKE ? OR name LIKE ? OR gstin LIKE ? OR phone LIKE ?)';
            array_push($params, $like, $like, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM vendors WHERE $whereClause", $params);

        // Per-vendor purchase cost: purchases are keyed by free-text vendor_name
        // (that's what the machine-add flow and the Purchases page write), so match
        // it to the vendor master by name (case/space-insensitive).
        $hasPurchases = Database::fetch("SHOW TABLES LIKE 'purchases'") !== null;
        $spendSelect = $hasPurchases
            ? ",\n  COALESCE((SELECT SUM(p.total) FROM purchases p WHERE LOWER(TRIM(p.vendor_name)) = LOWER(TRIM(vendors.name))), 0) AS purchase_total,"
              . "\n  COALESCE((SELECT COUNT(*) FROM purchases p WHERE LOWER(TRIM(p.vendor_name)) = LOWER(TRIM(vendors.name))), 0) AS purchase_count,"
              . "\n  COALESCE((SELECT SUM(GREATEST(p.total - p.amount_paid, 0)) FROM purchases p WHERE LOWER(TRIM(p.vendor_name)) = LOWER(TRIM(vendors.name))), 0) AS purchase_outstanding"
            : ",\n  0 AS purchase_total, 0 AS purchase_count, 0 AS purchase_outstanding";

        $rows = Database::fetchAll(
            "SELECT vendors.*$spendSelect
             FROM vendors
             WHERE $whereClause
             ORDER BY is_active DESC, name ASC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'format'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit),
            ],
        ];
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetch('SELECT * FROM vendors WHERE vendor_id = ? LIMIT 1', [$id]);

        return $row ? self::format($row) : null;
    }

    /**
     * Find an existing vendor by (case/space-insensitive) name, or create a
     * minimal register entry so free-text vendor names used elsewhere (e.g. the
     * Purchase Order form) always surface in the Vendors register. Returns the
     * vendor_id, or null if the name is blank.
     */
    public static function ensureByName(string $name): ?int
    {
        $name = trim($name);
        if ($name === '') {
            return null;
        }
        $existing = Database::fetch(
            'SELECT vendor_id FROM vendors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) ORDER BY is_active DESC, vendor_id ASC LIMIT 1',
            [$name]
        );
        if ($existing) {
            return (int)$existing['vendor_id'];
        }
        return self::create([
            'name' => $name, 'vendor_code' => '', 'gstin' => '', 'contact_name' => '',
            'phone' => '', 'email' => '', 'address' => '', 'city' => '', 'state' => '',
            'pincode' => '', 'payment_terms' => '', 'notes' => '',
        ]);
    }

    public static function create(array $data): int
    {
        $id = Database::insert(
            'INSERT INTO vendors
                (vendor_code, name, gstin, contact_name, phone, email, address, city, state, pincode, payment_terms, notes, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())',
            [
                $data['vendor_code'] ?: null,
                $data['name'],
                $data['gstin'] ?: null,
                $data['contact_name'] ?: null,
                $data['phone'] ?: null,
                $data['email'] ?: null,
                $data['address'] ?: null,
                $data['city'] ?: null,
                $data['state'] ?: null,
                $data['pincode'] ?: null,
                $data['payment_terms'] ?: null,
                $data['notes'] ?: null,
            ]
        );

        if (empty($data['vendor_code'])) {
            Database::execute(
                'UPDATE vendors SET vendor_code = ? WHERE vendor_id = ?',
                ['VND-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT), $id]
            );
        }

        return $id;
    }

    public static function update(int $id, array $data): void
    {
        $fields = [];
        $params = [];
        $allowed = [
            'vendor_code', 'name', 'gstin', 'contact_name', 'phone', 'email', 'address',
            'city', 'state', 'pincode', 'payment_terms', 'notes', 'is_active',
        ];

        foreach ($allowed as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $fields[] = "$field = ?";
            $params[] = $field === 'is_active' ? (int)(bool)$data[$field] : ($data[$field] ?: null);
        }

        if (empty($fields)) {
            return;
        }

        $params[] = $id;
        Database::execute(
            'UPDATE vendors SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE vendor_id = ?',
            $params
        );
    }

    public static function deactivate(int $id): void
    {
        Database::execute('UPDATE vendors SET is_active = 0, updated_at = NOW() WHERE vendor_id = ?', [$id]);
    }

    public static function existsByCode(string $code, ?int $excludeId = null): bool
    {
        $code = trim($code);
        if ($code === '') {
            return false;
        }

        $sql = 'SELECT vendor_id FROM vendors WHERE vendor_code = ?';
        $params = [$code];
        if ($excludeId !== null) {
            $sql .= ' AND vendor_id != ?';
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 1';

        return Database::fetch($sql, $params) !== null;
    }

    public static function duplicateHints(string $name, ?string $gstin, ?int $excludeId = null): array
    {
        $where = [];
        $params = [];
        if ($gstin) {
            $where[] = 'UPPER(gstin) = ?';
            $params[] = strtoupper($gstin);
        }
        if ($name !== '') {
            $where[] = 'LOWER(name) = ?';
            $params[] = strtolower($name);
        }
        if (empty($where)) {
            return [];
        }

        $sql = 'SELECT vendor_id, vendor_code, name, gstin FROM vendors WHERE (' . implode(' OR ', $where) . ')';
        if ($excludeId !== null) {
            $sql .= ' AND vendor_id != ?';
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 5';

        return Database::fetchAll($sql, $params);
    }

    public static function format(array $row): array
    {
        return [
            'vendor_id' => (int)$row['vendor_id'],
            'id' => (string)$row['vendor_id'],
            'vendor_code' => $row['vendor_code'],
            'name' => $row['name'],
            'gstin' => $row['gstin'],
            'contact_name' => $row['contact_name'],
            'phone' => $row['phone'],
            'email' => $row['email'],
            'address' => $row['address'],
            'city' => $row['city'],
            'state' => $row['state'],
            'pincode' => $row['pincode'],
            'payment_terms' => $row['payment_terms'],
            'notes' => $row['notes'] ?? null,
            'is_active' => (bool)$row['is_active'],
            'purchase_total' => isset($row['purchase_total']) ? (float)$row['purchase_total'] : 0.0,
            'purchase_count' => isset($row['purchase_count']) ? (int)$row['purchase_count'] : 0,
            'purchase_outstanding' => isset($row['purchase_outstanding']) ? (float)$row['purchase_outstanding'] : 0.0,
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }
}
