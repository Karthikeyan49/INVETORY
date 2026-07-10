<?php
declare(strict_types=1);

/**
 * Quotation Builder (Operations module).
 * Pick-and-play quotations: priced line items, each with a JSON list of spec
 * components (name + make + qty). Branded PDF is generated client-side from the
 * tenant company profile. All queries are tenant-scoped.
 *
 *  GET    /admin/quotations         index
 *  POST   /admin/quotations         store
 *  GET    /admin/quotations/{id}    show
 *  PUT    /admin/quotations/{id}    update
 *  DELETE /admin/quotations/{id}    destroy
 */
class AdminQuotationController
{
    public function index(Request $request): void
    {
        $rows = Database::fetchAll(
            'SELECT quotation_id, quotation_no, customer_name, particular, reference_no, system_title,
                    quotation_date, subtotal, gst_rate, gst_amount, grand_total, advance_amount,
                    status, created_at
             FROM quotations ORDER BY quotation_id DESC LIMIT 500'
        );
        Response::success($rows, 'Quotations');
    }

    public function show(Request $request): void
    {
        $id  = (int) $request->param('id');
        $q = Database::fetch(
            'SELECT * FROM quotations WHERE quotation_id = ? LIMIT 1',
            [$id]
        );
        if (!$q) {
            Response::error('Quotation not found', 404);
        }
        $q['items'] = $this->loadItems($id);
        Response::success($q, 'Quotation');
    }

    public function store(Request $request): void
    {
        $data = $this->validatePayload($request);

        $totals = $this->computeTotals($data['items'], $data['gst_rate']);
        $quotationNo = $this->nextQuotationNo($data['quotation_date']);

        $quotationId = Database::insert(
            'INSERT INTO quotations (quotation_no, customer_name, customer_address, particular,
                    customer_gstin, customer_contact, customer_contact_phone, reference_no,
                    prepared_by_name, prepared_by_designation, prepared_by_phone, system_title, quotation_kind,
                    quotation_date, subtotal, gst_rate, gst_amount, grand_total,
                    advance_amount, advance_date, terms, notes, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [
                $quotationNo,
                $data['customer_name'],
                $data['customer_address'],
                $data['particular'],
                $data['customer_gstin'],
                $data['customer_contact'],
                $data['customer_contact_phone'],
                $data['reference_no'],
                $data['prepared_by_name'],
                $data['prepared_by_designation'],
                $data['prepared_by_phone'],
                $data['system_title'],
                $data['quotation_kind'],
                $data['quotation_date'],
                $totals['subtotal'],
                $data['gst_rate'],
                $totals['gst_amount'],
                $totals['grand_total'],
                $data['advance_amount'],
                $data['advance_date'],
                $data['terms'],
                $data['notes'],
                $data['status'],
            ]
        );

        $this->saveItems($quotationId, $data['items']);

        $saved = Database::fetch('SELECT * FROM quotations WHERE quotation_id = ?', [$quotationId]);
        $saved['items'] = $this->loadItems($quotationId);
        Response::success($saved, 'Quotation created', 201);
    }

    public function update(Request $request): void
    {
        $id  = (int) $request->param('id');
        $existing = Database::fetch('SELECT quotation_id FROM quotations WHERE quotation_id = ?', [$id]);
        if (!$existing) {
            Response::error('Quotation not found', 404);
        }

        $data   = $this->validatePayload($request);
        $totals = $this->computeTotals($data['items'], $data['gst_rate']);

        Database::execute(
            'UPDATE quotations SET customer_name = ?, customer_address = ?, particular = ?,
                    customer_gstin = ?, customer_contact = ?, customer_contact_phone = ?, reference_no = ?,
                    prepared_by_name = ?, prepared_by_designation = ?, prepared_by_phone = ?, system_title = ?, quotation_kind = ?,
                    quotation_date = ?, subtotal = ?, gst_rate = ?, gst_amount = ?, grand_total = ?,
                    advance_amount = ?, advance_date = ?, terms = ?, notes = ?, status = ?,
                    updated_at = NOW()
             WHERE quotation_id = ?',
            [
                $data['customer_name'], $data['customer_address'], $data['particular'],
                $data['customer_gstin'], $data['customer_contact'], $data['customer_contact_phone'], $data['reference_no'],
                $data['prepared_by_name'], $data['prepared_by_designation'], $data['prepared_by_phone'], $data['system_title'], $data['quotation_kind'],
                $data['quotation_date'], $totals['subtotal'], $data['gst_rate'], $totals['gst_amount'], $totals['grand_total'],
                $data['advance_amount'], $data['advance_date'], $data['terms'], $data['notes'], $data['status'], $id,
            ]
        );

        Database::execute('DELETE FROM quotation_items WHERE quotation_id = ?', [$id]);
        $this->saveItems($id, $data['items']);

        $saved = Database::fetch('SELECT * FROM quotations WHERE quotation_id = ?', [$id]);
        $saved['items'] = $this->loadItems($id);
        Response::success($saved, 'Quotation updated');
    }

