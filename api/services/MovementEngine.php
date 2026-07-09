<?php
declare(strict_types=1);

/**
 * Movement Engine — every inventory movement flows through here so each one
 * carries full business context (who/why/when/which dealer-or-department) and
 * fires the same set of post-movement side effects.
 *
 * Canonical movement_type values follow the Prompt-1 schema:
 *   STOCK_IN, STOCK_OUT, TRANSFER, ADJUSTMENT, DAMAGE, RETURN,
 *   PRODUCTION_USE, DEALER_ALLOCATION, EMPLOYEE_ISSUE, EMERGENCY_USE
 * (the Prompt-4 endpoint names "WAREHOUSE_TRANSFER"/"DAMAGED" map to TRANSFER/DAMAGE).
 *
 * Movements are immutable: corrections are new ADJUSTMENT rows, never edits.
 *
 * Direction convention — types that REMOVE stock from a zone:
 *   STOCK_OUT, EMPLOYEE_ISSUE, DEALER_ALLOCATION, PRODUCTION_USE, DAMAGE, EMERGENCY_USE
 * types that ADD stock:
 *   STOCK_IN, RETURN
 * TRANSFER moves between two zones (out of from, into to).
 * ADJUSTMENT sets an absolute new quantity (delta computed here).
 */
class MovementEngine
{
    private const OUTFLOW_TYPES = [
        'STOCK_OUT', 'EMPLOYEE_ISSUE', 'DEALER_ALLOCATION', 'PRODUCTION_USE', 'DAMAGE', 'EMERGENCY_USE',
    ];
    private const INFLOW_TYPES = ['STOCK_IN', 'RETURN'];

    private const TRANSFER_VALUE_THRESHOLD = 50000.0; // ₹ — transfer above this needs approval

    /**
     * Core processor. Expects a normalized movement array; runs validation,
     * availability check, balance update, approval trigger, and all side effects
     * inside a single transaction. Returns the response payload.
     */
    public function processMovement(array $data): array
    {
        $this->validateMovement($data);

        $productId = (int)$data['inv_product_id'];
        $zoneId    = (int)$data['zone_id'];
        $type      = (string)$data['movement_type'];
        $quantity  = (float)$data['quantity'];
        $actorId   = isset($data['moved_by']) && $data['moved_by'] !== '' ? (int)$data['moved_by'] : null;
        $ip        = $data['ip'] ?? null;

        // Outflow types must have the stock available first.
        if (in_array($type, self::OUTFLOW_TYPES, true)
            && !$this->checkAvailability($productId, $zoneId, $quantity)) {
            throw new RuntimeException('Insufficient available stock in the selected zone');
        }

        $approvalNeeded = $this->requiresApproval($data);

        // When a movement goes PENDING, the apply step (ApprovalWorkflow, Prompt 7)
        // runs later and no longer has the in-memory context array. TRANSFER needs
        // its destination zone and ADJUSTMENT needs its target quantity to apply the
        // correct balance change, so persist those in remarks as structured JSON.
        $remarks = $data['remarks'] ?? null;
        if ($approvalNeeded) {
            $remarks = $this->buildPendingRemarks($type, $data, $remarks);
        }

        Database::beginTransaction();
        try {
            $movementId = InventoryMovement::recordMovement([
                'inv_product_id'  => $productId,
                'zone_id'         => $zoneId,
                'movement_type'   => $type,
                'quantity'        => $quantity,
                'unit_cost'       => (float)($data['unit_cost'] ?? $this->productCost($productId)),
                'reference_type'  => $data['reference_type'] ?? null,
                'reference_id'    => $data['reference_id'] ?? null,
                'dealer_id'       => $data['dealer_id'] ?? null,
                'moved_by'        => $actorId,
                'approved_by'     => $approvalNeeded ? null : $actorId,
                'approval_status' => $approvalNeeded ? 'PENDING' : 'APPROVED',
                'remarks'         => $remarks,
                'attachment_url'  => $data['attachment_url'] ?? null,
            ]);

            // Balances only move when the movement is auto-approved. Pending
            // movements wait for the approval workflow (Prompt 7) to apply them.
            $reorderTriggered = false;
            if (!$approvalNeeded) {
                $this->updateBalances($productId, $zoneId, $quantity, $type, $data);
                InventoryStock::updateHealthScore($productId);
                $reorderTriggered = $this->maybeCreateReorderSuggestion($productId);
                if ($type === 'DEALER_ALLOCATION' && isset($data['dealer_id'])) {
                    $this->updateDealerDemand((int)$data['dealer_id'], $productId, $quantity);
                }
            } else {
                $this->createApproval($movementId, $data, $actorId);
            }

            $this->logToAudit($data, $movementId, $actorId, $ip);

            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            throw $e;
        }

        return $this->buildResult($movementId, $productId, $zoneId, $type, $quantity, $approvalNeeded, $reorderTriggered, $data);
    }

