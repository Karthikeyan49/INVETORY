<?php
declare(strict_types=1);

/**
 * Smart Allocation Engine.
 *
 * After stock is received into an intake zone, this engine re-routes it into the
 * correct zones by business priority:
 *
 *   QC-damaged          → DAMAGED            (handled at QC, not here)
 *   dealer reservation  → DEALER_RESERVED    (up to reserved qty, by confidence)
 *   production demand   → PRODUCTION         (up to demand qty)
 *   ready stock low     → READY_STOCK        (top up to reorder level)
 *   raw material space  → RAW_MATERIAL       (up to remaining capacity)
 *   otherwise           → EMERGENCY_BUFFER
 *   nothing fit at all  → READY_STOCK        (never reject stock)
 *
 * Each placement TRANSFERs quantity out of the intake zone into the target zone,
 * records a movement + audit row, and updates inventory_stock balances. The
 * engine runs in its own transaction; on failure the received stock simply stays
 * in the intake zone (it is never lost).
 */
class SmartAllocationEngine
{
    private InventoryAllocation $allocations;

    public function __construct()
    {
        $this->allocations = new InventoryAllocation();
    }

    /**
     * Main entry point — called after a STOCK_IN receipt, or by the allocate
     * endpoint. $movementId is the originating STOCK_IN movement; its zone is the
     * intake zone we redistribute from. $actorId/$ip flow into audit logging.
     */
    public function allocate(
        int $productId,
        float $quantity,
        int $movementId,
        ?int $actorId = null,
        ?string $ip = null
    ): array {
        if ($quantity <= 0) {
            throw new RuntimeException('Allocation quantity must be positive');
        }

        $intakeZoneId = $this->intakeZoneId($movementId, $productId);
        if ($intakeZoneId === null) {
            throw new RuntimeException('Could not resolve intake zone for allocation');
        }

        $remaining  = $quantity;
        $placements = [];

        Database::beginTransaction();
        try {
            // 1. Dealer reservations (highest priority) — fill by confidence.
            if ($remaining > 0) {
                foreach ($this->checkDealerDemand($productId) as $res) {
                    if ($remaining <= 0) {
                        break;
                    }
                    $reserve = (float)$res['suggested_reserve_qty'];
                    if ($reserve <= 0) {
                        continue;
                    }
                    $take = min($reserve, $remaining);
                    $zone = InventoryZone::findByType('DEALER_RESERVED');
                    if ($zone === null) {
                        break; // no dealer zone configured → skip this tier
                    }
                    $this->placeInZone($productId, (int)$zone['zone_id'], $intakeZoneId, $take, $movementId, (int)$res['dealer_id'], $actorId);
                    $this->allocations->updateDealerReservation((int)$res['dealer_id'], $productId, $take);
                    $placements[] = [
                        'zone_type' => 'DEALER_RESERVED',
                        'zone_name' => $zone['zone_name'] ?? 'Dealer Reserved',
                        'zone_code' => $zone['zone_code'] ?? '',
                        'zone_id'   => (int)$zone['zone_id'],
                        'quantity'  => $take,
                        'reason'    => 'Active dealer reservation for ' . ($res['dealer_name'] ?? ('Dealer #' . $res['dealer_id'])),
                    ];
                    $remaining -= $take;
                }
            }

            // 2. Production demand.
            if ($remaining > 0) {
                $production = $this->checkProductionDemand($productId);
                $demand     = $production['demand'];
                if ($demand > 0) {
                    $take = min($demand, $remaining);
                    $zone = InventoryZone::findByType('PRODUCTION');
                    if ($zone !== null) {
                        $this->placeInZone($productId, (int)$zone['zone_id'], $intakeZoneId, $take, $movementId, null, $actorId);
                        $placements[] = [
                            'zone_type' => 'PRODUCTION',
                            'zone_name' => $zone['zone_name'] ?? 'Production',
                            'zone_code' => $zone['zone_code'] ?? '',
                            'zone_id'   => (int)$zone['zone_id'],
                            'quantity'  => $take,
                            'reason'    => 'Production demand detected',
                            'production_demand_source' => $production['method'],
                        ];
                        $remaining -= $take;
                    }
                }
            }

            // 3. Finished goods / non-raw-material products → READY_STOCK.
            // Raw materials belong in the RAW_MATERIAL zone (tier 4) and must never
            // be routed here. Everything else is sellable/ready stock and must never
            // land in the RAW_MATERIAL zone, so route the remainder to Ready Stock
            // regardless of reorder level (covers first-receipt when Ready Stock is empty).
            if ($remaining > 0 && !$this->isRawMaterialProduct($productId)) {
                $zone = InventoryZone::findByType('READY_STOCK');
                if ($zone !== null) {
                    $take = $remaining; // send the rest to ready stock
                    $this->placeInZone($productId, (int)$zone['zone_id'], $intakeZoneId, $take, $movementId, null, $actorId);
                    $placements[] = [
                        'zone_type' => 'READY_STOCK',
                        'zone_name' => $zone['zone_name'] ?? 'Ready Stock',
                        'zone_code' => $zone['zone_code'] ?? '',
                        'zone_id'   => (int)$zone['zone_id'],
                        'quantity'  => $take,
                        'reason'    => 'Finished goods routed to ready stock',
                    ];
                    $remaining = 0.0;
                }
            }

            // 4. Raw material zone has capacity headroom (raw-material products only).
            // Finished goods are handled by tier 3 above and never reach this tier.
            if ($remaining > 0 && $this->isRawMaterialProduct($productId)) {
                $capacity = $this->checkRawMaterialCapacity($productId);
                if ($capacity > 0) {
                    $take = min($capacity, $remaining);
                    $zone = InventoryZone::findByType('RAW_MATERIAL');
                    if ($zone !== null) {
                        $this->placeInZone($productId, (int)$zone['zone_id'], $intakeZoneId, $take, $movementId, null, $actorId);
                        $placements[] = [
                            'zone_type' => 'RAW_MATERIAL',
                            'zone_name' => $zone['zone_name'] ?? 'Raw Material',
                            'zone_code' => $zone['zone_code'] ?? '',
                            'zone_id'   => (int)$zone['zone_id'],
                            'quantity'  => $take,
                            'reason'    => 'Raw material zone has available capacity',
                        ];
                        $remaining -= $take;
                    }
                }
            }

            // 5. Whatever is left → EMERGENCY_BUFFER…
            if ($remaining > 0) {
                $zone = InventoryZone::findByType('EMERGENCY_BUFFER');
                if ($zone !== null) {
                    $this->placeInZone($productId, (int)$zone['zone_id'], $intakeZoneId, $remaining, $movementId, null, $actorId);
                    $placements[] = [
                        'zone_type' => 'EMERGENCY_BUFFER',
                        'zone_name' => $zone['zone_name'] ?? 'Emergency Buffer',
                        'zone_code' => $zone['zone_code'] ?? '',
                        'zone_id'   => (int)$zone['zone_id'],
                        'quantity'  => $remaining,
                        'reason'    => 'Overflow routed to emergency buffer',
                    ];
                    $remaining = 0.0;
                }
            }

            // 6. Safety net — never reject stock. If no zone fit (e.g. emergency
            //    buffer not configured), leave the remainder in READY_STOCK.
            if ($remaining > 0) {
                $zone = InventoryZone::findByType('READY_STOCK');
                if ($zone === null) {
                    throw new RuntimeException('No READY_STOCK zone configured for fallback allocation');
                }
                $this->placeInZone($productId, (int)$zone['zone_id'], $intakeZoneId, $remaining, $movementId, null, $actorId);
                $placements[] = [
                    'zone_type' => 'READY_STOCK',
                    'zone_name' => $zone['zone_name'] ?? 'Ready Stock',
                    'zone_code' => $zone['zone_code'] ?? '',
                    'zone_id'   => (int)$zone['zone_id'],
                    'quantity'  => $remaining,
                    'reason'    => 'Remaining stock to ready zone (default)',
                ];
                $remaining = 0.0;
            }

            $score = $this->calculatePriorityScore($productId);

            InventoryMovement::audit(
                'inventory_stock_movements', $movementId, 'UPDATE', null,
                ['action' => 'smart_allocation', 'product_id' => $productId, 'quantity' => $quantity, 'placements' => $placements, 'priority_score' => $score['score']],
                $actorId, $ip
            );

            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            throw $e;
        }

        return $this->buildAllocationResult($productId, $quantity, $placements);
    }

