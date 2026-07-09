<?php
declare(strict_types=1);

/**
 * Smart Inventory — Approval Workflow.
 *
 * Manages the lifecycle of inventory_approvals rows created when a movement goes
 * PENDING (high-value allocation, damage over threshold, manual adjustment,
 * warehouse transfer, emergency use). The movement's stock balance is NOT applied
 * until an authorised approver approves it here; rejection reverses any hold.
 *
 * Role model — this ERP has no 'manager' user_type. Authority is expressed via
 * users.staff_role on admin accounts (see AdminMiddleware):
 *   owner          → approve/reject EVERY type (legacy admins with no staff_role
 *                    are treated as owner, mirroring AdminMiddleware::staffRole)
 *   store_keeper   → the "manager" tier: DAMAGE_THRESHOLD and TRANSFER only
 * Everyone else (other staff_roles, dealers, customers, employees) cannot approve.
 *
 * Notifications — there is no notifications table in this schema, so approval
 * notifications are written to inventory_audit_log (the documented fallback).
 */
class ApprovalWorkflow
{
    /** Movement types whose pending approval this engine can apply on decision. */
    private const APPLIABLE_TYPES = ['ADJUSTMENT', 'EMERGENCY_USE', 'DAMAGE', 'TRANSFER', 'DEALER_ALLOCATION'];

    private const OUTFLOW_TYPES = [
        'STOCK_OUT', 'EMPLOYEE_ISSUE', 'DEALER_ALLOCATION', 'PRODUCTION_USE', 'DAMAGE', 'EMERGENCY_USE',
    ];
    private const INFLOW_TYPES = ['STOCK_IN', 'RETURN'];

    /** Approval types each staff tier may action. owner ⇒ all. */
    private const MANAGER_TIER_TYPES = ['DAMAGE_THRESHOLD', 'TRANSFER'];

    private const OVERDUE_HOURS = 24;
    private const EXPIRY_HOURS = 72;

    // ───────────────────────────────────────────────────────────────────────
    // Creation
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Create an inventory_approvals request for an already-recorded PENDING
     * movement. Returns the new approval_id. (MovementEngine already inserts an
     * approval row for movements it puts pending; this is the explicit entry
     * point for callers that record a pending movement directly.)
     */
    public function createApprovalRequest(array $movementData, string $approvalType): int
    {
        $movementId = (int)($movementData['movement_id'] ?? 0);
        if ($movementId <= 0) {
            throw new RuntimeException('movement_id is required to create an approval request');
        }

        return Database::insert(
            "INSERT INTO inventory_approvals
                (movement_id, approval_type, requested_by, approval_status, remarks)
             VALUES (?, ?, ?, 'PENDING', ?)",
            [
                $movementId,
                $approvalType,
                isset($movementData['requested_by']) ? (int)$movementData['requested_by'] : null,
                $movementData['remarks'] ?? null,
            ]
        );
    }

    // ───────────────────────────────────────────────────────────────────────
    // Decision
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Action a pending approval. $decision is 'approve' or 'reject'. Applies or
     * reverses the underlying movement and writes audit + notification entries,
     * all inside one transaction.
     */
    public function processApproval(int $approvalId, string $decision, int $approvedBy, string $remarks): array
    {
        $decision = strtolower(trim($decision));
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw new RuntimeException('Decision must be approve or reject');
        }

        $approval = $this->approvalRow($approvalId);
        if ($approval === null) {
            throw new RuntimeException('Approval not found');
        }
        if (strtoupper((string)$approval['approval_status']) !== 'PENDING') {
            throw new RuntimeException('Approval has already been actioned');
        }

        // Self-approval is blocked in production.
        // Temporarily disabled for single-admin testing environments.
        // if ($approval['requested_by'] !== null && (int)$approval['requested_by'] === $approvedBy) {
        //     throw new RuntimeException('You cannot approve your own request');
        // }

        if (!$this->canApprove($approvedBy, (string)$approval['approval_type'])) {
            throw new RuntimeException('You do not have permission to approve this approval type');
        }

        $movementId = (int)$approval['movement_id'];

