<?php
declare(strict_types=1);

class AdminInventoryController
{
    public function index(Request $request): void
    {
        $result = Inventory::list(
            [
                'search' => $request->query('search'),
                'low_stock' => $request->query('low_stock') === '1' || $request->query('low_stock') === 'true',
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function movements(Request $request): void
    {
        $productId = (int)$request->param('productId');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }

        $result = Inventory::movements(
            $productId,
            $request->query('location_id') !== null ? (int)$request->query('location_id') : null,
            (int)$request->query('page', 1),
            (int)$request->query('limit', 50)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function adjustment(Request $request): void
    {
        $productId = (int)$request->input('product_id', 0);
        $direction = trim((string)$request->input('direction', ''));
        $quantity = (float)$request->input('quantity', 0);
        $reason = trim((string)$request->input('reason', ''));

        if ($reason === '') {
            Response::error('reason is required', 422);
        }

        Database::beginTransaction();
        try {
            $adjustmentNumber = NumberSequence::next('ADJ');
            $movementId = Inventory::postMovement([
                'product_id' => $productId,
                'location_id' => (int)$request->input('location_id', Inventory::defaultLocationId()),
                'direction' => $direction,
                'quantity' => $quantity,
                'unit_cost' => $request->input('unit_cost'),
                'ref_type' => 'adjustment',
                'ref_id' => null,
                'note' => $adjustmentNumber . ': ' . $reason,
                'created_by' => isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
            ]);
            Database::execute(
                'INSERT INTO audit_log (user_id, action, table_name, record_id, new_value, ip_address, created_at)
                 VALUES (?, "stock_adjusted", "stock_movements", ?, ?, ?, NOW())',
                [
                    isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
                    $movementId,
                    json_encode(['adjustment_number' => $adjustmentNumber, 'reason' => $reason], JSON_UNESCAPED_UNICODE),
                    $request->ip(),
                ]
            );
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Stock adjustment error: ' . $e->getMessage());
            Response::error('Could not post stock adjustment', 500);
        }

        Response::success(['movement_id' => $movementId], 'Stock adjustment posted', 201);
    }

    public function reconcile(Request $request): void
    {
        Database::beginTransaction();
        try {
            $result = Inventory::reconcile();
            Database::execute(
                'INSERT INTO audit_log (user_id, action, table_name, new_value, ip_address, created_at)
                 VALUES (?, "stock_reconciled", "stock_items", ?, ?, NOW())',
                [
                    isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
                    json_encode($result, JSON_UNESCAPED_UNICODE),
                    $request->ip(),
                ]
            );
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Stock reconcile error: ' . $e->getMessage());
            Response::error('Could not reconcile stock', 500);
        }

        Response::success($result, 'Inventory reconciled');
    }

    public function valuation(Request $request): void
    {
        Response::success(Inventory::valuation());
    }

    public function locations(Request $request): void
    {
        Response::success(Inventory::locations());
    }
}
