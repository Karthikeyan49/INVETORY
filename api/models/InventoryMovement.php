<?php
declare(strict_types=1);

/**
 * Smart Inventory — movement ledger (inventory_stock_movements) and the audit
 * journal (inventory_audit_log).
 *
 * Movements are append-only; corrections are new rows, never edits. The ledger
 * does not touch balances itself — the controller pairs recordMovement() with
 * InventoryStock::upsertStock() inside one transaction.
 */
class InventoryMovement
{
    public const TYPES = [
        'STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'ADJUSTMENT', 'DAMAGE', 'RETURN',
        'PRODUCTION_USE', 'DEALER_ALLOCATION', 'EMPLOYEE_ISSUE', 'EMERGENCY_USE',
    ];

    public const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

    public static function recordMovement(array $data): int
    {
        $quantity = (float)$data['quantity'];
        $unitCost = (float)($data['unit_cost'] ?? 0);

        return Database::insert(
            "INSERT INTO inventory_stock_movements
                (inv_product_id, zone_id, movement_type, quantity, unit_cost, total_value,
                 reference_type, reference_id, dealer_id, moved_by, approved_by,
                 approval_status, remarks, attachment_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (int)$data['inv_product_id'],
                (int)$data['zone_id'],
                (string)$data['movement_type'],
                $quantity,
                $unitCost,
                round($quantity * $unitCost, 2),
                isset($data['reference_type']) && $data['reference_type'] !== ''
                    ? (string)$data['reference_type'] : null,
                isset($data['reference_id']) && $data['reference_id'] !== ''
                    ? (int)$data['reference_id'] : null,
                isset($data['dealer_id']) && $data['dealer_id'] !== '' ? (int)$data['dealer_id'] : null,
                isset($data['moved_by']) && $data['moved_by'] !== '' ? (int)$data['moved_by'] : null,
                isset($data['approved_by']) && $data['approved_by'] !== '' ? (int)$data['approved_by'] : null,
                (string)($data['approval_status'] ?? 'APPROVED'),
                isset($data['remarks']) && $data['remarks'] !== '' ? trim((string)$data['remarks']) : null,
                isset($data['attachment_url']) && $data['attachment_url'] !== ''
                    ? (string)$data['attachment_url'] : null,
            ]
        );
    }

    public static function getMovementsByProduct(int $productId, array $filters = []): array
    {
        $where = ['m.inv_product_id = ?'];
        $params = [$productId];

        if (!empty($filters['movement_type'])) {
            $where[] = 'm.movement_type = ?';
            $params[] = (string)$filters['movement_type'];
        }
        if (!empty($filters['zone_id'])) {
            $where[] = 'm.zone_id = ?';
            $params[] = (int)$filters['zone_id'];
        }
        if (!empty($filters['approval_status'])) {
            $where[] = 'm.approval_status = ?';
            $params[] = (string)$filters['approval_status'];
        }
        if (!empty($filters['from'])) {
            $where[] = 'm.created_at >= ?';
            $params[] = (string)$filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'm.created_at <= ?';
            $params[] = (string)$filters['to'];
        }

        $whereClause = implode(' AND ', $where);
        $rows = Database::fetchAll(
            "SELECT m.*, z.zone_name, z.zone_code, u.name AS moved_by_name
             FROM inventory_stock_movements m
             JOIN inventory_zones z ON z.zone_id = m.zone_id
             LEFT JOIN users u ON u.user_id = m.moved_by
             WHERE $whereClause
             ORDER BY m.created_at DESC, m.movement_id DESC",
            $params
        );
        return $rows;
    }

    public static function getMovementsByZone(int $zoneId): array
    {
        return Database::fetchAll(
            "SELECT m.*, p.name AS product_name, p.sku, u.name AS moved_by_name
             FROM inventory_stock_movements m
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             LEFT JOIN users u ON u.user_id = m.moved_by
             WHERE m.zone_id = ?
             ORDER BY m.created_at DESC, m.movement_id DESC",
            [$zoneId]
        );
    }

    public static function getPendingApprovals(): array
    {
        return Database::fetchAll(
            "SELECT m.*, a.approval_id, p.name AS product_name, p.sku, z.zone_name, z.zone_code,
                    u.name AS moved_by_name
             FROM inventory_stock_movements m
             JOIN inventory_approvals a ON a.movement_id = m.movement_id AND a.approval_status = 'PENDING'
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             JOIN inventory_zones z ON z.zone_id = m.zone_id
             LEFT JOIN users u ON u.user_id = m.moved_by
             WHERE m.approval_status = 'PENDING'
             ORDER BY m.created_at ASC, m.movement_id ASC",
            []
        );
    }

    public static function getMovementById(int $id): ?array
    {
        $row = Database::fetch(
            "SELECT m.*, p.name AS product_name, p.sku, z.zone_name, z.zone_code
             FROM inventory_stock_movements m
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             JOIN inventory_zones z ON z.zone_id = m.zone_id
             WHERE m.movement_id = ?
             LIMIT 1",
            [$id]
        );
        return $row ?: null;
    }

    public static function updateApprovalStatus(int $id, string $status, ?int $approvedBy): bool
    {
        return Database::execute(
            "UPDATE inventory_stock_movements
             SET approval_status = ?, approved_by = ?
             WHERE movement_id = ?",
            [$status, $approvedBy, $id]
        ) > 0;
    }

    /**
     * Append a row to inventory_audit_log. Callers already hold the request, so
     * performed_by / ip are passed in explicitly to keep this static and simple.
     */
    public static function audit(
        string $table,
        int $recordId,
        string $action,
        ?array $oldValue,
        ?array $newValue,
        ?int $performedBy,
        ?string $ip
    ): void {
        Database::insert(
            "INSERT INTO inventory_audit_log
                (table_name, record_id, action_type, old_value, new_value, performed_by, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                $table,
                $recordId,
                $action,
                $oldValue !== null ? json_encode($oldValue, JSON_UNESCAPED_UNICODE) : null,
                $newValue !== null ? json_encode($newValue, JSON_UNESCAPED_UNICODE) : null,
                $performedBy,
                $ip,
            ]
        );
    }
}