    /**
     * Manual override — place a quantity into a specific zone, bypassing the
     * waterfall. Reason is required by the caller and logged. Runs in its own
     * transaction; intake zone is the product's current largest non-target zone
     * or, if none, treated as a direct STOCK_IN into the target zone.
     */
    public function manualAllocate(
        int $productId,
        int $zoneId,
        float $quantity,
        string $reason,
        ?int $sourceZoneId,
        ?int $actorId,
        ?string $ip
    ): array {
        $zone = InventoryZone::findById($zoneId);
        $capacity = (float)($zone['capacity'] ?? 0);
        if ($capacity > 0) {
            $row = Database::fetch(
                "SELECT COALESCE(current_quantity, 0) AS qty FROM inventory_stock
                 WHERE inv_product_id = ? AND zone_id = ?",
                [$productId, $zoneId]
            );
            $current = (float)($row['qty'] ?? 0);
            if (($current + $quantity) > $capacity) {
                throw new RuntimeException('Zone capacity exceeded');
            }
        }

        Database::beginTransaction();
        try {
            $movementId = $this->allocations->recordAllocation([
                'inv_product_id' => $productId,
                'zone_id'        => $zoneId,
                'movement_type'  => 'TRANSFER',
                'quantity'       => $quantity,
                'moved_by'       => $actorId,
                'remarks'        => 'Manual override: ' . $reason,
            ]);

            if ($sourceZoneId !== null) {
                InventoryStock::upsertStock($productId, $sourceZoneId, -$quantity);
            }
            InventoryStock::upsertStock($productId, $zoneId, $quantity);

            InventoryMovement::audit(
                'inventory_stock_movements', $movementId, 'UPDATE', null,
                ['action' => 'manual_allocation', 'product_id' => $productId, 'zone_id' => $zoneId, 'quantity' => $quantity, 'reason' => $reason],
                $actorId, $ip
            );

            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            throw $e;
        }

        return $this->buildAllocationResult($productId, $quantity, [[
            'zone_type' => $zone['zone_type'] ?? 'UNKNOWN',
            'zone_name' => $zone['zone_name'] ?? 'Unknown Zone',
            'zone_code' => $zone['zone_code'] ?? '',
            'zone_id'   => $zoneId,
            'quantity'  => $quantity,
            'reason'    => 'Manual override: ' . $reason,
        ]]);
    }