    // ── public movement entry points ─────────────────────────────────────────

    public function issueToEmployee(int $productId, int $employeeId, float $qty, string $remarks, int $zoneId, ?int $actorId, ?string $ip): array
    {
        $employee = Database::fetch(
            "SELECT employee_id, name, department FROM employees WHERE employee_id = ? LIMIT 1",
            [$employeeId]
        );
        if ($employee === null) {
            throw new RuntimeException('Employee does not exist');
        }
        return $this->processMovement([
            'inv_product_id' => $productId,
            'zone_id'        => $zoneId,
            'movement_type'  => 'EMPLOYEE_ISSUE',
            'quantity'       => $qty,
            'reference_type' => 'EMPLOYEE_REQUEST',
            'reference_id'   => $employeeId,
            'remarks'        => $remarks,
            'moved_by'       => $actorId,
            'ip'             => $ip,
            '_issued_to'     => $employee['name'],
            '_department'    => $employee['department'],
        ]);
    }

    public function allocateToDealer(int $productId, int $dealerId, float $qty, string $remarks, int $zoneId, ?int $actorId, ?string $ip): array
    {
        $dealer = Database::fetch(
            "SELECT user_id, name FROM users WHERE user_id = ? AND user_type = 'dealer' LIMIT 1",
            [$dealerId]
        );
        if ($dealer === null) {
            throw new RuntimeException('Dealer does not exist or is not a dealer account');
        }
        return $this->processMovement([
            'inv_product_id' => $productId,
            'zone_id'        => $zoneId,
            'movement_type'  => 'DEALER_ALLOCATION',
            'quantity'       => $qty,
            'reference_type' => 'DEALER_ORDER',
            'reference_id'   => $dealerId,
            'dealer_id'      => $dealerId,
            'remarks'        => $remarks,
            'moved_by'       => $actorId,
            'ip'             => $ip,
            '_issued_to'     => $dealer['name'],
        ]);
    }

    public function recordProductionUsage(int $productId, float $qty, string $batchRef, string $remarks, int $zoneId, ?int $actorId, ?string $ip): array
    {
        return $this->processMovement([
            'inv_product_id' => $productId,
            'zone_id'        => $zoneId,
            'movement_type'  => 'PRODUCTION_USE',
            'quantity'       => $qty,
            'reference_type' => 'PRODUCTION_BATCH',
            'remarks'        => trim($batchRef . ' — ' . $remarks, ' —'),
            'moved_by'       => $actorId,
            'ip'             => $ip,
            '_batch_ref'     => $batchRef,
        ]);
    }

