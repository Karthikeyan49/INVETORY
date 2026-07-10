<?php
declare(strict_types=1);

/**
 * AdminIncentiveController — HR Incentive Payments (R7 / T10). Output-based pay,
 * kept separate from fixed payroll. Off-books extra is gated by tax_view; paying
 * an incentive posts an expense so it reaches Finance / P&L.
 */
class AdminIncentiveController
{
    private static function isExtended(Request $request): bool
    {
        return strtolower((string)($request->user['tax_view'] ?? 'standard')) === 'extended';
    }

    private static function gate(array $row, bool $extended): array
    {
        if (!$extended) {
            unset($row['extra_amount']);
        }
        return $row;
    }

    // GET /admin/incentives
    public function index(Request $request): void
    {
        $extended = self::isExtended($request);
        $result = Incentive::all(
            [
                'status'      => $request->query('status'),
                'period'      => $request->query('period'),
                'employee_id' => $request->query('employee_id'),
                'search'      => $request->query('search'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 200)
        );
        $rows = array_map(fn($r) => self::gate($r, $extended), $result['rows']);
        // Summary tiles (paid / unpaid totals), tax-gated.
        $paid = 0.0; $unpaid = 0.0;
        foreach ($rows as $r) {
            $amt = (float)$r['amount'] + ($extended ? (float)($r['extra_amount'] ?? 0) : 0.0);
            if (($r['status'] ?? '') === 'paid') { $paid += $amt; } else { $unpaid += $amt; }
        }
        Response::paginated($rows, [
            'page' => 1, 'limit' => 200, 'total' => $result['total'], 'total_pages' => 1,
            'summary' => ['paid' => round($paid, 2), 'unpaid' => round($unpaid, 2)],
        ]);
    }

    // GET /admin/incentives/{id}
    public function show(Request $request): void
    {
        $inc = Incentive::find((int)$request->param('id'));
        if (!$inc) {
            Response::error('Incentive not found', 404);
        }
        Response::success(self::gate($inc, self::isExtended($request)));
    }

    // POST /admin/incentives
    public function store(Request $request): void
    {
        $data = $request->only([
            'employee_id', 'person_name', 'basis', 'rate', 'units', 'base_amount', 'extra_amount',
            'period', 'status', 'payment_category', 'utr_no', 'notes',
        ]);
        if (empty($data['person_name'])) {
            Response::error('Payee name is required', 422);
        }
        if (!self::isExtended($request)) {
            unset($data['extra_amount']);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        $id = Incentive::create($data);
        Response::success(self::gate(Incentive::find($id), self::isExtended($request)), 'Incentive created', 201);
    }

    // PUT /admin/incentives/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $data = $request->only([
            'employee_id', 'person_name', 'basis', 'rate', 'units', 'base_amount', 'extra_amount',
            'period', 'payment_category', 'utr_no', 'notes',
        ]);
        if (!self::isExtended($request)) {
            unset($data['extra_amount']);
        }
        if (!Incentive::update($id, $data)) {
            Response::error('Incentive not found', 404);
        }
        Response::success(self::gate(Incentive::find($id), self::isExtended($request)), 'Incentive updated');
    }

    // POST /admin/incentives/{id}/pay
    public function pay(Request $request): void
    {
        $id = (int)$request->param('id');
        $data = $request->only(['paid_on', 'payment_category', 'utr_no']);
        $data['created_by'] = $request->user['user_id'] ?? null;
        $updated = Incentive::markPaid($id, $data);
        if (!$updated) {
            Response::error('Incentive not found', 404);
        }
        Response::success(self::gate($updated, self::isExtended($request)), 'Incentive marked paid');
    }

    // DELETE /admin/incentives/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Incentive::find($id)) {
            Response::error('Incentive not found', 404);
        }
        Incentive::delete($id);
        Response::success(null, 'Incentive deleted');
    }
}
