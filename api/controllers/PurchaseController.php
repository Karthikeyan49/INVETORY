<?php
declare(strict_types=1);

/**
 * Purchases API — record vendor purchases (cash/credit) with taxable+GST+extra,
 * advance/outstanding, and location. Each purchase posts a matching Expense so
 * it flows into the Profit & Loss report.
 */
class PurchaseController
{
    private static function isExtended(Request $request): bool
    {
        return strtolower((string)($request->user['tax_view'] ?? 'standard')) === 'extended';
    }

    // GET /purchases
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(500, max(1, (int)$request->query('limit', 200)));
        $filters = [
            'search'   => $request->query('search'),
            'type'     => $request->query('type'),
            'location' => $request->query('location'),
        ];
        $result   = Purchase::all($filters, $page, $limit);
        $extended = self::isExtended($request);
        foreach ($result['rows'] as &$r) {
            if (!$extended) {
                $r['extra_amount'] = 0.0;   // off-books extra: extended login only
            }
        }
        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $result['total'],
            'total_pages' => (int)ceil(max(1, $result['total']) / $limit),
            'locations'   => Purchase::distinctLocations(),
        ]);
    }

    // GET /purchases/locations
    public function locations(Request $request): void
    {
        Response::success(Purchase::distinctLocations());
    }

    // GET /purchases/{id}
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $p  = $id > 0 ? Purchase::find($id) : null;
        if (!$p) {
            Response::error('Purchase not found', 404);
        }
        if (!self::isExtended($request)) {
            $p['extra_amount'] = 0.0;
        }
        Response::success($p);
    }

    // POST /purchases
    public function store(Request $request): void
    {
        $data = $request->only([
            'vendor_name', 'location', 'purchase_type', 'taxable', 'gst_pct', 'extra_amount',
            'advance', 'payment_method', 'purchase_date', 'notes',
        ]);
        if (empty($data['vendor_name'])) {
            Response::error('vendor_name is required', 422);
        }
        if (!isset($data['taxable']) || !is_numeric($data['taxable'])) {
            Response::error('taxable amount is required', 422);
        }
        // Off-books extra only for the extended tax login.
        if (!self::isExtended($request)) {
            $data['extra_amount'] = 0;
        }
        $data['created_by'] = $request->user['user_id'] ?? null;

        $id = Purchase::create($data);
        $purchase = Purchase::find($id);

        // Book it as an expense so it flows into Profit & Loss.
        $this->postExpense($purchase);

        if (!self::isExtended($request)) {
            $purchase['extra_amount'] = 0.0;
        }
        Response::success($purchase, 'Purchase recorded', 201);
    }

    // PUT /purchases/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Purchase::find($id)) {
            Response::error('Purchase not found', 404);
        }
        $data = $request->only([
            'vendor_name', 'location', 'purchase_type', 'taxable', 'gst_pct', 'extra_amount',
            'advance', 'payment_method', 'purchase_date', 'notes',
        ]);
        if (!self::isExtended($request)) {
            unset($data['extra_amount']);
        }
        if (!Purchase::update($id, $data)) {
            Response::error('Nothing to update', 400);
        }
        $p = Purchase::find($id);
        if (!self::isExtended($request)) {
            $p['extra_amount'] = 0.0;
        }
        Response::success($p, 'Purchase updated');
    }

    // POST /purchases/{id}/payment
    public function payment(Request $request): void
    {
        $id     = (int)$request->param('id');
        $amount = (float)$request->input('amount', 0);
        if ($id <= 0 || !Purchase::find($id)) {
            Response::error('Purchase not found', 404);
        }
        if ($amount <= 0) {
            Response::error('amount must be greater than 0', 422);
        }
        Purchase::recordPayment($id, $amount);
        Response::success(Purchase::find($id), 'Payment recorded');
    }

    // DELETE /purchases/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Purchase::destroy($id)) {
            Response::error('Purchase not found', 404);
        }
        Response::success(null, 'Purchase deleted');
    }

    /** Mirror the purchase into the expense ledger (official total, GST-inclusive). */
    private function postExpense(array $purchase): void
    {
        try {
            $count = Database::count('SELECT COUNT(*) AS cnt FROM expenses');
            $code  = 'EXP-' . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);
            $mode  = in_array($purchase['payment_method'] ?? '', Purchase::PAYMENT_MODES, true)
                ? $purchase['payment_method'] : 'Bank Transfer';
            Database::insert(
                'INSERT INTO expenses
                    (expense_code, expense_date, category, vendor, description, amount, payment_mode, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $code,
                    !empty($purchase['purchase_date']) ? $purchase['purchase_date'] : date('Y-m-d'),
                    'Purchase',
                    (string)$purchase['vendor_name'],
                    'Purchase ' . ($purchase['purchase_no'] ?? ''),
                    (float)$purchase['total'],
                    $mode,
                    $purchase['created_by'] ?? null,
                ]
            );
        } catch (\Throwable $e) {
            error_log('[PurchaseController::postExpense] ' . $e->getMessage());
        }
    }
}
