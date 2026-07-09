<?php
declare(strict_types=1);

class InventoryMovementController
{
    private const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
    private const ATTACHMENT_EXTS  = ['pdf', 'jpg', 'jpeg', 'png'];
    private const ATTACHMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];

    /** GET /admin/inventory/movements — list all with filters (paginated). */
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(100, max(1, (int)$request->query('limit', 50)));

        $where = ['1=1'];
        $params = [];

        $eq = [
            'movement_type'   => 'm.movement_type',
            'product_id'      => 'm.inv_product_id',
            'zone_id'         => 'm.zone_id',
            'moved_by'        => 'm.moved_by',
            'approval_status' => 'm.approval_status',
            'reference_type'  => 'm.reference_type',
        ];
        foreach ($eq as $key => $col) {
            $val = $request->query($key);
            if ($val !== null && $val !== '') {
                $where[] = "$col = ?";
                $params[] = in_array($key, ['product_id', 'zone_id', 'moved_by'], true) ? (int)$val : (string)$val;
            }
        }
        if (($from = $request->query('date_from')) !== null && $from !== '') {
            $where[] = 'm.created_at >= ?';
            $params[] = (string)$from;
        }
        if (($to = $request->query('date_to')) !== null && $to !== '') {
            $where[] = 'm.created_at <= ?';
            $params[] = (string)$to;
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_stock_movements m WHERE $whereClause",
            $params
        );
        $rows = Database::fetchAll(
            "SELECT m.*, p.name AS product_name, p.sku, z.zone_name, z.zone_code, z.zone_type,
                    u.name AS moved_by_name
             FROM inventory_stock_movements m
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             JOIN inventory_zones z ON z.zone_id = m.zone_id
             LEFT JOIN users u ON u.user_id = m.moved_by
             WHERE $whereClause
             ORDER BY m.created_at DESC, m.movement_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        Response::paginated($rows, [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / $limit),
        ]);
    }

    /** POST /admin/inventory/movements/employee-issue */
    public function employeeIssue(Request $request): void
    {
        $data = $request->only(['product_id', 'employee_id', 'quantity', 'remarks', 'zone_id']);
        Validator::make($data, [
            'product_id'  => 'required|integer',
            'employee_id' => 'required|integer',
            'quantity'    => 'required|numeric|min:0.001',
            'remarks'     => 'required|string|min:5',
            'zone_id'     => 'required|integer',
        ])->validate();

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->issueToEmployee(
                (int)$data['product_id'], (int)$data['employee_id'], (float)$data['quantity'],
                (string)$data['remarks'], (int)$data['zone_id'], $actor, $ip
            ),
            'Stock issued to employee successfully'
        );
    }

    /** POST /admin/inventory/movements/dealer-allocation */
    public function dealerAllocation(Request $request): void
    {
        $data = $request->only(['product_id', 'dealer_id', 'quantity', 'remarks', 'zone_id']);
        Validator::make($data, [
            'product_id' => 'required|integer',
            'dealer_id'  => 'required|integer',
            'quantity'   => 'required|numeric|min:0.001',
            'zone_id'    => 'required|integer',
        ])->validate();

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->allocateToDealer(
                (int)$data['product_id'], (int)$data['dealer_id'], (float)$data['quantity'],
                (string)($data['remarks'] ?? ''), (int)$data['zone_id'], $actor, $ip
            ),
            'Stock allocated to dealer successfully'
        );
    }

    /** POST /admin/inventory/movements/production-use */
    public function productionUse(Request $request): void
    {
        $data = $request->only(['product_id', 'quantity', 'batch_reference', 'remarks', 'zone_id']);
        Validator::make($data, [
            'product_id'      => 'required|integer',
            'quantity'        => 'required|numeric|min:0.001',
            'batch_reference' => 'required|string',
            'zone_id'         => 'required|integer',
        ])->validate();

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->recordProductionUsage(
                (int)$data['product_id'], (float)$data['quantity'], (string)$data['batch_reference'],
                (string)($data['remarks'] ?? ''), (int)$data['zone_id'], $actor, $ip
            ),
            'Production usage recorded successfully'
        );
    }

    /** POST /admin/inventory/movements/transfer */
    public function zoneTransfer(Request $request): void
    {
        $data = $request->only(['product_id', 'from_zone_id', 'to_zone_id', 'quantity', 'reason']);
        Validator::make($data, [
            'product_id'   => 'required|integer',
            'from_zone_id' => 'required|integer',
            'to_zone_id'   => 'required|integer',
            'quantity'     => 'required|numeric|min:0.001',
            'reason'       => 'required|string|min:10',
        ])->validate();

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->transferBetweenZones(
                (int)$data['product_id'], (int)$data['from_zone_id'], (int)$data['to_zone_id'],
                (float)$data['quantity'], (string)$data['reason'], $actor, $ip
            ),
            'Stock transferred between zones successfully'
        );
    }

    /** POST /admin/inventory/movements/damaged */
    public function markDamaged(Request $request): void
    {
        $data = $request->only(['product_id', 'zone_id', 'quantity', 'reason']);
        Validator::make($data, [
            'product_id' => 'required|integer',
            'zone_id'    => 'required|integer',
            'quantity'   => 'required|numeric|min:0.001',
            'reason'     => 'required|string|min:10',
        ])->validate();

        $attachmentUrl = $this->storeEvidenceIfPresent();

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->markAsDamaged(
                (int)$data['product_id'], (int)$data['zone_id'], (float)$data['quantity'],
                (string)$data['reason'], $attachmentUrl, $actor, $ip
            ),
            'Stock marked as damaged successfully'
        );
    }

    /** POST /admin/inventory/movements/return */
    public function processReturn(Request $request): void
    {
        $data = $request->only(['product_id', 'from_type', 'from_id', 'quantity', 'remarks', 'zone_id']);
        Validator::make($data, [
            'product_id' => 'required|integer',
            'from_type'  => 'required|string',
            'from_id'    => 'required|integer',
            'quantity'   => 'required|numeric|min:0.001',
            'zone_id'    => 'required|integer',
        ])->validate();

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->processReturn(
                (int)$data['product_id'], (string)$data['from_type'], (int)$data['from_id'],
                (float)$data['quantity'], (string)($data['remarks'] ?? ''), (int)$data['zone_id'], $actor, $ip
            ),
            'Return processed successfully'
        );
    }

    /** POST /admin/inventory/movements/return-vendor */
    public function returnToVendor(Request $request): void
    {
        $data = $request->only(['product_id', 'zone_id', 'quantity', 'supplier_name', 'reason']);
        Validator::make($data, [
            'product_id'    => 'required|integer',
            'zone_id'       => 'required|integer',
            'quantity'      => 'required|numeric|min:0.001',
            'supplier_name' => 'required|string',
            'reason'        => 'required|string|min:10',
        ])->validate();

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->returnToVendorOut(
                (int)$data['product_id'], (string)$data['supplier_name'], (float)$data['quantity'],
                (string)$data['reason'], (int)$data['zone_id'], $actor, $ip
            ),
            'Stock returned to vendor successfully'
        );
    }

    /** POST /admin/inventory/movements/emergency */
    public function emergencyUse(Request $request): void
    {
        $data = $request->only(['product_id', 'quantity', 'reason', 'authorized_by', 'zone_id']);
        Validator::make($data, [
            'product_id'    => 'required|integer',
            'quantity'      => 'required|numeric|min:0.001',
            'reason'        => 'required|string|min:10',
            'authorized_by' => 'required|integer',
            'zone_id'       => 'required|integer',
        ])->validate();

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->processEmergencyUsage(
                (int)$data['product_id'], (float)$data['quantity'], (string)$data['reason'],
                (int)$data['authorized_by'], (int)$data['zone_id'], $actor, $ip
            ),
            'Emergency usage recorded (pending approval)'
        );
    }

    /** POST /admin/inventory/movements/cycle-count */
    public function cycleCountAdjustment(Request $request): void
    {
        $data = $request->only(['product_id', 'physical_quantity', 'reason', 'approved_by']);
        Validator::make($data, [
            'product_id'        => 'required|integer',
            'physical_quantity' => 'required|numeric|min:0',
            'reason'            => 'required|string|min:10',
            'approved_by'       => 'required|integer',
        ])->validate();

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->processCycleCountAdjustment(
                (int)$data['product_id'], (float)$data['physical_quantity'],
                (string)$data['reason'], (int)$data['approved_by'], $actor, $ip
            ),
            'Cycle-count adjustment recorded'
        );
    }

    /** POST /admin/inventory/movements/adjustment */
    public function adjustment(Request $request): void
    {
        $data = $request->only(['product_id', 'zone_id', 'new_quantity', 'reason', 'approved_by']);
        Validator::make($data, [
            'product_id'   => 'required|integer',
            'zone_id'      => 'required|integer',
            'new_quantity' => 'required|numeric|min:0',
            'reason'       => 'required|string|min:20',
            'approved_by'  => 'required|integer',
        ])->validate();

        // approved_by must be an admin user
        $admin = Database::fetch(
            "SELECT user_id FROM users WHERE user_id = ? AND user_type = 'admin' LIMIT 1",
            [(int)$data['approved_by']]
        );
        if ($admin === null) {
            Response::validationError(['approved_by' => ['approved_by must be an admin user']]);
        }

        $this->run($request, fn(MovementEngine $e, ?int $actor, ?string $ip) =>
            $e->processAdjustment(
                (int)$data['product_id'], (int)$data['zone_id'], (float)$data['new_quantity'],
                (string)$data['reason'], (int)$data['approved_by'], $actor, $ip
            ),
            'Adjustment recorded (pending approval)'
        );
    }

    /** GET /admin/inventory/movements/{id} */
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $movement = InventoryMovement::getMovementById($id);
        if ($movement === null) {
            Response::error('Movement not found', 404);
        }
        Response::success($movement);
    }

    /** GET /admin/inventory/movements/product/{productId} */
    public function byProduct(Request $request): void
    {
        $productId = (int)$request->param('productId');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }
        $filters = [
            'movement_type'   => $request->query('movement_type'),
            'zone_id'         => $request->query('zone_id'),
            'approval_status' => $request->query('approval_status'),
            'from'            => $request->query('date_from'),
            'to'              => $request->query('date_to'),
        ];
        Response::success(InventoryMovement::getMovementsByProduct($productId, $filters));
    }

    /** GET /admin/inventory/movements/pending-approvals */
    public function pendingApprovals(Request $request): void
    {
        Response::success(InventoryMovement::getPendingApprovals());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /**
     * Run an engine call with the standard actor/ip wiring + error handling, then
     * send the success response. $fn receives (engine, actorId, ip) and returns
     * the result payload.
     */
    private function run(Request $request, callable $fn, string $successMessage): void
    {
        $actorId = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
        try {
            $result = $fn(new MovementEngine(), $actorId, $request->ip());
        } catch (Throwable $e) {
            error_log('Movement error: ' . $e->getMessage());
            Response::error($e instanceof RuntimeException ? $e->getMessage() : 'Movement failed', 422);
        }
        Response::success($result, $successMessage, 201);
    }

    /** Validate + store an optional damage-evidence attachment; returns path or null. */
    private function storeEvidenceIfPresent(): ?string
    {
        if (!isset($_FILES['evidence_attachment'])
            || (int)($_FILES['evidence_attachment']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            return null;
        }
        $file = $_FILES['evidence_attachment'];
        if ((int)($file['size'] ?? 0) > self::ATTACHMENT_MAX_BYTES) {
            Response::error('Evidence attachment must be 5 MB or less', 422);
        }
        $ext = strtolower(pathinfo((string)($file['name'] ?? ''), PATHINFO_EXTENSION));
        if (!in_array($ext, self::ATTACHMENT_EXTS, true)) {
            Response::error('Evidence attachment must be a PDF, JPG, or PNG file', 422);
        }
        $stored = FileStore::put('certificate', $file, 'inventory');
        if (!in_array($stored['mime_type'], self::ATTACHMENT_MIMES, true)) {
            FileStore::deleteLocal($stored['file_path']);
            Response::error('Evidence attachment MIME type is not allowed', 422);
        }
        return $stored['file_path'];
    }
}
