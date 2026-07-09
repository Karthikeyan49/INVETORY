<?php
declare(strict_types=1);

/**
 * AdminInstallmentController — generic endpoints over the reusable payment
 * installment ledger (R12 / T3). Any Set-3 document (purchase order, stamping,
 * purchase, incentive, invoice) records its advance + N installments through
 * here, and the live outstanding is derived from the document's tax-gated total.
 */
class AdminInstallmentController
{
    private static function isExtended(Request $request): bool
    {
        return strtolower((string)($request->user['tax_view'] ?? 'standard')) === 'extended';
    }

    private static function actorId(Request $request): ?int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
    }

    // GET /admin/installments?ref_type=&ref_id=
    public function index(Request $request): void
    {
        $refType = (string)$request->query('ref_type', '');
        $refId   = (int)$request->query('ref_id', 0);
        if (!in_array($refType, PaymentInstallment::REF_TYPES, true) || $refId <= 0) {
            Response::error('ref_type and ref_id are required', 422);
        }
        $grandTotal = self::grandTotalFor($refType, $refId, self::isExtended($request));
        Response::success(PaymentInstallment::summariseRef($refType, $refId, $grandTotal));
    }

    // POST /admin/installments  { ref_type, ref_id, amount, category, utr_no, paid_on, seq?, label?, notes? }
    public function store(Request $request): void
    {
        $body = $request->only(['ref_type', 'ref_id', 'amount', 'category', 'utr_no', 'paid_on', 'seq', 'label', 'notes']);
        $refType = (string)($body['ref_type'] ?? '');
        $refId   = (int)($body['ref_id'] ?? 0);
        if (!in_array($refType, PaymentInstallment::REF_TYPES, true) || $refId <= 0) {
            Response::error('ref_type and ref_id are required', 422);
        }
        $body['created_by'] = self::actorId($request);
        $id = PaymentInstallment::record($refType, $refId, $body);

        // Keep the owning document's cached paid/outstanding in sync where it has such columns.
        self::syncDocument($refType, $refId);

        $grandTotal = self::grandTotalFor($refType, $refId, self::isExtended($request));
        Response::success(
            [
                'installment' => PaymentInstallment::find($id),
                'ledger'      => PaymentInstallment::summariseRef($refType, $refId, $grandTotal),
            ],
            'Installment recorded',
            201
        );
    }

    // DELETE /admin/installments/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        $row = PaymentInstallment::find($id);
        if (!$row) {
            Response::error('Installment not found', 404);
        }
        PaymentInstallment::delete($id);
        self::syncDocument($row['ref_type'], $row['ref_id']);
        Response::success(null, 'Installment removed');
    }

    /**
     * Resolve the tax-gated grand total for a document so outstanding is
     * computed consistently with the current login's tax_view.
     */
    private static function grandTotalFor(string $refType, int $refId, bool $extended): float
    {
        try {
            switch ($refType) {
                case 'purchase':
                    $r = Database::fetch("SELECT total, extra_amount FROM purchases WHERE id = ? LIMIT 1", [$refId]);
                    if (!$r) return 0.0;
                    return round((float)$r['total'] + ($extended ? (float)($r['extra_amount'] ?? 0) : 0.0), 2);
                case 'purchase_order':
                    $r = Database::fetch("SELECT total FROM purchase_orders WHERE po_id = ? LIMIT 1", [$refId]);
                    if (!$r) return 0.0;
                    $extra = self::columnValue('purchase_orders', 'extra_amount', 'po_id', $refId);
                    return round((float)$r['total'] + ($extended ? $extra : 0.0), 2);
                case 'stamping':
                    // stamping totals land in T5; read defensively.
                    $amt = self::columnValue('stampings', 'total_amount', 'id', $refId);
                    $extra = self::columnValue('stampings', 'extra_amount', 'id', $refId);
                    return round($amt + ($extended ? $extra : 0.0), 2);
                case 'incentive':
                    // incentive totals land in T10; read defensively.
                    $amt = self::columnValue('incentives', 'amount', 'id', $refId);
                    $extra = self::columnValue('incentives', 'extra_amount', 'id', $refId);
                    return round($amt + ($extended ? $extra : 0.0), 2);
                case 'invoice':
                    $r = Database::fetch("SELECT total FROM invoices WHERE invoice_id = ? LIMIT 1", [$refId]);
                    return $r ? round((float)$r['total'], 2) : 0.0;
            }
        } catch (\Throwable $e) {
            return 0.0;
        }
        return 0.0;
    }

    /** Fetch a single numeric column value, returning 0.0 if the column/table/row is absent. */
    private static function columnValue(string $table, string $column, string $pk, int $id): float
    {
        try {
            $exists = Database::count(
                "SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
                [$table, $column]
            );
            if ($exists === 0) {
                return 0.0;
            }
            $r = Database::fetch("SELECT `$column` AS v FROM `$table` WHERE `$pk` = ? LIMIT 1", [$id]);
            return $r ? (float)($r['v'] ?? 0) : 0.0;
        } catch (\Throwable $e) {
            return 0.0;
        }
    }

    /**
     * Push the derived paid total back onto documents that cache it.
     * Purchases keep their own advance/amount_paid flow (PurchaseController) so
     * they are intentionally excluded here to avoid double counting. Purchase
     * orders and stampings adopt the ledger in T4/T5 and are synced there.
     */
    private static function syncDocument(string $refType, int $refId): void
    {
        // Documents that adopt the ledger own their own cache sync (T4/T5/T10).
    }
}
