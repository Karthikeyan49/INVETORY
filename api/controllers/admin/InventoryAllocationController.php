<?php
declare(strict_types=1);

class InventoryAllocationController
{
    /**
     * POST /admin/inventory/allocate
     * Manually (re)run the allocation engine for a product/quantity. Requires an
     * existing STOCK_IN movement to define the intake zone; if movement_id is
     * omitted, the engine resolves the intake zone from current balances.
     */
    public function triggerAllocation(Request $request): void
    {
        $data = $request->only(['product_id', 'quantity', 'movement_id']);

        Validator::make($data, [
            'product_id' => 'required|integer',
            'quantity'   => 'required|numeric|min:0.001',
        ])->validate();

        $productId = (int)$data['product_id'];
        $quantity  = (float)$data['quantity'];

        if (InventoryProduct::findById($productId) === null) {
            Response::validationError(['product_id' => ['Product does not exist']]);
        }

        $movementId = isset($data['movement_id']) && $data['movement_id'] !== ''
            ? (int)$data['movement_id'] : 0;
        $actorId = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;

        try {
            $engine = new SmartAllocationEngine();
            $result = $engine->allocate($productId, $quantity, $movementId, $actorId, $request->ip());
        } catch (Throwable $e) {
            error_log('Allocation error: ' . $e->getMessage());
            Response::error($e instanceof RuntimeException ? $e->getMessage() : 'Allocation failed', 422);
        }

        Response::success($result, 'Stock allocated successfully');
    }

    /** GET /admin/inventory/allocate/{productId} */
    public function getAllocationHistory(Request $request): void
    {
        $productId = (int)$request->param('productId');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }
        if (InventoryProduct::findById($productId) === null) {
            Response::error('Product not found', 404);
        }
        $model = new InventoryAllocation();
        Response::success($model->getAllocationHistory($productId));
    }

    /** GET /admin/inventory/zones/distribution?product_id=N */
    public function getZoneDistribution(Request $request): void
    {
        $productId = (int)$request->query('product_id', 0);
        if ($productId <= 0) {
            Response::error('product_id query parameter is required', 400);
        }
        if (InventoryProduct::findById($productId) === null) {
            Response::error('Product not found', 404);
        }
        $model = new InventoryAllocation();
        Response::success($model->getZoneDistribution($productId));
    }

    /**
     * POST /admin/inventory/allocate/manual
     * { product_id, quantity, zone_id, override_reason, source_zone_id? }
     */
    public function manualOverride(Request $request): void
    {
        $data = $request->only(['product_id', 'quantity', 'zone_id', 'override_reason', 'source_zone_id']);

        Validator::make($data, [
            'product_id'      => 'required|integer',
            'quantity'        => 'required|numeric|min:0.001',
            'zone_id'         => 'required|integer',
            'override_reason' => 'required|string|min:10',
        ])->validate();

        $productId = (int)$data['product_id'];
        $zoneId    = (int)$data['zone_id'];
        $quantity  = (float)$data['quantity'];

        if (InventoryProduct::findById($productId) === null) {
            Response::validationError(['product_id' => ['Product does not exist']]);
        }
        if (InventoryZone::findById($zoneId) === null) {
            Response::validationError(['zone_id' => ['Zone does not exist']]);
        }

        $sourceZoneId = isset($data['source_zone_id']) && $data['source_zone_id'] !== ''
            ? (int)$data['source_zone_id'] : null;
        $actorId = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;

        try {
            $engine = new SmartAllocationEngine();
            $result = $engine->manualAllocate(
                $productId, $zoneId, $quantity, (string)$data['override_reason'],
                $sourceZoneId, $actorId, $request->ip()
            );
        } catch (Throwable $e) {
            error_log('Manual allocation error: ' . $e->getMessage());
            Response::error($e instanceof RuntimeException ? $e->getMessage() : 'Manual allocation failed', 422);
        }

        Response::success($result, 'Manual allocation completed');
    }

    /**
     * GET /admin/inventory/allocate/pending
     * Products that have outstanding dealer reservations awaiting stock.
     */
    public function getPendingAllocations(Request $request): void
    {
        $rows = Database::fetchAll(
            "SELECT d.inv_product_id, p.name AS product_name, p.sku,
                    COUNT(*) AS dealer_count,
                    SUM(d.suggested_reserve_qty) AS total_reserved,
                    MAX(d.confidence_score) AS top_confidence
             FROM inventory_dealer_demand d
             JOIN inventory_products p ON p.inv_product_id = d.inv_product_id
             WHERE d.suggested_reserve_qty > 0 AND p.is_deleted = 0
             GROUP BY d.inv_product_id, p.name, p.sku
             ORDER BY top_confidence DESC, total_reserved DESC",
            []
        );
        Response::success($rows);
    }
}
