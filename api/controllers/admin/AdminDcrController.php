<?php
declare(strict_types=1);

/**
 * AdminDcrController — Daily Call Report (R13 / T11), code F-SVS-01.
 * Create / list / view / approve field-visit reports; approval seeds
 * follow-ups (leads) from prospect lines.
 */
class AdminDcrController
{
    // GET /admin/dcr
    public function index(Request $request): void
    {
        $result = Dcr::all(
            [
                'status'      => $request->query('status'),
                'employee_id' => $request->query('employee_id'),
                'from'        => $request->query('from'),
                'to'          => $request->query('to'),
                'search'      => $request->query('search'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 100)
        );
        Response::paginated($result['rows'], [
            'page' => 1, 'limit' => 100, 'total' => $result['total'], 'total_pages' => 1,
        ]);
    }

    // GET /admin/dcr/{id}
    public function show(Request $request): void
    {
        $dcr = Dcr::find((int)$request->param('id'));
        if (!$dcr) {
            Response::error('DCR not found', 404);
        }
        Response::success($dcr);
    }

    // POST /admin/dcr
    public function store(Request $request): void
    {
        $data = $request->only([
            'employee_id', 'employee_name', 'report_date', 'area',
            'opening_km', 'closing_km', 'total_km', 'notes', 'lines',
        ]);
        if (empty($data['employee_name'])) {
            Response::error('Employee name is required', 422);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        $id = Dcr::create($data);
        Response::success(Dcr::find($id), 'Daily Call Report created', 201);
    }

    // PUT /admin/dcr/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $data = $request->only([
            'employee_id', 'employee_name', 'report_date', 'area',
            'opening_km', 'closing_km', 'total_km', 'notes', 'lines',
        ]);
        if (!Dcr::update($id, $data)) {
            Response::error('DCR not found', 404);
        }
        Response::success(Dcr::find($id), 'Daily Call Report updated');
    }

    // POST /admin/dcr/{id}/approve
    public function approve(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Dcr::find($id)) {
            Response::error('DCR not found', 404);
        }
        $result = Dcr::approve($id, $request->user['user_id'] ?? null);
        Response::success(
            ['dcr' => Dcr::find($id), 'leads_seeded' => $result['seeded']],
            $result['seeded'] > 0 ? "Approved — {$result['seeded']} lead(s) created" : 'Approved'
        );
    }

    // DELETE /admin/dcr/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Dcr::find($id)) {
            Response::error('DCR not found', 404);
        }
        Dcr::delete($id);
        Response::success(null, 'DCR deleted');
    }
}
