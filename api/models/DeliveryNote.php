<?php
declare(strict_types=1);

/**
 * DeliveryNote — delivery bill / challan (requirement.txt lines 6, 8, 14).
 * Each challan can reference a machine, which links delivery ↔ inventory and lets
 * the system warn at generation time if that machine is missing parts (e.g. a
 * battery that was transferred to another unit).
 */
class DeliveryNote
{
    public const STATUSES = ['draft', 'issued', 'delivered', 'cancelled'];

    public static function nextChallanNo(): string
    {
        $year = date('Y');
        $n = Database::count(
            "SELECT COUNT(*) AS cnt FROM delivery_notes WHERE challan_no LIKE ?",
            ["DN-$year-%"]
        );
        return sprintf('DN-%s-%04d', $year, $n + 1);
    }

    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 50): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['status'])) {
            $where[] = 'd.status = ?';
            $params[] = (string)$filters['status'];
        }
        if (!empty($filters['category'])) {
            $where[] = 'd.category = ?';
            $params[] = (string)$filters['category'];
        }
        if (!empty($filters['search'])) {
            $where[] = '(d.challan_no LIKE ? OR d.customer_name LIKE ?)';
            $params[] = '%' . $filters['search'] . '%';
            $params[] = '%' . $filters['search'] . '%';
        }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total = Database::count("SELECT COUNT(*) AS cnt FROM delivery_notes d $clause", $params);

        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT d.*, m.code AS machine_code, m.model AS machine_model,
                    (SELECT COUNT(*) FROM machine_parts p WHERE p.machine_id = d.machine_id AND p.status = 'missing') AS missing_parts_count
             FROM delivery_notes d
             LEFT JOIN machines m ON m.id = d.machine_id
             $clause
             ORDER BY d.created_at DESC
             LIMIT $limit OFFSET $offset",
            $params
        );
        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        $row = Database::fetch(
            "SELECT d.*, m.code AS machine_code, m.model AS machine_model
             FROM delivery_notes d LEFT JOIN machines m ON m.id = d.machine_id
             WHERE d.id = ? LIMIT 1",
            [$id]
        );
        if ($row && !empty($row['machine_id'])) {
            $row['missing_parts'] = Machine::missingParts((int)$row['machine_id']);
        }
        return $row;
    }

    public static function create(array $data): int
    {
        $machineId = !empty($data['machine_id']) ? (int)$data['machine_id'] : null;
        $missingFlag = 0;
        if ($machineId) {
            $missingFlag = count(Machine::missingParts($machineId)) > 0 ? 1 : 0;
        }
        $num = fn($k) => isset($data[$k]) && $data[$k] !== '' ? (float)$data[$k] : null;
        return Database::insert(
            "INSERT INTO delivery_notes
                (challan_no, customer_id, customer_name, machine_id, category, items,
                 amount, tax_amount, extra_amount, extra_from_vendor,
                 status, delivery_date, missing_flag, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                !empty($data['challan_no']) ? (string)$data['challan_no'] : self::nextChallanNo(),
                !empty($data['customer_id']) ? (int)$data['customer_id'] : null,
                isset($data['customer_name']) ? trim((string)$data['customer_name']) : null,
                $machineId,
                isset($data['category']) && $data['category'] !== '' ? trim((string)$data['category']) : null,
                isset($data['items']) ? trim((string)$data['items']) : null,
                $num('amount'), $num('tax_amount'), $num('extra_amount'), $num('extra_from_vendor'),
                in_array($data['status'] ?? '', self::STATUSES, true) ? $data['status'] : 'draft',
                !empty($data['delivery_date']) ? (string)$data['delivery_date'] : null,
                $missingFlag,
                isset($data['notes']) ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    /** Delivery-side money totals for the combined tax vs tax+extra ledger (line 18). */
    public static function taxSummary(): array
    {
        $r = Database::fetch(
            "SELECT
                COALESCE(SUM(amount),0)            AS total_amount,
                COALESCE(SUM(tax_amount),0)        AS total_tax,
                COALESCE(SUM(extra_amount),0)      AS total_extra_to_customer,
                COALESCE(SUM(extra_from_vendor),0) AS total_extra_from_vendor
             FROM delivery_notes WHERE status <> 'cancelled'"
        ) ?: [];
        return $r;
    }

    public static function updateStatus(int $id, string $status): bool
    {
        if (!in_array($status, self::STATUSES, true)) {
            return false;
        }
        Database::execute("UPDATE delivery_notes SET status = ? WHERE id = ?", [$status, $id]);
        return true;
    }
}
