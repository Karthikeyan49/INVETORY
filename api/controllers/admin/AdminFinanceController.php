<?php
declare(strict_types=1);

/**
 * Admin Finance Controller — Profit & Loss dashboard
 *
 * Endpoints
 * ─────────
 *   GET /admin/finance/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /admin/finance/ratios
 *   GET /admin/finance/config         — current balance-sheet config
 *   PUT /admin/finance/config         — update investment/assets/liabilities
 *
 * Smart Inventory interconnections
 *   GET /admin/finance/inventory-valuation       — current stock value by zone
 *   GET /admin/finance/inventory-value-movement  — monthly stock value in/out
 *   GET /admin/finance/damaged-stock-writeoff    — DAMAGED zone write-off candidates
 */
class AdminFinanceController
{
    // ─── GET /admin/finance/pnl ──────────────────────────────────────────────
    public function pnl(Request $request): void
    {
        [$from, $to] = $this->window($request);
        // Extended (tax) login sees revenue WITH the off-books extra; standard WITHOUT.
        $includeExtra = strtolower((string)($request->user['tax_view'] ?? 'standard')) === 'extended';
        Response::success($this->pnlData($from, $to, $includeExtra));
    }

    // ─── GET /admin/finance/statements — P&L + Balance Sheet + Cash Flow ─────
    // The "single frame" report: accrual P&L, a derived Balance Sheet as of `to`,
    // and a Cash Flow. Manual inputs (opening cash, depreciation %, fixed assets,
    // capital & loans) fill the gaps the transactional data can't.
    public function statements(Request $request): void
    {
        [$from, $to] = $this->window($request);
        $extended = strtolower((string)($request->user['tax_view'] ?? 'standard')) === 'extended';

        $val = static fn($q, $p = []) => (float)(Database::fetch($q, $p)['v'] ?? 0);

        // ── P&L (accrual) ────────────────────────────────────────────────────
        // Revenue = invoiced sales net of GST (subtotal); + off-books extra for extended.
        $revenue = $val("SELECT COALESCE(SUM(subtotal),0) AS v FROM invoices
                          WHERE status <> 'Cancelled' AND DATE(created_at) BETWEEN ? AND ?", [$from, $to]);
        if ($extended) {
            $revenue += self::invoiceExtra($from, $to);
        }
        // COGS = buy cost of machines sold in the window.
        $cogs = $val("SELECT COALESCE(SUM(buy_price),0) AS v FROM machines
                      WHERE sold_date IS NOT NULL AND sold_date BETWEEN ? AND ?", [$from, $to]);
        $grossProfit = round($revenue - $cogs, 2);

        // Operating expenses by category (exclude stock/purchase buckets — those are COGS/inventory).
        $expRows = Database::fetchAll(
            "SELECT category, COALESCE(SUM(amount),0) AS amount FROM expenses
             WHERE expense_date BETWEEN ? AND ?
               AND category NOT IN ('Purchase','Machine Purchase')
             GROUP BY category ORDER BY amount DESC",
            [$from, $to]
        );
        $opexGroups = [];
        $interest = 0.0; $opex = 0.0;
        foreach ($expRows as $r) {
            $amt = (float)$r['amount'];
            if (stripos((string)$r['category'], 'interest') !== false) { $interest += $amt; continue; }
            $opexGroups[] = ['category' => $r['category'], 'amount' => round($amt, 2)];
            $opex += $amt;
        }

        $months = self::monthsBetween($from, $to);
        $depRate = self::configValue('depreciation_rate_pct', 0);
        $fixedGross = self::configValue('fixed_assets_gross', 0);
        $depreciation = round($fixedGross * $depRate / 100 * ($months / 12), 2);

        $ebitda = round($grossProfit - $opex, 2);
        $ebit   = round($ebitda - $depreciation, 2);
        $ebt    = round($ebit - $interest, 2);
        $taxRate = self::configValue('tax_rate', 18);
        $tax    = $ebt > 0 ? round($ebt * $taxRate / 100, 2) : 0.0;
        $netProfit = round($ebt - $tax, 2);

        // ── Balance Sheet (as of `to`) ───────────────────────────────────────
        $invMachines = $val("SELECT COALESCE(SUM(buy_price),0) AS v FROM machines WHERE status <> 'delivered'");
        $invItems    = $val("SELECT COALESCE(SUM(quantity * unit_cost),0) AS v FROM inventory_items");
        $inventory   = round($invMachines + $invItems, 2);
        $receivables = $val("SELECT COALESCE(SUM(GREATEST(total - COALESCE(amount_paid,0),0)),0) AS v
                             FROM invoices WHERE status <> 'Cancelled' AND DATE(created_at) <= ?", [$to]);
        $payables    = $val("SELECT COALESCE(SUM(GREATEST(total - COALESCE(amount_paid,0),0)),0) AS v
                             FROM purchases WHERE purchase_date IS NULL OR purchase_date <= ?", [$to]);

        $fund = Funding::summary($to);
        $capital = $fund['capital'];
        $loanOut = $fund['loan_outstanding'];

        // Working capital + cash flow (Excel single-frame style).
        $workingCapital = round($receivables + $inventory - $payables, 2);
        $cfOperating = round(($netProfit + $depreciation) - $workingCapital, 2);
        $cfInvesting = 0.0; // fixed-asset purchase flows not tracked yet
        // Financing within the window.
        $fundWindow = Database::fetch(
            "SELECT
                COALESCE(SUM(CASE WHEN entry_type='capital'     THEN amount ELSE 0 END),0) AS cap,
                COALESCE(SUM(CASE WHEN entry_type='loan_in'     THEN amount ELSE 0 END),0) AS li,
                COALESCE(SUM(CASE WHEN entry_type='loan_repaid' THEN amount ELSE 0 END),0) AS lr
             FROM funding_entries WHERE entry_date IS NULL OR entry_date BETWEEN ? AND ?",
            [$from, $to]
        ) ?: ['cap' => 0, 'li' => 0, 'lr' => 0];
        $cfFinancing = round((float)$fundWindow['cap'] + (float)$fundWindow['li'] - (float)$fundWindow['lr'], 2);
        $openingCash = self::configValue('opening_cash', 0);
        $netCash = round($cfOperating + $cfInvesting + $cfFinancing, 2);
        $closingCash = round($openingCash + $netCash, 2);

        $assets = round($inventory + $receivables + $fixedGross + $closingCash, 2);
        $liabEquity = round($capital + $netProfit + $loanOut + $payables, 2);

        // ── Transactions ledger (cash book: real cash movements in the window) ─
        // Mirrors the Excel "Transactions" column — a running-balance ledger of
        // every cash event, tagged with one of the four categories (R/E/A/L).
        $txRows = [];
        foreach (Database::fetchAll(
            "SELECT entry_type, amount, entry_date, party FROM funding_entries
             WHERE entry_date IS NULL OR entry_date BETWEEN ? AND ?
             ORDER BY COALESCE(entry_date,'0000-00-00'), id", [$from, $to]) as $r) {
            $amt = (float)$r['amount'];
            $d = (string)($r['entry_date'] ?: $from);
            $party = trim((string)($r['party'] ?? ''));
            $suffix = $party !== '' ? " ($party)" : '';
            if ($r['entry_type'] === 'capital') {
                $txRows[] = ['date' => $d, 'particulars' => 'Capital brought in' . $suffix, 'type' => 'Liability', 'inflow' => $amt, 'outflow' => 0.0];
            } elseif ($r['entry_type'] === 'loan_in') {
                $txRows[] = ['date' => $d, 'particulars' => 'Loan received' . $suffix, 'type' => 'Liability', 'inflow' => $amt, 'outflow' => 0.0];
            } elseif ($r['entry_type'] === 'loan_repaid') {
                $txRows[] = ['date' => $d, 'particulars' => 'Loan repaid' . $suffix, 'type' => 'Liability', 'inflow' => 0.0, 'outflow' => $amt];
            }
        }
        // Sales receipts — cash actually received against invoices (cash + advances).
        foreach (Database::fetchAll(
            "SELECT invoice_number, DATE(created_at) d, COALESCE(amount_paid,0) paid FROM invoices
             WHERE status <> 'Cancelled' AND DATE(created_at) BETWEEN ? AND ? AND COALESCE(amount_paid,0) > 0
             ORDER BY created_at, invoice_id", [$from, $to]) as $r) {
            $txRows[] = ['date' => (string)$r['d'], 'particulars' => 'Sales receipt — ' . ($r['invoice_number'] ?: 'Invoice'),
                         'type' => 'Revenue', 'inflow' => (float)$r['paid'], 'outflow' => 0.0];
        }
        // Expenses & purchases — cash paid out (Machine Purchase is an asset buy).
        foreach (Database::fetchAll(
            "SELECT expense_date d, category, description, amount FROM expenses
             WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date, expense_id", [$from, $to]) as $r) {
            $cat = (string)$r['category'];
            $type = $cat === 'Machine Purchase' ? 'Asset' : 'Expense';
            $label = trim((string)($r['description'] ?? '')) ?: $cat;
            $txRows[] = ['date' => (string)$r['d'], 'particulars' => $label, 'type' => $type, 'inflow' => 0.0, 'outflow' => (float)$r['amount']];
        }
        usort($txRows, static fn($a, $b) => strcmp((string)$a['date'], (string)$b['date']));
        $run = (float)$openingCash; $totalIn = 0.0; $totalOut = 0.0;
        foreach ($txRows as &$row) {
            $run += $row['inflow'] - $row['outflow'];
            $row['inflow'] = round($row['inflow'], 2);
            $row['outflow'] = round($row['outflow'], 2);
            $row['balance'] = round($run, 2);
            $totalIn += $row['inflow']; $totalOut += $row['outflow'];
        }
        unset($row);

        Response::success([
            'period' => ['from' => $from, 'to' => $to, 'months' => $months],
            'extended' => $extended,
            'pnl' => [
                'revenue' => round($revenue, 2), 'cogs' => round($cogs, 2), 'gross_profit' => $grossProfit,
                'expense_groups' => $opexGroups, 'operating_expenses' => round($opex, 2),
                'ebitda' => $ebitda, 'depreciation' => $depreciation, 'ebit' => $ebit,
                'interest' => round($interest, 2), 'ebt' => $ebt, 'tax' => $tax, 'net_profit' => $netProfit,
            ],
            'balance_sheet' => [
                'assets' => [
                    'fixed_assets_gross' => round($fixedGross, 2),
                    'inventory' => $inventory,
                    'inventory_machines' => round($invMachines, 2),
                    'inventory_items' => round($invItems, 2),
                    'receivables' => round($receivables, 2),
                    'cash_bank' => $closingCash,
                    'total' => $assets,
                ],
                'liabilities' => [
                    'capital' => round($capital, 2),
                    'surplus' => $netProfit,
                    'loans' => round($loanOut, 2),
                    'creditors' => round($payables, 2),
                    'total' => $liabEquity,
                ],
                'difference' => round($assets - $liabEquity, 2),
            ],
            'cash_flow' => [
                'net_profit' => $netProfit, 'depreciation' => $depreciation,
                'working_capital' => $workingCapital, 'operating' => $cfOperating,
                'investing' => $cfInvesting, 'financing' => $cfFinancing,
                'opening_cash' => round($openingCash, 2), 'net_cash' => $netCash, 'closing_cash' => $closingCash,
            ],
            'transactions' => [
                'opening_cash' => round((float)$openingCash, 2),
                'rows' => $txRows,
                'total_in' => round($totalIn, 2),
                'total_out' => round($totalOut, 2),
                'closing' => round((float)$openingCash + $totalIn - $totalOut, 2),
            ],
        ]);
    }

    /** Whole months spanned by the window (min 1) — used to prorate annual depreciation. */
    private static function monthsBetween(string $from, string $to): float
    {
        $f = strtotime($from); $t = strtotime($to);
        if (!$f || !$t || $t < $f) return 1.0;
        $m = (int)((date('Y', $t) - date('Y', $f)) * 12 + (date('n', $t) - date('n', $f))) + 1;
        return max(1.0, (float)$m);
    }

    /** Assemble the full P&L payload for a window — shared by the endpoint and the AI analyst. */
    public function pnlData(string $from, string $to, bool $includeExtra = false): array
    {
        // Off-books extra on paid invoices — added to revenue only for the extended login.
        $extra = $includeExtra ? self::invoiceExtra($from, $to) : 0.0;
        // ── Revenue = paid orders within window (delivery_fee excluded) ─────
        $revenueRow = Database::fetch(
            "SELECT COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) AS revenue
             FROM orders
             WHERE payment_status = 'paid'
               AND DATE(created_at) BETWEEN ? AND ?",
            [$from, $to]
        );
        // Revenue also includes paid manual invoices (order_id IS NULL so order-linked
        // invoices aren't double-counted — their revenue already comes from the order).
        $revenue = (float)($revenueRow['revenue'] ?? 0) + self::invoiceRevenue($from, $to) + $extra;

        // ── Expenses = sum of expense amounts within window ─────────────────
        $expenseRow = Database::fetch(
            "SELECT COALESCE(SUM(amount), 0) AS expenses
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?",
            [$from, $to]
        );
        $expenses = (float)($expenseRow['expenses'] ?? 0);

        // ── Monthly breakdown (revenue/expenses by YYYY-MM) ─────────────────
        $revByMonth = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
                    COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) AS v
             FROM orders
             WHERE payment_status = 'paid'
               AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY m ORDER BY m ASC",
            [$from, $to]
        );
        $invRevByMonth = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
                    COALESCE(SUM(total), 0) AS v
             FROM invoices
             WHERE payment_status = 'paid' AND order_id IS NULL
               AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY m ORDER BY m ASC",
            [$from, $to]
        );
        $extraByMonth = $includeExtra ? Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
                    COALESCE(SUM(COALESCE(extra_amount, 0)), 0) AS v
             FROM invoices
             WHERE payment_status = 'paid'
               AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY m ORDER BY m ASC",
            [$from, $to]
        ) : [];
        $expByMonth = Database::fetchAll(
            "SELECT DATE_FORMAT(expense_date, '%Y-%m') AS m,
                    COALESCE(SUM(amount), 0) AS v
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             GROUP BY m ORDER BY m ASC",
            [$from, $to]
        );

        // Merge months into a single ordered series
        $months = [];
        foreach ($revByMonth as $r)    { $months[$r['m']]['revenue']  = (float)$r['v']; }
        foreach ($invRevByMonth as $r) { $months[$r['m']]['revenue']  = ($months[$r['m']]['revenue'] ?? 0) + (float)$r['v']; }
        foreach ($extraByMonth as $r)  { $months[$r['m']]['revenue']  = ($months[$r['m']]['revenue'] ?? 0) + (float)$r['v']; }
        foreach ($expByMonth as $r)    { $months[$r['m']]['expenses'] = (float)$r['v']; }
        ksort($months);

        $monthly = [];
        foreach ($months as $m => $vals) {
            $rev = (float)($vals['revenue']  ?? 0);
            $exp = (float)($vals['expenses'] ?? 0);
            $monthly[] = [
                'month'    => $m,
                'revenue'  => $rev,
                'expenses' => $exp,
                'profit'   => $rev - $exp,
            ];
        }

        // ── Expense breakdown by category ───────────────────────────────────
        $expBreakdown = Database::fetchAll(
            "SELECT category, COALESCE(SUM(amount), 0) AS amount
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             GROUP BY category
             ORDER BY amount DESC",
            [$from, $to]
        );
        foreach ($expBreakdown as &$e) { $e['amount'] = (float)$e['amount']; }

        // ── Revenue breakdown by customer type ──────────────────────────────
        $revBreakdown = Database::fetchAll(
            "SELECT CASE u.user_type
                        WHEN 'dealer'   THEN 'Dealer Network'
                        WHEN 'customer' THEN 'Direct Sales'
                        ELSE 'Other'
                    END AS source,
                    COALESCE(SUM(o.total_amount - COALESCE(o.delivery_fee, 0)), 0) AS amount
             FROM orders o
             JOIN users u ON u.user_id = o.user_id
             WHERE o.payment_status = 'paid'
               AND DATE(o.created_at) BETWEEN ? AND ?
             GROUP BY source
             ORDER BY amount DESC",
            [$from, $to]
        );
        foreach ($revBreakdown as &$r) { $r['amount'] = (float)$r['amount']; }
        unset($r);
        // Manual invoices (no linked order) shown as their own revenue source
        $invRev = self::invoiceRevenue($from, $to);
        if ($invRev > 0) {
            $revBreakdown[] = ['source' => 'Manual Invoices', 'amount' => round($invRev, 2)];
        }
        if ($extra > 0) {
            $revBreakdown[] = ['source' => 'Extra (off-books)', 'amount' => round($extra, 2)];
        }
        if ($invRev > 0 || $extra > 0) {
            usort($revBreakdown, static fn($a, $b) => $b['amount'] <=> $a['amount']);
        }

        // ── P&L totals ──────────────────────────────────────────────────────
        $grossProfit = $revenue - $expenses;
        $taxRate     = (float)self::configValue('tax_rate', 18);
        $taxes       = $grossProfit > 0 ? round($grossProfit * $taxRate / 100, 2) : 0;
        $netProfit   = $grossProfit - $taxes;

        return [
            'periodFrom'       => $from,
            'periodTo'         => $to,
            'revenue'          => round($revenue, 2),
            'expenses'         => round($expenses, 2),
            'grossProfit'      => round($grossProfit, 2),
            'netProfit'        => round($netProfit, 2),
            'taxes'            => round($taxes, 2),
            'monthly'          => $monthly,
            'expenseBreakdown' => $expBreakdown,
            'revenueBreakdown' => $revBreakdown,
        ];
    }

    // ─── GET /admin/finance/ratios ───────────────────────────────────────────
    public function ratios(Request $request): void
    {
        [$from, $to] = $this->window($request);
        Response::success($this->ratiosData($from, $to));
    }

    /** Assemble the financial ratios for a window — shared by the endpoint and the AI analyst. */
    public function ratiosData(string $from, string $to): array
    {
        $revenue = (float)(Database::fetch(
            "SELECT COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) AS v
             FROM orders WHERE payment_status = 'paid' AND DATE(created_at) BETWEEN ? AND ?",
            [$from, $to]
        )['v'] ?? 0) + self::invoiceRevenue($from, $to);

        $expenses = (float)(Database::fetch(
            "SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE expense_date BETWEEN ? AND ?",
            [$from, $to]
        )['v'] ?? 0);

        $investment         = (float)self::configValue('investment',         4500000);
        $currentAssets      = (float)self::configValue('current_assets',     2850000);
        $currentLiabilities = (float)self::configValue('current_liabilities',1320000);
        $taxRate            = (float)self::configValue('tax_rate',                18);
        $opexTaxPct         = (float)self::configValue('opex_tax_portion',        40);

        $grossProfit = $revenue - $expenses;
        $taxes       = $grossProfit > 0 ? round($grossProfit * $taxRate / 100, 2) : 0;
        $netProfit   = $grossProfit - $taxes;

        $safeDiv = static fn(float $a, float $b): float => $b == 0.0 ? 0.0 : $a / $b;

        return [
            'profitMargin'       => round($safeDiv($netProfit, $revenue), 4),
            'expenseRatio'       => round($safeDiv($expenses, $revenue), 4),
            'roi'                => round($safeDiv($netProfit, $investment), 4),
            'currentRatio'       => round($safeDiv($currentAssets, $currentLiabilities), 4),
            'grossMargin'        => round($safeDiv($grossProfit, $revenue), 4),
            'operatingMargin'    => round($safeDiv($grossProfit - $taxes * ($opexTaxPct / 100), $revenue), 4),
            'currentAssets'      => $currentAssets,
            'currentLiabilities' => $currentLiabilities,
            'investment'         => $investment,
        ];
    }

    // ─── Shared date-window parser ───────────────────────────────────────────
    private function window(Request $request): array
    {
        $to   = $request->query('to')   ?: date('Y-m-d');
        $from = $request->query('from') ?: date('Y-m-d', strtotime('-6 months', strtotime($to)));
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }
        return [$from, $to];
    }

    /** Revenue from paid manual invoices (no linked order) within a date window.
     *  Uses the full invoice total. Order-linked invoices are excluded here so
     *  their revenue isn't counted twice (it already comes through the order). */
    private static function invoiceRevenue(string $from, string $to): float
    {
        return (float)(Database::fetch(
            "SELECT COALESCE(SUM(total), 0) AS v
             FROM invoices
             WHERE payment_status = 'paid' AND order_id IS NULL
               AND DATE(created_at) BETWEEN ? AND ?",
            [$from, $to]
        )['v'] ?? 0);
    }

    /** Sum of off-books extra on ALL paid invoices in the window (linked or not). */
    private static function invoiceExtra(string $from, string $to): float
    {
        return (float)(Database::fetch(
            "SELECT COALESCE(SUM(COALESCE(extra_amount, 0)), 0) AS v
             FROM invoices
             WHERE payment_status = 'paid'
               AND DATE(created_at) BETWEEN ? AND ?",
            [$from, $to]
        )['v'] ?? 0);
    }

    // ─── GET /admin/finance/config ───────────────────────────────────────────
    public function config(Request $request): void
    {
        $rows = Database::fetchAll('SELECT config_key, config_value, notes FROM finance_config');
        $out  = [];
        foreach ($rows as $r) {
            $out[$r['config_key']] = [
                'value' => (float)$r['config_value'],
                'notes' => $r['notes'],
            ];
        }
        Response::success($out);
    }

    // ─── PUT /admin/finance/config ───────────────────────────────────────────
    public function updateConfig(Request $request): void
    {
        $allowed = ['investment', 'current_assets', 'current_liabilities', 'tax_rate', 'opex_tax_portion',
                    'opening_cash', 'depreciation_rate_pct', 'fixed_assets_gross'];
        $payload = [];
        foreach ($allowed as $key) {
            $val = $request->input($key);
            if ($val === null || $val === '') continue;
            if (!is_numeric($val)) {
                Response::error("$key must be numeric", 422);
            }
            if ((float)$val < 0) {
                Response::error("$key cannot be negative", 422);
            }
            $payload[$key] = (float)$val;
        }

        if (empty($payload)) {
            Response::error('Provide at least one config value to update', 400);
        }

        foreach ($payload as $k => $v) {
            Database::execute(
                'INSERT INTO finance_config (config_key, config_value) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)',
                [$k, $v]
            );
        }

        Response::success($payload, 'Finance config updated successfully');
    }

    // ─── GET /admin/finance/inventory-valuation ──────────────────────────────
    // Smart Inventory interconnection — current stock value (current_quantity x
    // standard_cost) grouped by zone.
    public function inventoryValuation(Request $request): void
    {
        $rows = Database::fetchAll(
            "SELECT z.zone_id, z.zone_name, z.zone_code, z.zone_type,
                    COALESCE(SUM(s.current_quantity * p.standard_cost), 0) AS stock_value,
                    COALESCE(SUM(s.current_quantity), 0) AS total_quantity
             FROM inventory_stock s
             JOIN inventory_zones z ON z.zone_id = s.zone_id
             JOIN inventory_products p ON p.inv_product_id = s.inv_product_id
             WHERE p.is_deleted = 0
             GROUP BY z.zone_id, z.zone_name, z.zone_code, z.zone_type
             ORDER BY stock_value DESC"
        );
        foreach ($rows as &$r) {
            $r['stock_value']    = round((float)$r['stock_value'], 2);
            $r['total_quantity'] = (float)$r['total_quantity'];
        }
        unset($r);

        $total = array_sum(array_column($rows, 'stock_value'));

        Response::success([
            'total_value' => round($total, 2),
            'by_zone'     => $rows,
        ]);
    }

    // ─── GET /admin/finance/inventory-value-movement ─────────────────────────
    // Smart Inventory interconnection — monthly stock value in vs out from
    // inventory_stock_movements.
    public function inventoryValueMovement(Request $request): void
    {
        $to   = $request->query('to')   ?: date('Y-m-d');
        $from = $request->query('from') ?: date('Y-m-d', strtotime('-6 months', strtotime($to)));

        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }

        $rows = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
                    movement_type,
                    COALESCE(SUM(total_value), 0) AS value
             FROM inventory_stock_movements
             WHERE DATE(created_at) BETWEEN ? AND ?
             GROUP BY month, movement_type
             ORDER BY month ASC",
            [$from, $to]
        );

        $inflowTypes  = ['STOCK_IN', 'RETURN'];
        $outflowTypes = ['STOCK_OUT', 'EMPLOYEE_ISSUE', 'DEALER_ALLOCATION', 'PRODUCTION_USE', 'DAMAGE', 'EMERGENCY_USE'];

        $months = [];
        foreach ($rows as $r) {
            $m = $r['month'];
            $months[$m]['month']       = $m;
            $months[$m]['value_in']    = $months[$m]['value_in']    ?? 0.0;
            $months[$m]['value_out']   = $months[$m]['value_out']   ?? 0.0;
            $value = (float)$r['value'];
            if (in_array($r['movement_type'], $inflowTypes, true)) {
                $months[$m]['value_in']  += $value;
            } elseif (in_array($r['movement_type'], $outflowTypes, true)) {
                $months[$m]['value_out'] += $value;
            }
        }
        ksort($months);

        $result = [];
        foreach ($months as $m) {
            $result[] = [
                'month'     => $m['month'],
                'value_in'  => round($m['value_in'], 2),
                'value_out' => round($m['value_out'], 2),
                'net_change'=> round($m['value_in'] - $m['value_out'], 2),
            ];
        }

        Response::success([
            'periodFrom' => $from,
            'periodTo'   => $to,
            'monthly'    => $result,
        ]);
    }

