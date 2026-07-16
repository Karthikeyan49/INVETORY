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

        $id = Database::insert(
            "INSERT INTO stampings
                (machine_id, customer_id, certificate_no, stamp_date, expiry_date, quarter, total_amount, extra_amount, status, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (int)$data['machine_id'],
                !empty($data['customer_id']) ? (int)$data['customer_id'] : null,
                isset($data['certificate_no']) ? trim((string)$data['certificate_no']) : null,
                $stampDate,
                $expiryDate,
                $data['quarter'] ?? self::quarterOf($stampDate),
                max(0.0, (float)($data['total_amount'] ?? 0)),
                max(0.0, (float)($data['extra_amount'] ?? 0)),
                in_array($data['status'] ?? '', self::STATUSES, true) ? $data['status'] : ($stampDate ? 'stamped' : 'pending'),
                isset($data['notes']) ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );

        // Optional stamping advance recorded through the shared installment ledger.
        $advance = isset($data['advance']) ? (float)$data['advance'] : 0.0;
        if ($advance > 0 && class_exists('PaymentInstallment')) {
            PaymentInstallment::record('stamping', $id, [
                'amount'     => $advance,
                'category'   => $data['payment_category'] ?? 'Cash',
                'utr_no'     => $data['utr_no'] ?? null,
                'paid_on'    => $stampDate ?? date('Y-m-d'),
                'seq'        => 0,
                'label'      => 'Advance',
                'created_by' => $data['created_by'] ?? null,
            ]);
        }
        return $id;
    }

    /**
     * Edit the non-money fields of a stamping (certificate no, stamp date, notes).
     * Changing the stamp date recomputes the expiry + quarter and promotes a
     * still-pending record to 'stamped'. Money fields go through updateFee().
     */
    public static function update(int $id, array $data): bool
    {
        $fields = [];
        $params = [];
        if (array_key_exists('certificate_no', $data)) {
            $cert = trim((string)($data['certificate_no'] ?? ''));
            $fields[] = 'certificate_no = ?';
            $params[] = $cert !== '' ? $cert : null;
        }
        if (array_key_exists('notes', $data)) {
            $notes = trim((string)($data['notes'] ?? ''));
            $fields[] = 'notes = ?';
            $params[] = $notes !== '' ? $notes : null;
        }
        if (array_key_exists('stamp_date', $data)) {
            $stampDate = !empty($data['stamp_date']) ? (string)$data['stamp_date'] : null;
            $fields[] = 'stamp_date = ?';   $params[] = $stampDate;
            $fields[] = 'expiry_date = ?';  $params[] = self::computeExpiry($stampDate);
            $fields[] = 'quarter = ?';      $params[] = self::quarterOf($stampDate);
            if ($stampDate) {
                // A date now exists — promote a pending record; leave others as-is.
                $fields[] = "status = CASE WHEN status = 'pending' THEN 'stamped' ELSE status END";
            }
        }
        if (!$fields) {
            return false;
        }
        $params[] = $id;
        return Database::execute("UPDATE stampings SET " . implode(', ', $fields) . " WHERE id = ?", $params) >= 0;
    }

    /** The current active (non-renewed, non-expired) stamping for a machine, if any. */
    public static function activeForMachine(int $machineId): ?array
    {
        return Database::fetch(
            "SELECT id, certificate_no FROM stampings
             WHERE machine_id = ? AND status NOT IN ('renewed','expired')
             ORDER BY id DESC LIMIT 1",
            [$machineId]
        );
    }

    /** Update the fee / extra amount on a stamping record (R9 / T5). */
    public static function updateFee(int $id, array $data): bool
    {
        $fields = [];
        $params = [];
        if (array_key_exists('total_amount', $data)) {
            $fields[] = 'total_amount = ?';
            $params[] = max(0.0, (float)$data['total_amount']);
        }
        if (array_key_exists('extra_amount', $data)) {
            $fields[] = 'extra_amount = ?';
            $params[] = max(0.0, (float)$data['extra_amount']);
        }
        if (!$fields) {
            return false;
        }
        $params[] = $id;
        return Database::execute("UPDATE stampings SET " . implode(', ', $fields) . " WHERE id = ?", $params) >= 0;
    }

    /** Enrich stamping rows with tax-gated paid/outstanding from the ledger. */
    public static function attachLedger(array $rows, bool $extended): array
    {
        if (!class_exists('PaymentInstallment')) {
            return $rows;
        }
        $paidMap = PaymentInstallment::paidTotalsByType('stamping');
        foreach ($rows as &$r) {
            $r = self::withLedgerRow($r, $extended, $paidMap);
        }
        unset($r);
        return $rows;
    }

    public static function withLedgerRow(array $r, bool $extended, ?array $paidMap = null): array
    {
        if ($paidMap === null) {
            $paidMap = class_exists('PaymentInstallment') ? PaymentInstallment::paidTotalsByType('stamping') : [];
        }
        $total = (float)($r['total_amount'] ?? 0);
        $extra = $extended ? (float)($r['extra_amount'] ?? 0) : 0.0;
        $grand = round($total + $extra, 2);
        $paid  = (float)($paidMap[(int)$r['id']] ?? 0);
        $r['total_amount']   = round($total, 2);
        $r['grand_total']    = $grand;
        $r['amount_paid']    = round($paid, 2);
        $r['outstanding']    = round(max(0.0, $grand - $paid), 2);
        $r['payment_status'] = $paid <= 0.005 ? 'unpaid' : ($r['outstanding'] <= 0.005 ? 'paid' : 'partial');
        if (!$extended) {
            unset($r['extra_amount']);
        } else {
            $r['extra_amount'] = round((float)($r['extra_amount'] ?? 0), 2);
        }
        return $r;
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

    /**
     * Renew: close the current stamp and open a fresh one-year window. $feeData
     * (total_amount / advance / payment_category / utr_no / extra_amount /
     * created_by) carries the renewal fee + any payment straight into the new
     * period's ledger, same as a fresh stamping — trailing array wins so the
     * caller can't override machine identity via feeData.
     */
    public static function renew(int $id, ?string $newStampDate = null, array $feeData = []): bool
    {
        $current = self::find($id);
        if (!$current) {
            return false;
        }
        $date = $newStampDate ?: date('Y-m-d');
        Database::execute("UPDATE stampings SET status = 'renewed' WHERE id = ?", [$id]);
        self::create(array_merge($feeData, [
            'machine_id'  => (int)$current['machine_id'],
            'customer_id' => $current['customer_id'] ? (int)$current['customer_id'] : null,
            'stamp_date'  => $date,
            'status'      => 'stamped',
        ]));
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

    /**
     * Called when a machine is pulled back out of a delivered/on-delivery state
     * (e.g. a wrong dispatch reverted). Removes the auto-opened stamping so it
     * stops raising false "renewal due" alerts for a machine that is no longer
     * with a customer. Only untouched auto-stampings are removed — any stamping
     * with a real certificate or a recorded payment is kept intact.
     */
    public static function cancelForMachine(int $machineId): int
    {
        $rows = Database::fetchAll(
            "SELECT id, certificate_no FROM stampings
             WHERE machine_id = ? AND status NOT IN ('renewed','expired')",
            [$machineId]
        );
        if (!$rows) {
            return 0;
        }
        $paidMap = class_exists('PaymentInstallment') ? PaymentInstallment::paidTotalsByType('stamping') : [];
        $removed = 0;
        foreach ($rows as $r) {
            $id = (int)$r['id'];
            $hasCert = trim((string)($r['certificate_no'] ?? '')) !== '';
            $paid    = (float)($paidMap[$id] ?? 0);
            if ($hasCert || $paid > 0.005) {
                continue; // real work recorded — leave it alone
            }
            Database::execute("DELETE FROM stampings WHERE id = ?", [$id]);
            $removed++;
        }
        return $removed;
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
