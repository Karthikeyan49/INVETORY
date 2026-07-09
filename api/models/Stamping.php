<?php
declare(strict_types=1);

/**
 * Stamping — legal-metrology stamping / verification per machine, with renewal
 * tracking (requirement.txt — Module 2). Weighing machines must be re-stamped
 * (typically yearly); this table drives the dashboard "renewal due" alerts.
 */
class Stamping
{
    public const STATUSES = ['pending', 'stamped', 'due', 'expired', 'renewed'];

    /** Validity window in months before a stamp must be renewed. */
    public const VALIDITY_MONTHS = 12;

    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 50): array
    {
        self::refreshStatuses();

        $where  = [];
        $params = [];
        if (!empty($filters['status'])) {
            $where[] = 's.status = ?';
            $params[] = (string)$filters['status'];
        }
        if (!empty($filters['machine_id'])) {
            $where[] = 's.machine_id = ?';
            $params[] = (int)$filters['machine_id'];
        }
        if (!empty($filters['search'])) {
            $where[] = '(m.code LIKE ? OR s.certificate_no LIKE ?)';
            $params[] = '%' . $filters['search'] . '%';
            $params[] = '%' . $filters['search'] . '%';
        }

        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM stampings s LEFT JOIN machines m ON m.id = s.machine_id $clause", $params);

        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT s.*, m.code AS machine_code, m.model AS machine_model, m.category AS machine_category
             FROM stampings s
             LEFT JOIN machines m ON m.id = s.machine_id
             $clause
             ORDER BY s.expiry_date IS NULL, s.expiry_date ASC
             LIMIT $limit OFFSET $offset",
            $params
        );
        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        return Database::fetch(
            "SELECT s.*, m.code AS machine_code, m.model AS machine_model
             FROM stampings s LEFT JOIN machines m ON m.id = s.machine_id
             WHERE s.id = ? LIMIT 1",
            [$id]
        );
    }

    public static function create(array $data): int
    {
        $stampDate  = !empty($data['stamp_date']) ? (string)$data['stamp_date'] : null;
        $expiryDate = !empty($data['expiry_date'])
            ? (string)$data['expiry_date']
            : self::computeExpiry($stampDate);

        return Database::insert(
            "INSERT INTO stampings
                (machine_id, customer_id, certificate_no, stamp_date, expiry_date, quarter, status, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (int)$data['machine_id'],
                !empty($data['customer_id']) ? (int)$data['customer_id'] : null,
                isset($data['certificate_no']) ? trim((string)$data['certificate_no']) : null,
                $stampDate,
                $expiryDate,
                $data['quarter'] ?? self::quarterOf($stampDate),
                in_array($data['status'] ?? '', self::STATUSES, true) ? $data['status'] : ($stampDate ? 'stamped' : 'pending'),
                isset($data['notes']) ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    /**
     * Auto-create a stamping record when a machine is sold/delivered (Module 2).
     * Skips if the machine already has an active (non-renewed) stamping.
     */
    public static function createForMachine(int $machineId, ?string $soldDate, ?int $customerId = null): void
    {
        $exists = Database::fetch(
            "SELECT id FROM stampings WHERE machine_id = ? AND status NOT IN ('renewed','expired') LIMIT 1",
            [$machineId]
        );
        if ($exists) {
            return;
        }
        $date = $soldDate ?: date('Y-m-d');
        self::create([
            'machine_id'  => $machineId,
            'customer_id' => $customerId,
            'stamp_date'  => $date,
            'status'      => 'stamped',
            'created_by'  => null,
        ]);
    }

    /** Renew: close the current stamp and open a fresh one-year window. */
    public static function renew(int $id, ?string $newStampDate = null): bool
    {
        $current = self::find($id);
        if (!$current) {
            return false;
        }
        $date = $newStampDate ?: date('Y-m-d');
        Database::execute("UPDATE stampings SET status = 'renewed' WHERE id = ?", [$id]);
        self::create([
            'machine_id'  => (int)$current['machine_id'],
            'customer_id' => $current['customer_id'] ? (int)$current['customer_id'] : null,
            'stamp_date'  => $date,
            'status'      => 'stamped',
        ]);
        return true;
    }

    public static function updateStatus(int $id, string $status): bool
    {
        if (!in_array($status, self::STATUSES, true)) {
            return false;
        }
        Database::execute("UPDATE stampings SET status = ? WHERE id = ?", [$status, $id]);
        return true;
    }

    /** Records whose renewal falls within $days (or already lapsed) — drives alerts. */
    public static function due(int $days = 30): array
    {
        self::refreshStatuses();
        return Database::fetchAll(
            "SELECT s.*, m.code AS machine_code, m.model AS machine_model
             FROM stampings s LEFT JOIN machines m ON m.id = s.machine_id
             WHERE s.status IN ('due','expired')
                OR (s.expiry_date IS NOT NULL AND s.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
                    AND s.status NOT IN ('renewed'))
             ORDER BY s.expiry_date ASC",
            [$days]
        );
    }

    public static function dueCount(int $days = 30): int
    {
        return count(self::due($days));
    }

    /**
     * Dashboard alert buckets:
     *   overdue  — expiry date already passed (renewal overdue)
     *   due_soon — expiry within the next 7 days (the "before a week" reminder)
     *   pending  — stamping not done yet (no stamp date)
     */
    public static function alerts(int $soonDays = 7): array
    {
        self::refreshStatuses();
        $withMachine = "s.*, m.code AS machine_code, m.model AS machine_model, m.category AS machine_category";

        $overdue = Database::fetchAll(
            "SELECT $withMachine FROM stampings s LEFT JOIN machines m ON m.id = s.machine_id
             WHERE s.expiry_date IS NOT NULL AND s.expiry_date < CURDATE()
               AND s.status NOT IN ('renewed')
             ORDER BY s.expiry_date ASC"
        );
        $dueSoon = Database::fetchAll(
            "SELECT $withMachine FROM stampings s LEFT JOIN machines m ON m.id = s.machine_id
             WHERE s.expiry_date IS NOT NULL AND s.expiry_date >= CURDATE()
               AND s.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
               AND s.status NOT IN ('renewed')
             ORDER BY s.expiry_date ASC",
            [$soonDays]
        );
        $pending = Database::fetchAll(
            "SELECT $withMachine FROM stampings s LEFT JOIN machines m ON m.id = s.machine_id
             WHERE (s.stamp_date IS NULL OR s.status = 'pending')
               AND s.status NOT IN ('renewed')
             ORDER BY s.created_at DESC"
        );
        return [
            'overdue'  => $overdue,
            'due_soon' => $dueSoon,
            'pending'  => $pending,
            'counts'   => ['overdue' => count($overdue), 'due_soon' => count($dueSoon), 'pending' => count($pending)],
        ];
    }

    /** Roll forward status flags based on today's date (idempotent). */
    private static function refreshStatuses(): void
    {
        Database::execute(
            "UPDATE stampings SET status = 'expired'
             WHERE expiry_date IS NOT NULL AND expiry_date < CURDATE()
               AND status NOT IN ('renewed','expired')"
        );
        Database::execute(
            "UPDATE stampings SET status = 'due'
             WHERE expiry_date IS NOT NULL
               AND expiry_date >= CURDATE()
               AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
               AND status = 'stamped'"
        );
    }

    private static function computeExpiry(?string $stampDate): ?string
    {
        if (!$stampDate) {
            return null;
        }
        $ts = strtotime($stampDate . ' +' . self::VALIDITY_MONTHS . ' months');
        return $ts ? date('Y-m-d', $ts) : null;
    }

    private static function quarterOf(?string $date): ?string
    {
        if (!$date) {
            return null;
        }
        $ts = strtotime($date);
        if (!$ts) {
            return null;
        }
        $q = (int)ceil((int)date('n', $ts) / 3);
        return 'Q' . $q . '-' . date('Y', $ts);
    }
}
