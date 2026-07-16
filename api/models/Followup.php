<?php
declare(strict_types=1);

/**
 * Followup — salesperson follow-up reminders (requirement.txt — Module 6).
 * When a customer reschedules / needs a callback, a follow-up is logged and
 * surfaced on both the admin and the assigned salesperson's dashboard.
 */
class Followup
{
    public const STATUSES = ['open', 'done', 'snoozed'];

    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 50): array
    {
        $where  = [];
        $params = [];
        if (!empty($filters['status'])) {
            $where[] = 'f.status = ?';
            $params[] = (string)$filters['status'];
        }
        if (!empty($filters['assigned_to'])) {
            $where[] = 'f.assigned_to = ?';
            $params[] = (int)$filters['assigned_to'];
        }
        if (!empty($filters['category'])) {
            $where[] = 'f.category = ?';
            $params[] = (string)$filters['category'];
        }
        if (!empty($filters['search'])) {
            $where[] = '(f.title LIKE ? OR f.customer_name LIKE ?)';
            $params[] = '%' . $filters['search'] . '%';
            $params[] = '%' . $filters['search'] . '%';
        }

        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM followups f $clause", $params);

        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT f.*, u.name AS assigned_name, m.code AS machine_code
             FROM followups f
             LEFT JOIN users u ON u.user_id = f.assigned_to
             LEFT JOIN machines m ON m.id = f.machine_id
             $clause
             ORDER BY f.status = 'done', f.followup_date IS NULL, f.followup_date ASC
             LIMIT $limit OFFSET $offset",
            $params
        );
        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        return Database::fetch(
            "SELECT f.*, u.name AS assigned_name FROM followups f
             LEFT JOIN users u ON u.user_id = f.assigned_to WHERE f.id = ? LIMIT 1",
            [$id]
        );
    }

    public static function create(array $data): int
    {
        return Database::insert(
            "INSERT INTO followups
                (customer_id, customer_name, mobile, machine_id, assigned_to, title, category, note, followup_date, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                !empty($data['customer_id']) ? (int)$data['customer_id'] : null,
                isset($data['customer_name']) ? trim((string)$data['customer_name']) : null,
                isset($data['mobile']) && $data['mobile'] !== '' ? trim((string)$data['mobile']) : null,
                !empty($data['machine_id']) ? (int)$data['machine_id'] : null,
                !empty($data['assigned_to']) ? (int)$data['assigned_to'] : null,
                trim((string)$data['title']),
                isset($data['category']) && $data['category'] !== '' ? trim((string)$data['category']) : null,
                isset($data['note']) ? trim((string)$data['note']) : null,
                !empty($data['followup_date']) ? (string)$data['followup_date'] : null,
                in_array($data['status'] ?? '', self::STATUSES, true) ? $data['status'] : 'open',
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function update(int $id, array $data): bool
    {
        $map = [
            'customer_name' => 'customer_name', 'mobile' => 'mobile', 'machine_id' => 'machine_id',
            'assigned_to' => 'assigned_to', 'title' => 'title', 'category' => 'category',
            'note' => 'note', 'followup_date' => 'followup_date', 'status' => 'status',
        ];
        $fields = [];
        $params = [];
        foreach ($map as $in => $col) {
            if (!array_key_exists($in, $data)) {
                continue;
            }
            $value = $data[$in];
            if (in_array($col, ['machine_id', 'assigned_to'], true)) {
                $value = $value !== '' && $value !== null ? (int)$value : null;
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
        return Database::execute("UPDATE followups SET " . implode(', ', $fields) . " WHERE id = ?", $params) >= 0;
    }

    /**
     * Cross-source dedup for lead seeding (e.g. the same prospect logged in two
     * DCRs): is there already an OPEN follow-up for this mobile or name? Mobile
     * match ignores spaces / dashes / plus so "+91 98…" and "98…" collapse.
     */
    public static function openLeadExists(?string $mobile, ?string $customerName): bool
    {
        $digits = $mobile !== null ? preg_replace('/[^0-9]/', '', $mobile) : '';
        if ($digits !== '') {
            $hit = Database::fetch(
                "SELECT id FROM followups
                 WHERE status = 'open' AND mobile IS NOT NULL
                   AND REGEXP_REPLACE(mobile, '[^0-9]', '') = ?
                 LIMIT 1",
                [$digits]
            );
            if ($hit) {
                return true;
            }
        }
        $name = $customerName !== null ? trim($customerName) : '';
        if ($name !== '') {
            $hit = Database::fetch(
                "SELECT id FROM followups WHERE status = 'open' AND LOWER(customer_name) = LOWER(?) LIMIT 1",
                [$name]
            );
            if ($hit) {
                return true;
            }
        }
        return false;
    }

    /** Open follow-ups due today or overdue — drives both dashboards. */
    public static function due(?int $assignedTo = null, int $days = 0): array
    {
        $params = [$days];
        $scope = '';
        if ($assignedTo) {
            $scope = ' AND f.assigned_to = ?';
            $params[] = $assignedTo;
        }
        return Database::fetchAll(
            "SELECT f.*, u.name AS assigned_name, m.code AS machine_code
             FROM followups f
             LEFT JOIN users u ON u.user_id = f.assigned_to
             LEFT JOIN machines m ON m.id = f.machine_id
             WHERE f.status = 'open'
               AND (f.followup_date IS NULL OR f.followup_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY))
               $scope
             ORDER BY f.followup_date IS NULL, f.followup_date ASC",
            $params
        );
    }
}
