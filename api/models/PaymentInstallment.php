<?php
declare(strict_types=1);

/**
 * PaymentInstallment — reusable, polymorphic payment ledger (R12 / T3).
 *
 * Any document that is paid over time (purchase order, stamping record, vendor
 * purchase, incentive, invoice) records its advance + N installments here, each
 * carrying a payment category (Bank Transfer / Cash / UPI) and a UTR number.
 * Outstanding is derived live: grand_total − SUM(installments).
 *
 * The ledger stays deliberately "dumb": it never decides the grand total (that
 * is document-specific and may or may not include the off-books extra amount
 * depending on tax_view). Callers pass the already-gated grand total to
 * outstanding()/summariseRef(). This keeps extra_amount gating in one place.
 */
class PaymentInstallment
{
    public const REF_TYPES   = ['purchase_order', 'po_register', 'stamping', 'purchase', 'incentive', 'invoice'];
    public const CATEGORIES  = ['Bank Transfer', 'Cash', 'UPI'];

    private static function validRefType(string $t): bool
    {
        return in_array($t, self::REF_TYPES, true);
    }

    /** Human label for an installment sequence number. */
    public static function labelForSeq(int $seq): string
    {
        if ($seq <= 0) {
            return 'Advance';
        }
        $ord = self::ordinal($seq);
        return "$ord Installment";
    }

    private static function ordinal(int $n): string
    {
        $suffix = 'th';
        if (!in_array($n % 100, [11, 12, 13], true)) {
            $suffix = ['th', 'st', 'nd', 'rd'][$n % 10] ?? 'th';
        }
        return $n . $suffix;
    }

    /** All installments for a document, oldest first. */
    public static function forRef(string $refType, int $refId): array
    {
        if (!self::validRefType($refType)) {
            return [];
        }
        $rows = Database::fetchAll(
            "SELECT * FROM payment_installments WHERE ref_type = ? AND ref_id = ? ORDER BY seq ASC, id ASC",
            [$refType, $refId]
        );
        return array_map([self::class, 'format'], $rows);
    }

    /** Sum of installments recorded against a document. */
    public static function paidTotal(string $refType, int $refId): float
    {
        if (!self::validRefType($refType)) {
            return 0.0;
        }
        $row = Database::fetch(
            "SELECT COALESCE(SUM(amount), 0) AS paid FROM payment_installments WHERE ref_type = ? AND ref_id = ?",
            [$refType, $refId]
        );
        return round((float)($row['paid'] ?? 0), 2);
    }

    /** Next seq for a document (0-based advance, then 1..N). */
    public static function nextSeq(string $refType, int $refId): int
    {
        if (!self::validRefType($refType)) {
            return 0;
        }
        $row = Database::fetch(
            "SELECT COUNT(*) AS cnt FROM payment_installments WHERE ref_type = ? AND ref_id = ?",
            [$refType, $refId]
        );
        return (int)($row['cnt'] ?? 0);
    }

    /**
     * Record one installment. Returns the new row id.
     * $data: amount (required), category, utr_no, paid_on, label, notes, created_by, seq (optional).
     */
    public static function record(string $refType, int $refId, array $data): int
    {
        if (!self::validRefType($refType)) {
            Response::error('Unknown payment reference type', 422);
        }
        $amount = isset($data['amount']) ? round((float)$data['amount'], 2) : 0.0;
        if ($amount <= 0) {
            Response::error('Installment amount must be greater than zero', 422);
        }
        $seq = isset($data['seq']) && $data['seq'] !== '' && $data['seq'] !== null
            ? max(0, (int)$data['seq'])
            : self::nextSeq($refType, $refId);
        $category = in_array($data['category'] ?? '', self::CATEGORIES, true) ? $data['category'] : 'Cash';
        $label = isset($data['label']) && trim((string)$data['label']) !== ''
            ? trim((string)$data['label'])
            : self::labelForSeq($seq);
        $paidOn = !empty($data['paid_on']) ? (string)$data['paid_on'] : date('Y-m-d');

        return Database::insert(
            "INSERT INTO payment_installments
                (ref_type, ref_id, seq, label, amount, category, utr_no, paid_on, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                $refType,
                $refId,
                $seq,
                $label,
                $amount,
                $category,
                isset($data['utr_no']) && trim((string)$data['utr_no']) !== '' ? trim((string)$data['utr_no']) : null,
                $paidOn,
                isset($data['notes']) && trim((string)$data['notes']) !== '' ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function delete(int $id): bool
    {
        return Database::execute("DELETE FROM payment_installments WHERE id = ?", [$id]) >= 0;
    }

    public static function find(int $id): ?array
    {
        $row = Database::fetch("SELECT * FROM payment_installments WHERE id = ? LIMIT 1", [$id]);
        return $row ? self::format($row) : null;
    }

    /**
     * Full ledger summary for one document given its (already tax-gated) grand total.
     * @return array{ref_type,ref_id,grand_total,paid_total,outstanding,payment_status,installments}
     */
    public static function summariseRef(string $refType, int $refId, float $grandTotal): array
    {
        $paid = self::paidTotal($refType, $refId);
        $grandTotal = round(max(0.0, $grandTotal), 2);
        $outstanding = round(max(0.0, $grandTotal - $paid), 2);
        $status = $paid <= 0.005 ? 'unpaid' : ($outstanding <= 0.005 ? 'paid' : 'partial');
        return [
            'ref_type'       => $refType,
            'ref_id'         => $refId,
            'grand_total'    => $grandTotal,
            'paid_total'     => $paid,
            'outstanding'    => $outstanding,
            'payment_status' => $status,
            'installments'   => self::forRef($refType, $refId),
        ];
    }

    /**
     * Aggregate paid totals per document for a whole ref_type in one query.
     * Returns [ref_id => paid_total]. Lets the outstanding widget avoid N+1.
     */
    public static function paidTotalsByType(string $refType): array
    {
        if (!self::validRefType($refType)) {
            return [];
        }
        $rows = Database::fetchAll(
            "SELECT ref_id, COALESCE(SUM(amount), 0) AS paid
             FROM payment_installments WHERE ref_type = ? GROUP BY ref_id",
            [$refType]
        );
        $map = [];
        foreach ($rows as $r) {
            $map[(int)$r['ref_id']] = round((float)$r['paid'], 2);
        }
        return $map;
    }

    private static function format(array $row): array
    {
        return [
            'id'         => (int)$row['id'],
            'ref_type'   => $row['ref_type'],
            'ref_id'     => (int)$row['ref_id'],
            'seq'        => (int)$row['seq'],
            'label'      => $row['label'],
            'amount'     => round((float)$row['amount'], 2),
            'category'   => $row['category'],
            'utr_no'     => $row['utr_no'],
            'paid_on'    => $row['paid_on'],
            'notes'      => $row['notes'],
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
        ];
    }
}
