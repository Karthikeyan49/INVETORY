<?php
declare(strict_types=1);

/**
 * Admin Reports Controller
 *
 * Endpoints
 * ─────────
 *   GET /admin/reports?module=<key>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Modules: sales, orders, payments, expenses, production, forecast
 * Each returns a uniform row shape: { date, reference, category, party, amount, status }
 *
 * Smart Inventory interconnections
 *   GET /admin/reports/inventory/stock-summary       — current stock per product
 *   GET /admin/reports/inventory/movement-report     — movement ledger in a date range
 *   GET /admin/reports/inventory/valuation-report    — stock valuation by category
 *   GET /admin/reports/inventory/dealer-consumption  — dealer allocation totals
 *   GET /admin/reports/inventory/zone-analysis       — per-zone utilization
 */
class AdminReportsController
{
    private const MODULES = ['sales', 'orders', 'payments', 'expenses', 'production', 'forecast'];

    public function index(Request $request): void
    {
        $module = strtolower((string)$request->query('module', 'sales'));
        if (!in_array($module, self::MODULES, true)) {
            Response::error('Invalid module. Allowed: ' . implode(', ', self::MODULES), 422);
        }

        $to   = $request->query('to')   ?: date('Y-m-d');
        $from = $request->query('from') ?: date('Y-m-d', strtotime('-30 days', strtotime($to)));
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }

        $rows = match ($module) {
            'sales'      => $this->sales($from, $to),
            'orders'     => $this->orders($from, $to),
            'payments'   => $this->payments($from, $to),
            'expenses'   => $this->expenses($from, $to),
            'production' => [], // no production table yet
            'forecast'   => $this->forecast($from, $to),
        };

