<?php
declare(strict_types=1);

/**
 * PoRegister — lightweight Purchase Order register (R10 / T4).
 *
 * A credit-purchase record: vendor, category, line items, taxable + off-books
 * extra amount, default payment category + UTR, location and status. Advance and
 * subsequent installments (and therefore the live outstanding) are recorded in
 * the shared payment_installments ledger with ref_type = 'po_register', so the
 * outstanding auto-includes the extra only for the extended login.
 */
class PoRegister
{
    public const STATUSES  = ['open', 'closed', 'cancelled'];
    public const CATEGORIES = ['Bank Transfer', 'Cash', 'UPI'];

    public static function nextNo(): string
    {
        $count = Database::count('SELECT COUNT(*) AS cnt FROM po_register');
        return 'PO-' . date('Y') . '-' . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);
    }

    /** @return array{rows: array, total: int, categories: array} */
    public static function all(array $filters = [], int $page = 1, int $limit = 200): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['search'])) {
            $where[] = '(vendor_name LIKE ? OR po_no LIKE ? OR notes LIKE ?)';
            $like = '%' . $filters['search'] . '%';
            array_push($params, $like, $like, $like);
        }
        if (!empty($filters['category'])) {
            $where[] = 'category = ?';
            $params[] = (string)$filters['category'];
        }
        if (!empty($filters['status']) && in_array($filters['status'], self::STATUSES, true)) {
            $where[] = 'status = ?';
            $params[] = (string)$filters['status'];
        }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total = Database::count("SELECT COUNT(*) AS cnt FROM po_register $clause", $params);
        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT * FROM po_register $clause ORDER BY created_at DESC, id DESC LIMIT $limit OFFSET $offset",
            $params
        );
        foreach ($rows as &$r) {
            self::castRow($r);
        }
        unset($r);
        $cats = Database::fetchAll("SELECT DISTINCT category FROM po_register WHERE category IS NOT NULL AND category <> '' ORDER BY category");
        return [
            'rows' => $rows,
            'total' => $total,
            'categories' => array_column($cats, 'category'),
        ];
    }

    public static function find(int $id): ?array
    {
        $row = Database::fetch("SELECT * FROM po_register WHERE id = ? LIMIT 1", [$id]);
        if (!$row) {
            return null;
        }
        self::castRow($row);
        $row['items'] = self::items($id);
        return $row;
    }

    public static function items(int $poId): array
    {
        $rows = Database::fetchAll("SELECT * FROM po_register_items WHERE po_id = ? ORDER BY id ASC", [$poId]);
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['po_id'] = (int)$r['po_id'];
            foreach (['qty', 'unit_price', 'amount'] as $f) {
                $r[$f] = (float)$r[$f];
            }
        }
        return $rows;
    }

    private static function castRow(array &$r): void
    {
        $r['id'] = (int)$r['id'];
        foreach (['taxable', 'gst_pct', 'gst_amount', 'extra_amount', 'other_charges', 'total'] as $f) {
            $r[$f] = (float)($r[$f] ?? 0);
        }
    }

    /** Compute taxable/gst/total from posted items (or explicit taxable) + charges. */
    private static function totals(array $items, float $gstPct, float $otherCharges, ?float $explicitTaxable): array
    {
        $taxable = 0.0;
        foreach ($items as $it) {
            $taxable += round((float)($it['qty'] ?? 0) * (float)($it['unit_price'] ?? 0), 2);
        }
        if ($explicitTaxable !== null && $taxable <= 0.0) {
            $taxable = max(0.0, $explicitTaxable);
        }
        $taxable = round($taxable, 2);
        $gst = round($taxable * $gstPct / 100, 2);
        $total = round($taxable + $gst + $otherCharges, 2);
        return ['taxable' => $taxable, 'gst_amount' => $gst, 'total' => $total];
    }

    public static function create(array $data): int
    {
        $items  = is_array($data['items'] ?? null) ? $data['items'] : [];
        $gstPct = max(0.0, (float)($data['gst_pct'] ?? 0));
        $other  = max(0.0, (float)($data['other_charges'] ?? 0));
        $extra  = max(0.0, (float)($data['extra_amount'] ?? 0));
        $explicitTaxable = isset($data['taxable']) && $data['taxable'] !== '' ? (float)$data['taxable'] : null;
        $t = self::totals($items, $gstPct, $other, $explicitTaxable);

        $id = Database::insert(
            "INSERT INTO po_register
                (po_no, vendor_name, category, location, taxable, gst_pct, gst_amount, extra_amount,
                 other_charges, total, payment_category, utr_no, status, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                self::nextNo(),
                trim((string)$data['vendor_name']),
                isset($data['category']) && $data['category'] !== '' ? trim((string)$data['category']) : null,
                isset($data['location']) && $data['location'] !== '' ? trim((string)$data['location']) : null,
                $t['taxable'], $gstPct, $t['gst_amount'], $extra, $other, $t['total'],
                in_array($data['payment_category'] ?? '', self::CATEGORIES, true) ? $data['payment_category'] : null,
                isset($data['utr_no']) && $data['utr_no'] !== '' ? trim((string)$data['utr_no']) : null,
                in_array($data['status'] ?? '', self::STATUSES, true) ? $data['status'] : 'open',
                isset($data['notes']) && $data['notes'] !== '' ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
        self::replaceItems($id, $items);

        // Optional advance recorded through the shared ledger.
        $advance = isset($data['advance']) ? (float)$data['advance'] : 0.0;
        if ($advance > 0) {
            PaymentInstallment::record('po_register', $id, [
                'amount'     => $advance,
                'category'   => $data['payment_category'] ?? 'Cash',
                'utr_no'     => $data['utr_no'] ?? null,
                'paid_on'    => $data['purchase_date'] ?? date('Y-m-d'),
                'seq'        => 0,
                'label'      => 'Advance',
                'created_by' => $data['created_by'] ?? null,
            ]);
        }
        return $id;
    }

    public static function update(int $id, array $data): bool
    {
        $existing = self::find($id);
        if (!$existing) {
            return false;
        }
        $items  = array_key_exists('items', $data) && is_array($data['items']) ? $data['items'] : $existing['items'];
        $gstPct = array_key_exists('gst_pct', $data) ? max(0.0, (float)$data['gst_pct']) : (float)$existing['gst_pct'];
        $other  = array_key_exists('other_charges', $data) ? max(0.0, (float)$data['other_charges']) : (float)$existing['other_charges'];
        $extra  = array_key_exists('extra_amount', $data) ? max(0.0, (float)$data['extra_amount']) : (float)$existing['extra_amount'];
        $explicitTaxable = array_key_exists('taxable', $data) && $data['taxable'] !== '' ? (float)$data['taxable'] : (float)$existing['taxable'];
        $t = self::totals($items, $gstPct, $other, $explicitTaxable);

        Database::execute(
            "UPDATE po_register SET vendor_name = ?, category = ?, location = ?, taxable = ?, gst_pct = ?,
                    gst_amount = ?, extra_amount = ?, other_charges = ?, total = ?, payment_category = ?,
                    utr_no = ?, status = ?, notes = ? WHERE id = ?",
            [
                array_key_exists('vendor_name', $data) ? trim((string)$data['vendor_name']) : $existing['vendor_name'],
                array_key_exists('category', $data) ? (trim((string)$data['category']) ?: null) : $existing['category'],
                array_key_exists('location', $data) ? (trim((string)$data['location']) ?: null) : $existing['location'],
                $t['taxable'], $gstPct, $t['gst_amount'], $extra, $other, $t['total'],
                array_key_exists('payment_category', $data)
                    ? (in_array($data['payment_category'], self::CATEGORIES, true) ? $data['payment_category'] : null)
                    : $existing['payment_category'],
                array_key_exists('utr_no', $data) ? (trim((string)$data['utr_no']) ?: null) : $existing['utr_no'],
                array_key_exists('status', $data) && in_array($data['status'], self::STATUSES, true) ? $data['status'] : $existing['status'],
                array_key_exists('notes', $data) ? (trim((string)$data['notes']) ?: null) : $existing['notes'],
                $id,
            ]
        );
        if (array_key_exists('items', $data) && is_array($data['items'])) {
            self::replaceItems($id, $data['items']);
        }
        return true;
    }

    private static function replaceItems(int $poId, array $items): void
    {
        Database::execute("DELETE FROM po_register_items WHERE po_id = ?", [$poId]);
        foreach ($items as $it) {
            $desc = trim((string)($it['description'] ?? ''));
            if ($desc === '') {
                continue;
            }
            $qty = max(0.0, (float)($it['qty'] ?? 1));
            $price = max(0.0, (float)($it['unit_price'] ?? 0));
            Database::insert(
                "INSERT INTO po_register_items (po_id, description, qty, unit_price, amount) VALUES (?, ?, ?, ?, ?)",
                [$poId, $desc, $qty, $price, round($qty * $price, 2)]
            );
        }
    }

    public static function delete(int $id): bool
    {
        Database::execute("DELETE FROM po_register_items WHERE po_id = ?", [$id]);
        Database::execute("DELETE FROM payment_installments WHERE ref_type = 'po_register' AND ref_id = ?", [$id]);
        return Database::execute("DELETE FROM po_register WHERE id = ?", [$id]) >= 0;
    }
}