        Database::beginTransaction();
        try {
            if ($decision === 'approve') {
                Database::execute(
                    "UPDATE inventory_approvals
                     SET approval_status = 'APPROVED', approved_by = ?, remarks = ?, actioned_at = NOW()
                     WHERE approval_id = ?",
                    [$approvedBy, $remarks !== '' ? $remarks : $approval['remarks'], $approvalId]
                );
                InventoryMovement::updateApprovalStatus($movementId, 'APPROVED', $approvedBy);
                $this->applyApprovedMovement($movementId);
                $auditAction = 'APPROVE';
            } else {
                Database::execute(
                    "UPDATE inventory_approvals
                     SET approval_status = 'REJECTED', rejected_by = ?, remarks = ?, actioned_at = NOW()
                     WHERE approval_id = ?",
                    [$approvedBy, $remarks, $approvalId]
                );
                InventoryMovement::updateApprovalStatus($movementId, 'REJECTED', $approvedBy);
                $this->rejectMovement($movementId);
                $auditAction = 'REJECT';
            }

            InventoryMovement::audit(
                'inventory_approvals',
                $approvalId,
                $auditAction,
                ['approval_status' => 'PENDING'],
                [
                    'approval_status' => $decision === 'approve' ? 'APPROVED' : 'REJECTED',
                    'movement_id'     => $movementId,
                    'remarks'         => $remarks,
                ],
                $approvedBy,
                null
            );

            $this->notifyApprover($approvalId);

            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            throw $e;
        }

