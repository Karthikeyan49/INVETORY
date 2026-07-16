<?php
declare(strict_types=1);

/**
 * Machines API (requirement.txt — Module 1). Mirrors ProductController conventions.
 */
class MachineController
{
    // GET /machines
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(100, max(1, (int)$request->query('limit', 20)));

        $filters = [
            'status'       => $request->query('status'),
            'category'     => $request->query('category'),
            'machine_type' => $request->query('machine_type'),
            'customer_id'  => $request->query('customer_id'),
            'search'       => $request->query('search'),
        ];

        if (!empty($filters['status']) && !in_array($filters['status'], Machine::STATUSES, true)) {
            Response::error('Invalid status. Allowed: ' . implode(', ', Machine::STATUSES), 400);
        }

        $result = Machine::all($filters, $page, $limit);
        $rows = array_map(fn($r) => $this->gateTax($request, $r), $result['rows']);
        Response::paginated($rows, [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $result['total'],
            'total_pages' => (int)ceil(max(1, $result['total']) / $limit),
            'tax_view'    => $this->taxView($request),
        ]);
    }

    // GET /machines/dispatch-recommendations  (Module 4)
    public function dispatch(Request $request): void
    {
        $limit = min(50, max(1, (int)$request->query('limit', 20)));
        $rows = array_map(fn($r) => $this->gateTax($request, $r), Machine::dispatchRecommendations($limit));
        Response::success($rows);
    }

    // GET /machines/catalog — models/categories/HSN + part names for the add-form dropdowns
    public function catalog(Request $request): void
    {
        Response::success(Machine::catalog());
    }

    // GET /machines/alerts  — incomplete machines (line 8, shown on invoice/delivery pages)
    public function alerts(Request $request): void
    {
        Response::success(Machine::alerts());
    }

    // PUT /machines/{id}/parts/{partId} — edit a part
    public function updatePart(Request $request): void
    {
        $id = (int)$request->param('id');
        $partId = (int)$request->param('partId');
        if ($id <= 0 || !Machine::find($id)) {
            Response::error('Machine not found', 404);
        }
        $data = $request->only(['part_name', 'qty', 'status', 'product_id']);
        Machine::updatePart($partId, $data);
        Response::success(Machine::parts($id), 'Part updated');
    }

    // POST /machines/{id}/convert/delivery — create a challan from a machine (body may override details)
    public function convertToDelivery(Request $request): void
    {
        $id = (int)$request->param('id');
        $m = $id > 0 ? Machine::find($id) : null;
        if (!$m) {
            Response::error('Machine not found', 404);
        }
        $b = $request->only(['customer_name', 'category', 'amount', 'tax_amount', 'delivery_date', 'items', 'notes', 'extra_amount', 'extra_from_vendor']);

        $customerName = $b['customer_name'] ?? null;
        if (($customerName === null || $customerName === '') && !empty($m['customer_id'])) {
            $u = Database::fetch("SELECT name FROM users WHERE user_id = ? LIMIT 1", [(int)$m['customer_id']]);
            $customerName = $u['name'] ?? null;
        }

        $data = [
            'customer_id'   => $m['customer_id'] ?? null,
            'customer_name' => $customerName,
            'machine_id'    => $id,
            'category'      => $b['category']   ?? ($m['category'] ?? null),
            'amount'        => array_key_exists('amount', $b) ? $b['amount'] : ($m['sale_price'] ?? null),
            'tax_amount'    => array_key_exists('tax_amount', $b) ? $b['tax_amount'] : ($m['tax_amount'] ?? null),
            'delivery_date' => $b['delivery_date'] ?? null,
            'items'         => $b['items'] ?? trim(($m['model'] ?? '') . ' (' . $m['code'] . ')'),
            'notes'         => $b['notes'] ?? null,
            'status'        => 'draft',
            'created_by'    => $request->user['user_id'] ?? null,
        ];
        // Only the extended login can carry the off-books extras onto the challan.
        if ($this->taxView($request) === 'extended') {
            if (array_key_exists('extra_amount', $b))      { $data['extra_amount'] = $b['extra_amount']; }
            if (array_key_exists('extra_from_vendor', $b)) { $data['extra_from_vendor'] = $b['extra_from_vendor']; }
        }
        $challanId = DeliveryNote::create($data);
        Response::success(DeliveryNote::find($challanId), 'Delivery challan created from machine', 201);
    }

    // POST /machines/{id}/convert/invoice — create an invoice from a machine (body may override details)
    public function convertToInvoice(Request $request): void
    {
        $id = (int)$request->param('id');
        $m = $id > 0 ? Machine::find($id) : null;
        if (!$m) {
            Response::error('Machine not found', 404);
        }
        $b = $request->only(['customer_name', 'description', 'hsn', 'quantity', 'unit_price', 'gst_pct', 'notes']);

        $qty  = isset($b['quantity'])   && $b['quantity']   !== '' ? (float)$b['quantity']   : 1.0;
        $unit = isset($b['unit_price']) && $b['unit_price'] !== '' ? (float)$b['unit_price'] : (float)($m['sale_price'] ?? 0);
        $pct  = isset($b['gst_pct'])    && $b['gst_pct']    !== '' ? (float)$b['gst_pct']    : (float)($m['sale_gst_pct'] ?? 18);
        $base = round($unit * $qty, 2);
        $gst  = round($base * $pct / 100, 2);
        $total = $base + $gst;

        $customerName = !empty($b['customer_name']) ? (string)$b['customer_name'] : 'Walk-in Customer';
        if (empty($b['customer_name']) && !empty($m['customer_id'])) {
            $u = Database::fetch("SELECT name FROM users WHERE user_id = ? LIMIT 1", [(int)$m['customer_id']]);
            $customerName = $u['name'] ?? $customerName;
        }
        $desc = !empty($b['description']) ? (string)$b['description'] : trim(($m['model'] ?? 'Machine') . ' — ' . $m['code']);
        $hsn  = array_key_exists('hsn', $b) && $b['hsn'] !== '' ? (string)$b['hsn'] : ($m['hsn'] ?? null);
        $notes = $b['notes'] ?? ('Auto-generated from machine ' . $m['code']);

        $year = date('Y');
        $seq  = Database::count("SELECT COUNT(*) AS cnt FROM invoices WHERE invoice_number LIKE ?", ["MINV-$year-%"]) + 1;
        $number = sprintf('MINV-%s-%04d', $year, $seq);

        // Carry the machine's off-books extra onto the invoice — extended login only.
        $extra = $this->taxView($request) === 'extended' ? max(0.0, (float)($m['extra_amount'] ?? 0)) : 0.0;

        // Link the invoice to the machine's real customer id (when known) so the
        // Customer History tab scopes by id, not just by name.
        $custId = !empty($m['customer_id']) ? (int)$m['customer_id'] : null;
        $invId = Database::insert(
            "INSERT INTO invoices
                (invoice_number, customer_id, customer_name, invoice_date, subtotal, gst_rate, gst_amount,
                 cgst_amount, sgst_amount, total, extra_amount, status, notes)
             VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, 'Unpaid', ?)",
            [$number, $custId, $customerName, $base, $pct, $gst, round($gst / 2, 2), round($gst / 2, 2), $total, $extra, $notes]
        );
        Database::insert(
            "INSERT INTO invoice_items
                (invoice_id, description, hsn_code, quantity, unit, unit_price, discount, gst_rate, line_total, sort_order)
             VALUES (?, ?, ?, ?, 'Nos', ?, 0, ?, ?, 0)",
            [$invId, $desc, $hsn, $qty, $unit, $pct, $total]
        );

        // Mirror the sale into the orders ledger (net of GST) and link it so the
        // paid → revenue chain fires through Payment::refreshInvoice().
        $orderId = Order::createDirect($customerName, (float)$base, [
            'payment_status' => 'unpaid',
            'source'         => 'machine',
            'notes'          => 'Auto-created from machine ' . $m['code'],
        ]);
        Database::execute('UPDATE invoices SET order_id = ? WHERE invoice_id = ?', [$orderId, $invId]);

        Response::success(['invoice_id' => $invId, 'invoice_number' => $number, 'total' => $total], 'Invoice created from machine', 201);
    }

    // GET /machines/tax-summary  — business-wide tax vs tax+extra (lines 2, 18; extended only)
    // Combines every money surface (machine sales + delivery challans) so the
    // extended login maintains BOTH the plain-tax and the tax+extra picture.
    public function taxSummary(Request $request): void
    {
        if ($this->taxView($request) !== 'extended') {
            Response::error('Extended tax view required', 403);
        }
        $m = Machine::taxSummary();
        $d = DeliveryNote::taxSummary();
        $tax    = (float)($m['total_tax'] ?? 0)                 + (float)($d['total_tax'] ?? 0);
        $extraC = (float)($m['total_extra_to_customer'] ?? 0)   + (float)($d['total_extra_to_customer'] ?? 0);
        $extraV = (float)($m['total_extra_from_vendor'] ?? 0)   + (float)($d['total_extra_from_vendor'] ?? 0);
        Response::success([
            'total_sales'             => (float)($m['total_sales'] ?? 0) + (float)($d['total_amount'] ?? 0),
            'total_tax'               => $tax,
            'total_extra_to_customer' => $extraC,
            'total_extra_from_vendor' => $extraV,
            'total_with_extra'        => $tax + $extraC + $extraV,
            'sources'                 => ['machines' => $m, 'deliveries' => $d],
        ]);
    }

    // GET /machines/{id}
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $machine = $id > 0 ? Machine::find($id) : null;
        if (!$machine) {
            Response::error('Machine not found', 404);
        }
        $machine['missing_parts'] = Machine::missingParts($id);
        $machine['transfers']     = Machine::transfers($id);
        Response::success($this->gateTax($request, $machine));
    }

    // POST /machines/{id}/parts/{partId}/transfer  (Module 3)
    public function transferPart(Request $request): void
    {
        $partId = (int)$request->param('partId');
        $to     = (int)$request->input('to_machine_id', 0);
        if ($partId <= 0 || $to <= 0) {
            Response::error('partId and to_machine_id are required', 422);
        }
        if (!Machine::find($to)) {
            Response::error('Target machine not found', 404);
        }
        $sourceId = (int)$request->param('id');
        if (!Machine::transferPart($partId, $to, $request->user['user_id'] ?? null, $request->input('notes'))) {
            Response::error('Part not found', 404);
        }
        $by      = $request->user['user_id'] ?? null;
        $srcCode = Machine::find($sourceId)['code'] ?? "#$sourceId";
        $tgtCode = Machine::find($to)['code'] ?? "#$to";
        if ($sourceId > 0) {
            MachineMovement::log($sourceId, 'part_out', "Part moved to $tgtCode", null, null, $by);
        }
        MachineMovement::log($to, 'part_in', "Part received from $srcCode", null, null, $by);
        Response::success(null, 'Part transferred — source machine flagged incomplete', 200);
    }

    /** Resolve the caller's tax visibility (Module 5). */
    private function taxView(Request $request): string
    {
        return strtolower((string)($request->user['tax_view'] ?? 'standard')) === 'extended'
            ? 'extended' : 'standard';
    }

    /** Hide the off-books "extra_amount" unless the caller has extended tax view. */
    private function gateTax(Request $request, array $row): array
    {
        if ($this->taxView($request) !== 'extended') {
            unset($row['extra_amount'], $row['extra_from_vendor']);
        }
        return $row;
    }

    // POST /machines
    public function store(Request $request): void
    {
        $data = $request->only([
            'code', 'model', 'category', 'machine_type', 'brand_name', 'accuracy', 'platform_size', 'capacity', 'customer_id', 'zone_id',
            'status', 'purchase_date', 'invoice_date', 'stamping_date', 'sold_date', 'notes',
            'hsn', 'buy_price', 'buy_gst_pct', 'sale_price', 'sale_gst_pct', 'tax_amount', 'extra_amount', 'extra_from_vendor',
        ]);
        if (empty($data['code'])) {
            Response::error('Machine code is required', 422);
        }
        // Line 2: only the extended login may set the off-books extra figures.
        if ($this->taxView($request) !== 'extended') {
            unset($data['extra_amount'], $data['extra_from_vendor']);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;

        try {
            $id = Machine::create($data);
        } catch (\Throwable $e) {
            Response::error('Could not create machine (code may already exist)', 409);
        }

        // Buying a machine is a cost — book it into the expense ledger so it
        // flows through to the Profit & Loss report automatically.
        $this->recordPurchaseExpense($data);

        // Keep the stock-items count in sync: same model+category → quantity +1
        // (code → SKU, buy price → unit cost, so Stock value is populated).
        InventoryItem::incrementForMachine($data['model'] ?? null, $data['category'] ?? null, $data['code'] ?? null, $data['buy_price'] ?? null);

        // Auto-open a stamping record from the stamping date; if blank it starts
        // as 'pending' so the Stamping page + dashboard flag it as "not done yet".
        if (class_exists('Stamping')) {
            $stampDate = !empty($data['stamping_date']) ? (string)$data['stamping_date'] : null;
            Stamping::create([
                'machine_id'  => $id,
                'customer_id' => !empty($data['customer_id']) ? (int)$data['customer_id'] : null,
                'stamp_date'  => $stampDate,
                'status'      => $stampDate ? 'stamped' : 'pending',
                'created_by'  => $data['created_by'] ?? null,
            ]);
        }

        // Movement log entry so the machine's history shows on the Machines page.
        MachineMovement::log(
            $id,
            'added',
            trim(('Machine ' . ($data['code'] ?? '')) . (!empty($data['model']) ? ' — ' . $data['model'] : '')),
            null,
            $data['status'] ?? 'in_stock',
            $data['created_by'] ?? null
        );

        Response::success(Machine::find($id), 'Machine created', 201);
    }

    // GET /machines/{id}/movements
    public function movements(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Machine::find($id)) {
            Response::error('Machine not found', 404);
        }
        Response::success(MachineMovement::forMachine($id));
    }

    // GET /machine-movements  — global feed across all machines
    public function movementsFeed(Request $request): void
    {
        $filters = ['search' => $request->query('search'), 'type' => $request->query('type')];
        Response::success(MachineMovement::all($filters, (int)$request->query('limit', 300)));
    }

    /**
     * Record a machine purchase as an expense (buy price + its GST).
     * Silent no-op when no buy price was entered. Never blocks machine creation.
     */
    private function recordPurchaseExpense(array $m): void
    {
        $buy = (float)($m['buy_price'] ?? 0);
        if ($buy <= 0) {
            return;
        }
        try {
            $gst    = $buy * (float)($m['buy_gst_pct'] ?? 0) / 100;
            $amount = round($buy + $gst, 2);
            $count  = Database::count('SELECT COUNT(*) AS cnt FROM expenses');
            $code   = 'EXP-' . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);
            $label  = trim((string)($m['model'] ?? '')) !== '' ? $m['model'] : ('Machine ' . ($m['code'] ?? ''));

            Database::insert(
                'INSERT INTO expenses
                    (expense_code, expense_date, category, vendor, description, amount, payment_mode, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $code,
                    !empty($m['purchase_date']) ? $m['purchase_date'] : date('Y-m-d'),
                    'Machine Purchase',
                    (string)$label,
                    'Machine ' . ($m['code'] ?? '') . (isset($m['model']) ? ' — ' . $m['model'] : ''),
                    $amount,
                    'Bank Transfer',
                    $m['created_by'] ?? null,
                ]
            );
        } catch (\Throwable $e) {
            error_log('[MachineController::recordPurchaseExpense] ' . $e->getMessage());
        }
    }

    // PUT /machines/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Machine::find($id)) {
            Response::error('Machine not found', 404);
        }
        $data = $request->only([
            'code', 'model', 'category', 'brand_name', 'accuracy', 'platform_size', 'capacity', 'customer_id', 'zone_id',
            'purchase_date', 'invoice_date', 'stamping_date', 'sold_date', 'notes',
            'hsn', 'buy_price', 'buy_gst_pct', 'sale_price', 'sale_gst_pct', 'tax_amount', 'extra_amount', 'extra_from_vendor',
        ]);
        if ($this->taxView($request) !== 'extended') {
            unset($data['extra_amount'], $data['extra_from_vendor']);
        }
        Machine::update($id, $data);

        // Keep the linked vendor purchase in step when the buy price/GST is edited
        // (the machine ↔ purchase FK, so the Purchases page reflects the change).
        if (array_key_exists('buy_price', $data) || array_key_exists('buy_gst_pct', $data)) {
            $m = Machine::find($id);
            if ($m && !empty($m['purchase_id']) && class_exists('Purchase')) {
                $sync = [];
                if (isset($m['buy_price']) && $m['buy_price'] !== null)   { $sync['taxable'] = (float)$m['buy_price']; }
                if (isset($m['buy_gst_pct']) && $m['buy_gst_pct'] !== null) { $sync['gst_pct'] = (float)$m['buy_gst_pct']; }
                if ($sync) {
                    Purchase::update((int)$m['purchase_id'], $sync);
                }
            }
        }
        Response::success(Machine::find($id), 'Machine updated');
    }

    // PUT /machines/{id}/status
    public function updateStatus(Request $request): void
    {
        $id = (int)$request->param('id');
        $status = (string)$request->input('status', '');
        $before = $id > 0 ? Machine::find($id) : null;
        if ($id <= 0 || !$before) {
            Response::error('Machine not found', 404);
        }
        if (!Machine::updateStatus($id, $status)) {
            Response::error('Invalid status. Allowed: ' . implode(', ', Machine::STATUSES), 422);
        }
        // Reverting a machine out of a sold/dispatch state back to stock should
        // retire the stamping auto-opened at delivery, so it no longer counts as
        // a "renewal due" for a machine that isn't with a customer anymore.
        $wasSold   = in_array($before['status'] ?? '', ['delivered', 'on_delivery'], true);
        $nowUnsold = in_array($status, ['in_stock', 'reserved', 'maintenance'], true);
        if ($wasSold && $nowUnsold && class_exists('Stamping')) {
            Stamping::cancelForMachine($id);
        }
        if (($before['status'] ?? null) !== $status) {
            MachineMovement::log(
                $id, 'status_change',
                'Status ' . ($before['status'] ?? '?') . ' → ' . $status,
                $before['status'] ?? null, $status,
                $request->user['user_id'] ?? null
            );
        }
        Response::success(Machine::find($id), 'Status updated');
    }

    // GET /machines/{id}/parts
    public function parts(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Machine::find($id)) {
            Response::error('Machine not found', 404);
        }
        Response::success(Machine::parts($id));
    }

    // POST /machines/{id}/parts
    public function addPart(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !Machine::find($id)) {
            Response::error('Machine not found', 404);
        }
        $data = $request->only(['part_name', 'product_id', 'qty', 'status']);
        if (empty($data['part_name'])) {
            Response::error('part_name is required', 422);
        }
        Machine::addPart($id, $data);
        Response::success(Machine::parts($id), 'Part added', 201);
    }
}