    public function transferBetweenZones(int $productId, int $fromZoneId, int $toZoneId, float $qty, string $reason, ?int $actorId, ?string $ip): array
    {
        if ($fromZoneId === $toZoneId) {
            throw new RuntimeException('Source and destination zones must differ');
        }
        $toZone = InventoryZone::findById($toZoneId);
        if ($toZone === null) {
            throw new RuntimeException('Destination zone does not exist');
        }

        $capacity = (float)($toZone['capacity'] ?? 0);
        if ($capacity > 0) {
            $current = $this->currentZoneQty($productId, $toZoneId);
            if (($current + $qty) > $capacity) {
                throw new RuntimeException('Zone capacity exceeded');
            }
        }
        // A transfer is one logical action recorded as a TRANSFER out of the source
        // and a TRANSFER into the destination, sharing one approval decision.
        $data = [
            'inv_product_id' => $productId,
            'zone_id'        => $fromZoneId,
            'movement_type'  => 'TRANSFER',
            'quantity'       => $qty,
            'reference_type' => 'TRANSFER',
            'remarks'        => $reason,
            'moved_by'       => $actorId,
            'ip'             => $ip,
            '_to_zone_id'    => $toZoneId,
        ];
        return $this->processMovement($data);
    }

    public function markAsDamaged(int $productId, int $zoneId, float $qty, string $reason, ?string $attachmentUrl, ?int $actorId, ?string $ip): array
    {
        return $this->processMovement([
            'inv_product_id' => $productId,
            'zone_id'        => $zoneId,
            'movement_type'  => 'DAMAGE',
            'quantity'       => $qty,
            'reference_type' => 'MANUAL',
            'remarks'        => $reason,
            'attachment_url' => $attachmentUrl,
            'moved_by'       => $actorId,
            'ip'             => $ip,
        ]);
    }

    public function processReturn(int $productId, string $fromType, int $fromId, float $qty, string $remarks, int $zoneId, ?int $actorId, ?string $ip): array
    {
        return $this->processMovement([
            'inv_product_id' => $productId,
            'zone_id'        => $zoneId,
            'movement_type'  => 'RETURN',
            'quantity'       => $qty,
            'reference_type' => $fromType,
            'reference_id'   => $fromId,
            'remarks'        => $remarks,
            'moved_by'       => $actorId,
            'ip'             => $ip,
        ]);
    }

    /**
     * Return stock OUT to a supplier/vendor. This is an outflow (reduces the
     * zone) — distinct from processReturn(), which is a customer return inflow.
     * Recorded as STOCK_OUT with reference_type VENDOR_RETURN; the vendor name
     * is captured in the remarks.
     */
    public function returnToVendorOut(int $productId, string $vendorName, float $qty, string $reason, int $zoneId, ?int $actorId, ?string $ip): array
    {
        return $this->processMovement([
            'inv_product_id' => $productId,
            'zone_id'        => $zoneId,
            'movement_type'  => 'STOCK_OUT',
            'quantity'       => $qty,
            'reference_type' => 'VENDOR_RETURN',
            'remarks'        => trim('Return to Vendor: ' . $vendorName . ' — ' . $reason, ' —'),
            'moved_by'       => $actorId,
            'ip'             => $ip,
        ]);
    }

    public function processEmergencyUsage(int $productId, float $qty, string $reason, int $authorizedBy, int $zoneId, ?int $actorId, ?string $ip): array
    {
        return $this->processMovement([
            'inv_product_id' => $productId,
            'zone_id'        => $zoneId,
            'movement_type'  => 'EMERGENCY_USE',
            'quantity'       => $qty,
            'reference_type' => 'MANUAL',
            'remarks'        => $reason,
            'moved_by'       => $actorId,
            'approved_by'    => $authorizedBy,
            'ip'             => $ip,
            '_authorized_by' => $authorizedBy,
        ]);
    }

    public function processAdjustment(int $productId, int $zoneId, float $newQty, string $reason, int $approvedBy, ?int $actorId, ?string $ip): array
    {
        $current = $this->currentZoneQty($productId, $zoneId);
        return $this->processMovement([
            'inv_product_id'   => $productId,
            'zone_id'          => $zoneId,
            'movement_type'    => 'ADJUSTMENT',
            'quantity'         => abs($newQty - $current),
            'reference_type'   => 'MANUAL',
            'remarks'          => $reason,
            'moved_by'         => $actorId,
            'ip'               => $ip,
            '_new_quantity'    => $newQty,
            '_current_quantity'=> $current,
            '_approved_by'     => $approvedBy,
        ]);
    }

