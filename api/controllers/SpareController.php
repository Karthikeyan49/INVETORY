<?php
declare(strict_types=1);

/**
 * SpareController — spare-parts stock register (R6 / T6): CRUD + stock movements
 * (receive/consume/issue), low-stock notification and stock-out forecasting.
 */
class SpareController
{
    // GET /spares
    public function index(Request $request): void
    {
        $result = Spare::all(
            [
                'category'  => $request->query('category'),
                'search'    => $request->query('search'),
                'low_stock' => $request->query('low_stock'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 200)
        );
        Response::paginated($result['rows'], [
            'page' => 1,
            'limit' => 200,
            'total' => $result['total'],
            'total_pages' => 1,
            'categories' => $result['categories'],
        ]);
    }

    // GET /spares/low-stock  (before {id})
    public function lowStock(Request $request): void
    {
        $rows = Spare::lowStock();
        Response::success(['count' => count($rows), 'rows' => $rows]);
    }

    // GET /spares/forecast  (before {id})
    public function forecast(Request $request): void
    {
        $window = max(7, min(365, (int)$request->query('window', 90)));
        Response::success(Spare::forecast($window));
    }

    // GET /spares/{id}
    public function show(Request $request): void
    {
        $spare = Spare::find((int)$request->param('id'));
        if (!$spare) {
            Response::error('Spare not found', 404);
        }
        $spare['movements'] = Spare::movements((int)$request->param('id'));
        Response::success($spare);
    }

    // POST /spares
    public function store(Request $request): void
    {
        $data = $request->only(['name', 'part_no', 'category', 'quantity', 'unit', 'unit_cost', 'reorder_level', 'location', 'notes']);
        if (empty($data['name'])) {
            Response::error('name is required', 422);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        $id = Spare::create($data);
        Response::success(Spare::find($id), 'Spare added', 201);
    }

    // PUT /spares/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Spare::find($id)) {
            Response::error('Spare not found', 404);
        }
        $data = $request->only(['name', 'part_no', 'category', 'quantity', 'unit', 'unit_cost', 'reorder_level', 'location', 'notes']);
        if (!Spare::update($id, $data)) {
            Response::error('Provide at least one field to update', 400);
        }
        Response::success(Spare::find($id), 'Spare updated');
    }

    // POST /spares/{id}/move  { qty, reason, machine_id?, note? }
    public function move(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Spare::find($id)) {
            Response::error('Spare not found', 404);
        }
        $qty = (int)$request->input('qty', 0);
        if ($qty === 0) {
            Response::error('qty is required', 422);
        }
        $reason = (string)$request->input('reason', 'adjust');
        $machineId = $request->input('machine_id') ? (int)$request->input('machine_id') : null;
        $note = $request->input('note') ? trim((string)$request->input('note')) : null;
        $newQty = Spare::move($id, $qty, $reason, $machineId, $note, $request->user['user_id'] ?? null);
        Response::success(['spare' => Spare::find($id), 'quantity' => $newQty], 'Stock updated');
    }

    // DELETE /spares/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Spare::find($id)) {
            Response::error('Spare not found', 404);
        }
        Spare::delete($id);
        Response::success(null, 'Spare deleted');
    }
}