    // ── private waterfall helpers ────────────────────────────────────────────

    private function checkDealerDemand(int $productId): array
    {
        return $this->allocations->getPendingDealerReservations($productId);
    }

    /** @return array{demand: float, method: string} */
    private function checkProductionDemand(int $productId): array
    {
        return $this->allocations->getProductionDemandDetailed($productId);
    }

    /**
     * Ready stock is "low" when total available in READY_STOCK zones is at/below
     * the product's reorder level.
     */
    private function isReadyStockLow(int $productId): bool
    {
        $product = InventoryProduct::findById($productId);
        $reorder = $product !== null ? (float)$product['reorder_level'] : 0.0;
        if ($reorder <= 0) {
            return false;
        }
        $row = Database::fetch(
            "SELECT COALESCE(SUM(s.available_quantity), 0) AS qty
             FROM inventory_stock s
             JOIN inventory_zones z ON z.zone_id = s.zone_id
             WHERE s.inv_product_id = ? AND z.zone_type = 'READY_STOCK' AND z.is_active = 1",
            [$productId]
        );
        $qty = (float)($row['qty'] ?? 0);
        // Only "low" if the product already exists in Ready Stock (qty > 0).
        // A qty of 0 means this product has never been placed in Ready Stock —
        // in that case let the RAW_MATERIAL / safety-net tiers handle it.
        return $qty > 0 && $qty <= $reorder;
    }

    /**
     * Returns true when the product belongs to a raw-material category.
     * Raw-material products should always flow to the RAW_MATERIAL zone
     * and must never be routed to READY_STOCK via the reorder-top-up step.
     *
     * Matches category names that contain "raw" (case-insensitive), e.g.
     * "Raw Material", "Raw Materials", "Raw Wood Chips", "raw_material".
     */
    private function isRawMaterialProduct(int $productId): bool
    {
        $product  = InventoryProduct::findById($productId);
        $category = strtolower(trim((string)($product['category'] ?? '')));
        return strpos($category, 'raw') !== false;
    }