    /**
     * Cycle-count adjustment at the PRODUCT level. The counter enters one physical
     * total for the product (across all zones); we reconcile it by applying the
     * variance to the product's primary zone (the zone holding the most stock).
     * Falls back to a default intake zone if the product currently has no stock.
     */
    public function processCycleCountAdjustment(int $productId, float $physicalTotal, string $reason, int $approvedBy, ?int $actorId, ?string $ip): array
    {
        $systemTotal = (float)(Database::fetch(
            "SELECT COALESCE(SUM(current_quantity), 0) AS total FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        )['total'] ?? 0);

        $primary = Database::fetch(
            "SELECT zone_id, current_quantity FROM inventory_stock
             WHERE inv_product_id = ? ORDER BY current_quantity DESC LIMIT 1",
            [$productId]
        );

        if ($primary === null) {
            $zone = InventoryZone::findByType('READY_STOCK') ?? InventoryZone::findByType('RAW_MATERIAL');
            if ($zone === null) {
                throw new RuntimeException('No zone available to record the adjustment');
            }
            $zoneId      = (int)$zone['zone_id'];
            $zoneCurrent = 0.0;
        } else {
            $zoneId      = (int)$primary['zone_id'];
            $zoneCurrent = (float)$primary['current_quantity'];
        }

        $delta      = $physicalTotal - $systemTotal;       // +surplus / -loss
        $newZoneQty = max(0.0, $zoneCurrent + $delta);     // apply variance to primary zone

        return $this->processAdjustment($productId, $zoneId, $newZoneQty, $reason, $approvedBy, $actorId, $ip);
    }

    // ── private helpers ──────────────────────────────────────────────────────

    private function validateMovement(array $data): bool
    {
        $type = (string)($data['movement_type'] ?? '');
        if (!in_array($type, InventoryMovement::TYPES, true)) {
            throw new RuntimeException('Unknown movement type: ' . $type);
        }
        if (InventoryProduct::findById((int)($data['inv_product_id'] ?? 0)) === null) {
            throw new RuntimeException('Product does not exist');
        }
        if (InventoryZone::findById((int)($data['zone_id'] ?? 0)) === null) {
            throw new RuntimeException('Zone does not exist');
        }
        if ((float)($data['quantity'] ?? 0) < 0.001 && $type !== 'ADJUSTMENT') {
            throw new RuntimeException('Quantity must be at least 0.001');
        }
        return true;
    }

    private function checkAvailability(int $productId, int $zoneId, float $qty): bool
    {
        $row = Database::fetch(
            "SELECT available_quantity FROM inventory_stock
             WHERE inv_product_id = ? AND zone_id = ? LIMIT 1",
            [$productId, $zoneId]
        );
        $available = $row !== null ? (float)$row['available_quantity'] : 0.0;
        return $qty <= $available;
    }

    /**
     * Apply the balance change for an approved movement. Outflows subtract,
     * inflows add, TRANSFER moves between zones, ADJUSTMENT sets an absolute qty.
     * Delegates to InventoryStock (which enforces never-negative).
     */
    private function updateBalances(int $productId, int $zoneId, float $qty, string $type, array $data): bool
    {
        if ($type === 'ADJUSTMENT') {
            $target = (float)($data['_new_quantity'] ?? 0);
            $current = $this->currentZoneQty($productId, $zoneId);
            InventoryStock::upsertStock($productId, $zoneId, $target - $current);
            return true;
        }
        if ($type === 'TRANSFER') {
            $toZoneId = (int)($data['_to_zone_id'] ?? 0);
            InventoryStock::upsertStock($productId, $zoneId, -$qty);
            InventoryStock::upsertStock($productId, $toZoneId, $qty);
            return true;
        }
        if (in_array($type, self::OUTFLOW_TYPES, true)) {
            InventoryStock::upsertStock($productId, $zoneId, -$qty);
            return true;
        }
        if (in_array($type, self::INFLOW_TYPES, true)) {
            InventoryStock::upsertStock($productId, $zoneId, $qty);
            return true;
        }
        return false;
    }

    private function requiresApproval(array $data): bool
    {
        $type = (string)$data['movement_type'];
        $productId = (int)$data['inv_product_id'];
        $zoneId = (int)$data['zone_id'];
        $qty = (float)$data['quantity'];

        switch ($type) {
            case 'ADJUSTMENT':
            case 'EMERGENCY_USE':
                return true;

            case 'DAMAGE':
                // approval if qty > 10% of current zone stock
                $current = $this->currentZoneQty($productId, $zoneId);
                return $current > 0 && $qty > ($current * 0.10);

            case 'TRANSFER':
                // approval if moved value > ₹50,000
                $value = $qty * $this->productCost($productId);
                return $value > self::TRANSFER_VALUE_THRESHOLD;

            case 'DEALER_ALLOCATION':
                // approval if qty > dealer avg monthly consumption × 2
                $dealerId = (int)($data['dealer_id'] ?? 0);
                $row = Database::fetch(
                    "SELECT avg_monthly_consumption FROM inventory_dealer_demand
                     WHERE dealer_id = ? AND inv_product_id = ? LIMIT 1",
                    [$dealerId, $productId]
                );
                $avg = $row !== null ? (float)$row['avg_monthly_consumption'] : 0.0;
                return $avg > 0 && $qty > ($avg * 2);

            default:
                return false;
        }
    }

    private function createApproval(int $movementId, array $data, ?int $requestedBy): void
    {
        $typeMap = [
            'ADJUSTMENT'        => 'MANUAL_ADJUSTMENT',
            'EMERGENCY_USE'     => 'HIGH_VALUE',
            'DAMAGE'            => 'DAMAGE_THRESHOLD',
            'TRANSFER'          => 'TRANSFER',
            'DEALER_ALLOCATION' => 'HIGH_VALUE',
        ];
        $approvalType = $typeMap[(string)$data['movement_type']] ?? 'HIGH_VALUE';
        Database::insert(
            "INSERT INTO inventory_approvals
                (movement_id, approval_type, requested_by, approval_status, remarks)
             VALUES (?, ?, ?, 'PENDING', ?)",
            [$movementId, $approvalType, $requestedBy, $data['remarks'] ?? null]
        );
    }

    /**
     * Auto-create a reorder suggestion if total available across READY_STOCK and
     * RAW_MATERIAL zones has dropped to/below the product reorder level and there
     * isn't already a pending suggestion. Returns true if one was created.
     */
    private function maybeCreateReorderSuggestion(int $productId): bool
    {
        $product = InventoryProduct::findById($productId);
        if ($product === null) {
            return false;
        }
        $reorder = (float)$product['reorder_level'];
        if ($reorder <= 0) {
            return false;
        }

        $row = Database::fetch(
            "SELECT COALESCE(SUM(available_quantity), 0) AS qty
             FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        );
        $current = (float)($row['qty'] ?? 0);
        if ($current > $reorder) {
            return false;
        }

        $pending = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_reorder_suggestions
             WHERE inv_product_id = ? AND status = 'PENDING'",
            [$productId]
        );
        if ($pending > 0) {
            return false; // don't spam duplicates
        }

        Database::insert(
            "INSERT INTO inventory_reorder_suggestions
                (inv_product_id, current_stock, reorder_level, suggested_quantity, prediction_basis, status)
             VALUES (?, ?, ?, ?, 'usage_trend', 'PENDING')",
            [$productId, $current, $reorder, (float)$product['reorder_quantity']]
        );
        return true;
    }

    private function updateDealerDemand(int $dealerId, int $productId, float $qty): void
    {
        // Upsert the dealer's last-order info; the intelligence layer refines the
        // averages later. Insert a baseline row if none exists.
        $exists = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_dealer_demand
             WHERE dealer_id = ? AND inv_product_id = ?",
            [$dealerId, $productId]
        );
        if ($exists > 0) {
            Database::execute(
                "UPDATE inventory_dealer_demand
                 SET last_order_quantity = ?, last_order_date = CURDATE()
                 WHERE dealer_id = ? AND inv_product_id = ?",
                [$qty, $dealerId, $productId]
            );
        } else {
            Database::insert(
                "INSERT INTO inventory_dealer_demand
                    (dealer_id, inv_product_id, avg_monthly_consumption, last_order_quantity, last_order_date, confidence_score)
                 VALUES (?, ?, ?, ?, CURDATE(), 0)",
                [$dealerId, $productId, $qty, $qty]
            );
        }
    }

