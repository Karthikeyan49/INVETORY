<?php
declare(strict_types=1);

/**
 * Smart Inventory — allocation reads/writes over the existing 9 tables (no new
 * table is introduced in Prompt 3). An "allocation" is materialised as a
 * DEALER_ALLOCATION / PRODUCTION_USE / TRANSFER movement plus an inventory_audit_log
 * entry; history is those rows read back; distribution is inventory_stock.
 */
class InventoryAllocation
{
    /**
     * Persist a single allocation placement: a movement row tagged with
     * reference_type='ALLOCATION', plus the balance change is done by the engine.
     * Returns the new movement_id.
     */
    public function recordAllocation(array $data): int
    {
        return InventoryMovement::recordMovement([
            'inv_product_id'  => (int)$data['inv_product_id'],
            'zone_id'         => (int)$data['zone_id'],
            'movement_type'   => (string)($data['movement_type'] ?? 'TRANSFER'),
            'quantity'        => (float)$data['quantity'],
            'unit_cost'       => (float)($data['unit_cost'] ?? 0),
            'reference_type'  => 'ALLOCATION',
            'reference_id'    => isset($data['reference_id']) ? (int)$data['reference_id'] : null,
            'dealer_id'       => isset($data['dealer_id']) && $data['dealer_id'] !== '' ? (int)$data['dealer_id'] : null,
            'moved_by'        => isset($data['moved_by']) && $data['moved_by'] !== '' ? (int)$data['moved_by'] : null,
            'approved_by'     => isset($data['moved_by']) && $data['moved_by'] !== '' ? (int)$data['moved_by'] : null,
            'approval_status' => 'APPROVED',
            'remarks'         => $data['remarks'] ?? null,
        ]);
    }

    /**
     * Allocation history = movement rows produced by the allocation engine for a
     * product (reference_type='ALLOCATION'), newest first.
     */
    public function getAllocationHistory(int $productId): array
    {
        return Database::fetchAll(
            "SELECT m.movement_id, m.movement_type, m.quantity, m.zone_id,
                    m.dealer_id, m.remarks, m.created_at,
                    z.zone_name, z.zone_code, z.zone_type,
                    u.name AS moved_by_name
             FROM inventory_stock_movements m
             JOIN inventory_zones z ON z.zone_id = m.zone_id
             LEFT JOIN users u ON u.user_id = m.moved_by
             WHERE m.inv_product_id = ? AND m.reference_type = 'ALLOCATION'
             ORDER BY m.created_at DESC, m.movement_id DESC",
            [$productId]
        );
    }

    /**
     * Current per-zone balances for a product (where stock physically sits now).
     */
    public function getZoneDistribution(int $productId): array
    {
        return Database::fetchAll(
            "SELECT s.zone_id, z.zone_name, z.zone_code, z.zone_type,
                    s.current_quantity, s.reserved_quantity, s.available_quantity
             FROM inventory_stock s
             JOIN inventory_zones z ON z.zone_id = s.zone_id
             WHERE s.inv_product_id = ?
             ORDER BY z.zone_type ASC, z.zone_name ASC",
            [$productId]
        );
    }

    /**
     * Dealer reservations for a product: rows in inventory_dealer_demand with a
     * positive suggested reserve. Ordered by confidence so the engine fills the
     * most-confident dealers first.
     */
    public function getPendingDealerReservations(int $productId): array
    {
        return Database::fetchAll(
            "SELECT d.dealer_id, d.inv_product_id, d.suggested_reserve_qty,
                    d.confidence_score, d.avg_monthly_consumption,
                    d.predicted_next_order_date, u.name AS dealer_name
             FROM inventory_dealer_demand d
             LEFT JOIN users u ON u.user_id = d.dealer_id
             WHERE d.inv_product_id = ? AND d.suggested_reserve_qty > 0
             ORDER BY d.confidence_score DESC, d.suggested_reserve_qty DESC",
            [$productId]
        );
    }

    /**
     * After stock is allocated to a dealer, reduce that dealer's outstanding
     * reserve so the same quantity isn't reserved twice. Never goes negative.
     */
    public function updateDealerReservation(int $dealerId, int $productId, float $allocatedQty): bool
    {
        return Database::execute(
            "UPDATE inventory_dealer_demand
             SET suggested_reserve_qty = GREATEST(suggested_reserve_qty - ?, 0)
             WHERE dealer_id = ? AND inv_product_id = ?",
            [$allocatedQty, $dealerId, $productId]
        ) >= 0;
    }

    /**
     * Production demand for a product, plus which method produced the figure.
     *
     * If a production_batches table exists, demand is the outstanding (planned -
     * consumed) quantity of this product across active batches — a real signal
     * from the production schedule. Otherwise we fall back to the PRODUCTION zone
     * shortfall (reserved - current, floored at 0), the only signal Prompt 1's
     * schema exposes.
     *
     * @return array{demand: float, method: string}
     */
    public function getProductionDemandDetailed(int $productId): array
    {
        $hasProductionBatches = (int)(Database::fetch(
            "SELECT COUNT(*) AS cnt FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = 'production_batches'"
        )['cnt'] ?? 0) > 0;

        if ($hasProductionBatches) {
            $row = Database::fetch(
                "SELECT COALESCE(SUM(GREATEST(b.planned_quantity - b.consumed_quantity, 0)), 0) AS demand
                 FROM production_batches b
                 WHERE b.inv_product_id = ? AND b.status IN ('planned', 'in_progress')",
                [$productId]
            );
            return [
                'demand' => (float)($row['demand'] ?? 0),
                'method' => 'production_batches',
            ];
        }

        $row = Database::fetch(
            "SELECT COALESCE(SUM(GREATEST(s.reserved_quantity - s.current_quantity, 0)), 0) AS demand
             FROM inventory_stock s
             JOIN inventory_zones z ON z.zone_id = s.zone_id
             WHERE s.inv_product_id = ? AND z.zone_type = 'PRODUCTION' AND z.is_active = 1",
            [$productId]
        );
        return [
            'demand' => (float)($row['demand'] ?? 0),
            'method' => 'zone_shortfall_fallback',
        ];
    }

    /**
     * Production demand for a product (value only). Prompt 1 has no dedicated
     * production-demand column; see getProductionDemandDetailed() for the
     * production_batches-aware logic and the method used.
     */
    public function getProductionDemand(int $productId): float
    {
        return $this->getProductionDemandDetailed($productId)['demand'];
    }
}