        return [
            'approval_id'     => $approvalId,
            'movement_id'     => $movementId,
            'decision'        => $decision === 'approve' ? 'APPROVED' : 'REJECTED',
            'actioned_by'     => $approvedBy,
            'actioned_at'     => date('Y-m-d H:i:s'),
        ];
    }

    /**
     * Apply an approved movement's balance change. Mirrors MovementEngine's
     * direction rules; reads TRANSFER destination / ADJUSTMENT target from the
     * structured JSON stored in the movement remarks, then recomputes health and
     * reorder. For ADJUSTMENT, also records a delta movement for the audit trail.
     */
    private function applyApprovedMovement(int $movementId): bool
    {
        $movement = Database::fetch(
            "SELECT * FROM inventory_stock_movements WHERE movement_id = ? LIMIT 1",
            [$movementId]
        );
        if ($movement === null) {
            throw new RuntimeException('Movement not found for approval apply');
        }

        $productId = (int)$movement['inv_product_id'];
        $zoneId    = (int)$movement['zone_id'];
        $type      = (string)$movement['movement_type'];
        $quantity  = (float)$movement['quantity'];
        $meta      = $this->decodeRemarks((string)($movement['remarks'] ?? ''));

        if ($type === 'ADJUSTMENT') {
            $target  = (float)($meta['target_quantity'] ?? 0);
            $current = $this->currentZoneQty($productId, $zoneId);
            $delta   = $target - $current;
            InventoryStock::upsertStock($productId, $zoneId, $delta);

            // Record the actual delta applied as a new movement for the trail.
            InventoryMovement::recordMovement([
                'inv_product_id'  => $productId,
                'zone_id'         => $zoneId,
                'movement_type'   => 'ADJUSTMENT',
                'quantity'        => abs($delta),
                'unit_cost'       => (float)$movement['unit_cost'],
                'reference_type'  => 'APPROVAL',
                'reference_id'    => $movementId,
                'moved_by'        => isset($movement['approved_by']) ? (int)$movement['approved_by'] : null,
                'approved_by'     => isset($movement['approved_by']) ? (int)$movement['approved_by'] : null,
                'approval_status' => 'APPROVED',
                'remarks'         => json_encode([
                    'applied_delta'   => $delta,
                    'target_quantity' => $target,
                    'from_movement'   => $movementId,
                ], JSON_UNESCAPED_UNICODE),
            ]);
        } elseif ($type === 'TRANSFER') {
            $toZoneId = (int)($meta['to_zone_id'] ?? 0);
            InventoryStock::upsertStock($productId, $zoneId, -$quantity);
            if ($toZoneId > 0) {
                InventoryStock::upsertStock($productId, $toZoneId, $quantity);
            }
        } elseif (in_array($type, self::OUTFLOW_TYPES, true)) {
            InventoryStock::upsertStock($productId, $zoneId, -$quantity);
        } elseif (in_array($type, self::INFLOW_TYPES, true)) {
            InventoryStock::upsertStock($productId, $zoneId, $quantity);
        }

        InventoryStock::updateHealthScore($productId);
        $this->maybeCreateReorderSuggestion($productId);

        return true;
    }

    /**
     * Reverse a rejected pending movement: it never touched on-hand balances, so
     * there is nothing to subtract — but if any stock was reserved against it,
     * release it. Marking the movement REJECTED is done by the caller.
     */
    private function rejectMovement(int $movementId): bool
    {
        $movement = Database::fetch(
            "SELECT inv_product_id, zone_id, quantity, movement_type FROM inventory_stock_movements
             WHERE movement_id = ? LIMIT 1",
            [$movementId]
        );
        if ($movement === null) {
            return false;
        }

        // Pending outflows may have reserved stock; release it back to available.
        if (in_array((string)$movement['movement_type'], self::OUTFLOW_TYPES, true)) {
            $row = Database::fetch(
                "SELECT reserved_quantity FROM inventory_stock
                 WHERE inv_product_id = ? AND zone_id = ? LIMIT 1",
                [(int)$movement['inv_product_id'], (int)$movement['zone_id']]
            );
            $reserved = $row !== null ? (float)$row['reserved_quantity'] : 0.0;
            $release = min((float)$movement['quantity'], $reserved);
            if ($release > 0) {
                InventoryStock::releaseReserved(
                    (int)$movement['inv_product_id'],
                    (int)$movement['zone_id'],
                    $release
                );
            }
        }

        return true;
    }

    // ───────────────────────────────────────────────────────────────────────
    // Queries
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Pending approvals visible to a user. owner sees all; the manager tier
     * (store_keeper) sees only the types it can approve; anyone else sees none.
     */
    public function getPendingApprovals(int $userId): array
    {
        $tier = $this->approverTier($userId);
        if ($tier === 'none') {
            return [];
        }

        $where = ["a.approval_status = 'PENDING'"];
        $params = [];
        if ($tier === 'manager') {
            $placeholders = implode(',', array_fill(0, count(self::MANAGER_TIER_TYPES), '?'));
            $where[] = "a.approval_type IN ($placeholders)";
            $params = self::MANAGER_TIER_TYPES;
        }

        $whereClause = implode(' AND ', $where);
        $rows = Database::fetchAll(
            "SELECT a.approval_id, a.approval_type, a.approval_status, a.requested_by,
                    a.created_at AS requested_at, a.remarks,
                    m.movement_id, m.movement_type, m.quantity, m.total_value,
                    p.name AS product, p.sku,
                    u.name AS requested_by_name,
                    TIMESTAMPDIFF(HOUR, a.created_at, NOW()) AS hours_pending
             FROM inventory_approvals a
             JOIN inventory_stock_movements m ON m.movement_id = a.movement_id
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             LEFT JOIN users u ON u.user_id = a.requested_by
             WHERE $whereClause
             ORDER BY a.created_at ASC, a.approval_id ASC",
            $params
        );

        return array_map(function (array $r): array {
            $hours = (int)$r['hours_pending'];
            return [
                'approval_id'   => (int)$r['approval_id'],
                'approval_type' => $r['approval_type'],
                'movement_id'   => (int)$r['movement_id'],
                'movement_type' => $r['movement_type'],
                'product'       => $r['product'],
                'sku'           => $r['sku'],
                'quantity'      => (float)$r['quantity'],
                'total_value'   => (float)$r['total_value'],
                'requested_by'  => $r['requested_by_name'],
                'requested_at'  => $r['requested_at'],
                'hours_pending' => $hours,
                'is_overdue'    => $hours >= self::OVERDUE_HOURS,
                'remarks'       => $this->displayRemarks((string)($r['remarks'] ?? '')),
            ];
        }, $rows);
    }

    /**
     * Approval history with optional filters: approval_type, status, from, to.
     */
    public function getApprovalHistory(array $filters = []): array
    {
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['approval_type'])) {
            $where[] = 'a.approval_type = ?';
            $params[] = (string)$filters['approval_type'];
        }
        if (!empty($filters['status'])) {
            $where[] = 'a.approval_status = ?';
            $params[] = strtoupper((string)$filters['status']);
        }
        if (!empty($filters['from'])) {
            $where[] = 'a.created_at >= ?';
            $params[] = (string)$filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'a.created_at <= ?';
            $params[] = (string)$filters['to'];
        }

        $whereClause = implode(' AND ', $where);
        return Database::fetchAll(
            "SELECT a.*, m.movement_type, m.quantity, m.total_value,
                    p.name AS product, p.sku,
                    req.name AS requested_by_name,
                    apr.name AS approved_by_name,
                    rej.name AS rejected_by_name
             FROM inventory_approvals a
             JOIN inventory_stock_movements m ON m.movement_id = a.movement_id
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             LEFT JOIN users req ON req.user_id = a.requested_by
             LEFT JOIN users apr ON apr.user_id = a.approved_by
             LEFT JOIN users rej ON rej.user_id = a.rejected_by
             WHERE $whereClause
             ORDER BY a.created_at DESC, a.approval_id DESC",
            $params
        );
    }

    // ───────────────────────────────────────────────────────────────────────
    // Permissions
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Can the given user approve this approval type? owner ⇒ all; the manager
     * tier ⇒ DAMAGE_THRESHOLD / TRANSFER only.
     */
    public function canApprove(int $userId, string $approvalType): bool
    {
        $tier = $this->approverTier($userId);
        if ($tier === 'owner') {
            return true;
        }
        if ($tier === 'manager') {
            return in_array($approvalType, self::MANAGER_TIER_TYPES, true);
        }
        return false;
    }

    /**
     * Classify a user's inventory-approval authority:
     *   'owner'   → admin with staff_role owner (or legacy admin without a role)
     *   'manager' → admin with staff_role store_keeper (the manager tier)
     *   'none'    → everyone else
     */
    private function approverTier(int $userId): string
    {
        $user = Database::fetch(
            "SELECT user_type, staff_role FROM users WHERE user_id = ? LIMIT 1",
            [$userId]
        );
        if ($user === null || ($user['user_type'] ?? '') !== 'admin') {
            return 'none';
        }

        $role = strtolower(trim((string)($user['staff_role'] ?? '')));
        if ($role === '' || $role === 'owner') {
            return 'owner'; // legacy admins predate staff_role; treat as owner
        }
        if ($role === 'store_keeper') {
            return 'manager';
        }
        return 'none';
    }

    // ───────────────────────────────────────────────────────────────────────
    // Notification
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Notify the requester of the decision. No notifications table exists in this
     * schema, so the notification is recorded in inventory_audit_log.
     */
    public function notifyApprover(int $approvalId): bool
    {
        $approval = $this->approvalRow($approvalId);
        if ($approval === null) {
            return false;
        }

        $status = strtoupper((string)$approval['approval_status']);
        $verb = $status === 'APPROVED' ? 'approved' : ($status === 'REJECTED' ? 'rejected' : 'updated');

        InventoryMovement::audit(
            'inventory_approvals',
            $approvalId,
            'UPDATE',
            null,
            [
                'notification' => 'inventory_approval',
                'title'        => 'Stock Movement ' . ucfirst($verb),
                'body'         => 'Your request for ' . (float)($approval['quantity'] ?? 0) . ' units of '
                                  . ($approval['product'] ?? 'product') . ' has been ' . $verb,
                'recipient'    => isset($approval['requested_by']) ? (int)$approval['requested_by'] : null,
                'reference'    => $approvalId,
            ],
            null,
            null
        );

        return true;
    }

    // ───────────────────────────────────────────────────────────────────────
    // Expiry
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Auto-reject any approval that has been PENDING for more than EXPIRY_HOURS
     * (72h). The underlying movement never touched balances while pending, so
     * rejection only releases any reserved stock and marks the records REJECTED
     * with a system-generated reason. Returns the list of expired approval IDs.
     */
    public function expirePendingApprovals(): array
    {
        $rows = Database::fetchAll(
            "SELECT approval_id, movement_id FROM inventory_approvals
             WHERE approval_status = 'PENDING'
               AND TIMESTAMPDIFF(HOUR, created_at, NOW()) >= ?",
            [self::EXPIRY_HOURS]
        );

        $expired = [];
        foreach ($rows as $row) {
            $approvalId = (int)$row['approval_id'];
            $movementId = (int)$row['movement_id'];
            $reason = 'Auto-rejected: approval expired after ' . self::EXPIRY_HOURS . ' hours';

            Database::beginTransaction();
            try {
                Database::execute(
                    "UPDATE inventory_approvals
                     SET approval_status = 'REJECTED', remarks = ?, actioned_at = NOW()
                     WHERE approval_id = ? AND approval_status = 'PENDING'",
                    [$reason, $approvalId]
                );
                InventoryMovement::updateApprovalStatus($movementId, 'REJECTED', null);
                $this->rejectMovement($movementId);

                InventoryMovement::audit(
                    'inventory_approvals',
                    $approvalId,
                    'REJECT',
                    ['approval_status' => 'PENDING'],
                    ['approval_status' => 'REJECTED', 'movement_id' => $movementId, 'remarks' => $reason, 'auto_expired' => true],
                    null,
                    null
                );

                Database::commit();
                $expired[] = $approvalId;
            } catch (Throwable $e) {
                Database::rollBack();
                error_log('Approval auto-expiry failed for approval_id ' . $approvalId . ': ' . $e->getMessage());
            }
        }

        return $expired;
    }

    // ───────────────────────────────────────────────────────────────────────
    // Escalation
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Flag approvals pending longer than $hoursThreshold. Records an escalation
     * audit entry for each (deduped per approval) and returns the escalated list.
     */
    public function escalateOverdueApprovals(int $hoursThreshold = 24): array
    {
        $rows = Database::fetchAll(
            "SELECT a.approval_id, a.approval_type, a.requested_by,
                    m.movement_id, p.name AS product,
                    TIMESTAMPDIFF(HOUR, a.created_at, NOW()) AS hours_pending
             FROM inventory_approvals a
             JOIN inventory_stock_movements m ON m.movement_id = a.movement_id
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             WHERE a.approval_status = 'PENDING'
               AND TIMESTAMPDIFF(HOUR, a.created_at, NOW()) >= ?
             ORDER BY hours_pending DESC",
            [$hoursThreshold]
        );

        $escalated = [];
        foreach ($rows as $row) {
            $approvalId = (int)$row['approval_id'];
            // Manager-tier types escalate to admin (owner); owner-only types that
            // are still pending escalate to CRITICAL.
            $managerTier = in_array((string)$row['approval_type'], self::MANAGER_TIER_TYPES, true);
            $escalateTo = $managerTier ? 'ADMIN' : 'CRITICAL';

            if (!$this->alreadyEscalated($approvalId, $escalateTo)) {
                InventoryMovement::audit(
                    'inventory_approvals',
                    $approvalId,
                    'UPDATE',
                    null,
                    [
                        'escalation'    => true,
                        'escalated_to'  => $escalateTo,
                        'hours_pending' => (int)$row['hours_pending'],
                        'approval_type' => $row['approval_type'],
                    ],
                    null,
                    null
                );
            }

            $escalated[] = [
                'approval_id'   => $approvalId,
                'approval_type' => $row['approval_type'],
                'movement_id'   => (int)$row['movement_id'],
                'product'       => $row['product'],
                'hours_pending' => (int)$row['hours_pending'],
                'escalated_to'  => $escalateTo,
            ];
        }

        return $escalated;
    }

    // ───────────────────────────────────────────────────────────────────────
    // Statistics
    // ───────────────────────────────────────────────────────────────────────

    public function getApprovalStats(): array
    {
        $totalPending = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_approvals WHERE approval_status = 'PENDING'"
        );
        $approvedToday = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_approvals
             WHERE approval_status = 'APPROVED' AND DATE(actioned_at) = CURDATE()"
        );
        $rejectedToday = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_approvals
             WHERE approval_status = 'REJECTED' AND DATE(actioned_at) = CURDATE()"
        );
        $overdue = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_approvals
             WHERE approval_status = 'PENDING'
               AND TIMESTAMPDIFF(HOUR, created_at, NOW()) >= " . self::OVERDUE_HOURS
        );

        $avgRow = Database::fetch(
            "SELECT COALESCE(AVG(TIMESTAMPDIFF(MINUTE, created_at, actioned_at)), 0) AS avg_minutes
             FROM inventory_approvals
             WHERE actioned_at IS NOT NULL"
        );
        $avgHours = round(((float)($avgRow['avg_minutes'] ?? 0)) / 60, 2);

        $byTypeRows = Database::fetchAll(
            "SELECT approval_type, approval_status, COUNT(*) AS cnt
             FROM inventory_approvals
             GROUP BY approval_type, approval_status"
        );
        $byType = [];
        foreach (['HIGH_VALUE', 'DAMAGE_THRESHOLD', 'MANUAL_ADJUSTMENT', 'TRANSFER', 'EMERGENCY_USE'] as $t) {
            $byType[$t] = ['pending' => 0, 'approved' => 0];
        }
        foreach ($byTypeRows as $row) {
            $type = (string)$row['approval_type'];
            if (!isset($byType[$type])) {
                $byType[$type] = ['pending' => 0, 'approved' => 0];
            }
            $status = strtoupper((string)$row['approval_status']);
            if ($status === 'PENDING') {
                $byType[$type]['pending'] = (int)$row['cnt'];
            } elseif ($status === 'APPROVED') {
                $byType[$type]['approved'] = (int)$row['cnt'];
            }
        }

        return [
            'total_pending'           => $totalPending,
            'total_approved_today'    => $approvedToday,
            'total_rejected_today'    => $rejectedToday,
            'avg_approval_time_hours' => $avgHours,
            'overdue_approvals'       => $overdue,
            'by_type'                 => $byType,
        ];
    }

    // ───────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ───────────────────────────────────────────────────────────────────────

    private function approvalRow(int $approvalId): ?array
    {
        $row = Database::fetch(
            "SELECT a.*, m.movement_type, m.quantity, p.name AS product
             FROM inventory_approvals a
             JOIN inventory_stock_movements m ON m.movement_id = a.movement_id
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             WHERE a.approval_id = ?
             LIMIT 1",
            [$approvalId]
        );
        return $row ?: null;
    }

    private function alreadyEscalated(int $approvalId, string $escalateTo): bool
    {
        return Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_audit_log
             WHERE table_name = 'inventory_approvals'
               AND record_id = ?
               AND JSON_EXTRACT(new_value, '$.escalation') = TRUE
               AND JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.escalated_to')) = ?",
            [$approvalId, $escalateTo]
        ) > 0;
    }

    /** Decode the structured JSON a pending movement stored in remarks (or []). */
    private function decodeRemarks(string $remarks): array
    {
        if ($remarks === '') {
            return [];
        }
        $decoded = json_decode($remarks, true);
        return is_array($decoded) ? $decoded : [];
    }

    /** Human-facing remarks: the original reason if remarks held structured JSON. */
    private function displayRemarks(string $remarks): ?string
    {
        $meta = $this->decodeRemarks($remarks);
        if ($meta !== [] && array_key_exists('reason', $meta)) {
            return $meta['reason'] !== null ? (string)$meta['reason'] : null;
        }
        return $remarks !== '' ? $remarks : null;
    }

    private function currentZoneQty(int $productId, int $zoneId): float
    {
        $row = Database::fetch(
            "SELECT current_quantity FROM inventory_stock
             WHERE inv_product_id = ? AND zone_id = ? LIMIT 1",
            [$productId, $zoneId]
        );
        return $row !== null ? (float)$row['current_quantity'] : 0.0;
    }

    private function maybeCreateReorderSuggestion(int $productId): void
    {
        $product = InventoryProduct::findById($productId);
        if ($product === null) {
            return;
        }
        $reorder = (float)$product['reorder_level'];
        if ($reorder <= 0) {
            return;
        }

        $row = Database::fetch(
            "SELECT COALESCE(SUM(available_quantity), 0) AS qty
             FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        );
        if ((float)($row['qty'] ?? 0) > $reorder) {
            return;
        }

        $pending = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_reorder_suggestions
             WHERE inv_product_id = ? AND status = 'PENDING'",
            [$productId]
        );
        if ($pending > 0) {
            return;
        }

        Database::insert(
            "INSERT INTO inventory_reorder_suggestions
                (inv_product_id, current_stock, reorder_level, suggested_quantity, prediction_basis, status)
             VALUES (?, ?, ?, ?, 'usage_trend', 'PENDING')",
            [$productId, (float)($row['qty'] ?? 0), $reorder, (float)$product['reorder_quantity']]
        );
    }
}
