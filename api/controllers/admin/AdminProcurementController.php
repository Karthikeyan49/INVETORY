<?php
declare(strict_types=1);

/**
 * Procurement Cockpit — the "decision surface" data layer behind the Procurement
 * landing page and the stock-aware Smart Requisition. Read-only aggregates only.
 *
 *   GET /admin/procurement/cockpit                 action queues + reorder list + KPIs + recent
 *   GET /admin/procurement/product-insight?id=..   stock-aware figures for one product (PR lines)
 *   GET /admin/procurement/reorder                 full low-stock list with suggested qty + vendor
 */
class AdminProcurementController
{
    public function cockpit(Request $request): void
    {
        Response::success([
            'queues'    => $this->queues(),
            'reorder'   => $this->reorderList(8),
            'kpis'      => $this->kpis(),
            'recent'    => $this->recent(8),
        ]);
    }

    public function reorder(Request $request): void
    {
        Response::success(['rows' => $this->reorderList(200)]);
    }

    public function productInsight(Request $request): void
    {
        $productId = (int)$request->query('product_id', 0);
        if ($productId <= 0) {
            Response::error('product_id is required', 422);
        }
        Response::success($this->buildProductInsight($productId));
    }

    // ─── Action queues — "what needs a human" ────────────────────────────────
    private function queues(): array
    {
        $approvals = Database::fetch(
            "SELECT COUNT(DISTINCT pr.pr_id) AS cnt,
                    COALESCE(SUM(line.est_value), 0) AS value
             FROM purchase_requests pr
             LEFT JOIN (
                 SELECT pr_id, SUM(quantity * COALESCE(est_unit_price, 0)) AS est_value
                 FROM purchase_request_items GROUP BY pr_id
             ) line ON line.pr_id = pr.pr_id
             WHERE pr.status = 'submitted'"
        );

        $toReceive = Database::fetch(
            "SELECT COUNT(*) AS cnt,
                    SUM(CASE WHEN expected_date IS NOT NULL AND expected_date < CURDATE() THEN 1 ELSE 0 END) AS overdue
             FROM purchase_orders
             WHERE status IN ('issued', 'partially_received')"
        );

        $toBill = Database::fetch(
            "SELECT COUNT(*) AS cnt FROM purchase_orders WHERE status IN ('received', 'short_closed')"
        );

        return [
            'approvals' => [
                'count' => (int)($approvals['cnt'] ?? 0),
                'value' => round((float)($approvals['value'] ?? 0), 2),
                'items' => array_map([$this, 'formatApprovalRow'], Database::fetchAll(
                    "SELECT pr.pr_id, pr.pr_number, pr.priority, pr.department, pr.need_by_date, pr.created_at,
                            COALESCE(line.est_value, 0) AS est_value, COALESCE(line.item_count, 0) AS item_count,
                            u.name AS requested_by_name
                     FROM purchase_requests pr
                     LEFT JOIN (
                         SELECT pr_id, SUM(quantity * COALESCE(est_unit_price, 0)) AS est_value, COUNT(*) AS item_count
                         FROM purchase_request_items GROUP BY pr_id
                     ) line ON line.pr_id = pr.pr_id
                     LEFT JOIN users u ON u.user_id = pr.requested_by
                     WHERE pr.status = 'submitted'
                     ORDER BY FIELD(pr.priority,'urgent','high','normal','low'), pr.created_at ASC
                     LIMIT 6"
                )),
            ],
            'to_receive' => [
                'count'   => (int)($toReceive['cnt'] ?? 0),
                'overdue' => (int)($toReceive['overdue'] ?? 0),
                'items'   => array_map([$this, 'formatPoRow'], Database::fetchAll(
                    "SELECT po.po_id, po.po_number, po.expected_date, po.total, po.status, v.name AS vendor_name,
                            (SELECT COALESCE(SUM(received_qty),0) FROM purchase_order_items WHERE po_id = po.po_id) AS received_qty,
                            (SELECT COALESCE(SUM(quantity),0)     FROM purchase_order_items WHERE po_id = po.po_id) AS ordered_qty
                     FROM purchase_orders po
                     JOIN vendors v ON v.vendor_id = po.vendor_id
                     WHERE po.status IN ('issued','partially_received')
                     ORDER BY (po.expected_date IS NULL), po.expected_date ASC
                     LIMIT 6"
                )),
            ],
            'to_bill' => ['count' => (int)($toBill['cnt'] ?? 0)],
        ];
    }