    /**
     * Remaining headroom in the RAW_MATERIAL zone (capacity - current). capacity
     * of 0 means "untracked/unlimited" → return a large headroom.
     */
    private function checkRawMaterialCapacity(int $productId): float
    {
        $zone = InventoryZone::findByType('RAW_MATERIAL');
        if ($zone === null) {
            return 0.0;
        }
        $capacity = (float)$zone['capacity'];
        $row = Database::fetch(
            "SELECT COALESCE(current_quantity, 0) AS qty
             FROM inventory_stock
             WHERE inv_product_id = ? AND zone_id = ?",
            [$productId, (int)$zone['zone_id']]
        );
        $current = (float)($row['qty'] ?? 0);
        if ($capacity <= 0) {
            return PHP_INT_MAX; // untracked capacity → always has room
        }
        return max(0.0, $capacity - $current);
    }

    /**
     * Move quantity out of the intake zone and into the target zone, recording a
     * TRANSFER (or DEALER_ALLOCATION) movement. Caller holds the transaction.
     */
    private function placeInZone(
        int $productId,
        int $zoneId,
        int $intakeZoneId,
        float $quantity,
        int $movementId,
        ?int $dealerId,
        ?int $actorId
    ): bool {
        $type = $dealerId !== null ? 'DEALER_ALLOCATION' : 'TRANSFER';

        // out of intake (skip if target IS the intake zone — no-op move)
        if ($zoneId !== $intakeZoneId) {
            InventoryStock::upsertStock($productId, $intakeZoneId, -$quantity);
            InventoryStock::upsertStock($productId, $zoneId, $quantity);
        }

        $this->allocations->recordAllocation([
            'inv_product_id' => $productId,
            'zone_id'        => $zoneId,
            'movement_type'  => $type,
            'quantity'       => $quantity,
            'dealer_id'      => $dealerId,
            'moved_by'       => $actorId,
            'reference_id'   => $movementId,
            'remarks'        => 'Auto-allocated from intake zone #' . $intakeZoneId,
        ]);

        return true;
    }

    /**
     * Priority score (0-100) from dealer-demand confidence, production urgency,
     * and stock age. Used for reporting and to rank pending allocations.
     */
    private function calculatePriorityScore(int $productId): array
    {
        // Dealer confidence component (0-40): highest confidence among reservations.
        $conf = Database::fetch(
            "SELECT COALESCE(MAX(confidence_score), 0) AS c
             FROM inventory_dealer_demand
             WHERE inv_product_id = ? AND suggested_reserve_qty > 0",
            [$productId]
        );
        $dealerComponent = round((float)($conf['c'] ?? 0) / 100 * 40, 2);

        // Production urgency component (0-35): demand present → urgent.
        $demand = $this->checkProductionDemand($productId)['demand'];
        $productionComponent = $demand > 0 ? 35.0 : 0.0;

        // Stock age component (0-25): older oldest-movement → higher (needs turnover).
        $age = Database::fetch(
            "SELECT DATEDIFF(NOW(), MIN(last_movement_at)) AS days
             FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        );
        $days = (int)($age['days'] ?? 0);
        $ageComponent = round(min(25.0, max(0.0, $days / 30 * 25)), 2);

        $score = (int)round($dealerComponent + $productionComponent + $ageComponent);
        return [
            'score'      => max(0, min(100, $score)),
            'components' => [
                'dealer_confidence'  => $dealerComponent,
                'production_urgency' => $productionComponent,
                'stock_age'          => $ageComponent,
            ],
        ];
    }

    private function buildAllocationResult(int $productId, float $totalQuantity, array $placements): array
    {
        return [
            'product_id'     => $productId,
            'total_quantity' => $totalQuantity,
            'allocations'    => $placements,
            'priority_score' => $this->calculatePriorityScore($productId)['score'],
            'allocated_at'   => date('Y-m-d H:i:s'),
        ];
    }

    /** Resolve the intake zone from the originating STOCK_IN movement. */
    private function intakeZoneId(int $movementId, int $productId): ?int
    {
        $row = Database::fetch(
            "SELECT zone_id FROM inventory_stock_movements WHERE movement_id = ? LIMIT 1",
            [$movementId]
        );
        if ($row !== null) {
            return (int)$row['zone_id'];
        }
        // Fallback: a zone where this product currently has stock.
        $row = Database::fetch(
            "SELECT zone_id FROM inventory_stock WHERE inv_product_id = ? ORDER BY current_quantity DESC LIMIT 1",
            [$productId]
        );
        return $row !== null ? (int)$row['zone_id'] : null;
    }
}
