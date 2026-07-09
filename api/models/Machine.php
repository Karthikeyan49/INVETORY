<?php
declare(strict_types=1);

/**
 * Machines — weighing machines tracked as inventory units made of parts.
 * Plain static-method model over the Database helper (mirrors InventoryProduct).
 */
class Machine
{
    public const STATUSES     = ['in_stock', 'reserved', 'on_delivery', 'delivered', 'maintenance'];
    public const PART_STATUS  = ['present', 'missing', 'transferred'];
    public const TYPES        = ['local', 'brand'];

    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 20): array
    {
        $where  = [];
        $params = [];

        if (!empty($filters['status'])) {
            $where[] = 'm.status = ?';
            $params[] = (string)$filters['status'];
        }
        if (!empty($filters['category'])) {
            $where[] = 'm.category = ?';
            $params[] = (string)$filters['category'];
        }
        if (!empty($filters['machine_type']) && in_array($filters['machine_type'], self::TYPES, true)) {
            $where[] = 'm.machine_type = ?';
            $params[] = (string)$filters['machine_type'];
        }
        if (!empty($filters['customer_id'])) {
            $where[] = 'm.customer_id = ?';
            $params[] = (int)$filters['customer_id'];
        }
        if (!empty($filters['search'])) {
            $where[] = '(m.code LIKE ? OR m.model LIKE ?)';
            $params[] = '%' . $filters['search'] . '%';
            $params[] = '%' . $filters['search'] . '%';
        }

        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM machines m $clause", $params);

        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT m.*,
                    (SELECT COUNT(*) FROM machine_parts p WHERE p.machine_id = m.id AND p.status = 'missing') AS missing_parts_count
             FROM machines m
             $clause
             ORDER BY m.created_at DESC
             LIMIT $limit OFFSET $offset",
            $params
        );

        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        $machine = Database::fetch("SELECT * FROM machines WHERE id = ? LIMIT 1", [$id]);
        if (!$machine) {
            return null;
        }
        $machine['parts'] = self::parts($id);
        return $machine;
    }

    public static function create(array $data): int
    {
        $txt = fn($k) => isset($data[$k]) && $data[$k] !== '' ? trim((string)$data[$k]) : null;
        return Database::insert(
            "INSERT INTO machines
                (code, model, category, machine_type, accuracy, platform_size, capacity, hsn, customer_id, zone_id, status,
                 purchase_date, invoice_date, stamping_date, sold_date,
                 notes, buy_price, buy_gst_pct, sale_price, sale_gst_pct, tax_amount,
                 extra_amount, extra_from_vendor, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                trim((string)$data['code']),
                isset($data['model']) ? trim((string)$data['model']) : null,
                $txt('category'),
                in_array($data['machine_type'] ?? '', self::TYPES, true) ? $data['machine_type'] : 'brand',
                $txt('accuracy'),
                $txt('platform_size'),
                $txt('capacity'),
                $txt('hsn'),
                !empty($data['customer_id']) ? (int)$data['customer_id'] : null,
                !empty($data['zone_id']) ? (int)$data['zone_id'] : null,
                in_array($data['status'] ?? '', self::STATUSES, true) ? $data['status'] : 'in_stock',
                !empty($data['purchase_date']) ? (string)$data['purchase_date'] : null,
                !empty($data['invoice_date']) ? (string)$data['invoice_date'] : null,
                !empty($data['stamping_date']) ? (string)$data['stamping_date'] : null,
                !empty($data['sold_date']) ? (string)$data['sold_date'] : null,
                isset($data['notes']) ? trim((string)$data['notes']) : null,
                isset($data['buy_price']) && $data['buy_price'] !== '' ? (float)$data['buy_price'] : null,
                isset($data['buy_gst_pct']) && $data['buy_gst_pct'] !== '' ? (float)$data['buy_gst_pct'] : null,
                isset($data['sale_price']) && $data['sale_price'] !== '' ? (float)$data['sale_price'] : null,
                isset($data['sale_gst_pct']) && $data['sale_gst_pct'] !== '' ? (float)$data['sale_gst_pct'] : null,
                isset($data['tax_amount']) && $data['tax_amount'] !== '' ? (float)$data['tax_amount'] : null,
                isset($data['extra_amount']) && $data['extra_amount'] !== '' ? (float)$data['extra_amount'] : null,
                isset($data['extra_from_vendor']) && $data['extra_from_vendor'] !== '' ? (float)$data['extra_from_vendor'] : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function update(int $id, array $data): bool
    {
        $map = [
            'code' => 'code', 'model' => 'model', 'category' => 'category', 'machine_type' => 'machine_type', 'hsn' => 'hsn',
            'accuracy' => 'accuracy', 'platform_size' => 'platform_size', 'capacity' => 'capacity',
            'customer_id' => 'customer_id', 'zone_id' => 'zone_id',
            'purchase_date' => 'purchase_date', 'invoice_date' => 'invoice_date', 'stamping_date' => 'stamping_date',
            'sold_date' => 'sold_date', 'notes' => 'notes',
            'buy_price' => 'buy_price', 'buy_gst_pct' => 'buy_gst_pct',
            'sale_price' => 'sale_price', 'sale_gst_pct' => 'sale_gst_pct', 'tax_amount' => 'tax_amount',
            'extra_amount' => 'extra_amount', 'extra_from_vendor' => 'extra_from_vendor',
        ];
        $numeric = ['buy_price', 'buy_gst_pct', 'sale_price', 'sale_gst_pct', 'tax_amount', 'extra_amount', 'extra_from_vendor'];
        $fields = [];
        $params = [];
        foreach ($map as $in => $col) {
            if (!array_key_exists($in, $data)) {
                continue;
            }
            $value = $data[$in];
            if ($col === 'machine_type') {
                $value = in_array($value, self::TYPES, true) ? $value : 'brand';
            } elseif (in_array($col, ['customer_id', 'zone_id'], true)) {
                $value = $value !== '' && $value !== null ? (int)$value : null;
            } elseif (in_array($col, $numeric, true)) {
                $value = $value !== '' && $value !== null ? (float)$value : null;
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
        return Database::execute("UPDATE machines SET " . implode(', ', $fields) . " WHERE id = ?", $params) >= 0;
    }

    public static function updateStatus(int $id, string $status): bool
    {
        if (!in_array($status, self::STATUSES, true)) {
            return false;
        }
        // Mark sold_date when the machine is delivered (drives stamping renewal — Module 2).
        if ($status === 'delivered') {
            Database::execute(
                "UPDATE machines SET status = ?, sold_date = COALESCE(sold_date, CURDATE()) WHERE id = ?",
                [$status, $id]
            );
            // Auto-open a stamping record so its yearly renewal starts tracking (Module 2).
            $m = Database::fetch("SELECT sold_date, customer_id FROM machines WHERE id = ? LIMIT 1", [$id]);
            if ($m && class_exists('Stamping')) {
                Stamping::createForMachine(
                    $id,
                    $m['sold_date'] ?? null,
                    !empty($m['customer_id']) ? (int)$m['customer_id'] : null
                );
            }
        } else {
            Database::execute("UPDATE machines SET status = ? WHERE id = ?", [$status, $id]);
        }
        return true;
    }

    // ── Parts ────────────────────────────────────────────────────────────────

    public static function parts(int $machineId): array
    {
        return Database::fetchAll(
            "SELECT * FROM machine_parts WHERE machine_id = ? ORDER BY part_name",
            [$machineId]
        );
    }

    /**
     * Catalog for the add-machine form (requirement): once a model/category/HSN
     * has been entered, it appears in the dropdown for the next machine, and
     * picking a known model auto-fills category, HSN and prices from its most
     * recent machine.
     */
    public static function catalog(): array
    {
        // Most recent machine per model → the values to auto-fill.
        $models = Database::fetchAll(
            "SELECT m.model, m.category, m.accuracy, m.platform_size, m.capacity, m.hsn,
                    m.buy_price, m.buy_gst_pct, m.sale_price, m.sale_gst_pct
             FROM machines m
             INNER JOIN (SELECT model, MAX(id) AS max_id FROM machines WHERE model IS NOT NULL AND model <> '' GROUP BY model) t
               ON t.max_id = m.id
             ORDER BY m.model"
        );
        $distinct = function (string $col): array {
            $rows = Database::fetchAll("SELECT DISTINCT $col AS v FROM machines WHERE $col IS NOT NULL AND $col <> '' ORDER BY $col");
            return array_map(fn($r) => $r['v'], $rows);
        };
        $partNames = Database::fetchAll("SELECT DISTINCT part_name FROM machine_parts WHERE part_name IS NOT NULL AND part_name <> '' ORDER BY part_name");
        return [
            'models'         => $models,
            'categories'     => $distinct('category'),
            'accuracies'     => $distinct('accuracy'),
            'platform_sizes' => $distinct('platform_size'),
            'capacities'     => $distinct('capacity'),
            'hsns'           => $distinct('hsn'),
            'part_names'     => array_map(fn($r) => $r['part_name'], $partNames),
        ];
    }

    public static function updatePart(int $partId, array $data): bool
    {
        $map = ['part_name' => 'part_name', 'qty' => 'qty', 'status' => 'status', 'product_id' => 'product_id'];
        $fields = [];
        $params = [];
        foreach ($map as $in => $col) {
            if (!array_key_exists($in, $data)) {
                continue;
            }
            if ($col === 'status' && !in_array($data[$in], self::PART_STATUS, true)) {
                continue;
            }
            $value = $data[$in];
            if ($col === 'qty') {
                $value = (float)$value;
            } elseif ($col === 'product_id') {
                $value = $value !== '' && $value !== null ? (int)$value : null;
            }
            $fields[] = "$col = ?";
            $params[] = $value;
        }
        if (!$fields) {
            return false;
        }
        $params[] = $partId;
        return Database::execute("UPDATE machine_parts SET " . implode(', ', $fields) . " WHERE id = ?", $params) >= 0;
    }

    public static function addPart(int $machineId, array $data): int
    {
        return Database::insert(
            "INSERT INTO machine_parts (machine_id, part_name, product_id, qty, status)
             VALUES (?, ?, ?, ?, ?)",
            [
                $machineId,
                trim((string)$data['part_name']),
                !empty($data['product_id']) ? (int)$data['product_id'] : null,
                isset($data['qty']) ? (float)$data['qty'] : 1,
                in_array($data['status'] ?? '', self::PART_STATUS, true) ? $data['status'] : 'present',
            ]
        );
    }

    /** Machines that are missing one or more parts (used by invoice/delivery guard — Module 3). */
    public static function missingParts(int $machineId): array
    {
        return Database::fetchAll(
            "SELECT part_name, qty FROM machine_parts WHERE machine_id = ? AND status = 'missing'",
            [$machineId]
        );
    }

    /**
     * Transfer a part from one machine to another (Module 3).
     * Flips the source part → 'missing' and adds/updates a 'present' part on the
     * target, and writes a part_transfers audit row so the source machine can be
     * flagged as incomplete on any future invoice/delivery.
     */
    public static function transferPart(int $partId, int $toMachineId, ?int $userId = null, ?string $notes = null): bool
    {
        $part = Database::fetch("SELECT * FROM machine_parts WHERE id = ? LIMIT 1", [$partId]);
        if (!$part) {
            return false;
        }
        $fromMachineId = (int)$part['machine_id'];
        // Source loses the part.
        Database::execute("UPDATE machine_parts SET status = 'missing' WHERE id = ?", [$partId]);
        // Target gains it (fresh present part).
        Database::insert(
            "INSERT INTO machine_parts (machine_id, part_name, product_id, qty, status)
             VALUES (?, ?, ?, ?, 'present')",
            [
                $toMachineId,
                (string)$part['part_name'],
                !empty($part['product_id']) ? (int)$part['product_id'] : null,
                (float)$part['qty'],
            ]
        );
        // Audit trail.
        Database::insert(
            "INSERT INTO part_transfers (part_id, from_machine_id, to_machine_id, part_name, qty, notes, transferred_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            [$partId, $fromMachineId, $toMachineId, (string)$part['part_name'], (float)$part['qty'], $notes, $userId]
        );
        return true;
    }

    public static function transfers(int $machineId): array
    {
        return Database::fetchAll(
            "SELECT pt.*, mf.code AS from_code, mt.code AS to_code
             FROM part_transfers pt
             LEFT JOIN machines mf ON mf.id = pt.from_machine_id
             LEFT JOIN machines mt ON mt.id = pt.to_machine_id
             WHERE pt.from_machine_id = ? OR pt.to_machine_id = ?
             ORDER BY pt.created_at DESC",
            [$machineId, $machineId]
        );
    }

    /**
     * Machines that are missing parts — surfaced as warnings at invoice/delivery
     * time (line 8). Prioritises units that are on delivery or already delivered.
     */
    public static function alerts(): array
    {
        return Database::fetchAll(
            "SELECT m.id, m.code, m.model, m.status,
                    (SELECT COUNT(*) FROM machine_parts p WHERE p.machine_id = m.id AND p.status = 'missing') AS missing_parts_count,
                    (SELECT GROUP_CONCAT(p.part_name SEPARATOR ', ') FROM machine_parts p WHERE p.machine_id = m.id AND p.status = 'missing') AS missing_parts
             FROM machines m
             HAVING missing_parts_count > 0
             ORDER BY FIELD(m.status,'on_delivery','delivered','reserved','in_stock'), m.code"
        );
    }

    /**
     * Tax vs tax+extra totals (lines 2, 18) — lets the extended login maintain
     * both the plain-tax view and the extra given-to-customer / from-vendor view.
     */
    public static function taxSummary(): array
    {
        $r = Database::fetch(
            "SELECT
                COALESCE(SUM(sale_price),0)        AS total_sales,
                COALESCE(SUM(tax_amount),0)        AS total_tax,
                COALESCE(SUM(extra_amount),0)      AS total_extra_to_customer,
                COALESCE(SUM(extra_from_vendor),0) AS total_extra_from_vendor
             FROM machines"
        ) ?: [];
        $r['total_with_extra'] = (float)($r['total_tax'] ?? 0)
            + (float)($r['total_extra_to_customer'] ?? 0)
            + (float)($r['total_extra_from_vendor'] ?? 0);
        return $r;
    }

    /**
     * "Which machine should we move first?" (Module 4).
     * Ranks in-stock machines: complete (no missing parts) first, then oldest
     * stock (FIFO), so ready + longest-held machines dispatch ahead of others.
     */
    public static function dispatchRecommendations(int $limit = 20): array
    {
        $rows = Database::fetchAll(
            "SELECT m.*,
                    (SELECT COUNT(*) FROM machine_parts p WHERE p.machine_id = m.id AND p.status = 'missing') AS missing_parts_count,
                    DATEDIFF(CURDATE(), COALESCE(m.purchase_date, DATE(m.created_at))) AS days_in_stock
             FROM machines m
             WHERE m.status = 'in_stock'
             ORDER BY missing_parts_count ASC, days_in_stock DESC
             LIMIT $limit"
        );
        $rank = 1;
        foreach ($rows as &$r) {
            $complete = (int)$r['missing_parts_count'] === 0;
            $age      = (int)$r['days_in_stock'];
            // Ready machines score high; each missing part is a heavy penalty; age nudges FIFO.
            $r['dispatch_score'] = ($complete ? 100 : 40) - ((int)$r['missing_parts_count'] * 15) + min(30, (int)($age / 7));
            $r['dispatch_rank']  = $rank++;
            $r['dispatch_reason'] = $complete
                ? ($age > 0 ? "Ready · in stock {$age}d (FIFO)" : "Ready to dispatch")
                : "Incomplete · {$r['missing_parts_count']} part(s) missing";
        }
        return $rows;
    }
}
