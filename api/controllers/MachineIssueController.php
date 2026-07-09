<?php
declare(strict_types=1);

/**
 * Machine Issues API — report a fault against a machine, track where it is
 * (place) and its repair stage (process), then resolve it to send the machine
 * back to the Machines page.
 */
class MachineIssueController
{
    // GET /machine-issues
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(200, max(1, (int)$request->query('limit', 100)));
        $filters = [
            'status'     => $request->query('status'),
            'machine_id' => $request->query('machine_id'),
            'search'     => $request->query('search'),
        ];
        $result = MachineIssue::all($filters, $page, $limit);
        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $result['total'],
            'total_pages' => (int)ceil(max(1, $result['total']) / $limit),
            'stages'      => MachineIssue::STAGES,
        ]);
    }

    // POST /machine-issues
    public function store(Request $request): void
    {
        $data = $request->only(['machine_id', 'title', 'description', 'place', 'process', 'status']);
        if (empty($data['machine_id'])) {
            Response::error('machine_id is required', 422);
        }
        if (empty($data['title'])) {
            Response::error('title is required', 422);
        }
        if (!Machine::find((int)$data['machine_id'])) {
            Response::error('Machine not found', 404);
        }
        $data['reported_by'] = $request->user['user_id'] ?? null;
        $id = MachineIssue::create($data);
        Response::success(MachineIssue::find($id), 'Issue reported', 201);
    }

    // GET /machine-issues/{id}
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $issue = $id > 0 ? MachineIssue::find($id) : null;
        if (!$issue) {
            Response::error('Issue not found', 404);
        }
        Response::success($issue);
    }

    // PUT /machine-issues/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !MachineIssue::find($id)) {
            Response::error('Issue not found', 404);
        }
        $data = $request->only(['title', 'description', 'place', 'process', 'status']);
        if (!MachineIssue::update($id, $data)) {
            Response::error('Provide at least one field to update', 400);
        }
        Response::success(MachineIssue::find($id), 'Issue updated');
    }

    // PUT /machine-issues/{id}/resolve
    public function resolve(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !MachineIssue::resolve($id)) {
            Response::error('Issue not found', 404);
        }
        Response::success(MachineIssue::find($id), 'Issue resolved — machine returned to stock');
    }

    // PUT /machine-issues/{id}/reopen
    public function reopen(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !MachineIssue::reopen($id)) {
            Response::error('Issue not found', 404);
        }
        Response::success(MachineIssue::find($id), 'Issue reopened');
    }

    // DELETE /machine-issues/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !MachineIssue::destroy($id)) {
            Response::error('Issue not found', 404);
        }
        Response::success(null, 'Issue deleted');
    }
}