        Response::success([
            'module' => $module,
            'from'   => $from,
            'to'     => $to,
            'rows'   => $rows,
            'total'  => array_sum(array_column($rows, 'amount')),
            'count'  => count($rows),
        ]);
    }

    private function sales(string $from, string $to): array
    {
        $rows = Database::fetchAll(
            "SELECT DATE(i.created_at) AS date,
                    COALESCE(i.invoice_number, 'Unknown') AS reference,
                    'Invoice'          AS category,
                    COALESCE(i.customer_name, u.name, 'Unknown') AS party,
                    i.total            AS amount,
                    COALESCE(i.status, 'Unknown') AS status
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id
             WHERE DATE(i.created_at) BETWEEN ? AND ?
             ORDER BY i.created_at DESC",
            [$from, $to]
        );
        return self::castAmount($rows);
    }

    private function orders(string $from, string $to): array
    {
        $rows = Database::fetchAll(
            "SELECT DATE(o.created_at) AS date,
                    COALESCE(o.order_number, 'Unknown') AS reference,
                    CASE u.user_type WHEN 'dealer' THEN 'Wholesale' ELSE 'Retail' END AS category,
                    COALESCE(u.name, 'Unknown') AS party,
                    o.total_amount     AS amount,
                    COALESCE(o.order_status, 'Unknown') AS status
             FROM orders o
             JOIN users u ON u.user_id = o.user_id
             WHERE DATE(o.created_at) BETWEEN ? AND ?
             ORDER BY o.created_at DESC",
            [$from, $to]
        );
        return self::castAmount($rows);
    }

    private function payments(string $from, string $to): array
    {
        // Inflows: paid invoices  |  Outflows: expenses
        $inflows = Database::fetchAll(
            "SELECT DATE(COALESCE(i.updated_at, i.created_at)) AS date,
                    COALESCE(i.invoice_number, 'Unknown') AS reference,
                    'Inflow'           AS category,
                    COALESCE(i.customer_name, u.name, 'Unknown') AS party,
                    i.total            AS amount,
                    'Cleared'          AS status
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id
             WHERE LOWER(COALESCE(i.payment_status, o.payment_status)) = 'paid'
               AND DATE(COALESCE(i.updated_at, i.created_at)) BETWEEN ? AND ?",
            [$from, $to]
        );
        $outflows = Database::fetchAll(
            "SELECT COALESCE(expense_date, DATE(created_at)) AS date,
                    COALESCE(expense_code, 'Unknown') AS reference,
                    'Outflow'     AS category,
                    COALESCE(vendor, 'Unknown') AS party,
                    amount,
                    'Paid'        AS status
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?",
            [$from, $to]
        );
        $rows = array_merge($inflows, $outflows);
        usort($rows, fn($a, $b) => strcmp((string)$b['date'], (string)$a['date']));
        return self::castAmount($rows);
    }

    private function expenses(string $from, string $to): array
    {
        $rows = Database::fetchAll(
            "SELECT COALESCE(expense_date, DATE(created_at)) AS date,
                    COALESCE(expense_code, 'Unknown') AS reference,
                    COALESCE(category, 'Miscellaneous') AS category,
                    COALESCE(vendor, 'Unknown') AS party,
                    amount,
                    'Paid'       AS status
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             ORDER BY expense_date DESC",
            [$from, $to]
        );
        return self::castAmount($rows);
    }

    /**
     * Forecast = naive month-over-month projection based on last 3 months revenue average.
     * Returned as one synthetic row per upcoming month between `from` and `to`.
     */
    private function forecast(string $from, string $to): array
    {
        $hist = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
                    COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) AS v
             FROM orders
             WHERE payment_status = 'paid'
               AND created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
             GROUP BY m ORDER BY m ASC"
        );
        // Paid manual invoices (no linked order) added to the same monthly buckets
        $invHist = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
                    COALESCE(SUM(total), 0) AS v
             FROM invoices
             WHERE payment_status = 'paid' AND order_id IS NULL
               AND created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
             GROUP BY m ORDER BY m ASC"
        );
        $byMonth = [];
        foreach ($hist as $r)    { $byMonth[$r['m']] = (float)$r['v']; }
        foreach ($invHist as $r) { $byMonth[$r['m']] = ($byMonth[$r['m']] ?? 0) + (float)$r['v']; }
        $avg = !empty($byMonth) ? array_sum($byMonth) / count($byMonth) : 0.0;

        $rows = [];
        $cursor = new DateTime(date('Y-m-01', strtotime($from)));
        $end    = new DateTime(date('Y-m-01', strtotime($to)));
        $i = 1;
        while ($cursor <= $end) {
            $rows[] = [
                'date'      => $cursor->format('Y-m-d'),
                'reference' => 'FCST-' . $cursor->format('Ym') . '-' . str_pad((string)$i, 2, '0', STR_PAD_LEFT),
                'category'  => 'Projected',
                'party'     => 'Revenue Forecast',
                'amount'    => round($avg, 2),
                'status'    => 'Projected',
            ];
            $cursor->modify('+1 month');
            $i++;
        }
        return $rows;
    }

    // ─── GET /admin/reports/inventory/stock-summary ──────────────────────────
    // Smart Inventory interconnection — current stock per product across zones.
    public function inventoryStockSummary(Request $request): void
    {
        $rows = Database::fetchAll(
            "SELECT p.inv_product_id, p.name, p.sku, p.category, p.uom,
                    p.reorder_level, p.standard_cost,
                    COALESCE(SUM(s.current_quantity), 0) AS total_quantity,
                    COALESCE(SUM(s.available_quantity), 0) AS available_quantity,
                    COALESCE(SUM(s.reserved_quantity), 0) AS reserved_quantity,
                    COALESCE(SUM(s.current_quantity * p.standard_cost), 0) AS stock_value
             FROM inventory_products p
             LEFT JOIN inventory_stock s ON s.inv_product_id = p.inv_product_id
             WHERE p.is_deleted = 0
             GROUP BY p.inv_product_id, p.name, p.sku, p.category, p.uom, p.reorder_level, p.standard_cost
             ORDER BY p.name ASC"
        );
        foreach ($rows as &$r) {
            $r['inv_product_id']     = (int)$r['inv_product_id'];
            $r['reorder_level']      = (float)$r['reorder_level'];
            $r['standard_cost']      = (float)$r['standard_cost'];
            $r['total_quantity']     = (float)$r['total_quantity'];
            $r['available_quantity'] = (float)$r['available_quantity'];
            $r['reserved_quantity']  = (float)$r['reserved_quantity'];
            $r['stock_value']        = round((float)$r['stock_value'], 2);
            $r['is_low_stock']       = $r['total_quantity'] <= $r['reorder_level'];
        }
        unset($r);

        Response::success([
            'rows'  => $rows,
            'count' => count($rows),
            'total_value' => round(array_sum(array_column($rows, 'stock_value')), 2),
        ]);
    }

    // ─── GET /admin/reports/inventory/movement-report ────────────────────────
    // Smart Inventory interconnection — movement ledger within a date range.
    public function inventoryMovementReport(Request $request): void
    {
        $to   = $request->query('to')   ?: date('Y-m-d');
        $from = $request->query('from') ?: date('Y-m-d', strtotime('-30 days', strtotime($to)));
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }

        $rows = Database::fetchAll(
            "SELECT m.movement_id, DATE(m.created_at) AS date, m.movement_type,
                    p.name AS product_name, p.sku, z.zone_name, z.zone_type,
                    m.quantity, m.unit_cost, m.total_value, m.reference_type,
                    m.reference_id, m.approval_status, u.name AS moved_by_name
             FROM inventory_stock_movements m
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             JOIN inventory_zones z ON z.zone_id = m.zone_id
             LEFT JOIN users u ON u.user_id = m.moved_by
             WHERE DATE(m.created_at) BETWEEN ? AND ?
             ORDER BY m.created_at DESC, m.movement_id DESC",
            [$from, $to]
        );
        foreach ($rows as &$r) {
            $r['movement_id'] = (int)$r['movement_id'];
            $r['quantity']    = (float)$r['quantity'];
            $r['unit_cost']   = (float)$r['unit_cost'];
            $r['total_value'] = (float)$r['total_value'];
        }
        unset($r);

        Response::success([
            'from'  => $from,
            'to'    => $to,
            'rows'  => $rows,
            'count' => count($rows),
        ]);
    }

    // ─── GET /admin/reports/inventory/valuation-report ───────────────────────
    // Smart Inventory interconnection — stock valuation by category.
    public function inventoryValuationReport(Request $request): void
    {
        $rows = Database::fetchAll(
            "SELECT p.category,
                    COALESCE(SUM(s.current_quantity), 0) AS total_quantity,
                    COALESCE(SUM(s.current_quantity * p.standard_cost), 0) AS stock_value,
                    COALESCE(SUM(s.current_quantity * p.selling_price), 0) AS sale_value
             FROM inventory_products p
             LEFT JOIN inventory_stock s ON s.inv_product_id = p.inv_product_id
             WHERE p.is_deleted = 0
             GROUP BY p.category
             ORDER BY stock_value DESC"
        );
        foreach ($rows as &$r) {
            $r['total_quantity'] = (float)$r['total_quantity'];
            $r['stock_value']    = round((float)$r['stock_value'], 2);
            $r['sale_value']     = round((float)$r['sale_value'], 2);
        }
        unset($r);

        Response::success([
            'rows'  => $rows,
            'count' => count($rows),
            'total_stock_value' => round(array_sum(array_column($rows, 'stock_value')), 2),
            'total_sale_value'  => round(array_sum(array_column($rows, 'sale_value')), 2),
        ]);
    }

    // ─── GET /admin/reports/inventory/dealer-consumption ─────────────────────
    // Smart Inventory interconnection — dealer allocation totals (DEALER_ALLOCATION
    // movements), joined with their current reservation profile.
    public function inventoryDealerConsumption(Request $request): void
    {
        $to   = $request->query('to')   ?: date('Y-m-d');
        $from = $request->query('from') ?: date('Y-m-d', strtotime('-30 days', strtotime($to)));
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }

        $rows = Database::fetchAll(
            "SELECT u.user_id AS dealer_id, u.name AS dealer_name,
                    COUNT(*) AS total_allocations,
                    COALESCE(SUM(m.quantity), 0) AS total_quantity,
                    COALESCE(SUM(m.total_value), 0) AS total_value
             FROM inventory_stock_movements m
             JOIN users u ON u.user_id = m.dealer_id
             WHERE m.movement_type = 'DEALER_ALLOCATION'
               AND DATE(m.created_at) BETWEEN ? AND ?
             GROUP BY u.user_id, u.name
             ORDER BY total_value DESC",
            [$from, $to]
        );
        foreach ($rows as &$r) {
            $r['dealer_id']         = (int)$r['dealer_id'];
            $r['total_allocations'] = (int)$r['total_allocations'];
            $r['total_quantity']    = (float)$r['total_quantity'];
            $r['total_value']       = round((float)$r['total_value'], 2);
        }
        unset($r);

        Response::success([
            'from'  => $from,
            'to'    => $to,
            'rows'  => $rows,
            'count' => count($rows),
        ]);
    }

    // ─── GET /admin/reports/inventory/zone-analysis ──────────────────────────
    // Smart Inventory interconnection — utilization per zone.
    public function inventoryZoneAnalysis(Request $request): void
    {
        $rows = Database::fetchAll(
            "SELECT z.zone_id, z.zone_name, z.zone_code, z.zone_type, z.capacity,
                    COALESCE(SUM(s.current_quantity), 0) AS total_quantity,
                    COALESCE(SUM(s.reserved_quantity), 0) AS reserved_quantity,
                    COALESCE(SUM(s.available_quantity), 0) AS available_quantity,
                    COALESCE(SUM(s.current_quantity * p.standard_cost), 0) AS stock_value,
                    COUNT(DISTINCT s.inv_product_id) AS product_count
             FROM inventory_zones z
             LEFT JOIN inventory_stock s ON s.zone_id = z.zone_id
             LEFT JOIN inventory_products p ON p.inv_product_id = s.inv_product_id AND p.is_deleted = 0
             WHERE z.is_active = 1
             GROUP BY z.zone_id, z.zone_name, z.zone_code, z.zone_type, z.capacity
             ORDER BY z.zone_type ASC, z.zone_name ASC"
        );
        foreach ($rows as &$r) {
            $r['zone_id']            = (int)$r['zone_id'];
            $r['capacity']           = (float)$r['capacity'];
            $r['total_quantity']     = (float)$r['total_quantity'];
            $r['reserved_quantity']  = (float)$r['reserved_quantity'];
            $r['available_quantity'] = (float)$r['available_quantity'];
            $r['stock_value']        = round((float)$r['stock_value'], 2);
            $r['product_count']      = (int)$r['product_count'];
            $r['utilization_pct']    = $r['capacity'] > 0
                ? round($r['total_quantity'] / $r['capacity'] * 100, 2)
                : null;
        }
        unset($r);

        Response::success([
            'rows'  => $rows,
            'count' => count($rows),
        ]);
    }

    private static function castAmount(array $rows): array
    {
        foreach ($rows as &$r) {
            $r['amount'] = (float)$r['amount'];
        }
        return $rows;
    }

    private static function validateDate($val, string $name): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$val) || !strtotime((string)$val)) {
            Response::error("`$name` must be a valid YYYY-MM-DD date", 422);
        }
    }
}
