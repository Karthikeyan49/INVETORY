<?php
declare(strict_types=1);

/**
 * Smart Inventory — on-hand balances (inventory_stock).
 *
 * Invariants enforced here (callers should already be inside a transaction when
 * mutating, mirroring AdminInventoryController::adjustment):
 *   - current_quantity and reserved_quantity can never go negative.
 *   - available_quantity is always kept = current_quantity - reserved_quantity.
 *   - is_low_stock and health_score are recomputed after every balance change.
 */
class InventoryStock
{
    public static function getStockByProduct(int $productId): array
    {
        $rows = Database::fetchAll(
            "SELECT s.*, z.zone_name, z.zone_code, z.zone_type
             FROM inventory_stock s
             JOIN inventory_zones z ON z.zone_id = s.zone_id
             WHERE s.inv_product_id = ?
             ORDER BY z.zone_name ASC",
            [$productId]
        );
        return array_map([self::class, 'format'], $rows);
    }

    public static function getStockByZone(int $zoneId): array
    {
        $rows = Database::fetchAll(
            "SELECT s.*, p.name AS product_name, p.sku, p.uom
             FROM inventory_stock s
             JOIN inventory_products p ON p.inv_product_id = s.inv_product_id
             WHERE s.zone_id = ? AND p.is_deleted = 0
             ORDER BY p.name ASC",
            [$zoneId]
        );
        return array_map([self::class, 'format'], $rows);
    }

    /**
     * Add (positive) or remove (negative) on-hand quantity for a product/zone,
     * creating the balance row if it does not yet exist. Throws if the resulting
     * current_quantity would be negative.
     */
    public static function upsertStock(int $productId, int $zoneId, float $quantity): bool
    {
        $quantity = round($quantity, 3);
        $existing = self::rowForUpdate($productId, $zoneId);

        if ($existing === null) {
            if ($quantity < 0) {
                throw new RuntimeException('Insufficient stock: no balance exists for this product/zone');
            }
            Database::insert(
                "INSERT INTO inventory_stock
                    (inv_product_id, zone_id, current_quantity, reserved_quantity,
                     available_quantity, last_movement_at)
                 VALUES (?, ?, ?, 0, ?, NOW())",
                [$productId, $zoneId, $quantity, $quantity]
            );
        } else {
            $newCurrent = round((float)$existing['current_quantity'] + $quantity, 3);
            if ($newCurrent < 0) {
                throw new RuntimeException('Insufficient stock: quantity cannot go negative');
            }
            $reserved  = (float)$existing['reserved_quantity'];
            $available = max(0.0, round($newCurrent - $reserved, 3));
            Database::execute(
                "UPDATE inventory_stock
                 SET current_quantity = ?, available_quantity = ?, last_movement_at = NOW()
                 WHERE stock_id = ?",
                [$newCurrent, $available, (int)$existing['stock_id']]
            );
        }

        self::recompute($productId, $zoneId);
        return true;
    }

    public static function reserveStock(int $productId, int $zoneId, float $quantity): bool
    {
        $quantity = round($quantity, 3);
        if ($quantity <= 0) {
            throw new RuntimeException('Reserve quantity must be positive');
        }
        $row = self::rowForUpdate($productId, $zoneId);
        if ($row === null) {
            throw new RuntimeException('No stock to reserve for this product/zone');
        }
        $available = (float)$row['current_quantity'] - (float)$row['reserved_quantity'];
        if ($quantity > $available) {
            throw new RuntimeException('Cannot reserve more than available stock');
        }
        $newReserved  = round((float)$row['reserved_quantity'] + $quantity, 3);
        $newAvailable = max(0.0, round((float)$row['current_quantity'] - $newReserved, 3));
        Database::execute(
            "UPDATE inventory_stock
             SET reserved_quantity = ?, available_quantity = ?
             WHERE stock_id = ?",
            [$newReserved, $newAvailable, (int)$row['stock_id']]
        );
        self::recompute($productId, $zoneId);
        return true;
    }

