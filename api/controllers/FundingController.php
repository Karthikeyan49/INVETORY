<?php
declare(strict_types=1);

/**
 * Capital & Loans API — equity brought in and loans received/repaid.
 * Feeds the Balance Sheet + financing cash flow on the Financial Statements page.
 */
class FundingController
{
    // GET /funding
    public function index(Request $request): void
    {
        $rows = Funding::all(['type' => $request->query('type')]);
        Response::paginated($rows, [
            'page' => 1, 'limit' => count($rows), 'total' => count($rows), 'total_pages' => 1,
            'summary' => Funding::summary(),
        ]);
    }

    // POST /funding
    public function store(Request $request): void
    {
        $data = $request->only(['entry_type', 'amount', 'entry_date', 'party', 'notes']);
        if (!in_array($data['entry_type'] ?? '', Funding::TYPES, true)) {
            Response::error('entry_type must be capital, loan_in or loan_repaid', 422);
        }
        if (!isset($data['amount']) || !is_numeric($data['amount']) || (float)$data['amount'] <= 0) {
            Response::error('amount must be a positive number', 422);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        $id = Funding::create($data);
        Response::success(Funding::find($id), 'Entry recorded', 201);
    }

    // DELETE /funding/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Funding::destroy($id)) {
            Response::error('Entry not found', 404);
        }
        Response::success(null, 'Entry deleted');
    }
}
