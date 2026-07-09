<?php
declare(strict_types=1);

class InventoryStockController
{
    /** Attachment on stock entry — pdf/jpg/png only, 5 MB max (per Prompt 2). */
    private const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
    private const ATTACHMENT_EXTS  = ['pdf', 'jpg', 'jpeg', 'png'];
    private const ATTACHMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];

    /**
     * POST /admin/inventory/stock/receive
     * Receive supplier stock: append a STOCK_IN movement, raise the balance, log audit.
     */
    public function receiveStock(Request $request): void
    {
        $data = $request->only([
            'product_id', 'quantity', 'unit_cost',
            'reference_type', 'reference_id', 'remarks',
            'batch_number', 'expiry_date',
        ]);

        Validator::make($data, [
            'product_id'     => 'required|integer',
            'quantity'       => 'required|numeric|min:0.001',
            'unit_cost'      => 'required|numeric|min:0',
            'reference_type' => 'required|string|max:30',
            'reference_id'   => 'nullable|integer',
        ])->validate();

        $productId = (int)$data['product_id'];
        $quantity  = (float)$data['quantity'];

        if (InventoryProduct::findById($productId) === null) {
            Response::validationError(['product_id' => ['Product does not exist']]);
        }

        // Stock is received into a default intake zone; Smart Allocation then
        // re-routes it into the correct zones — zone selection is not a caller input.
        $intakeZone = InventoryZone::findByType('RAW_MATERIAL') ?? InventoryZone::findByType('READY_STOCK');
        if ($intakeZone === null) {
            Response::error('No RAW_MATERIAL or READY_STOCK zone configured for stock intake', 422);
        }
        $zoneId = (int)$intakeZone['zone_id'];

        $attachmentUrl = $this->storeAttachmentIfPresent($request);
        $actorId = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;

        Database::beginTransaction();
        try {
            $movementId = InventoryMovement::recordMovement([
                'inv_product_id' => $productId,
                'zone_id'        => $zoneId,
                'movement_type'  => 'STOCK_IN',
                'quantity'       => $quantity,
                'unit_cost'      => (float)$data['unit_cost'],
                'reference_type' => $data['reference_type'],
                'reference_id'   => (isset($data['reference_id']) && $data['reference_id'] !== '') ? (int)$data['reference_id'] : null,
                'moved_by'       => $actorId,
                'approved_by'    => $actorId,
                'approval_status'=> 'APPROVED',
                'remarks'        => $data['remarks'] ?? null,
                'batch_number'   => $data['batch_number'] ?? null,
                'expiry_date'    => (!empty($data['expiry_date']) && strtotime((string)$data['expiry_date'])) ? $data['expiry_date'] : null,
                'attachment_url' => $attachmentUrl,
            ]);

            InventoryStock::upsertStock($productId, $zoneId, $quantity);

            InventoryMovement::audit(
                'inventory_stock_movements', $movementId, 'CREATE', null,
                ['movement_type' => 'STOCK_IN', 'product_id' => $productId, 'zone_id' => $zoneId, 'quantity' => $quantity],
                $actorId, $request->ip()
            );

            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Stock receive error: ' . $e->getMessage());
            Response::error($e instanceof RuntimeException ? $e->getMessage() : 'Could not receive stock', 422);
        }

        // Smart Allocation — re-route the received stock into the correct zones.
        // Runs in its own transaction; an allocation failure must NOT fail the
        // receipt (stock simply stays in the intake zone — never rejected).
        $allocation = null;
        try {
            $engine = new SmartAllocationEngine();
            $allocation = $engine->allocate($productId, $quantity, $movementId, $actorId, $request->ip());
        } catch (Throwable $e) {
            error_log('Auto-allocation after receive failed (stock retained in intake zone): ' . $e->getMessage());
        }

        Response::success(
            [
                'movement_id' => $movementId,
                'allocation'  => $allocation,
                'stock'       => InventoryStock::getStockByProduct($productId),
            ],
            'Stock received successfully',
            201
        );
    }

    /**
     * POST /admin/inventory/stock/quality-check
     * Approve → confirm balance stays (already in receiving zone).
     * Reject  → move the rejected quantity out of its zone into the DAMAGED zone.
     */
    public function qualityCheck(Request $request): void
    {
        $data = $request->only(['product_id', 'zone_id', 'quantity', 'decision', 'remarks']);

        Validator::make($data, [
            'product_id' => 'required|integer',
            'zone_id'    => 'required|integer',
            'quantity'   => 'required|numeric|min:0.001',
            'decision'   => 'required|in:approve,reject',
        ])->validate();

        $productId = (int)$data['product_id'];
        $zoneId    = (int)$data['zone_id'];
        $quantity  = (float)$data['quantity'];
        $decision  = (string)$data['decision'];

        if (InventoryProduct::findById($productId) === null) {
            Response::validationError(['product_id' => ['Product does not exist']]);
        }
        if (InventoryZone::findById($zoneId) === null) {
            Response::validationError(['zone_id' => ['Zone does not exist']]);
        }

        $actorId = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;

        if ($decision === 'approve') {
            // Stock is already in the balance from receiving; log the approval movement only.
            Database::beginTransaction();
            try {
                $movementId = InventoryMovement::recordMovement([
                    'inv_product_id'  => $productId,
                    'zone_id'         => $zoneId,
                    'movement_type'   => 'ADJUSTMENT',
                    'quantity'        => $quantity,
                    'unit_cost'       => 0,
                    'reference_type'  => 'QUALITY_CHECK',
                    'reference_id'    => null,
                    'moved_by'        => $actorId,
                    'approved_by'     => $actorId,
                    'approval_status' => 'APPROVED',
                    'remarks'         => 'QC approved' . (isset($data['remarks']) ? ': ' . $data['remarks'] : ''),
                ]);
                InventoryStock::updateHealthScore($productId);
                InventoryMovement::audit(
                    'inventory_stock_movements', $movementId, 'APPROVE', null,
                    ['quality_check' => 'approved', 'product_id' => $productId, 'quantity' => $quantity],
                    $actorId, $request->ip()
                );
                Database::commit();
            } catch (Throwable $e) {
                Database::rollBack();
                error_log('QC approve error: ' . $e->getMessage());
                Response::error('Could not approve stock', 500);
            }

            Response::success(['movement_id' => $movementId], 'Stock approved');
        }

        // Reject → relocate to DAMAGED zone.
        $damagedZone = InventoryZone::findByType('DAMAGED');
        if ($damagedZone === null) {
            Response::error('No active DAMAGED zone configured', 422);
        }
        $damagedZoneId = (int)$damagedZone['zone_id'];

        Database::beginTransaction();
        try {
            // Out of the source zone…
            $outId = InventoryMovement::recordMovement([
                'inv_product_id'  => $productId,
                'zone_id'         => $zoneId,
                'movement_type'   => 'DAMAGE',
                'quantity'        => $quantity,
                'unit_cost'       => 0,
                'reference_type'  => 'QUALITY_CHECK',
                'reference_id'    => null,
                'moved_by'        => $actorId,
                'approved_by'     => $actorId,
                'approval_status' => 'APPROVED',
                'remarks'         => 'QC rejected' . (isset($data['remarks']) ? ': ' . $data['remarks'] : ''),
            ]);
            InventoryStock::upsertStock($productId, $zoneId, -$quantity);

            // …into the DAMAGED zone.
            InventoryMovement::recordMovement([
                'inv_product_id'  => $productId,
                'zone_id'         => $damagedZoneId,
                'movement_type'   => 'DAMAGE',
                'quantity'        => $quantity,
                'unit_cost'       => 0,
                'reference_type'  => 'QUALITY_CHECK',
                'reference_id'    => $outId,
                'moved_by'        => $actorId,
                'approved_by'     => $actorId,
                'approval_status' => 'APPROVED',
                'remarks'         => 'Moved to DAMAGED on QC reject',
            ]);
            InventoryStock::upsertStock($productId, $damagedZoneId, $quantity);

            InventoryMovement::audit(
                'inventory_stock_movements', $outId, 'REJECT',
                ['zone_id' => $zoneId],
                ['quality_check' => 'rejected', 'moved_to_zone' => $damagedZoneId, 'quantity' => $quantity],
                $actorId, $request->ip()
            );

            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('QC reject error: ' . $e->getMessage());
            Response::error($e instanceof RuntimeException ? $e->getMessage() : 'Could not reject stock', 422);
        }

        Response::success(
            ['moved_to_zone' => $damagedZoneId, 'stock' => InventoryStock::getStockByProduct($productId)],
            'Stock rejected and moved to DAMAGED zone'
        );
    }

    /**
     * POST /admin/inventory/stock/bulk-import
     * CSV columns: sku, name, category, unit_of_measure, hsn_code, reorder_level,
     *              reorder_quantity, cost_price, selling_price, zone_code.
     * Each row is validated independently; invalid rows are skipped and reported.
     */
    private const MAX_IMPORT_ROWS = 500;

    public function bulkImport(Request $request): void
    {
        if (!isset($_FILES['file']) || (int)($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            Response::error('CSV file is required', 422);
        }

        $stored = FileStore::put('import', $_FILES['file']);
        $path = FileStore::resolveLocalPath($stored['file_path']);
        if ($path === null) {
            Response::error('Could not read uploaded file', 500);
        }

        $handle = fopen($path, 'r');
        if ($handle === false) {
            Response::error('Could not open CSV file', 500);
        }

        $header = fgetcsv($handle);
        if ($header === false) {
            fclose($handle);
            Response::error('CSV file is empty', 422);
        }
        $header = array_map(fn($h) => strtolower(trim((string)$h)), $header);

        $required = ['sku', 'name', 'category', 'unit_of_measure', 'reorder_level', 'cost_price'];
        $missing = array_diff($required, $header);
        if ($missing) {
            fclose($handle);
            Response::error('CSV missing required columns: ' . implode(', ', $missing), 422);
        }

        $rows = [];
        while (($cols = fgetcsv($handle)) !== false) {
            if (count(array_filter($cols, fn($c) => trim((string)$c) !== '')) === 0) {
                continue; // skip fully blank lines
            }
            $rows[] = $cols;
        }
        fclose($handle);

        if (count($rows) > self::MAX_IMPORT_ROWS) {
            FileStore::deleteLocal($stored['file_path']);
            Response::error('Maximum 500 rows per import', 422);
        }

        $actorId = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
        $total = 0;
        $success = 0;
        $errors = [];
        $rowNum = 1; // header was row 1

        foreach ($rows as $cols) {
            $rowNum++;
            $total++;
            $row = [];
            foreach ($header as $i => $name) {
                $row[$name] = isset($cols[$i]) ? trim((string)$cols[$i]) : '';
            }

            $sku = $row['sku'] ?? '';

            // Per-row validation — collect first reason, skip on failure.
            $reason = $this->validateImportRow($row);
            if ($reason !== null) {
                $errors[] = ['row' => $rowNum, 'sku' => $sku, 'reason' => $reason];
                continue;
            }
            if (InventoryProduct::existsBySku($sku)) {
                $errors[] = ['row' => $rowNum, 'sku' => $sku, 'reason' => 'Duplicate SKU'];
                continue;
            }

            $zoneId = null;
            if (($row['zone_code'] ?? '') !== '') {
                $zone = InventoryZone::findByCode($row['zone_code']);
                if ($zone === null) {
                    $errors[] = ['row' => $rowNum, 'sku' => $sku, 'reason' => 'Unknown zone_code'];
                    continue;
                }
                $zoneId = (int)$zone['zone_id'];
            }

            Database::beginTransaction();
            try {
                $productId = InventoryProduct::create([
                    'name'             => $row['name'],
                    'sku'              => $sku,
                    'category'         => $row['category'],
                    'unit_of_measure'  => $row['unit_of_measure'],
                    'hsn_code'         => $row['hsn_code'] ?? null,
                    'reorder_level'    => $row['reorder_level'],
                    'reorder_quantity' => $row['reorder_quantity'] ?? 0,
                    'cost_price'       => $row['cost_price'],
                    'selling_price'    => $row['selling_price'] ?? 0,
                    'created_by'       => $actorId,
                ]);
                InventoryMovement::audit(
                    'inventory_products', $productId, 'CREATE', null,
                    ['sku' => $sku, 'via' => 'bulk_import'], $actorId, $request->ip()
                );
                Database::commit();
                $success++;
            } catch (Throwable $e) {
                Database::rollBack();
                error_log('Bulk import row error: ' . $e->getMessage());
                $errors[] = ['row' => $rowNum, 'sku' => $sku, 'reason' => 'Database error'];
            }
        }
        FileStore::deleteLocal($stored['file_path']);

        Response::success([
            'total'   => $total,
            'success' => $success,
            'failed'  => count($errors),
            'errors'  => $errors,
        ], 'Bulk import completed');
    }

    /** GET /admin/inventory/stock/low-stock */
    public function getLowStock(Request $request): void
    {
        Response::success(InventoryStock::getLowStockProducts());
    }

    /** GET /admin/inventory/stock/{productId} */
    public function getProductStock(Request $request): void
    {
        $productId = (int)$request->param('productId');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }
        if (InventoryProduct::findById($productId) === null) {
            Response::error('Product not found', 404);
        }
        Response::success(InventoryStock::getStockByProduct($productId));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private function validateImportRow(array $row): ?string
    {
        if (($row['sku'] ?? '') === '')             { return 'Missing SKU'; }
        if (($row['name'] ?? '') === '')            { return 'Missing name'; }
        if (($row['category'] ?? '') === '')        { return 'Missing category'; }
        $unit = $row['unit_of_measure'] ?? '';
        if (!in_array($unit, InventoryProduct::UNITS, true)) {
            return 'Invalid unit_of_measure';
        }
        if (!is_numeric($row['reorder_level'] ?? '') || (float)$row['reorder_level'] < 0) {
            return 'Invalid reorder_level';
        }
        if (!is_numeric($row['cost_price'] ?? '') || (float)$row['cost_price'] < 0) {
            return 'Invalid cost_price';
        }
        if (($row['hsn_code'] ?? '') !== '' && mb_strlen((string)$row['hsn_code']) > 8) {
            return 'hsn_code too long';
        }
        return null;
    }

    /** Validate + store a single optional attachment; returns its relative path or null. */
    private function storeAttachmentIfPresent(Request $request): ?string
    {
        if (!isset($_FILES['attachment']) || (int)($_FILES['attachment']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            return null;
        }
        $file = $_FILES['attachment'];

        if ((int)($file['size'] ?? 0) > self::ATTACHMENT_MAX_BYTES) {
            Response::error('Attachment must be 5 MB or less', 422);
        }
        $ext = strtolower(pathinfo((string)($file['name'] ?? ''), PATHINFO_EXTENSION));
        if (!in_array($ext, self::ATTACHMENT_EXTS, true)) {
            Response::error('Attachment must be a PDF, JPG, or PNG file', 422);
        }

        // FileStore re-validates mime/extension/size and stores under uploads/.
        $stored = FileStore::put('certificate', $file, 'inventory');
        if (!in_array($stored['mime_type'], self::ATTACHMENT_MIMES, true)) {
            FileStore::deleteLocal($stored['file_path']);
            Response::error('Attachment MIME type is not allowed', 422);
        }
        return $stored['file_path'];
    }
}
