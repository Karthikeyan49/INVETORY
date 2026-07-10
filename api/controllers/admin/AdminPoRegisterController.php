<?php
declare(strict_types=1);

/**
 * AdminPoRegisterController — Purchase Order register (R10 / T4) + the
 * single-page Total Outstanding widget (sum across PO register + vendor
 * purchases + stamping). Off-books extra is gated by tax_view: only the
 * extended login may set it and see it flow into totals/outstanding.
 */
class AdminPoRegisterController
{
    private static function isExtended(Request $request): bool
    {
        return strtolower((string)($request->user['tax_view'] ?? 'standard')) === 'extended';
    }

    /** Attach live paid/outstanding (tax-gated) onto a PO row. */
    private static function withLedger(array $row, bool $extended, array $paidMap): array
    {
        $extra = $extended ? (float)($row['extra_amount'] ?? 0) : 0.0;
        $grand = round((float)$row['total'] + $extra, 2);
        $paid = (float)($paidMap[(int)$row['id']] ?? 0);
        $row['grand_total'] = $grand;
        $row['amount_paid'] = round($paid, 2);
        $row['outstanding'] = round(max(0.0, $grand - $paid), 2);
        $row['payment_status'] = $paid <= 0.005 ? 'unpaid' : ($row['outstanding'] <= 0.005 ? 'paid' : 'partial');
        if (!$extended) {
            unset($row['extra_amount']);
        }
        return $row;
    }