    public function destroy(Request $request): void
    {
        $id  = (int) $request->param('id');
        $existing = Database::fetch('SELECT quotation_id FROM quotations WHERE quotation_id = ?', [$id]);
        if (!$existing) {
            Response::error('Quotation not found', 404);
        }
        Database::execute('DELETE FROM quotation_items WHERE quotation_id = ?', [$id]);
        Database::execute('DELETE FROM quotations WHERE quotation_id = ?', [$id]);
        Response::success(['quotation_id' => $id], 'Quotation deleted');
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function validatePayload(Request $request): array
    {
        $customer = trim((string) $request->input('customer_name', ''));
        if ($customer === '') {
            Response::error('Customer name (M/S) is required', 422);
        }
        $items = $request->input('items');
        if (!is_array($items) || count($items) === 0) {
            Response::error('At least one line item is required', 422);
        }

        $gstRate = $request->input('gst_rate');
        $gstRate = $gstRate === null || $gstRate === '' ? 18.0 : (float) $gstRate;

        $clean = [];
        foreach ($items as $it) {
            $name = trim((string) ($it['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $qty  = (float) ($it['qty'] ?? 0);
            $rate = (float) ($it['rate'] ?? 0);
            $amount = isset($it['amount']) && $it['amount'] !== '' && $it['amount'] !== null
                ? (float) $it['amount']
                : ($qty > 0 ? $qty * $rate : $rate);

            $itemGstRate = isset($it['gst_rate']) && $it['gst_rate'] !== '' && $it['gst_rate'] !== null
                ? (float) $it['gst_rate']
                : $gstRate;

            $components = [];
            if (isset($it['components']) && is_array($it['components'])) {
                foreach ($it['components'] as $c) {
                    $cn = trim((string) ($c['name'] ?? ''));
                    if ($cn === '' && trim((string) ($c['group'] ?? '')) === '') {
                        continue;
                    }
                    $components[] = [
                        'group' => trim((string) ($c['group'] ?? '')),
                        'name'  => $cn,
                        'make'  => trim((string) ($c['make'] ?? '')),
                        'qty'   => (float) ($c['qty'] ?? 0),
                    ];
                }
            }

            $clean[] = [
                'name'           => $name,
                'make'           => trim((string) ($it['make'] ?? '')),
                'qty'            => $qty,
                'unit'           => trim((string) ($it['unit'] ?? '')),
                'specifications' => trim((string) ($it['specifications'] ?? '')) ?: null,
                'gst_rate'       => $itemGstRate,
                'rate'           => $rate,
                'amount'         => $amount,
                'components'     => $components,
            ];
        }
        if (count($clean) === 0) {
            Response::error('At least one valid line item is required', 422);
        }

        $status = (string) $request->input('status', 'Draft');
        if (!in_array($status, ['Draft', 'Sent', 'Accepted', 'Rejected'], true)) {
            $status = 'Draft';
        }

        $advanceAmount = $request->input('advance_amount');
        $advanceAmount = $advanceAmount === null || $advanceAmount === '' ? 0.0 : (float) $advanceAmount;
        $advanceDateRaw = trim((string) $request->input('advance_date', ''));

        return [
            'customer_name'           => $customer,
            'customer_address'        => trim((string) $request->input('customer_address', '')) ?: null,
            'customer_gstin'          => trim((string) $request->input('customer_gstin', '')) ?: null,
            'customer_contact'        => trim((string) $request->input('customer_contact', '')) ?: null,
            'customer_contact_phone'  => trim((string) $request->input('customer_contact_phone', '')) ?: null,
            'particular'              => trim((string) $request->input('particular', '')) ?: null,
            'reference_no'            => trim((string) $request->input('reference_no', '')) ?: null,
            'prepared_by_name'        => trim((string) $request->input('prepared_by_name', '')) ?: null,
            'prepared_by_designation' => trim((string) $request->input('prepared_by_designation', '')) ?: null,
            'prepared_by_phone'       => trim((string) $request->input('prepared_by_phone', '')) ?: null,
            'system_title'            => trim((string) $request->input('system_title', '')) ?: null,
            'quotation_kind'          => in_array((string) $request->input('quotation_kind', ''), ['retail', 'industrial', 'service', 'stamping'], true)
                                            ? (string) $request->input('quotation_kind')
                                            : 'retail',
            'quotation_date'          => $this->normalizeDate((string) $request->input('quotation_date', '')),
            'gst_rate'                => $gstRate,
            'advance_amount'          => $advanceAmount,
            'advance_date'            => $advanceDateRaw === '' ? null : $this->normalizeDate($advanceDateRaw),
            'terms'                   => trim((string) $request->input('terms', '')) ?: null,
            'notes'                   => trim((string) $request->input('notes', '')) ?: null,
            'status'                  => $status,
            'items'                   => $clean,
        ];
    }

    private function computeTotals(array $items, float $gstRate): array
    {
        $subtotal = 0.0;
        $taxableByRate = [];   // keyed by gst_rate => Σ amount
        foreach ($items as $it) {
            $amount = (float) $it['amount'];
            $subtotal += $amount;

            $rate = isset($it['gst_rate']) && $it['gst_rate'] !== '' && $it['gst_rate'] !== null
                ? (float) $it['gst_rate']
                : $gstRate;
            $key = (string) $rate;
            $taxableByRate[$key] = ($taxableByRate[$key] ?? 0.0) + $amount;
        }

        $gstAmount = 0.0;
        foreach ($taxableByRate as $key => $taxable) {
            $gstAmount += round($taxable * (float) $key / 100, 2);
        }
        $gstAmount = round($gstAmount, 2);

        return [
            'subtotal'    => round($subtotal, 2),
            'gst_amount'  => $gstAmount,
            'grand_total' => round($subtotal + $gstAmount, 2),
        ];
    }

    private function saveItems(int $quotationId, array $items): void
    {
        $order = 0;
        foreach ($items as $it) {
            Database::insert(
                'INSERT INTO quotation_items (quotation_id, sort_order, name, make, qty, unit, specifications, gst_rate, rate, amount, components) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [
                    $quotationId,
                    $order++,
                    $it['name'],
                    $it['make'] ?: null,
                    $it['qty'],
                    $it['unit'] ?: null,
                    $it['specifications'] ?? null,
                    $it['gst_rate'] ?? 18,
                    $it['rate'],
                    $it['amount'],
                    json_encode($it['components'] ?? []),
                ]
            );
        }
    }

    private function loadItems(int $quotationId): array
    {
        $rows = Database::fetchAll(
            'SELECT item_id, sort_order, name, make, qty, unit, specifications, gst_rate, rate, amount, components
             FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC, item_id ASC',
            [$quotationId]
        );
        foreach ($rows as &$r) {
            $decoded = $r['components'] ? json_decode((string) $r['components'], true) : [];
            $r['components'] = is_array($decoded) ? $decoded : [];
        }
        return $rows;
    }

    private function nextQuotationNo(?string $date): string
    {
        $count = (int) (Database::fetch('SELECT COUNT(*) AS c FROM quotations')['c'] ?? 0);
        $seq   = str_pad((string) ($count + 1), 3, '0', STR_PAD_LEFT);
        $ts    = strtotime($date ?: 'now') ?: time();
        $y     = (int) date('Y', $ts);
        $m     = (int) date('n', $ts);
        $start = $m >= 4 ? $y : $y - 1;            // Indian financial year starts in April
        $fy    = sprintf('%02d-%02d', $start % 100, ($start + 1) % 100);
        return "QT/{$seq}/{$fy}";
    }

    private function normalizeDate(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return date('Y-m-d');
        }
        $ts = strtotime($value);
        return $ts ? date('Y-m-d', $ts) : date('Y-m-d');
    }
}
