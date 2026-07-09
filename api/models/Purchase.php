<?php
declare(strict_types=1);

/**
 * Purchase — a purchase from a vendor (taxable amount BEFORE GST + GST% + an
 * off-books extra amount). Cash purchases are paid in full; credit purchases
 * track an advance and an outstanding balance. Each purchase posts a matching
 * Expense so it flows into the Profit & Loss report.
 */
class Purchase
{
    public const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card'];
    public const TYPES = ['cash', 'credit'];

    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 100): array
    {
        $where  = [];
        $params = [];
        if (!empty($filters['search'])) {
            $where[] = '(vendor_name LIKE ? OR purchase_no LIKE ? OR notes LIKE ?)';
            $like = '%' . $filters['search'] . '%';
            array_push($params, $like, $like, $like);
        }
        if (!empty($filters['type']) && in_array($filters['type'], self::TYPES, true)) {
            $where[] = 'purchase_type = ?';
            $params[] = $filters['type'];
        }
        if (!empty($filters['location'])) {
            $where[] = 'location = ?';
            $params[] = $filters['location'];
        }

        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM purchases $clause", $params);

        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT * FROM purchases $clause ORDER BY purchase_date DESC, id DESC LIMIT $limit OFFSET $offset",
            $params
        );
        foreach ($rows as &$r) {
            self::castRow($r);
        }
        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        $row = Database::fetch("SELECT * FROM purchases WHERE id = ? LIMIT 1", [$id]);
        if ($row) {
            self::castRow($row);
        }
        return $row ?: null;
    }

    private static function castRow(array &$r): void
    {
        foreach (['taxable', 'gst_pct', 'gst_amount', 'extra_amount', 'total', 'advance', 'amount_paid'] as $f) {
            $r[$f] = (float)($r[$f] ?? 0);
        }
        $r['outstanding'] = max(0.0, round($r['total'] - $r['amount_paid'], 2));
    }

    public static function nextNo(): string
    {
        $count = Database::count('SELECT COUNT(*) AS cnt FROM purchases');
        return 'PUR-' . date('Y') . '-' . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);
    }

    public static function create(array $data): int
    {
        $type    = in_array($data['purchase_type'] ?? '', self::TYPES, true) ? $data['purchase_type'] : 'cash';
        $taxable = max(0.0, (float)($data['taxable'] ?? 0));
        $gstPct  = max(0.0, (float)($data['gst_pct'] ?? 0));
        $gst     = round($taxable * $gstPct / 100, 2);
        $total   = round($taxable + $gst, 2);
        $extra   = max(0.0, (float)($data['extra_amount'] ?? 0));
        $advance = max(0.0, (float)($data['advance'] ?? 0));
        // Cash = paid in full; credit = whatever advance was given.
        $paid    = $type === 'cash' ? $total : min($advance, $total);

        return Database::insert(
            "INSERT INTO purchases
                (purchase_no, vendor_name, location, purchase_type, taxable, gst_pct, gst_amount,
                 extra_amount, total, advance, amount_paid, payment_method, purchase_date, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                self::nextNo(),
                trim((string)$data['vendor_name']),
                isset($data['location']) && $data['location'] !== '' ? trim((string)$data['location']) : null,
                $type,
                $taxable, $gstPct, $gst, $extra, $total, $advance, $paid,
                isset($data['payment_method']) && $data['payment_method'] !== '' ? (string)$data['payment_method'] : null,
                !empty($data['purchase_date']) ? (string)$data['purchase_date'] : null,
                isset($data['notes']) && $data['notes'] !== '' ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function update(int $id, array $data): bool
    {
        $existing = self::find($id);
        if (!$existing) {
            return false;
        }
        $type    = in_array($data['purchase_type'] ?? $existing['purchase_type'], self::TYPES, true) ? ($data['purchase_type'] ?? $existing['purchase_type']) : 'cash';
        $taxable = array_key_exists('taxable', $data) ? max(0.0, (float)$data['taxable']) : (float)$existing['taxable'];
        $gstPct  = array_key_exists('gst_pct', $data) ? max(0.0, (float)$data['gst_pct']) : (float)$existing['gst_pct'];
        $gst     = round($taxable * $gstPct / 100, 2);
        $total   = round($taxable + $gst, 2);
        $extra   = array_key_exists('extra_amount', $data) ? max(0.0, (float)$data['extra_amount']) : (float)$existing['extra_amount'];
        $advance = array_key_exists('advance', $data) ? max(0.0, (float)$data['advance']) : (float)$existing['advance'];
        $paid    = $type === 'cash' ? $total : min($advance, $total);

        Database::execute(
            "UPDATE purchases SET vendor_name = ?, location = ?, purchase_type = ?, taxable = ?, gst_pct = ?,
                    gst_amount = ?, extra_amount = ?, total = ?, advance = ?, amount_paid = ?,
                    payment_method = ?, purchase_date = ?, notes = ? WHERE id = ?",
            [
                array_key_exists('vendor_name', $data) ? trim((string)$data['vendor_name']) : $existing['vendor_name'],
                array_key_exists('location', $data) ? (trim((string)$data['location']) ?: null) : $existing['location'],
                $type, $taxable, $gstPct, $gst, $extra, $total, $advance, $paid,
                array_key_exists('payment_method', $data) ? ((string)$data['payment_method'] ?: null) : $existing['payment_method'],
                array_key_exists('purchase_date', $data) ? ((string)$data['purchase_date'] ?: null) : $existing['purchase_date'],
                array_key_exists('notes', $data) ? (trim((string)$data['notes']) ?: null) : $existing['notes'],
                $id,
            ]
        );
        return true;
    }

    /** Record a payment against a credit purchase (reduces outstanding). */
    public static function recordPayment(int $id, float $amount): bool
    {
        $p = self::find($id);
        if (!$p || $amount <= 0) {
            return false;
        }
        $newPaid = min($p['total'], $p['amount_paid'] + $amount);
        Database::execute("UPDATE purchases SET amount_paid = ? WHERE id = ?", [$newPaid, $id]);
        return true;
    }

    public static function destroy(int $id): bool
    {
        if (!self::find($id)) {
            return false;
        }
        Database::execute("DELETE FROM purchases WHERE id = ?", [$id]);
        return true;
    }

    public static function distinctLocations(): array
    {
        $rows = Database::fetchAll("SELECT DISTINCT location FROM purchases WHERE location IS NOT NULL AND location <> '' ORDER BY location");
        return array_map(fn($r) => $r['location'], $rows);
    }
}
