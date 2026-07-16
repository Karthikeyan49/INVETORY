<?php
declare(strict_types=1);

/**
 * CashBill — Sri Vari "Cash Bill" (F/SVS/34), a cash-sale receipt. Mirrors the
 * delivery-challan model: can reference a machine, is listed with history, and
 * is downloadable as a PDF from the Cash Bills page.
 */
class CashBill
{
    public static function nextBillNo(): string
    {
        $year = date('Y');
        $n = Database::count(
            "SELECT COUNT(*) AS cnt FROM cash_bills WHERE bill_no LIKE ?",
            ["CB-$year-%"]
        );
        return sprintf('CB-%s-%04d', $year, $n + 1);
    }

    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 50): array
    {
        $where  = [];
        $params = [];
        if (!empty($filters['search'])) {
            $where[]  = '(c.bill_no LIKE ? OR c.customer_name LIKE ?)';
            $params[] = '%' . $filters['search'] . '%';
            $params[] = '%' . $filters['search'] . '%';
        }
        $custId   = !empty($filters['customer_id']) ? (int)$filters['customer_id'] : 0;
        $custName = isset($filters['customer_name']) ? trim((string)$filters['customer_name']) : '';
        if ($custId > 0) {
            if ($custName !== '') {
                $where[]  = '(c.customer_id = ? OR (c.customer_id IS NULL AND LOWER(c.customer_name) = LOWER(?)))';
                $params[] = $custId;
                $params[] = $custName;
            } else {
                $where[]  = 'c.customer_id = ?';
                $params[] = $custId;
            }
        } elseif ($custName !== '') {
            $where[]  = 'LOWER(c.customer_name) = LOWER(?)';
            $params[] = $custName;
        }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM cash_bills c $clause", $params);

        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT c.*, m.code AS machine_code, m.model AS machine_model
             FROM cash_bills c
             LEFT JOIN machines m ON m.id = c.machine_id
             $clause
             ORDER BY c.created_at DESC
             LIMIT $limit OFFSET $offset",
            $params
        );
        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        return Database::fetch(
            "SELECT c.*, m.code AS machine_code, m.model AS machine_model
             FROM cash_bills c LEFT JOIN machines m ON m.id = c.machine_id
             WHERE c.id = ? LIMIT 1",
            [$id]
        );
    }

    public static function create(array $data): int
    {
        $num = fn($k) => isset($data[$k]) && $data[$k] !== '' ? (float)$data[$k] : null;
        $amount = $num('amount');
        $total  = $num('total');
        if ($total === null) {
            $total = $amount; // cash bill has no separate tax line — total defaults to amount
        }
        return Database::insert(
            "INSERT INTO cash_bills
                (bill_no, customer_id, customer_name, cell_no, machine_id,
                 description, qty, amount, total, bill_date, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                !empty($data['bill_no']) ? (string)$data['bill_no'] : self::nextBillNo(),
                !empty($data['customer_id']) ? (int)$data['customer_id'] : null,
                isset($data['customer_name']) ? trim((string)$data['customer_name']) : null,
                isset($data['cell_no']) ? trim((string)$data['cell_no']) : null,
                !empty($data['machine_id']) ? (int)$data['machine_id'] : null,
                isset($data['description']) ? trim((string)$data['description']) : null,
                isset($data['qty']) && $data['qty'] !== '' ? trim((string)$data['qty']) : null,
                $amount, $total,
                !empty($data['bill_date']) ? (string)$data['bill_date'] : null,
                isset($data['notes']) ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function delete(int $id): bool
    {
        return Database::execute("DELETE FROM cash_bills WHERE id = ?", [$id]) >= 0;
    }
}
