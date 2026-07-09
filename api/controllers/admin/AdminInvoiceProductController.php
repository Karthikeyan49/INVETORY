<?php
declare(strict_types=1);

/**
 * GET    /admin/invoice-products          — list all catalog entries
 * POST   /admin/invoice-products          — create or update by name (upsert)
 * PUT    /admin/invoice-products/{id}     — update a specific entry
 * DELETE /admin/invoice-products/{id}     — delete an entry
 */
class AdminInvoiceProductController
{
    public function index(Request $request): void
    {
        $rows = Database::fetchAll(
            'SELECT id, name, hsn_code, unit_price, gst_rate, unit, created_at, updated_at
               FROM invoice_products
              ORDER BY name ASC'
        );
        Response::success($rows);
    }

    // Create or update by name (upsert so duplicates don't pile up)
    public function store(Request $request): void
    {
        $name     = trim(Request::sanitize((string)($request->input('name') ?? '')));
        $hsn      = trim((string)($request->input('hsn_code')  ?? ''));
        $price    = (float)($request->input('unit_price') ?? 0);
        $gstRate  = (int)($request->input('gst_rate')    ?? 18);
        $unit     = trim((string)($request->input('unit') ?? ''));

        if ($name === '') Response::error('Product name is required', 422);
        if (!in_array($gstRate, [0, 5, 12, 18, 28], true)) {
            Response::error('gst_rate must be one of 0, 5, 12, 18, 28', 422);
        }

        $existing = Database::fetch(
            'SELECT id FROM invoice_products WHERE name = ? LIMIT 1', [$name]
        );

        if ($existing) {
            Database::execute(
                'UPDATE invoice_products
                    SET hsn_code = ?, unit_price = ?, gst_rate = ?, unit = ?, updated_at = NOW()
                  WHERE id = ?',
                [$hsn ?: null, $price, $gstRate, $unit ?: null, $existing['id']]
            );
            $row = Database::fetch('SELECT * FROM invoice_products WHERE id = ? LIMIT 1', [$existing['id']]);
            Response::success($row, 'Invoice product updated', 200);
        } else {
            $id = Database::insert(
                'INSERT INTO invoice_products (name, hsn_code, unit_price, gst_rate, unit, created_at)
                 VALUES (?, ?, ?, ?, ?, NOW())',
                [$name, $hsn ?: null, $price, $gstRate, $unit ?: null]
            );
            $row = Database::fetch('SELECT * FROM invoice_products WHERE id = ? LIMIT 1', [$id]);
            Response::success($row, 'Invoice product created', 201);
        }
    }

    public function update(Request $request): void
    {
        $id  = (int)$request->param('id');
        $row = Database::fetch('SELECT id FROM invoice_products WHERE id = ? LIMIT 1', [$id]);
        if (!$row) Response::error('Invoice product not found', 404);

        $name    = trim(Request::sanitize((string)($request->input('name') ?? '')));
        $hsn     = trim((string)($request->input('hsn_code')  ?? ''));
        $price   = (float)($request->input('unit_price') ?? 0);
        $gstRate = (int)($request->input('gst_rate')    ?? 18);
        $unit    = trim((string)($request->input('unit') ?? ''));

        if ($name === '') Response::error('Product name is required', 422);

        Database::execute(
            'UPDATE invoice_products
                SET name = ?, hsn_code = ?, unit_price = ?, gst_rate = ?, unit = ?, updated_at = NOW()
              WHERE id = ?',
            [$name, $hsn ?: null, $price, $gstRate, $unit ?: null, $id]
        );
        Response::success(
            Database::fetch('SELECT * FROM invoice_products WHERE id = ? LIMIT 1', [$id]),
            'Invoice product updated'
        );
    }

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Database::fetch('SELECT id FROM invoice_products WHERE id = ? LIMIT 1', [$id])) {
            Response::error('Invoice product not found', 404);
        }
        Database::execute('DELETE FROM invoice_products WHERE id = ?', [$id]);
        Response::success(null, 'Invoice product deleted');
    }
}
