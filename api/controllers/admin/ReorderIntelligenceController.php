<?php
declare(strict_types=1);

class ReorderIntelligenceController
{
    /** Status values allowed by the reorder suggestion flow (schema + GRN-receive). */
    private const SUGGESTION_STATUSES = ['PENDING', 'ORDERED', 'DISMISSED', 'RECEIVED'];

    // ── Engine 1: Reorder Prediction ──────────────────────────────────────────

    /** GET /admin/inventory/reorder/suggestions */
    public function getAllSuggestions(Request $request): void
    {
        $where = ['1=1'];
        $params = [];

        $status = $request->query('status');
        if ($status !== null && $status !== '') {
            $where[] = 's.status = ?';
            $params[] = (string)$status;
        }

        $whereClause = implode(' AND ', $where);
        $rows = Database::fetchAll(
            "SELECT s.*, p.name AS product_name, p.sku
             FROM inventory_reorder_suggestions s
             JOIN inventory_products p ON p.inv_product_id = s.inv_product_id
             WHERE $whereClause
             ORDER BY s.created_at DESC, s.suggestion_id DESC",
            $params
        );

        Response::success($rows);
    }

    /** GET /admin/inventory/reorder/suggestions/{id} */
    public function getSuggestion(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid suggestion ID', 400);
        }

        $row = Database::fetch(
            "SELECT s.*, p.name AS product_name, p.sku
             FROM inventory_reorder_suggestions s
             JOIN inventory_products p ON p.inv_product_id = s.inv_product_id
             WHERE s.suggestion_id = ?",
            [$id]
        );
        if ($row === null) {
            Response::error('Suggestion not found', 404);
        }

        Response::success($row);
    }

    /** POST /admin/inventory/reorder/generate */
    public function generateSuggestions(Request $request): void
    {
        $engine = new ReorderIntelligence();
        try {
            $result = $engine->generateReorderSuggestions();
        } catch (Throwable $e) {
            error_log('Reorder generation error: ' . $e->getMessage());
            Response::error('Could not generate reorder suggestions', 500);
        }
        Response::success($result, 'Reorder suggestions generated successfully');
    }

    /** PUT /admin/inventory/reorder/suggestions/{id} */
    public function updateSuggestionStatus(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid suggestion ID', 400);
        }

        $data = $request->only(['status']);
        Validator::make($data, [
            'status' => 'required|string|in:' . implode(',', self::SUGGESTION_STATUSES),
        ])->validate();

        $existing = Database::fetch(
            "SELECT suggestion_id FROM inventory_reorder_suggestions WHERE suggestion_id = ?",
            [$id]
        );
        if ($existing === null) {
            Response::error('Suggestion not found', 404);
        }

        Database::execute(
            "UPDATE inventory_reorder_suggestions SET status = ? WHERE suggestion_id = ?",
            [(string)$data['status'], $id]
        );

        Response::success(['suggestion_id' => $id, 'status' => $data['status']], 'Suggestion status updated successfully');
    }

    // ── Engine 2: Dealer Demand Intelligence ──────────────────────────────────

    /** GET /admin/inventory/reorder/dealer-demand */
    public function getDealerDemandProfiles(Request $request): void
    {
        $engine = new ReorderIntelligence();
        Response::success($engine->getAllDealerDemandProfiles());
    }

    /** GET /admin/inventory/reorder/dealer/{dealerId} */
    public function getDealerDemand(Request $request): void
    {
        $dealerId = (int)$request->param('dealerId');
        if ($dealerId <= 0) {
            Response::error('Invalid dealer ID', 400);
        }

        $engine = new ReorderIntelligence();
        try {
            $result = $engine->suggestDealerReservation($dealerId);
        } catch (Throwable $e) {
            error_log('Dealer demand error: ' . $e->getMessage());
            Response::error($e instanceof RuntimeException ? $e->getMessage() : 'Could not load dealer demand', 422);
        }
        Response::success($result);
    }

    /** POST /admin/inventory/reorder/dealer/update */
    public function updateDealerDemand(Request $request): void
    {
        $data = $request->only(['dealer_id', 'product_id']);
        Validator::make($data, [
            'dealer_id'  => 'required|integer',
            'product_id' => 'required|integer',
        ])->validate();

        $engine = new ReorderIntelligence();
        try {
            $result = $engine->updateDealerDemandProfile((int)$data['dealer_id'], (int)$data['product_id']);
        } catch (Throwable $e) {
            error_log('Dealer demand update error: ' . $e->getMessage());
            Response::error($e instanceof RuntimeException ? $e->getMessage() : 'Could not update dealer demand', 422);
        }
        Response::success($result, 'Dealer demand profile updated successfully');
    }

    // ── Engine 3: Consumption Analytics ───────────────────────────────────────

    /** GET /admin/inventory/reorder/consumption/{id} */
    public function getConsumptionTrends(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }
        if (InventoryProduct::findById($productId) === null) {
            Response::error('Product not found', 404);
        }

        $days = (int)$request->query('days', 90);
        if ($days <= 0) {
            $days = 90;
        }

        $engine = new ReorderIntelligence();
        try {
            $result = $engine->getConsumptionTrends($productId, $days);
        } catch (Throwable $e) {
            error_log('Consumption trends error: ' . $e->getMessage());
            Response::error('Could not load consumption trends', 500);
        }
        Response::success($result);
    }

    /** GET /admin/inventory/reorder/consumption/breakdown/{id} */
    public function getConsumptionBreakdown(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }
        if (InventoryProduct::findById($productId) === null) {
            Response::error('Product not found', 404);
        }

        $engine = new ReorderIntelligence();
        Response::success($engine->getConsumptionBreakdown($productId));
    }

    /** GET /admin/inventory/reorder/top-dealers?days=30 */
    public function getTopDealers(Request $request): void
    {
        $days = (int)$request->query('days', 30);
        if ($days <= 0) {
            $days = 30;
        }

        $engine = new ReorderIntelligence();
        Response::success($engine->getTopConsumingDealers($days));
    }

    /** GET /admin/inventory/reorder/top-departments?days=30 */
    public function getTopDepartments(Request $request): void
    {
        $days = (int)$request->query('days', 30);
        if ($days <= 0) {
            $days = 30;
        }

        $engine = new ReorderIntelligence();
        Response::success($engine->getTopConsumingDepartments($days));
    }

    /** GET /admin/inventory/reorder/heatmap/{productId} */
    public function getHeatmap(Request $request): void
    {
        $productId = (int)$request->param('productId');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }
        if (InventoryProduct::findById($productId) === null) {
            Response::error('Product not found', 404);
        }

        $engine = new ReorderIntelligence();
        Response::success($engine->getConsumptionHeatmap($productId));
    }

    // ── AI Demand Forecast (TimesFM) ──────────────────────────────────────────

    /**
     * GET /admin/inventory/reorder/forecast/{productId}
     *
     * Forecast-aware reorder analysis for one product using the TimesFM model:
     * projected daily demand, demand over lead time, reorder point, suggested
     * quantity, and days-until-stockout. Falls back to a recent average (source
     * = 'average') when the model service is unavailable or history is thin.
     */
    public function getForecast(Request $request): void
    {
        $productId = (int)$request->param('productId');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }
        if (InventoryProduct::findById($productId) === null) {
            Response::error('Product not found', 404);
        }

        $service = new DemandForecast();
        Response::success($service->reorderForecast($productId));
    }
}