    public static function releaseReserved(int $productId, int $zoneId, float $quantity): bool
    {
        $quantity = round($quantity, 3);
        if ($quantity <= 0) {
            throw new RuntimeException('Release quantity must be positive');
        }
        $row = self::rowForUpdate($productId, $zoneId);
        if ($row === null) {
            throw new RuntimeException('No stock row for this product/zone');
        }
        $newReserved = round((float)$row['reserved_quantity'] - $quantity, 3);
        if ($newReserved < 0) {
            $newReserved = 0.0; // never release more than is reserved
        }
        $newAvailable = max(0.0, round((float)$row['current_quantity'] - $newReserved, 3));
        Database::execute(
            "UPDATE inventory_stock
             SET reserved_quantity = ?, available_quantity = ?
             WHERE stock_id = ?",
            [$newReserved, $newAvailable, (int)$row['stock_id']]
        );
        self::recompute($productId, $zoneId);
        return true;
    }

    public static function getLowStockProducts(): array
    {
        $rows = Database::fetchAll(
            "SELECT s.*, p.name AS product_name, p.sku, p.uom, p.reorder_level AS product_reorder_level,
                    z.zone_name, z.zone_code, z.zone_type
             FROM inventory_stock s
             JOIN inventory_products p ON p.inv_product_id = s.inv_product_id
             JOIN inventory_zones z ON z.zone_id = s.zone_id
             WHERE s.is_low_stock = 1 AND p.is_deleted = 0
             ORDER BY s.available_quantity ASC, p.name ASC",
            []
        );
        return array_map([self::class, 'format'], $rows);
    }

    /**
     * Recompute health_score + is_low_stock for every balance row of a product,
     * then return true. health_score is a simple 0-100 cover ratio against the
     * product reorder_level (intelligence layer can refine this in a later prompt).
     */
    public static function updateHealthScore(int $productId): bool
    {
        $product = Database::fetch(
            "SELECT reorder_level FROM inventory_products WHERE inv_product_id = ? LIMIT 1",
            [$productId]
        );
        if ($product === null) {
            return false;
        }
        $reorder = (float)$product['reorder_level'];

        $rows = Database::fetchAll(
            "SELECT stock_id, available_quantity FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        );
        foreach ($rows as $row) {
            $available = (float)$row['available_quantity'];
            $isLow = $reorder > 0 && $available <= $reorder ? 1 : 0;
            $health = self::healthFor($available, $reorder);
            Database::execute(
                "UPDATE inventory_stock SET is_low_stock = ?, health_score = ? WHERE stock_id = ?",
                [$isLow, $health, (int)$row['stock_id']]
            );
        }
        return true;
    }

    private static function recompute(int $productId, int $zoneId): void
    {
        // Scoped recompute for the single zone touched; cheaper than the full product sweep.
        $product = Database::fetch(
            "SELECT reorder_level FROM inventory_products WHERE inv_product_id = ? LIMIT 1",
            [$productId]
        );
        $reorder = $product !== null ? (float)$product['reorder_level'] : 0.0;

        $row = self::row($productId, $zoneId);
        if ($row === null) {
            return;
        }
        $available = (float)$row['available_quantity'];
        $isLow  = $reorder > 0 && $available <= $reorder ? 1 : 0;
        $health = self::healthFor($available, $reorder);
        Database::execute(
            "UPDATE inventory_stock SET is_low_stock = ?, health_score = ? WHERE stock_id = ?",
            [$isLow, $health, (int)$row['stock_id']]
        );
    }

    private static function healthFor(float $available, float $reorder): float
    {
        if ($reorder <= 0) {
            return 100.00; // no reorder threshold defined → treat as healthy
        }
        $ratio = ($available / $reorder) * 100.0;
        return round(max(0.0, min(100.0, $ratio)), 2);
    }

    private static function row(int $productId, int $zoneId): ?array
    {
        return Database::fetch(
            "SELECT * FROM inventory_stock WHERE inv_product_id = ? AND zone_id = ? LIMIT 1",
            [$productId, $zoneId]
        );
    }

    /**
     * Same as row(), but locks the matching row with FOR UPDATE so concurrent
     * balance mutations for the same product/zone serialize on this row.
     * Callers must already be inside a transaction (Database::beginTransaction()).
     */
    private static function rowForUpdate(int $productId, int $zoneId): ?array
    {
        return Database::fetch(
            "SELECT * FROM inventory_stock WHERE inv_product_id = ? AND zone_id = ? LIMIT 1 FOR UPDATE",
            [$productId, $zoneId]
        );
    }

    private static function format(array $row): array
    {
        $row['is_low_stock'] = (int)($row['is_low_stock'] ?? 0) === 1;
        return $row;
    }
}
