<?php
declare(strict_types=1);

/**
 * MachineMovement — a per-machine activity log (added, status change, part
 * moved, billed…). Surfaced on the Machines page so each machine's movement
 * history is visible.
 */
class MachineMovement
{
    public static function log(
        int $machineId,
        string $type,
        ?string $description = null,
        ?string $fromStatus = null,
        ?string $toStatus = null,
        ?int $createdBy = null
    ): void {
        try {
            Database::insert(
                "INSERT INTO machine_movements (machine_id, movement_type, description, from_status, to_status, created_by)
                 VALUES (?, ?, ?, ?, ?, ?)",
                [$machineId, $type, $description, $fromStatus, $toStatus, $createdBy]
            );
        } catch (\Throwable $e) {
            error_log('[MachineMovement::log] ' . $e->getMessage());
        }
    }

    /** @return array all movement rows across every machine, newest first. */
    public static function all(array $filters = [], int $limit = 300): array
    {
        $where  = [];
        $params = [];
        if (!empty($filters['search'])) {
            $where[] = '(m.code LIKE ? OR m.model LIKE ? OR mm.description LIKE ? OR mm.movement_type LIKE ?)';
            $like = '%' . $filters['search'] . '%';
            array_push($params, $like, $like, $like, $like);
        }
        if (!empty($filters['type'])) {
            $where[] = 'mm.movement_type = ?';
            $params[] = (string)$filters['type'];
        }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $limit  = max(1, min(1000, $limit));
        return Database::fetchAll(
            "SELECT mm.*, m.code AS machine_code, m.model AS machine_model, u.name AS by_name
             FROM machine_movements mm
             LEFT JOIN machines m ON m.id = mm.machine_id
             LEFT JOIN users u ON u.user_id = mm.created_by
             $clause
             ORDER BY mm.created_at DESC, mm.id DESC
             LIMIT $limit",
            $params
        );
    }

    /** @return array movement rows for one machine, newest first. */
    public static function forMachine(int $machineId): array
    {
        return Database::fetchAll(
            "SELECT mm.*, u.name AS by_name
             FROM machine_movements mm
             LEFT JOIN users u ON u.user_id = mm.created_by
             WHERE mm.machine_id = ?
             ORDER BY mm.created_at DESC, mm.id DESC",
            [$machineId]
        );
    }
}
