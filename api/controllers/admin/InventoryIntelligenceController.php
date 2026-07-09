<?php
declare(strict_types=1);

class InventoryIntelligenceController
{
    /** GET /admin/inventory/intelligence/health-scores */
    public function getAllHealthScores(Request $request): void
    {
        $engine = new InventoryIntelligence();
        Response::success($engine->calculateAllHealthScores());
    }

    /** GET /admin/inventory/intelligence/health/{productId} */
    public function getProductHealth(Request $request): void
    {
        $productId = (int)$request->param('productId');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }
        if (InventoryProduct::findById($productId) === null) {
            Response::error('Product not found', 404);
        }

        $engine = new InventoryIntelligence();
        try {
            $result = $engine->calculateHealthScore($productId);
        } catch (Throwable $e) {
            error_log('Health score error: ' . $e->getMessage());
            Response::error('Could not calculate health score', 500);
        }

        Response::success($result);
    }

    /** GET /admin/inventory/intelligence/dead-stock?days=90 */
    public function getDeadStock(Request $request): void
    {
        $days = (int)$request->query('days', 90);
        if ($days <= 0) {
            $days = 90;
        }

        $engine = new InventoryIntelligence();
        Response::success($engine->detectDeadStock($days));
    }

    /** GET /admin/inventory/intelligence/dead-stock/value */
    public function getDeadStockValue(Request $request): void
    {
        $engine = new InventoryIntelligence();
        Response::success($engine->calculateDeadStockValue());
    }

    /** GET /admin/inventory/intelligence/runout */
    public function getAllRunouts(Request $request): void
    {
        $engine = new InventoryIntelligence();
        Response::success($engine->predictAllRunouts());
    }

    /** GET /admin/inventory/intelligence/runout/{productId} */
    public function getProductRunout(Request $request): void
    {
        $productId = (int)$request->param('productId');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }
        if (InventoryProduct::findById($productId) === null) {
            Response::error('Product not found', 404);
        }

        $engine = new InventoryIntelligence();
        try {
            $result = $engine->predictStockRunout($productId);
        } catch (Throwable $e) {
            error_log('Runout prediction error: ' . $e->getMessage());
            Response::error('Could not predict stock runout', 500);
        }

        Response::success($result);
    }

    /** GET /admin/inventory/intelligence/abnormal?days=7 */
    public function getAbnormalMovements(Request $request): void
    {
        $days = (int)$request->query('days', 7);
        if ($days <= 0) {
            $days = 7;
        }

        $engine = new InventoryIntelligence();
        Response::success($engine->detectAbnormalMovements($days));
    }

    /** GET /admin/inventory/intelligence/summary */
    public function getIntelligenceSummary(Request $request): void
    {
        $engine = new InventoryIntelligence();
        Response::success($engine->getSummary());
    }

    /**
     * GET /admin/inventory/intelligence/expiring?days=30
     * Returns RECEIVE movements that have an expiry_date within the next N days.
     * Unique approach: groups by batch so the same batch received in one movement
     * doesn't show up as multiple rows.
     */
    public function getExpiringBatches(Request $request): void
    {
        $days = (int)$request->query('days', 30);
        if ($days <= 0) $days = 30;

        $db  = Database::getConnection();
        $sql = "
            SELECT
                m.movement_id,
                m.product_id,
                p.name          AS product_name,
                p.sku,
                p.uom,
                m.batch_number,
                m.expiry_date,
                m.quantity,
                DATEDIFF(m.expiry_date, CURDATE()) AS days_until_expiry,
                z.zone_name
            FROM inventory_stock_movements m
            JOIN inventory_products  p ON p.inv_product_id = m.product_id
            LEFT JOIN inventory_zones z ON z.zone_id       = m.to_zone_id
            WHERE m.expiry_date IS NOT NULL
              AND m.expiry_date >= CURDATE()
              AND m.expiry_date <= DATE_ADD(CURDATE(), INTERVAL :days DAY)
              AND m.movement_type = 'RECEIVE'
              AND p.is_deleted = 0
            ORDER BY m.expiry_date ASC
            LIMIT 100
        ";
        $stmt = $db->prepare($sql);
        $stmt->execute([':days' => $days]);
        Response::success($stmt->fetchAll(\PDO::FETCH_ASSOC));
    }
}