    // ─── Reorder radar — low stock with a suggested order qty + likely vendor ─
    private function reorderList(int $limit): array
    {
        $rows = Database::fetchAll(
            "SELECT si.product_id, p.product_name, p.unit AS base_unit,
                    SUM(si.on_hand) AS on_hand, SUM(si.reorder_level) AS reorder_level,
                    AVG(NULLIF(si.avg_cost,0)) AS avg_cost
             FROM stock_items si
             JOIN products p ON p.product_id = si.product_id
             GROUP BY si.product_id, p.product_name, p.unit
             HAVING reorder_level > 0 AND on_hand < reorder_level
             ORDER BY (reorder_level - on_hand) DESC
             LIMIT ?",
            [$limit]
        );

        foreach ($rows as &$r) {
            $onHand   = (float)$r['on_hand'];
            $reorder  = (float)$r['reorder_level'];
            $monthly  = $this->monthlyConsumption((int)$r['product_id']);
            $last     = $this->lastPurchase((int)$r['product_id']);
            $r['on_hand']        = round($onHand, 3);
            $r['reorder_level']  = round($reorder, 3);
            $r['avg_cost']       = round((float)($r['avg_cost'] ?? 0), 2);
            $r['shortfall']      = round(max(0, $reorder - $onHand), 3);
            // suggest covering the shortfall, but at least one month of typical consumption
            $r['suggested_qty']  = round(max($reorder - $onHand, $monthly), 3);
            $r['monthly_usage']  = round($monthly, 3);
            $r['last_unit_price'] = $last ? round((float)$last['unit_price'], 2) : null;
            $r['suggested_vendor_id']   = $last ? (int)$last['vendor_id'] : null;
            $r['suggested_vendor_name'] = $last['vendor_name'] ?? null;
            $r['product_id']     = (int)$r['product_id'];
        }
        return $rows;
    }

