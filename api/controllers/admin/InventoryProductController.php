<?php
declare(strict_types=1);

class InventoryProductController
{
    public function index(Request $request): void
    {
        $products = InventoryProduct::getAll([
            'search'    => $request->query('search'),
            'category'  => $request->query('category'),
            'is_active' => $request->query('is_active'),
        ]);
        Response::success($products);
    }

    public function store(Request $request): void
    {
        $data = $request->only([
            'name', 'sku', 'category', 'unit_of_measure', 'uom', 'hsn_code',
            'reorder_level', 'reorder_quantity', 'cost_price', 'selling_price',
            'source_product_id', 'is_active',
        ]);
        // Accept either unit_of_measure or uom on input.
        $unit = $data['unit_of_measure'] ?? $data['uom'] ?? null;

        Validator::make(
            ['unit_of_measure' => $unit] + $data,
            [
                'name'            => 'required|string|max:255',
                'sku'             => 'required|string|max:60',
                'category'        => 'required|string|max:100',
                'unit_of_measure' => 'required|in:' . implode(',', InventoryProduct::UNITS),
                'hsn_code'        => 'string|max:8',
                'reorder_level'   => 'required|numeric|min:0',
                'cost_price'      => 'required|numeric|min:0',
            ]
        )->validate();

        if (InventoryProduct::existsBySku((string)$data['sku'])) {
            Response::validationError(['sku' => ['SKU already exists']]);
        }

        $data['unit_of_measure'] = $unit;
        $data['created_by'] = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;

        $id = InventoryProduct::create($data);

        InventoryMovement::audit(
            'inventory_products', $id, 'CREATE', null, InventoryProduct::findById($id),
            $data['created_by'], $request->ip()
        );

        Response::success(InventoryProduct::findById($id), 'Product created successfully', 201);
    }

    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $product = InventoryProduct::findById($id);
        if ($product === null) {
            Response::error('Product not found', 404);
        }
        Response::success($product);
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = InventoryProduct::findById($id);
        if ($existing === null) {
            Response::error('Product not found', 404);
        }

        $data = $request->only([
            'name', 'sku', 'category', 'unit_of_measure', 'uom', 'hsn_code',
            'reorder_level', 'reorder_quantity', 'cost_price', 'selling_price',
            'source_product_id', 'is_active',
        ]);

        $rules = [];
        if (array_key_exists('name', $data))          { $rules['name'] = 'string|max:255'; }
        if (array_key_exists('sku', $data))           { $rules['sku'] = 'string|max:60'; }
        if (array_key_exists('category', $data))      { $rules['category'] = 'string|max:100'; }
        if (isset($data['unit_of_measure']) || isset($data['uom'])) {
            $data['unit_of_measure'] = $data['unit_of_measure'] ?? $data['uom'];
            $rules['unit_of_measure'] = 'in:' . implode(',', InventoryProduct::UNITS);
        }
        if (array_key_exists('hsn_code', $data))      { $rules['hsn_code'] = 'string|max:8'; }
        if (array_key_exists('reorder_level', $data)) { $rules['reorder_level'] = 'numeric|min:0'; }
        if (array_key_exists('cost_price', $data))    { $rules['cost_price'] = 'numeric|min:0'; }

        if ($rules) {
            Validator::make($data, $rules)->validate();
        }

        if (isset($data['sku']) && InventoryProduct::existsBySku((string)$data['sku'], $id)) {
            Response::validationError(['sku' => ['SKU already exists']]);
        }

        InventoryProduct::update($id, $data);

        $performedBy = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
        InventoryMovement::audit(
            'inventory_products', $id, 'UPDATE', $existing, InventoryProduct::findById($id),
            $performedBy, $request->ip()
        );

        Response::success(InventoryProduct::findById($id), 'Product updated successfully');
    }

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = InventoryProduct::findById($id);
        if ($existing === null) {
            Response::error('Product not found', 404);
        }

        InventoryProduct::softDelete($id);

        $performedBy = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
        InventoryMovement::audit(
            'inventory_products', $id, 'DELETE', $existing, null, $performedBy, $request->ip()
        );

        Response::success(null, 'Product deleted successfully');
    }

    public function search(Request $request): void
    {
        $term = trim((string)$request->query('q', $request->query('search', '')));
        if ($term === '') {
            Response::success([]);
        }
        Response::success(InventoryProduct::getAll(['search' => $term]));
    }
}
