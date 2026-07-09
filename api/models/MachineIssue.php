<?php
declare(strict_types=1);

/**
 * MachineIssue — service / fault tracking for machines.
 *
 * Opening an issue takes the machine OUT of available stock (status
 * 'maintenance') and surfaces it on the Issues page with its current PLACE
 * (where it physically is) and PROCESS (repair stage). Resolving the last open
 * issue returns the machine to 'in_stock' so it reappears on the Machines page.
 */
class MachineIssue
{
    public const STATUSES = ['open', 'in_progress', 'resolved'];

    /** Suggested repair stages (free-text — not enforced). */
    public const STAGES = ['Reported', 'Diagnosing', 'Awaiting Parts', 'In Repair', 'Testing', 'Ready'];

    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 100): array
    {
        $where  = [];
        $params = [];
        if (!empty($filters['status'])) {
            $where[] = 'i.status = ?';
            $params[] = (string)$filters['status'];
        }
        if (!empty($filters['machine_id'])) {
            $where[] = 'i.machine_id = ?';
            $params[] = (int)$filters['machine_id'];
        }
        if (!empty($filters['search'])) {
            $where[] = '(m.code LIKE ? OR m.model LIKE ? OR i.title LIKE ? OR i.place LIKE ?)';
            $like = '%' . $filters['search'] . '%';
            array_push($params, $like, $like, $like, $like);
        }

        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM machine_issues i LEFT JOIN machines m ON m.id = i.machine_id $clause", $params);

        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT i.*, m.code AS machine_code, m.model AS machine_model,
                    m.category AS machine_category, m.status AS machine_status
             FROM machine_issues i
             LEFT JOIN machines m ON m.id = i.machine_id
             $clause
             ORDER BY (i.status = 'resolved'), i.created_at DESC
             LIMIT $limit OFFSET $offset",
            $params
        );
        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        return Database::fetch(
            "SELECT i.*, m.code AS machine_code, m.model AS machine_model, m.status AS machine_status
             FROM machine_issues i LEFT JOIN machines m ON m.id = i.machine_id
             WHERE i.id = ? LIMIT 1",
            [$id]
        );
    }

    public static function create(array $data): int
    {
        $status = in_array($data['status'] ?? '', self::STATUSES, true) ? $data['status'] : 'open';
        $id = Database::insert(
            "INSERT INTO machine_issues (machine_id, title, description, place, process, status, reported_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (int)$data['machine_id'],
                trim((string)$data['title']),
                isset($data['description']) && $data['description'] !== '' ? trim((string)$data['description']) : null,
                isset($data['place']) && $data['place'] !== '' ? trim((string)$data['place']) : null,
                isset($data['process']) && $data['process'] !== '' ? trim((string)$data['process']) : 'Reported',
                $status,
                !empty($data['reported_by']) ? (int)$data['reported_by'] : null,
            ]
        );
        // Take the machine out of available stock while the issue is open.
        if ($status !== 'resolved') {
            self::setMachineStatus((int)$data['machine_id'], 'maintenance');
        }
        self::logMovement((int)$data['machine_id'], 'Issue reported: ' . trim((string)$data['title']), $data['reported_by'] ?? null);
        return $id;
    }

    /** Mirror an issue event into the machine movement log (short form). */
    private static function logMovement(int $machineId, string $desc, $by = null): void
    {
        if (class_exists('MachineMovement')) {
            MachineMovement::log($machineId, 'issue', $desc, null, null, $by ? (int)$by : null);
        }
    }

    /** Update editable fields; keeps the machine status in sync with the issue status. */
    public static function update(int $id, array $data): bool
    {
        $issue = self::find($id);
        if (!$issue) {
            return false;
        }

        $map = ['title' => 'title', 'description' => 'description', 'place' => 'place', 'process' => 'process'];
        $fields = [];
        $params = [];
        foreach ($map as $in => $col) {
            if (!array_key_exists($in, $data)) {
                continue;
            }
            $val = $data[$in];
            $fields[] = "$col = ?";
            $params[] = ($val === '' || $val === null) ? null : trim((string)$val);
        }

        if (array_key_exists('status', $data) && in_array($data['status'], self::STATUSES, true)) {
            $fields[] = 'status = ?';
            $params[] = $data['status'];
            $fields[] = 'resolved_at = ' . ($data['status'] === 'resolved' ? 'NOW()' : 'NULL');
        }

        if (!$fields) {
            return false;
        }
        $params[] = $id;
        Database::execute("UPDATE machine_issues SET " . implode(', ', $fields) . " WHERE id = ?", $params);

        // Re-sync the machine: back to stock only when it has no more open issues.
        self::syncMachine((int)$issue['machine_id']);

        // Log meaningful transitions into the movement feed (short form).
        if (array_key_exists('status', $data) && $data['status'] !== ($issue['status'] ?? null)) {
            $label = $data['status'] === 'resolved' ? 'Issue resolved: ' : 'Issue ' . $data['status'] . ': ';
            self::logMovement((int)$issue['machine_id'], $label . (string)($issue['title'] ?? ''));
        } elseif (array_key_exists('process', $data) && $data['process'] && $data['process'] !== ($issue['process'] ?? null)) {
            self::logMovement((int)$issue['machine_id'], 'Issue stage → ' . (string)$data['process'] . ' (' . (string)($issue['title'] ?? '') . ')');
        }
        return true;
    }

    /** Mark resolved and (if it was the last open issue) return the machine to stock. */
    public static function resolve(int $id): bool
    {
        $issue = self::find($id);
        if (!$issue) {
            return false;
        }
        Database::execute("UPDATE machine_issues SET status = 'resolved', resolved_at = NOW() WHERE id = ?", [$id]);
        self::syncMachine((int)$issue['machine_id']);
        self::logMovement((int)$issue['machine_id'], 'Issue resolved: ' . (string)($issue['title'] ?? ''));
        return true;
    }

    /** Reopen a resolved issue — puts the machine back into maintenance. */
    public static function reopen(int $id): bool
    {
        $issue = self::find($id);
        if (!$issue) {
            return false;
        }
        Database::execute("UPDATE machine_issues SET status = 'open', resolved_at = NULL WHERE id = ?", [$id]);
        self::syncMachine((int)$issue['machine_id']);
        return true;
    }

    public static function destroy(int $id): bool
    {
        $issue = self::find($id);
        if (!$issue) {
            return false;
        }
        Database::execute("DELETE FROM machine_issues WHERE id = ?", [$id]);
        self::syncMachine((int)$issue['machine_id']);
        return true;
    }

    public static function openCount(): int
    {
        return Database::count("SELECT COUNT(*) AS cnt FROM machine_issues WHERE status <> 'resolved'");
    }

    /**
     * Reconcile a machine's status with its issues: 'maintenance' while any
     * issue is unresolved, else 'in_stock' (unless it has already moved on to
     * reserved/on_delivery/delivered — those are never overridden).
     */
    private static function syncMachine(int $machineId): void
    {
        $open = Database::count(
            "SELECT COUNT(*) AS cnt FROM machine_issues WHERE machine_id = ? AND status <> 'resolved'",
            [$machineId]
        );
        $current = Database::fetch("SELECT status FROM machines WHERE id = ? LIMIT 1", [$machineId]);
        if (!$current) {
            return;
        }
        if ($open > 0) {
            if ($current['status'] === 'in_stock') {
                self::setMachineStatus($machineId, 'maintenance');
            }
        } elseif ($current['status'] === 'maintenance') {
            self::setMachineStatus($machineId, 'in_stock');
        }
    }

    private static function setMachineStatus(int $machineId, string $status): void
    {
        Database::execute("UPDATE machines SET status = ? WHERE id = ?", [$status, $machineId]);
    }
}
