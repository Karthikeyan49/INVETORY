<?php
declare(strict_types=1);

/**
 * Inventory Items API — a simple stock register (add an item + how many are in
 * stock), shown in a table just like the Machines page.
 */
class InventoryItemController
{
    // GET /inventory-items
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(500, max(1, (int)$request->query('limit', 200)));
        $filters = [
            'category'  => $request->query('category'),
            'search'    => $request->query('search'),
            'low_stock' => $request->query('low_stock'),
        ];
        $result = InventoryItem::all($filters, $page, $limit);
        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $result['total'],
            'total_pages' => (int)ceil(max(1, $result['total']) / $limit),
            'categories'  => InventoryItem::categories(),
        ]);
    }

    // GET /inventory-items/{id}
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $item = $id > 0 ? InventoryItem::find($id) : null;
        if (!$item) {
            Response::error('Item not found', 404);
        }
        Response::success($item);
    }

    // POST /inventory-items
    public function store(Request $request): void
    {
        $data = $request->only(['name', 'category', 'sku', 'quantity', 'unit_cost', 'unit', 'location', 'notes']);
        if (empty($data['name'])) {
            Response::error('name is required', 422);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        $id = InventoryItem::create($data);
        Response::success(InventoryItem::find($id), 'Item added', 201);
    }

    // PUT /inventory-items/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !InventoryItem::find($id)) {
            Response::error('Item not found', 404);
        }
        $data = $request->only(['name', 'category', 'sku', 'quantity', 'unit_cost', 'unit', 'location', 'notes']);
        if (!InventoryItem::update($id, $data)) {
            Response::error('Provide at least one field to update', 400);
        }
        Response::success(InventoryItem::find($id), 'Item updated');
    }

    // DELETE /inventory-items/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !InventoryItem::destroy($id)) {
            Response::error('Item not found', 404);
        }
        Response::success(null, 'Item deleted');
    }
}
