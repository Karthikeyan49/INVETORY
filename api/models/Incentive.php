<?php
declare(strict_types=1);

/**
 * Incentive — output-based HR pay (R7 / T10). Separate from fixed payroll:
 * people paid per sale / visit / collection, a fixed bonus, or a percentage of
 * turnover. Off-books extra is extended-login only. Marking an incentive paid
 * posts an expense so it flows into Finance / P&L.
 */
class Incentive
{
    public const BASES  = ['per_sale', 'per_visit', 'per_collection', 'fixed', 'percentage'];
    public const STATUS = ['unpaid', 'paid'];

    /** Compute the on-books incentive amount from basis + rate + units/base. */
    public static function computeAmount(string $basis, float $rate, float $units, float $baseAmount): float
    {
        if ($basis === 'percentage') {
            return round($baseAmount * $rate / 100, 2);
        }
        if ($basis === 'fixed') {
            return round($rate * ($units > 0 ? $units : 1), 2);
        }
        return round($rate * $units, 2);
    }

    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 200): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['status']) && in_array($filters['status'], self::STATUS, true)) {
            $where[] = 'i.status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['period'])) {
            $where[] = 'i.period = ?';
            $params[] = (string)$filters['period'];
        }
        if (!empty($filters['employee_id'])) {
            $where[] = 'i.employee_id = ?';
            $params[] = (int)$filters['employee_id'];
        }
        if (!empty($filters['search'])) {
            $where[] = '(i.person_name LIKE ? OR i.notes LIKE ?)';
            $like = '%' . $filters['search'] . '%';
            array_push($params, $like, $like);
        }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total = Database::count("SELECT COUNT(*) AS cnt FROM incentives i $clause", $params);
        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT i.*, e.name AS employee_name, e.designation AS employee_designation
             FROM incentives i
             LEFT JOIN employees e ON e.employee_id = i.employee_id
             $clause
             ORDER BY i.created_at DESC, i.id DESC
             LIMIT $limit OFFSET $offset",
            $params
        );
        foreach ($rows as &$r) {
            self::cast($r);
        }
        unset($r);
        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        $row = Database::fetch(
            "SELECT i.*, e.name AS employee_name, e.designation AS employee_designation
             FROM incentives i LEFT JOIN employees e ON e.employee_id = i.employee_id
             WHERE i.id = ? LIMIT 1",
            [$id]
        );
        if (!$row) {
            return null;
        }
        self::cast($row);
        return $row;
    }

    private static function cast(array &$r): void
    {
        $r['id'] = (int)$r['id'];
        $r['employee_id'] = $r['employee_id'] ? (int)$r['employee_id'] : null;
        foreach (['rate', 'units', 'base_amount', 'amount', 'extra_amount'] as $f) {
            $r[$f] = (float)($r[$f] ?? 0);
        }
    }

    public static function create(array $data): int
    {
        $basis = in_array($data['basis'] ?? '', self::BASES, true) ? $data['basis'] : 'per_sale';
        $rate = max(0.0, (float)($data['rate'] ?? 0));
        $units = max(0.0, (float)($data['units'] ?? 0));
        $baseAmount = max(0.0, (float)($data['base_amount'] ?? 0));
        $amount = self::computeAmount($basis, $rate, $units, $baseAmount);

        return Database::insert(
            "INSERT INTO incentives
                (employee_id, person_name, basis, rate, units, base_amount, amount, extra_amount,
                 period, status, payment_category, utr_no, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                !empty($data['employee_id']) ? (int)$data['employee_id'] : null,
                trim((string)$data['person_name']),
                $basis, $rate, $units, $baseAmount, $amount,
                max(0.0, (float)($data['extra_amount'] ?? 0)),
                isset($data['period']) && $data['period'] !== '' ? trim((string)$data['period']) : null,
                in_array($data['status'] ?? '', self::STATUS, true) ? $data['status'] : 'unpaid',
                isset($data['payment_category']) && $data['payment_category'] !== '' ? (string)$data['payment_category'] : null,
                isset($data['utr_no']) && $data['utr_no'] !== '' ? trim((string)$data['utr_no']) : null,
                isset($data['notes']) && $data['notes'] !== '' ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function update(int $id, array $data): bool
    {
        $existing = self::find($id);
        if (!$existing) {
            return false;
        }
        $basis = in_array($data['basis'] ?? $existing['basis'], self::BASES, true) ? ($data['basis'] ?? $existing['basis']) : 'per_sale';
        $rate = array_key_exists('rate', $data) ? max(0.0, (float)$data['rate']) : (float)$existing['rate'];
        $units = array_key_exists('units', $data) ? max(0.0, (float)$data['units']) : (float)$existing['units'];
        $baseAmount = array_key_exists('base_amount', $data) ? max(0.0, (float)$data['base_amount']) : (float)$existing['base_amount'];
        $amount = self::computeAmount($basis, $rate, $units, $baseAmount);
        $extra = array_key_exists('extra_amount', $data) ? max(0.0, (float)$data['extra_amount']) : (float)$existing['extra_amount'];

        Database::execute(
            "UPDATE incentives SET employee_id = ?, person_name = ?, basis = ?, rate = ?, units = ?,
                    base_amount = ?, amount = ?, extra_amount = ?, period = ?, payment_category = ?,
                    utr_no = ?, notes = ? WHERE id = ?",
            [
                array_key_exists('employee_id', $data) ? (!empty($data['employee_id']) ? (int)$data['employee_id'] : null) : $existing['employee_id'],
                array_key_exists('person_name', $data) ? trim((string)$data['person_name']) : $existing['person_name'],
                $basis, $rate, $units, $baseAmount, $amount, $extra,
                array_key_exists('period', $data) ? (trim((string)$data['period']) ?: null) : $existing['period'],
                array_key_exists('payment_category', $data) ? ((string)$data['payment_category'] ?: null) : $existing['payment_category'],
                array_key_exists('utr_no', $data) ? (trim((string)$data['utr_no']) ?: null) : $existing['utr_no'],
                array_key_exists('notes', $data) ? (trim((string)$data['notes']) ?: null) : $existing['notes'],
                $id,
            ]
        );
        return true;
    }

    /** Mark paid and post an expense (Finance link). Returns the updated row. */
    public static function markPaid(int $id, array $data): ?array
    {
        $inc = self::find($id);
        if (!$inc) {
            return null;
        }
        if ($inc['status'] === 'paid') {
            return $inc;
        }
        $paidOn = !empty($data['paid_on']) ? (string)$data['paid_on'] : date('Y-m-d');
        $category = isset($data['payment_category']) && $data['payment_category'] !== '' ? (string)$data['payment_category'] : ($inc['payment_category'] ?? 'Bank Transfer');
        $utr = isset($data['utr_no']) && $data['utr_no'] !== '' ? trim((string)$data['utr_no']) : ($inc['utr_no'] ?? null);

        // Post the on-books incentive to the expense ledger → P&L.
        $expenseCode = null;
        try {
            $count = Database::count('SELECT COUNT(*) AS cnt FROM expenses');
            $expenseCode = 'EXP-' . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);
            Database::insert(
                'INSERT INTO expenses
                    (expense_code, expense_date, category, vendor, description, amount, payment_mode, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $expenseCode,
                    $paidOn,
                    'Incentive',
                    $inc['person_name'],
                    'Incentive (' . $inc['basis'] . ')' . ($inc['period'] ? ' — ' . $inc['period'] : ''),
                    $inc['amount'],
                    $category,
                    $data['created_by'] ?? null,
                ]
            );
        } catch (\Throwable $e) {
            $expenseCode = null; // expense posting is best-effort
        }

        Database::execute(
            "UPDATE incentives SET status = 'paid', paid_on = ?, payment_category = ?, utr_no = ?, expense_code = ? WHERE id = ?",
            [$paidOn, $category, $utr, $expenseCode, $id]
        );
        return self::find($id);
    }

    public static function delete(int $id): bool
    {
        return Database::execute("DELETE FROM incentives WHERE id = ?", [$id]) >= 0;
    }
}