    private function kpis(): array
    {
        $open = Database::fetch(
            "SELECT COUNT(*) AS cnt FROM purchase_orders WHERE status IN ('draft','issued','partially_received')"
        );
        $spend = Database::fetch(
            "SELECT COALESCE(SUM(total),0) AS v FROM purchase_orders
             WHERE status NOT IN ('draft','cancelled')
               AND MONTH(order_date) = MONTH(CURDATE()) AND YEAR(order_date) = YEAR(CURDATE())"
        );
        // avg cycle: order_date → last receipt, for POs received in the last 90 days
        $cycle = Database::fetch(
            "SELECT AVG(DATEDIFF(gr.last_recv, po.order_date)) AS days
             FROM purchase_orders po
             JOIN (SELECT po_id, MAX(received_on) AS last_recv FROM goods_receipts WHERE status='posted' GROUP BY po_id) gr
               ON gr.po_id = po.po_id
             WHERE po.status IN ('received','short_closed','billed','paid')
               AND gr.last_recv >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)"
        );
        $lowStock = Database::fetch(
            "SELECT COUNT(*) AS cnt FROM (
                SELECT si.product_id FROM stock_items si
                GROUP BY si.product_id
                HAVING SUM(si.reorder_level) > 0 AND SUM(si.on_hand) < SUM(si.reorder_level)
             ) t"
        );

        return [
            'open_po'         => (int)($open['cnt'] ?? 0),
            'month_spend'     => round((float)($spend['v'] ?? 0), 2),
            'avg_cycle_days'  => $cycle['days'] !== null ? round((float)$cycle['days'], 1) : null,
            'low_stock_count' => (int)($lowStock['cnt'] ?? 0),
        ];
    }

    private function recent(int $limit): array
    {
        $prs = Database::fetchAll(
            "SELECT 'PR' AS doc, pr_id AS id, pr_number AS number, status, created_at, NULL AS vendor_name, NULL AS total
             FROM purchase_requests ORDER BY created_at DESC LIMIT ?",
            [$limit]
        );
        $pos = Database::fetchAll(
            "SELECT 'PO' AS doc, po.po_id AS id, po.po_number AS number, po.status, po.created_at, v.name AS vendor_name, po.total
             FROM purchase_orders po JOIN vendors v ON v.vendor_id = po.vendor_id
             ORDER BY po.created_at DESC LIMIT ?",
            [$limit]
        );
        $merged = array_merge($prs, $pos);
        usort($merged, fn($a, $b) => strcmp((string)$b['created_at'], (string)$a['created_at']));
        $merged = array_slice($merged, 0, $limit);
        foreach ($merged as &$m) {
            $m['id'] = (int)$m['id'];
            $m['total'] = $m['total'] !== null ? (float)$m['total'] : null;
        }
        return $merged;
    }

    // ─── Stock-aware figures for a single product (Smart Requisition line) ───
    private function buildProductInsight(int $productId): array
    {
        $product = Database::fetch('SELECT product_id, product_name, unit FROM products WHERE product_id = ? LIMIT 1', [$productId]);
        if (!$product) {
            Response::error('Product not found', 404);
        }
        $stock = Database::fetch(
            "SELECT COALESCE(SUM(on_hand),0) AS on_hand, COALESCE(SUM(reorder_level),0) AS reorder_level,
                    AVG(NULLIF(avg_cost,0)) AS avg_cost
             FROM stock_items WHERE product_id = ?",
            [$productId]
        );
        $onHand  = round((float)($stock['on_hand'] ?? 0), 3);
        $reorder = round((float)($stock['reorder_level'] ?? 0), 3);
        $monthly = $this->monthlyConsumption($productId);
        $last    = $this->lastPurchase($productId);

        return [
            'product_id'      => $productId,
            'product_name'    => $product['product_name'],
            'unit'            => $product['unit'] ?? null,
            'on_hand'         => $onHand,
            'reorder_level'   => $reorder,
            'avg_cost'        => round((float)($stock['avg_cost'] ?? 0), 2),
            'monthly_usage'   => round($monthly, 3),
            'below_reorder'   => $reorder > 0 && $onHand < $reorder,
            'suggested_qty'   => round(max($reorder - $onHand, $monthly, 0), 3),
            'last_unit_price' => $last ? round((float)$last['unit_price'], 2) : null,
            'last_purchased'  => $last['order_date'] ?? null,
            'suggested_vendor_id'   => $last ? (int)$last['vendor_id'] : null,
            'suggested_vendor_name' => $last['vendor_name'] ?? null,
        ];
    }

    private function monthlyConsumption(int $productId): float
    {
        $row = Database::fetch(
            "SELECT COALESCE(SUM(quantity),0) AS qty FROM stock_movements
             WHERE product_id = ? AND direction = 'out'
               AND created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)",
            [$productId]
        );
        return ((float)($row['qty'] ?? 0)) / 3.0;
    }

    private function lastPurchase(int $productId): ?array
    {
        return Database::fetch(
            "SELECT poi.unit_price, po.vendor_id, v.name AS vendor_name, po.order_date
             FROM purchase_order_items poi
             JOIN purchase_orders po ON po.po_id = poi.po_id
             JOIN vendors v ON v.vendor_id = po.vendor_id
             WHERE poi.product_id = ? AND po.status <> 'cancelled'
             ORDER BY po.order_date DESC, po.po_id DESC LIMIT 1",
            [$productId]
        );
    }

    private function formatApprovalRow(array $r): array
    {
        return [
            'pr_id'        => (int)$r['pr_id'],
            'pr_number'    => $r['pr_number'],
            'priority'     => $r['priority'],
            'department'   => $r['department'],
            'need_by_date' => $r['need_by_date'],
            'created_at'   => $r['created_at'],
            'est_value'    => round((float)$r['est_value'], 2),
            'item_count'   => (int)$r['item_count'],
            'requested_by_name' => $r['requested_by_name'],
        ];
    }

    private function formatPoRow(array $r): array
    {
        $ordered = (float)$r['ordered_qty'];
        $received = (float)$r['received_qty'];
        return [
            'po_id'         => (int)$r['po_id'],
            'po_number'     => $r['po_number'],
            'vendor_name'   => $r['vendor_name'],
            'expected_date' => $r['expected_date'],
            'overdue'       => $r['expected_date'] !== null && $r['expected_date'] < date('Y-m-d'),
            'total'         => round((float)$r['total'], 2),
            'status'        => $r['status'],
            'ordered_qty'   => round($ordered, 3),
            'received_qty'  => round($received, 3),
            'receive_pct'   => $ordered > 0 ? round($received / $ordered * 100) : 0,
        ];
    }
}
