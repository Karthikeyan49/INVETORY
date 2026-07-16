<?php
declare(strict_types=1);

class OrderController
{   //a
    // ─── GET /orders  (admin: all orders) ────────────────────────────────────

    public function index(Request $request): void
    {
        $page    = max(1, (int)$request->query('page', 1));
        $limit   = min(100, max(1, (int)$request->query('limit', 10)));
        $filters = ['status' => $request->query('status')];

        $result = Order::all($filters, $page, $limit);
        $total  = $result['total'];

        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / $limit),
        ]);
    }

    // ─── POST /orders ────────────────────────────────────────────────────────

    public function store(Request $request): void
    {
        $inputItems = $request->input('items');
        if (!is_array($inputItems) || empty($inputItems)) {
            Response::error('items array is required and must contain at least one item', 422);
        }

        $items = [];
        foreach ($inputItems as $item) {
            Validator::make($item, [
                'product_id' => 'required|integer',
                'quantity'   => 'required|integer|min:1',
            ])->validate();

            $productId = (int)$item['product_id'];
            $configId  = isset($item['config_id']) ? (int)$item['config_id'] : null;
            $quantity  = (int)$item['quantity'];

            try {
                $product = Product::findActiveOrFail($productId);
            } catch (AppException $e) {
                Response::error($e->getMessage(), $e->getCode());
            }

            // Server-side price resolution ONLY. A client-supplied unit_price is
            // never trusted on customer self-service orders — that let a buyer
            // order a real product at 0.01 or a negative amount. Staff walk-in
            // orders keep their entered price via storeManual (admin-guarded).
            $unitPrice = (float)$product['base_price'];
            $size = $item['size'] ?? null;
            $purpose = $item['purpose'] ?? null;
            $subPurpose = $item['sub_purpose'] ?? null;

            if ($configId !== null) {
                $config = Product::findConfig($configId, $productId);
                if (!$config) {
                    Response::error('Configuration not found or inactive for this product', 404);
                }
                $unitPrice = (float)$config['price'];
                $size = $size ?? $config['size'];
                $purpose = $purpose ?? $config['purpose'];
                $subPurpose = $subPurpose ?? ($config['sub_purpose'] ?? null);
            }

            $resolved = DealerNetwork::resolvePriceForCustomer((int)$request->user['user_id'], $productId, $configId);
            if ($resolved && ($resolved['source'] ?? '') === 'dealer_price_list') {
                $unitPrice = (float)$resolved['price'];
            }

            if ($unitPrice < 0) {
                Response::error('Resolved product price is invalid', 422);
            }

            $items[] = [
                'product_id' => $productId,
                'config_id'  => $configId,
                'quantity'   => $quantity,
                'unit_price' => $unitPrice,
                'size'       => $size,
                'purpose'    => $purpose,
                'sub_purpose'=> $subPurpose,
            ];
        }

        $meta = $request->only([
            'payment_method', 'delivery_address', 'delivery_city',
            'delivery_state', 'delivery_pincode', 'notes',
        ]);

        // Fall back to user's registered address if not provided
        if (empty($meta['delivery_address'])) {
            $meta['delivery_address'] = $request->user['address']  ?? null;
            $meta['delivery_city']    = $request->user['city']     ?? null;
            $meta['delivery_state']   = $request->user['state']    ?? null;
            $meta['delivery_pincode'] = $request->user['pincode']  ?? null;
        }

        try {
            $orderId = Order::create((int)$request->user['user_id'], $items, $meta);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        $order = Order::findForUser($orderId, (int)$request->user['user_id']);
        Response::success($order, 'Order created successfully', 201);
    }

    // ─── POST /admin/orders  (staff manual / walk-in order entry) ─────────────
    //
    // The business has no customer mobile app, so staff enter walk-in orders by
    // hand. Unlike store() (which creates an order for the *authenticated* user),
    // this accepts manual customer details: it resolves an existing customer by
    // phone or creates a lightweight customer user, then reuses Order::create so
    // the orders.user_id FK and the customer JOIN in Order::findById keep working.

    public function storeManual(Request $request): void
    {
        // ── Customer ──────────────────────────────────────────────────────────
        $name  = trim((string)($request->input('customer_name') ?? ''));
        $phone = preg_replace('/\D/', '', (string)($request->input('customer_phone') ?? ''));

        if ($name === '') {
            Response::error('customer_name is required', 422);
        }
        if (strlen((string)$phone) < 7) {
            Response::error('A valid customer_phone is required', 422);
        }

        $address = $request->input('delivery_address');
        $city    = $request->input('delivery_city');
        $state   = $request->input('delivery_state');
        $pincode = $request->input('delivery_pincode');

        // Resolve existing customer by phone, otherwise create one.
        $existing = User::findByPhone((string)$phone);
        if ($existing) {
            $customerId = (int)$existing['user_id'];
        } else {
            try {
                $email = trim((string)($request->input('customer_email') ?? ''));
                if ($email === '') {
                    // Synthesize a unique placeholder email for the walk-in record.
                    $email = 'walkin+' . $phone . '@inventory.local';
                }
                $customerId = User::create([
                    'name'            => $name,
                    'email'          => $email,
                    'phone'           => $phone,
                    'user_type'       => 'customer',
                    'address'         => $address,
                    'city'            => $city,
                    'state'           => $state,
                    'pincode'         => $pincode,
                    // Random password — manual customers don't log in.
                    'password'        => bin2hex(random_bytes(16)),
                    'approval_status' => 'approved',
                ]);
            } catch (AppException $e) {
                Response::error($e->getMessage(), $e->getCode());
            }
        }

        // ── Line items ────────────────────────────────────────────────────────
        $inputItems = $request->input('items');
        if (!is_array($inputItems) || empty($inputItems)) {
            Response::error('items array is required and must contain at least one item', 422);
        }

        $items = [];
        foreach ($inputItems as $idx => $item) {
            if (!is_array($item)) {
                Response::error("items[$idx] must be an object", 422);
            }
            Validator::make($item, [
                'product_id' => 'required|integer',
                'quantity'   => 'required|integer|min:1',
            ])->validate();

            $productId = (int)$item['product_id'];
            $quantity  = (int)$item['quantity'];
            $configId  = isset($item['config_id']) ? (int)$item['config_id'] : null;

            try {
                $product = Product::findActiveOrFail($productId);
            } catch (AppException $e) {
                Response::error($e->getMessage(), $e->getCode());
            }

            // Staff-entered price wins; fall back to product base price.
            $unitPrice = isset($item['unit_price']) ? (float)$item['unit_price'] : (float)$product['base_price'];

            $items[] = [
                'product_id'  => $productId,
                'config_id'   => $configId,
                'quantity'    => $quantity,
                'unit_price'  => $unitPrice,
                'size'        => $item['size']        ?? null,
                'purpose'     => $item['purpose']     ?? null,
                'sub_purpose' => $item['sub_purpose'] ?? null,
            ];
        }

        $meta = [
            'payment_method'   => $request->input('payment_method'),
            'delivery_address' => $address,
            'delivery_city'    => $city,
            'delivery_state'   => $state,
            'delivery_pincode' => $pincode,
            'notes'            => $request->input('notes'),
        ];

        try {
            $orderId = Order::create($customerId, $items, $meta);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        // Optional payment status (manual orders are often paid on the spot).
        $paymentStatus = strtolower(trim((string)($request->input('payment_status') ?? '')));
        if (in_array($paymentStatus, ['paid', 'pending', 'failed', 'refunded'], true) && $paymentStatus !== 'pending') {
            Database::execute(
                'UPDATE orders SET payment_status = ?, updated_at = NOW() WHERE order_id = ?',
                [$paymentStatus, $orderId]
            );
        }

        Response::success(Order::findById($orderId), 'Order created successfully', 201);
    }

    // ─── GET /orders/{id} ───────────────────────────────────────────────────

    public function show(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        $order = Order::findById($orderId);
        if (!$order) {
            Response::error('Order not found', 404);
        }

        // Admins can view any order; regular users only their own
        $isAdmin = ($request->user['user_type'] ?? '') === 'admin';
        if (!$isAdmin && (int)$order['user_id'] !== (int)$request->user['user_id']) {
            Response::error('Forbidden', 403);
        }

        Response::success($order);
    }

    // ─── PUT /orders/{id}/status ─────────────────────────────────────────────

    public function updateStatus(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        Validator::make($request->only(['order_status']), [
            'order_status' => 'required|in:' . implode(',', Order::STATUSES),
        ])->validate();

        $newStatus      = $request->input('order_status');
        $trackingNumber = $newStatus === 'shipped'
            ? (trim((string)($request->input('tracking_number') ?? '')) ?: null)
            : null;
        $cancelReason   = $newStatus === 'cancelled'
            ? (trim((string)($request->input('cancel_reason') ?? '')) ?: null)
            : null;

        try {
            Order::updateStatus($orderId, $newStatus, $trackingNumber, $cancelReason);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        $data = [];

        // ── Smart Inventory hook: dealer order confirmed → reserve stock ────────
        // Failure here must never break order status updates.
        if ($newStatus === 'confirmed') {
            try {
                $this->reserveInventoryForDealerOrder($orderId);
            } catch (\Throwable $e) {
                error_log('[updateStatus] Dealer inventory reservation failed: ' . $e->getMessage());
            }
        }

        if ($request->input('order_status') === 'delivered') {
            try {
                $inv = AdminInvoiceController::generateForOrder($orderId);
                if ($inv) {
                    $data['invoice_generated'] = true;
                    $data['invoice_number']    = $inv['invoice_number'];
                }
            } catch (\Throwable $e) {
                error_log('[updateStatus] Invoice generation failed: ' . $e->getMessage());
            }

            // ── Smart Inventory hook: invoice confirmed → stock-out movement ────
            // Failure here must never break order status updates or invoicing.
            try {
                $this->recordStockOutForOrder($orderId);
            } catch (\Throwable $e) {
                error_log('[updateStatus] Inventory stock-out failed: ' . $e->getMessage());
            }
        }

        Response::success($data ?: null, 'Order status updated successfully');
    }

    /**
     * Smart Inventory interconnection — when a dealer's order is confirmed,
     * reserve available stock for each ordered product (DEALER_RESERVED zone),
     * update their demand profile, and trigger allocation if stock is available.
     */
    private function reserveInventoryForDealerOrder(int $orderId): void
    {
        $order = Order::findById($orderId);
        if ($order === null) {
            return;
        }

        $buyer = Database::fetch('SELECT user_type FROM users WHERE user_id = ? LIMIT 1', [$order['user_id']]);
        if ($buyer === null || ($buyer['user_type'] ?? '') !== 'dealer') {
            return;
        }

        $dealerId = (int)$order['user_id'];
        $zone     = InventoryZone::findByType('DEALER_RESERVED');
        if ($zone === null) {
            return;
        }

        $allocationEngine = new SmartAllocationEngine();

        // Wrap the read-then-reserve loop in a transaction. InventoryStock::
        // reserveStock() locks the stock row with SELECT ... FOR UPDATE but
        // requires the caller to be inside a transaction — in autocommit the
        // lock is released immediately, so concurrent confirmations could each
        // read the same availability and over-reserve. The transaction makes
        // the read + reserve atomic.
        Database::beginTransaction();
        try {
            foreach ($order['items'] as $item) {
                $invProductId = Database::fetch(
                    'SELECT inv_product_id FROM inventory_products WHERE source_product_id = ? AND is_deleted = 0 LIMIT 1',
                    [(int)$item['product_id']]
                );
                if ($invProductId === null) {
                    continue;
                }
                $invProductId = (int)$invProductId['inv_product_id'];
                $quantity     = (float)$item['quantity'];

                $stock = Database::fetch(
                    'SELECT COALESCE(SUM(available_quantity), 0) AS qty FROM inventory_stock WHERE inv_product_id = ? FOR UPDATE',
                    [$invProductId]
                );
                $available = (float)($stock['qty'] ?? 0);

                Database::execute(
                    "INSERT INTO inventory_dealer_demand (dealer_id, inv_product_id, suggested_reserve_qty, confidence_score, last_order_quantity, last_order_date)
                     VALUES (?, ?, ?, 50, ?, CURDATE())
                     ON DUPLICATE KEY UPDATE
                        suggested_reserve_qty = suggested_reserve_qty + VALUES(suggested_reserve_qty),
                        last_order_quantity = VALUES(last_order_quantity),
                        last_order_date = VALUES(last_order_date)",
                    [$dealerId, $invProductId, $quantity, $quantity]
                );

                if ($available <= 0) {
                    continue;
                }

                $reserveQty = min($available, $quantity);
                InventoryStock::reserveStock($invProductId, (int)$zone['zone_id'], $reserveQty);
                InventoryAllocation::updateDealerReservation($dealerId, $invProductId, $reserveQty);
                InventoryStock::updateHealthScore($invProductId);
            }
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            throw $e;
        }
    }

    /**
     * Smart Inventory interconnection — when an order is delivered (and its
     * invoice generated), record a STOCK_OUT/DEALER_ALLOCATION movement for each
     * line item, deducting from DEALER_RESERVED (if reserved) or READY_STOCK.
     */
    private function recordStockOutForOrder(int $orderId): void
    {
        $order = Order::findById($orderId);
        if ($order === null) {
            return;
        }

        $buyer    = Database::fetch('SELECT user_type FROM users WHERE user_id = ? LIMIT 1', [$order['user_id']]);
        $isDealer = $buyer !== null && ($buyer['user_type'] ?? '') === 'dealer';
        $movementEngine = new MovementEngine();

        foreach ($order['items'] as $item) {
            $invProductId = Database::fetch(
                'SELECT inv_product_id FROM inventory_products WHERE source_product_id = ? AND is_deleted = 0 LIMIT 1',
                [(int)$item['product_id']]
            );
            if ($invProductId === null) {
                continue;
            }
            $invProductId = (int)$invProductId['inv_product_id'];
            $quantity     = (float)$item['quantity'];

            $reservedZone = InventoryZone::findByType('DEALER_RESERVED');
            $readyZone    = InventoryZone::findByType('READY_STOCK');

            $zone       = null;
            $fromReserved = false;
            if ($isDealer && $reservedZone !== null) {
                $reservedStock = Database::fetch(
                    'SELECT current_quantity, reserved_quantity FROM inventory_stock WHERE inv_product_id = ? AND zone_id = ?',
                    [$invProductId, (int)$reservedZone['zone_id']]
                );
                if ($reservedStock !== null && (float)$reservedStock['current_quantity'] >= $quantity) {
                    $zone         = $reservedZone;
                    $fromReserved = true;
                }
            }
            if ($zone === null) {
                $zone = $readyZone;
            }
            if ($zone === null) {
                continue;
            }

            if ($fromReserved) {
                // Free the reservation first so available_quantity covers the outflow.
                InventoryStock::releaseReserved($invProductId, (int)$zone['zone_id'], $quantity);
            }

            $movementEngine->processMovement([
                'inv_product_id'  => $invProductId,
                'zone_id'         => (int)$zone['zone_id'],
                'movement_type'   => $fromReserved ? 'DEALER_ALLOCATION' : 'STOCK_OUT',
                'quantity'        => $quantity,
                'unit_cost'       => (float)$item['unit_price'],
                'reference_type'  => 'DEALER_ORDER',
                'reference_id'    => $orderId,
                'dealer_id'       => $isDealer ? (int)$order['user_id'] : null,
                'remarks'         => 'Auto stock-out for order #' . ($order['order_number'] ?? $orderId),
            ]);
        }
    }
    // ─── PUT /orders/{id}/payment ─────────────────────────────────────────────

    public function updatePayment(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        $paymentMethod = $request->input('payment_method');
        if (!$paymentMethod) {
            Response::error('payment_method is required', 422);
        }

        $allowed = ['pending', 'cod', 'upi', 'online', 'net_banking', 'wallet'];
        if (!in_array(strtolower($paymentMethod), $allowed, true)) {
            Response::error('Invalid payment_method value', 422);
        }

        Database::execute(
            'UPDATE orders SET payment_method = ?, updated_at = NOW() WHERE order_id = ?',
            [strtolower($paymentMethod), $orderId]
        );

        Response::success(null, 'Payment method updated successfully');
    }
    public function updatePaymentStatus(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        $status = $request->input('payment_status');
        if (!$status) {
            Response::error('payment_status is required', 422);
        }

        $allowed = ['pending', 'paid', 'failed', 'refunded'];
        if (!in_array(strtolower($status), $allowed, true)) {
            Response::error('Invalid payment_status value', 422);
        }

        Database::execute(
            'UPDATE orders SET payment_status = ?, updated_at = NOW() WHERE order_id = ?',
            [strtolower($status), $orderId]
        );

        $data = [];
        if (strtolower($status) === 'paid') {
            try {
                $inv = AdminInvoiceController::generateForOrder($orderId);
                if ($inv) {
                    $data['invoice_generated'] = true;
                    $data['invoice_number']    = $inv['invoice_number'];
                }
            } catch (\Throwable $e) {
                error_log('[updatePaymentStatus] Invoice generation failed: ' . $e->getMessage());
            }
        }

        Response::success($data ?: null, 'Payment status updated successfully');
    }

    // ─── PUT /orders/{id}/refund-status ──────────────────────────────────────

    public function updateRefundStatus(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        $refundStatus = trim((string)($request->input('refund_status') ?? ''));
        if ($refundStatus === '') {
            Response::error('refund_status is required', 422);
        }

        try {
            Order::updateRefundStatus($orderId, $refundStatus);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        Response::success(null, 'Refund status updated successfully');
    }

    // POST /admin/orders/from-document — create an order from an invoice or delivery challan
    public function storeFromDocument(Request $request): void
    {
        $type = strtolower(trim((string)($request->input('source_type') ?? '')));
        $id   = (int)($request->input('source_id') ?? 0);
        if (!in_array($type, ['invoice', 'challan'], true) || $id <= 0) {
            Response::error('source_type (invoice|challan) and source_id are required', 422);
        }

        $customerName = 'Customer';
        $total = 0.0;
        $ref = '#' . $id;
        $itemsNote = '';

        if ($type === 'challan') {
            $d = DeliveryNote::find($id);
            if (!$d) {
                Response::error('Delivery challan not found', 404);
            }
            $customerName = trim((string)($d['customer_name'] ?? '')) ?: 'Customer';
            $total = (float)($d['amount'] ?? 0);
            $ref = (string)($d['challan_no'] ?? $ref);
            $itemsNote = trim((string)($d['items'] ?? ''));
        } else {
            $inv = Database::fetch(
                "SELECT i.invoice_number, COALESCE(i.customer_name, u.name) AS customer_name, i.total
                 FROM invoices i LEFT JOIN users u ON u.user_id = i.customer_id
                 WHERE i.invoice_id = ? LIMIT 1",
                [$id]
            );
            if (!$inv) {
                Response::error('Invoice not found', 404);
            }
            $customerName = trim((string)($inv['customer_name'] ?? '')) ?: 'Customer';
            $total = (float)($inv['total'] ?? 0);
            $ref = (string)($inv['invoice_number'] ?? $ref);
        }

        $notes = 'From ' . ucfirst($type) . ' ' . $ref . ($itemsNote !== '' ? (' — ' . $itemsNote) : '');
        $orderId = Order::createDirect($customerName, $total, ['source' => $type, 'notes' => $notes]);
        Response::success(Order::find($orderId), 'Order created from ' . $type, 201);
    }
}
