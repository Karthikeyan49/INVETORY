<?php
declare(strict_types=1);

/**
 * Stamping API (requirement.txt — Module 2). Renewal tracking + due alerts.
 */
class StampingController
{
    // GET /stampings
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(200, max(1, (int)$request->query('limit', 50)));
        $filters = [
            'status'     => $request->query('status'),
            'machine_id' => $request->query('machine_id'),
            'search'     => $request->query('search'),
        ];
        $result = Stamping::all($filters, $page, $limit);
        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $result['total'],
            'total_pages' => (int)ceil(max(1, $result['total']) / $limit),
        ]);
    }

    // GET /stampings/due
    public function due(Request $request): void
    {
        $days = (int)$request->query('days', 30);
        Response::success(Stamping::due($days));
    }

    // GET /stampings/alerts  — overdue / due-soon / pending buckets for the dashboard
    public function alerts(Request $request): void
    {
        Response::success(Stamping::alerts((int)$request->query('days', 7)));
    }

    // POST /stampings
    public function store(Request $request): void
    {
        $data = $request->only([
            'machine_id', 'customer_id', 'certificate_no', 'stamp_date', 'expiry_date', 'quarter', 'status', 'notes',
        ]);
        if (empty($data['machine_id'])) {
            Response::error('machine_id is required', 422);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        $id = Stamping::create($data);
        Response::success(Stamping::find($id), 'Stamping recorded', 201);
    }

    // PUT /stampings/{id}/renew
    public function renew(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Stamping::find($id)) {
            Response::error('Stamping not found', 404);
        }
        Stamping::renew($id, $request->input('stamp_date'));
        Response::success(null, 'Stamping renewed');
    }

    // PUT /stampings/{id}/status
    public function updateStatus(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Stamping::find($id)) {
            Response::error('Stamping not found', 404);
        }
        if (!Stamping::updateStatus($id, (string)$request->input('status', ''))) {
            Response::error('Invalid status. Allowed: ' . implode(', ', Stamping::STATUSES), 422);
        }
        Response::success(Stamping::find($id), 'Status updated');
    }
}
