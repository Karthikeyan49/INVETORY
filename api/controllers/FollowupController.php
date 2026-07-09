<?php
declare(strict_types=1);

/**
 * Follow-up API (requirement.txt — Module 6). Salesperson reminders that surface
 * on both the admin and the assigned salesperson's dashboard.
 */
class FollowupController
{
    // GET /followups
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(200, max(1, (int)$request->query('limit', 50)));
        $filters = [
            'status'      => $request->query('status'),
            'assigned_to' => $request->query('assigned_to'),
            'category'    => $request->query('category'),
            'search'      => $request->query('search'),
        ];
        // A salesperson only sees their own follow-ups; owners/accountants see all.
        if ($this->isSalesperson($request)) {
            $filters['assigned_to'] = (int)($request->user['user_id'] ?? 0);
        }
        $result = Followup::all($filters, $page, $limit);
        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $result['total'],
            'total_pages' => (int)ceil(max(1, $result['total']) / $limit),
        ]);
    }

    // GET /followups/due
    public function due(Request $request): void
    {
        $days = (int)$request->query('days', 0);
        $assignedTo = $this->isSalesperson($request) ? (int)($request->user['user_id'] ?? 0) : null;
        Response::success(Followup::due($assignedTo, $days));
    }

    // POST /followups
    public function store(Request $request): void
    {
        $data = $request->only([
            'customer_id', 'customer_name', 'machine_id', 'assigned_to', 'title', 'category', 'note', 'followup_date', 'status',
        ]);
        if (empty($data['title'])) {
            Response::error('title is required', 422);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        // Salespeople default to self-assignment.
        if (empty($data['assigned_to']) && $this->isSalesperson($request)) {
            $data['assigned_to'] = (int)($request->user['user_id'] ?? 0);
        }
        $id = Followup::create($data);
        Response::success(Followup::find($id), 'Follow-up created', 201);
    }

    // PUT /followups/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Followup::find($id)) {
            Response::error('Follow-up not found', 404);
        }
        $data = $request->only([
            'customer_name', 'machine_id', 'assigned_to', 'title', 'category', 'note', 'followup_date', 'status',
        ]);
        Followup::update($id, $data);
        Response::success(Followup::find($id), 'Follow-up updated');
    }

    private function isSalesperson(Request $request): bool
    {
        return strtolower((string)($request->user['staff_role'] ?? '')) === 'sales';
    }
}