    private function logToAudit(array $data, int $movementId, ?int $actorId, ?string $ip): bool
    {
        InventoryMovement::audit(
            'inventory_stock_movements',
            $movementId,
            'CREATE',
            null,
            [
                'movement_type' => $data['movement_type'],
                'product_id'    => (int)$data['inv_product_id'],
                'zone_id'       => (int)$data['zone_id'],
                'quantity'      => (float)$data['quantity'],
                'remarks'       => $data['remarks'] ?? null,
            ],
            $actorId,
            $ip
        );
        return true;
    }

    // ── small utilities ──────────────────────────────────────────────────────

    /**
     * Encode the extra context a PENDING movement needs so the approval apply
     * step can reconstruct the balance change after the request is gone.
     * Returns a JSON string for TRANSFER/ADJUSTMENT (carrying the original
     * human reason), otherwise the plain reason unchanged.
     */
    private function buildPendingRemarks(string $type, array $data, ?string $reason): ?string
    {
        if ($type === 'ADJUSTMENT') {
            return json_encode([
                'target_quantity' => (float)($data['_new_quantity'] ?? 0),
                'reason'          => $reason,
            ], JSON_UNESCAPED_UNICODE);
        }
        if ($type === 'TRANSFER') {
            return json_encode([
                'to_zone_id' => (int)($data['_to_zone_id'] ?? 0),
                'reason'     => $reason,
            ], JSON_UNESCAPED_UNICODE);
        }
        return $reason;
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

    private function productCost(int $productId): float
    {
        $product = InventoryProduct::findById($productId);
        return $product !== null ? (float)$product['standard_cost'] : 0.0;
    }

    private function buildResult(
        int $movementId,
        int $productId,
        int $zoneId,
        string $type,
        float $quantity,
        bool $approvalNeeded,
        bool $reorderTriggered,
        array $data
    ): array {
        $product = InventoryProduct::findById($productId);
        $zone = InventoryZone::findById($zoneId);
        $cost = $product !== null ? (float)$product['standard_cost'] : 0.0;

        // remaining = total available across all zones for this product
        $row = Database::fetch(
            "SELECT COALESCE(SUM(available_quantity), 0) AS qty, COALESCE(AVG(health_score), 0) AS health
             FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        );

        $result = [
            'movement_id'       => $movementId,
            'movement_type'     => $type,
            'product'           => $product['name'] ?? null,
            'quantity'          => $quantity,
            'from_zone'         => $zone['zone_type'] ?? null,
            'remaining_stock'   => (float)($row['qty'] ?? 0),
            'approval_required' => $approvalNeeded,
            'movement_date'     => date('Y-m-d H:i:s'),
            'business_impact'   => [
                'stock_value_moved' => round($quantity * $cost, 2),
                'new_health_score'  => (int)round((float)($row['health'] ?? 0)),
                'reorder_triggered' => $reorderTriggered,
            ],
        ];

        // Context fields per movement type.
        if (isset($data['_issued_to']))  { $result['issued_to'] = $data['_issued_to']; }
        if (isset($data['_department'])) { $result['department'] = $data['_department']; }
        if (isset($data['_batch_ref']))  { $result['batch_reference'] = $data['_batch_ref']; }
        if (isset($data['_to_zone_id'])) {
            $to = InventoryZone::findById((int)$data['_to_zone_id']);
            $result['to_zone'] = $to['zone_type'] ?? null;
        }

        return $result;
    }
}
