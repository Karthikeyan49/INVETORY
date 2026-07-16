<?php
declare(strict_types=1);

/**
 * Delivery challan API (requirement.txt lines 6, 8, 14).
 * Warns at generation time when the linked machine is missing parts.
 */
class DeliveryController
{
    // GET /deliveries
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(200, max(1, (int)$request->query('limit', 50)));
        $filters = [
            'status'        => $request->query('status'),
            'category'      => $request->query('category'),
            'search'        => $request->query('search'),
            'customer_id'   => $request->query('customer_id'),
            'customer_name' => $request->query('customer_name'),
        ];
        $result = DeliveryNote::all($filters, $page, $limit);
        $rows = array_map(fn($r) => $this->gateTax($request, $r), $result['rows']);
        Response::paginated($rows, [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $result['total'],
            'total_pages' => (int)ceil(max(1, $result['total']) / $limit),
            'next_challan' => DeliveryNote::nextChallanNo(),
            'tax_view'    => $this->taxView($request),
        ]);
    }

    // GET /deliveries/{id}
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $row = $id > 0 ? DeliveryNote::find($id) : null;
        if (!$row) {
            Response::error('Delivery note not found', 404);
        }
        Response::success($this->gateTax($request, $row));
    }

    private function taxView(Request $request): string
    {
        return strtolower((string)($request->user['tax_view'] ?? 'standard')) === 'extended'
            ? 'extended' : 'standard';
    }

    private function gateTax(Request $request, array $row): array
    {
        if ($this->taxView($request) !== 'extended') {
            unset($row['extra_amount'], $row['extra_from_vendor']);
        }
        return $row;
    }

    // POST /deliveries
    public function store(Request $request): void
    {
        $data = $request->only([
            'challan_no', 'customer_id', 'customer_name', 'machine_id',
            'category', 'items', 'amount', 'tax_amount', 'extra_amount', 'extra_from_vendor',
            'status', 'delivery_date', 'notes',
        ]);
        // Line 2/18: only the extended login may record the off-books extras.
        if ($this->taxView($request) !== 'extended') {
            unset($data['extra_amount'], $data['extra_from_vendor']);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;

        // Line 8: surface a warning (do not hard-block) if the machine is incomplete.
        $warning = null;
        if (!empty($data['machine_id'])) {
            $missing = Machine::missingParts((int)$data['machine_id']);
            if ($missing) {
                $names = implode(', ', array_map(fn($p) => $p['part_name'], $missing));
                $warning = "Machine is missing part(s): $names. Delivering an incomplete machine.";
            }
        }

        $id = DeliveryNote::create($data);
        Response::success(
            array_merge(DeliveryNote::find($id) ?? [], ['warning' => $warning]),
            $warning ? 'Challan created — WARNING: ' . $warning : 'Delivery challan created',
            201
        );
    }

    // PUT /deliveries/{id}/status
    public function updateStatus(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !DeliveryNote::find($id)) {
            Response::error('Delivery note not found', 404);
        }
        if (!DeliveryNote::updateStatus($id, (string)$request->input('status', ''))) {
            Response::error('Invalid status. Allowed: ' . implode(', ', DeliveryNote::STATUSES), 422);
        }
        Response::success(DeliveryNote::find($id), 'Status updated');
    }
}