    // GET /admin/po-register
    public function index(Request $request): void
    {
        $extended = self::isExtended($request);
        $result = PoRegister::all(
            [
                'search'   => $request->query('search'),
                'category' => $request->query('category'),
                'status'   => $request->query('status'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 200)
        );
        $paidMap = PaymentInstallment::paidTotalsByType('po_register');
        $rows = array_map(fn($r) => self::withLedger($r, $extended, $paidMap), $result['rows']);
        Response::paginated($rows, [
            'page' => 1,
            'limit' => 200,
            'total' => $result['total'],
            'total_pages' => 1,
            'categories' => $result['categories'],
        ]);
    }

    // GET /admin/po-register/{id}
    public function show(Request $request): void
    {
        $extended = self::isExtended($request);
        $po = PoRegister::find((int)$request->param('id'));
        if (!$po) {
            Response::error('Purchase order not found', 404);
        }
        $paidMap = PaymentInstallment::paidTotalsByType('po_register');
        Response::success(self::withLedger($po, $extended, $paidMap));
    }

    // POST /admin/po-register
    public function store(Request $request): void
    {
        $data = $request->only([
            'vendor_name', 'category', 'location', 'taxable', 'gst_pct', 'extra_amount', 'other_charges',
            'payment_category', 'utr_no', 'status', 'notes', 'items', 'advance', 'purchase_date',
        ]);
        if (empty($data['vendor_name'])) {
            Response::error('Vendor name is required', 422);
        }
        // Only the extended login may set the off-books extra.
        if (!self::isExtended($request)) {
            unset($data['extra_amount']);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        $id = PoRegister::create($data);
        $po = PoRegister::find($id);
        $paidMap = PaymentInstallment::paidTotalsByType('po_register');
        Response::success(self::withLedger($po, self::isExtended($request), $paidMap), 'Purchase order created', 201);
    }

    // PUT /admin/po-register/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $data = $request->only([
            'vendor_name', 'category', 'location', 'taxable', 'gst_pct', 'extra_amount', 'other_charges',
            'payment_category', 'utr_no', 'status', 'notes', 'items',
        ]);
        if (!self::isExtended($request)) {
            unset($data['extra_amount']);
        }
        if (!PoRegister::update($id, $data)) {
            Response::error('Purchase order not found', 404);
        }
        $po = PoRegister::find($id);
        $paidMap = PaymentInstallment::paidTotalsByType('po_register');
        Response::success(self::withLedger($po, self::isExtended($request), $paidMap), 'Purchase order updated');
    }

    // DELETE /admin/po-register/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!PoRegister::find($id)) {
            Response::error('Purchase order not found', 404);
        }
        PoRegister::delete($id);
        Response::success(null, 'Purchase order deleted');
    }

    /**
     * GET /admin/outstanding — single-page Total Outstanding widget.
     * Sums outstanding across the PO register, vendor purchases and stampings,
     * each tax-gated. Powers the widget + its Excel/PDF download (client-side).
     */
    public function outstanding(Request $request): void
    {
        $extended = self::isExtended($request);

        // ── PO register ─────────────────────────────────────────────
        $poPaid = PaymentInstallment::paidTotalsByType('po_register');
        $poRows = Database::fetchAll("SELECT id, po_no, vendor_name, category, total, extra_amount FROM po_register WHERE status = 'open'");
        $poItems = [];
        $poTotal = 0.0;
        foreach ($poRows as $r) {
            $grand = (float)$r['total'] + ($extended ? (float)($r['extra_amount'] ?? 0) : 0.0);
            $paid = (float)($poPaid[(int)$r['id']] ?? 0);
            $out = round(max(0.0, $grand - $paid), 2);
            if ($out <= 0.005) {
                continue;
            }
            $poTotal += $out;
            $poItems[] = [
                'source' => 'Purchase Order', 'ref_no' => $r['po_no'], 'party' => $r['vendor_name'],
                'category' => $r['category'], 'grand_total' => round($grand, 2), 'paid' => round($paid, 2), 'outstanding' => $out,
            ];
        }

        // ── Vendor purchases (credit) ───────────────────────────────
        $purchaseItems = [];
        $purchaseTotal = 0.0;
        $prRows = Database::fetchAll("SELECT id, purchase_no, vendor_name, total, extra_amount, amount_paid FROM purchases WHERE purchase_type = 'credit'");
        foreach ($prRows as $r) {
            $grand = (float)$r['total'] + ($extended ? (float)($r['extra_amount'] ?? 0) : 0.0);
            $paid = (float)($r['amount_paid'] ?? 0);
            $out = round(max(0.0, $grand - $paid), 2);
            if ($out <= 0.005) {
                continue;
            }
            $purchaseTotal += $out;
            $purchaseItems[] = [
                'source' => 'Purchase', 'ref_no' => $r['purchase_no'], 'party' => $r['vendor_name'],
                'category' => null, 'grand_total' => round($grand, 2), 'paid' => round($paid, 2), 'outstanding' => $out,
            ];
        }

        // ── Stamping (T5 — read defensively if the columns exist) ───
        $stampItems = [];
        $stampTotal = 0.0;
        if (self::tableHasColumn('stampings', 'total_amount')) {
            $stampPaid = PaymentInstallment::paidTotalsByType('stamping');
            $extraCol = self::tableHasColumn('stampings', 'extra_amount') ? ', s.extra_amount' : '';
            $sRows = Database::fetchAll(
                "SELECT s.id, s.total_amount$extraCol, m.code AS machine_code
                 FROM stampings s LEFT JOIN machines m ON m.id = s.machine_id
                 WHERE s.total_amount > 0"
            );
            foreach ($sRows as $r) {
                $grand = (float)$r['total_amount'] + ($extended && isset($r['extra_amount']) ? (float)$r['extra_amount'] : 0.0);
                $paid = (float)($stampPaid[(int)$r['id']] ?? 0);
                $out = round(max(0.0, $grand - $paid), 2);
                if ($out <= 0.005) {
                    continue;
                }
                $stampTotal += $out;
                $stampItems[] = [
                    'source' => 'Stamping', 'ref_no' => $r['machine_code'] ?? ('STMP-' . $r['id']), 'party' => null,
                    'category' => null, 'grand_total' => round($grand, 2), 'paid' => round($paid, 2), 'outstanding' => $out,
                ];
            }
        }

        $rows = array_merge($poItems, $purchaseItems, $stampItems);
        Response::success([
            'as_of' => date('Y-m-d'),
            'tax_view' => $extended ? 'extended' : 'standard',
            'total_outstanding' => round($poTotal + $purchaseTotal + $stampTotal, 2),
            'by_source' => [
                'purchase_orders' => round($poTotal, 2),
                'purchases' => round($purchaseTotal, 2),
                'stamping' => round($stampTotal, 2),
            ],
            'rows' => $rows,
        ]);
    }

    private static function tableHasColumn(string $table, string $column): bool
    {
        try {
            return Database::count(
                "SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
                [$table, $column]
            ) > 0;
        } catch (\Throwable $e) {
            return false;
        }
    }
}
