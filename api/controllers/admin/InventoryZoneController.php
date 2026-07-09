<?php
declare(strict_types=1);

class InventoryZoneController
{
    public function index(Request $request): void
    {
        $zones = InventoryZone::getAll([
            'zone_type' => $request->query('zone_type'),
            'is_active' => $request->query('is_active'),
            'search'    => $request->query('search'),
        ]);
        Response::success($zones);
    }

    public function store(Request $request): void
    {
        $data = $request->only([
            'zone_name', 'zone_code', 'zone_type', 'warehouse_location', 'capacity',
            'min_quantity', 'max_quantity', 'is_active',
        ]);

        Validator::make($data, [
            'zone_name' => 'required|string|max:100',
            'zone_code' => 'required|string|max:30',
            'zone_type' => 'required|in:' . implode(',', InventoryZone::TYPES),
        ])->validate();

        if (InventoryZone::existsByCode((string)$data['zone_code'])) {
            Response::validationError(['zone_code' => ['Zone code already exists']]);
        }

        $id = InventoryZone::create($data);

        $performedBy = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
        InventoryMovement::audit(
            'inventory_zones', $id, 'CREATE', null, InventoryZone::findById($id),
            $performedBy, $request->ip()
        );

        Response::success(InventoryZone::findById($id), 'Zone created successfully', 201);
    }

    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $zone = InventoryZone::findById($id);
        if ($zone === null) {
            Response::error('Zone not found', 404);
        }
        Response::success($zone);
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = InventoryZone::findById($id);
        if ($existing === null) {
            Response::error('Zone not found', 404);
        }

        $data = $request->only([
            'zone_name', 'zone_code', 'zone_type', 'warehouse_location', 'capacity',
            'min_quantity', 'max_quantity', 'is_active',
        ]);

        $rules = [];
        if (array_key_exists('zone_name', $data)) { $rules['zone_name'] = 'string|max:100'; }
        if (array_key_exists('zone_code', $data)) { $rules['zone_code'] = 'string|max:30'; }
        if (array_key_exists('zone_type', $data)) { $rules['zone_type'] = 'in:' . implode(',', InventoryZone::TYPES); }
        if ($rules) {
            Validator::make($data, $rules)->validate();
        }

        if (isset($data['zone_code']) && InventoryZone::existsByCode((string)$data['zone_code'], $id)) {
            Response::validationError(['zone_code' => ['Zone code already exists']]);
        }

        InventoryZone::update($id, $data);

        $performedBy = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
        InventoryMovement::audit(
            'inventory_zones', $id, 'UPDATE', $existing, InventoryZone::findById($id),
            $performedBy, $request->ip()
        );

        Response::success(InventoryZone::findById($id), 'Zone updated successfully');
    }

    public function getActive(Request $request): void
    {
        Response::success(InventoryZone::getActiveZones());
    }
}