    // ─── GET /admin/finance/damaged-stock-writeoff ───────────────────────────
    // Smart Inventory interconnection — value of stock currently sitting in
    // DAMAGED zones (write-off candidates).
    public function damagedStockWriteoff(Request $request): void
    {
        $zone = InventoryZone::findByType('DAMAGED');
        if ($zone === null) {
            Response::success([
                'total_value'  => 0,
                'total_quantity' => 0,
                'items'        => [],
            ]);
        }

        $rows = Database::fetchAll(
            "SELECT p.inv_product_id, p.name, p.sku, p.uom,
                    s.current_quantity, p.standard_cost,
                    (s.current_quantity * p.standard_cost) AS write_off_value
             FROM inventory_stock s
             JOIN inventory_products p ON p.inv_product_id = s.inv_product_id
             WHERE s.zone_id = ? AND s.current_quantity > 0 AND p.is_deleted = 0
             ORDER BY write_off_value DESC",
            [(int)$zone['zone_id']]
        );

        $items = [];
        $totalValue = 0.0;
        $totalQty   = 0.0;
        foreach ($rows as $r) {
            $value = round((float)$r['write_off_value'], 2);
            $totalValue += $value;
            $totalQty   += (float)$r['current_quantity'];
            $items[] = [
                'inv_product_id'  => (int)$r['inv_product_id'],
                'name'            => $r['name'],
                'sku'             => $r['sku'],
                'uom'             => $r['uom'],
                'quantity'        => (float)$r['current_quantity'],
                'unit_cost'       => (float)$r['standard_cost'],
                'write_off_value' => $value,
            ];
        }

        Response::success([
            'total_value'    => round($totalValue, 2),
            'total_quantity' => $totalQty,
            'items'          => $items,
        ]);
    }

    // ─── helpers ─────────────────────────────────────────────────────────────
    private static function configValue(string $key, float $default): float
    {
        $row = Database::fetch(
            'SELECT config_value FROM finance_config WHERE config_key = ? LIMIT 1',
            [$key]
        );
        return $row ? (float)$row['config_value'] : $default;
    }

    private static function validateDate($val, string $name): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$val) || !strtotime((string)$val)) {
            Response::error("`$name` must be a valid YYYY-MM-DD date", 422);
        }
    }
}
