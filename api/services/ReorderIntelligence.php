<?php
declare(strict_types=1);

/**
 * Smart Inventory — Intelligence Hub Part 2.
 *
 * Three engines over the existing 9 inventory tables plus the procurement
 * tables (purchase_orders / goods_receipts) — no new tables:
 *   1. Reorder Prediction     — reorder point / safety stock / optimal qty, writes
 *                               PENDING rows to inventory_reorder_suggestions
 *   2. Dealer Demand          — per dealer-product consumption profile + next-order
 *                               prediction, persisted to inventory_dealer_demand
 *   3. Consumption Analytics  — trends, type breakdown, top dealers / departments,
 *                               and a day-of-week × hour heatmap
 *
 * Consumption is always read from inventory_stock_movements via
 * idx_mov_product_date (inv_product_id, created_at) and idx_mov_type. Batch
 * operations chunk products in groups of 50, matching InventoryIntelligence.
 */
class ReorderIntelligence
{
    private const BATCH_SIZE = 50;

    private const OUTFLOW_TYPES = ['STOCK_OUT', 'EMPLOYEE_ISSUE', 'DEALER_ALLOCATION', 'PRODUCTION_USE'];

    private const DEFAULT_LEAD_TIME_DAYS = 7;

    // ───────────────────────────────────────────────────────────────────────
    // ENGINE 1: Reorder Prediction
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Generate reorder suggestions for all active products, in chunks of 50.
     * A PENDING inventory_reorder_suggestions row is created (deduped) for any
     * product whose current stock is at or below its computed reorder point.
     */
    public function generateReorderSuggestions(): array
    {
        $results = [];
        $offset = 0;

        do {
            $ids = Database::fetchAll(
                "SELECT inv_product_id FROM inventory_products
                 WHERE is_deleted = 0
                 ORDER BY inv_product_id ASC
                 LIMIT " . self::BATCH_SIZE . " OFFSET ?",
                [$offset]
            );
            foreach ($ids as $row) {
                $suggestion = $this->generateProductReorder((int)$row['inv_product_id']);
                if ($suggestion['needs_reorder']) {
                    $results[] = $suggestion;
                }
            }
            $offset += self::BATCH_SIZE;
        } while (count($ids) === self::BATCH_SIZE);

        return $results;
    }

    /**
     * Compute the full reorder picture for a single product and, when stock is
     * at or below the reorder point, persist a PENDING suggestion (deduped).
     */
    public function generateProductReorder(int $productId): array
    {
        $product = Database::fetch(
            "SELECT inv_product_id, name, sku, reorder_level FROM inventory_products WHERE inv_product_id = ?",
            [$productId]
        );
        if ($product === null) {
            throw new RuntimeException('Product not found');
        }

        $currentStock = (float)Database::fetch(
            "SELECT COALESCE(SUM(available_quantity), 0) AS total FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        )['total'];

        $avgDaily   = $this->getAverageDailyConsumption($productId, 30);
        $leadTime   = $this->estimateLeadTime($productId);
        $safetyStock = $this->calculateSafetyStock($productId);
        $reorderPoint = ($avgDaily * $leadTime) + $safetyStock;
        $suggestedQty = $this->calculateOptimalReorderQty($productId);

        $needsReorder = $currentStock <= $reorderPoint;
        $urgency = $this->reorderUrgency($currentStock, $reorderPoint, $safetyStock);

        if ($needsReorder) {
            $this->persistSuggestion($productId, $currentStock, (float)$product['reorder_level'], $suggestedQty);
        }

        return [
            'product_id'     => (int)$product['inv_product_id'],
            'product'        => $product['name'],
            'sku'            => $product['sku'],
            'current_stock'  => round($currentStock, 3),
            'reorder_point'  => round($reorderPoint, 3),
            'suggested_qty'  => round($suggestedQty, 3),
            'lead_time_days' => $leadTime,
            'safety_stock'   => round($safetyStock, 3),
            'avg_daily_consumption' => round($avgDaily, 3),
            'urgency'        => $urgency,
            'needs_reorder'  => $needsReorder,
            'reason'         => $this->reorderReason($urgency),
        ];
    }

    /**
     * Optimal order quantity = 30-day supply + safety stock - current available
     * stock. Never negative.
     */
    private function calculateOptimalReorderQty(int $productId): float
    {
        $avgDaily = $this->getAverageDailyConsumption($productId, 30);
        $safetyStock = $this->calculateSafetyStock($productId);
        $currentStock = (float)Database::fetch(
            "SELECT COALESCE(SUM(available_quantity), 0) AS total FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        )['total'];

        $optimal = ($avgDaily * 30) + $safetyStock - $currentStock;
        return max(0.0, $optimal);
    }

    /**
     * Lead time = average days between PO order_date and the GRN received_on for
     * this product's last 3 receipts. Falls back to 7 days when there is no
     * purchase history.
     */
    private function estimateLeadTime(int $productId): int
    {
        $rows = Database::fetchAll(
            "SELECT po.order_date, g.received_on
             FROM purchase_order_items poi
             JOIN purchase_orders po ON po.po_id = poi.po_id
             JOIN goods_receipt_items gri ON gri.po_item_id = poi.item_id
             JOIN goods_receipts g ON g.grn_id = gri.grn_id
             JOIN inventory_products ip ON ip.source_product_id = poi.product_id
             WHERE ip.inv_product_id = ?
               AND g.status = 'posted'
             ORDER BY g.received_on DESC
             LIMIT 3",
            [$productId]
        );

        if ($rows === []) {
            return self::DEFAULT_LEAD_TIME_DAYS;
        }

        $totalDays = 0;
        $count = 0;
        foreach ($rows as $row) {
            $ordered  = strtotime((string)$row['order_date']);
            $received = strtotime((string)$row['received_on']);
            if ($ordered === false || $received === false || $received < $ordered) {
                continue;
            }
            $totalDays += (int)floor(($received - $ordered) / 86400);
            $count++;
        }

        if ($count === 0) {
            return self::DEFAULT_LEAD_TIME_DAYS;
        }

        return max(1, (int)round($totalDays / $count));
    }

    /**
     * Safety stock = (max daily consumption - avg daily consumption) × lead time,
     * where max daily consumption is the highest single-day outflow in 90 days.
     */
    private function calculateSafetyStock(int $productId): float
    {
        $placeholders = implode(',', array_fill(0, count(self::OUTFLOW_TYPES), '?'));

        $maxRow = Database::fetch(
            "SELECT COALESCE(MAX(daily_total), 0) AS max_daily FROM (
                SELECT DATE(created_at) AS d, SUM(quantity) AS daily_total
                FROM inventory_stock_movements
                WHERE inv_product_id = ?
                  AND movement_type IN ($placeholders)
                  AND created_at >= (NOW() - INTERVAL 90 DAY)
                GROUP BY DATE(created_at)
             ) AS daily",
            array_merge([$productId], self::OUTFLOW_TYPES)
        );

        $maxDaily = (float)($maxRow['max_daily'] ?? 0);
        $avgDaily = $this->getAverageDailyConsumption($productId, 30);
        $leadTime = $this->estimateLeadTime($productId);

        $safety = ($maxDaily - $avgDaily) * $leadTime;
        return max(0.0, $safety);
    }

    private function reorderUrgency(float $currentStock, float $reorderPoint, float $safetyStock): string
    {
        if ($currentStock < $safetyStock) {
            return 'IMMEDIATE';
        }
        if ($currentStock < $reorderPoint) {
            return 'SOON';
        }
        if ($currentStock <= ($reorderPoint * 1.2)) {
            return 'PLAN';
        }
        return 'OK';
    }

    private function reorderReason(string $urgency): string
    {
        return match ($urgency) {
            'IMMEDIATE' => 'Stock below safety buffer',
            'SOON'      => 'Stock at or below reorder point',
            'PLAN'      => 'Stock approaching reorder point',
            default     => 'Stock above reorder point',
        };
    }

    /**
     * Insert a PENDING usage_trend suggestion unless one is already pending for
     * this product.
     */
    private function persistSuggestion(int $productId, float $currentStock, float $reorderLevel, float $suggestedQty): void
    {
        $existing = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_reorder_suggestions
             WHERE inv_product_id = ? AND status = 'PENDING'",
            [$productId]
        );
        if ($existing > 0) {
            return;
        }

        Database::insert(
            "INSERT INTO inventory_reorder_suggestions
                (inv_product_id, current_stock, reorder_level, suggested_quantity, prediction_basis, status)
             VALUES (?, ?, ?, ?, 'usage_trend', 'PENDING')",
            [$productId, $currentStock, $reorderLevel, $suggestedQty]
        );
    }

    // ───────────────────────────────────────────────────────────────────────
    // ENGINE 2: Dealer Demand Intelligence
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Recompute a single dealer-product demand profile from the last 6 months of
     * DEALER_ALLOCATION movements and upsert it into inventory_dealer_demand.
     */
    public function updateDealerDemandProfile(int $dealerId, int $productId): array
    {
        $dealer = Database::fetch(
            "SELECT user_id, name FROM users WHERE user_id = ? AND user_type = 'dealer'",
            [$dealerId]
        );
        if ($dealer === null) {
            throw new RuntimeException('Dealer not found');
        }
        $product = Database::fetch(
            "SELECT inv_product_id, name FROM inventory_products WHERE inv_product_id = ?",
            [$productId]
        );
        if ($product === null) {
            throw new RuntimeException('Product not found');
        }

        $movements = Database::fetchAll(
            "SELECT quantity, created_at
             FROM inventory_stock_movements
             WHERE dealer_id = ?
               AND inv_product_id = ?
               AND movement_type = 'DEALER_ALLOCATION'
               AND created_at >= (NOW() - INTERVAL 6 MONTH)
             ORDER BY created_at DESC",
            [$dealerId, $productId]
        );

        $orderCount = count($movements);
        $totalQty = array_sum(array_map(fn($m) => (float)$m['quantity'], $movements));
        $avgMonthly = $totalQty / 6;

        $lastOrderQty = $orderCount > 0 ? (float)$movements[0]['quantity'] : 0.0;
        $lastOrderDate = $orderCount > 0 ? date('Y-m-d', strtotime((string)$movements[0]['created_at'])) : null;

        $prediction = $this->predictNextOrderDate($movements);
        $predictedNextOrder = $prediction['predicted_next_order_date'];

        $confidenceScore = $this->confidenceScore($orderCount);
        $confidenceFactor = $this->confidenceFactor($confidenceScore);
        $suggestedReserve = $avgMonthly * $confidenceFactor;

        $this->upsertDealerDemand([
            'dealer_id'                 => $dealerId,
            'inv_product_id'            => $productId,
            'avg_monthly_consumption'   => $avgMonthly,
            'last_order_quantity'       => $lastOrderQty,
            'last_order_date'           => $lastOrderDate,
            'predicted_next_order_date' => $predictedNextOrder,
            'suggested_reserve_qty'     => $suggestedReserve,
            'confidence_score'          => $confidenceScore,
        ]);

        return [
            'dealer_id'               => $dealerId,
            'dealer'                  => $dealer['name'],
            'product_id'              => $productId,
            'product'                 => $product['name'],
            'avg_monthly_consumption' => round($avgMonthly, 3),
            'last_order_quantity'     => round($lastOrderQty, 3),
            'last_order_date'         => $lastOrderDate,
            'predicted_next_order'    => $predictedNextOrder,
            'confidence_score'        => round($confidenceScore, 2),
            'suggested_reserve_qty'   => round($suggestedReserve, 3),
        ];
    }

    /**
     * Predict the next order date for a dealer-product pair from its allocation
     * history. Returns the prediction plus the supporting averages.
     */
    public function predictNextDealerOrder(int $dealerId, int $productId): array
    {
        $movements = Database::fetchAll(
            "SELECT quantity, created_at
             FROM inventory_stock_movements
             WHERE dealer_id = ?
               AND inv_product_id = ?
               AND movement_type = 'DEALER_ALLOCATION'
               AND created_at >= (NOW() - INTERVAL 6 MONTH)
             ORDER BY created_at DESC",
            [$dealerId, $productId]
        );

        $prediction = $this->predictNextOrderDate($movements);

        return [
            'dealer_id'                 => $dealerId,
            'product_id'                => $productId,
            'order_count'               => count($movements),
            'last_order_date'           => count($movements) > 0
                ? date('Y-m-d', strtotime((string)$movements[0]['created_at']))
                : null,
            'avg_days_between_orders'   => $prediction['avg_days_between_orders'],
            'predicted_next_order_date' => $prediction['predicted_next_order_date'],
            'confidence_score'          => round($this->confidenceScore(count($movements)), 2),
        ];
    }

    /**
     * All current dealer demand profiles (one row per dealer-product), joined
     * with dealer and product names.
     */
    public function getAllDealerDemandProfiles(): array
    {
        return Database::fetchAll(
            "SELECT d.demand_id, d.dealer_id, u.name AS dealer, d.inv_product_id,
                    p.name AS product, d.avg_monthly_consumption, d.last_order_quantity,
                    d.last_order_date, d.predicted_next_order_date, d.suggested_reserve_qty,
                    d.confidence_score
             FROM inventory_dealer_demand d
             JOIN users u ON u.user_id = d.dealer_id
             JOIN inventory_products p ON p.inv_product_id = d.inv_product_id
             ORDER BY d.predicted_next_order_date ASC"
        );
    }

    /**
     * Suggested stock reservation across all products for a single dealer, based
     * on the persisted demand profiles.
     */
    public function suggestDealerReservation(int $dealerId): array
    {
        $dealer = Database::fetch(
            "SELECT user_id, name FROM users WHERE user_id = ? AND user_type = 'dealer'",
            [$dealerId]
        );
        if ($dealer === null) {
            throw new RuntimeException('Dealer not found');
        }

        // Predicted demand profiles for this dealer (forward-looking suggestion).
        $rows = Database::fetchAll(
            "SELECT d.inv_product_id, p.name AS product, p.sku,
                    d.avg_monthly_consumption, d.suggested_reserve_qty,
                    d.confidence_score, d.predicted_next_order_date
             FROM inventory_dealer_demand d
             JOIN inventory_products p ON p.inv_product_id = d.inv_product_id
             WHERE d.dealer_id = ?
             ORDER BY d.suggested_reserve_qty DESC",
            [$dealerId]
        );

        // Actual stock physically reserved for this dealer — summed from
        // DEALER_ALLOCATION movements into DEALER_RESERVED zones. This is the
        // source of truth for "which dealer the reserved-zone stock belongs to".
        $actualRows = Database::fetchAll(
            "SELECT m.inv_product_id, p.name AS product, p.sku,
                    COALESCE(SUM(m.quantity), 0) AS actual_reserved_qty
             FROM inventory_stock_movements m
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             JOIN inventory_zones z ON z.zone_id = m.zone_id
             WHERE m.dealer_id = ?
               AND m.movement_type = 'DEALER_ALLOCATION'
               AND z.zone_type = 'DEALER_RESERVED'
             GROUP BY m.inv_product_id, p.name, p.sku
             HAVING actual_reserved_qty > 0",
            [$dealerId]
        );

        // Merge predicted + actual into one map keyed by product so a product
        // with physical reserved stock but no demand profile still shows up.
        $items = [];
        foreach ($rows as $r) {
            $items[(int)$r['inv_product_id']] = [
                'inv_product_id'            => (int)$r['inv_product_id'],
                'product'                   => $r['product'],
                'sku'                       => $r['sku'],
                'avg_monthly_consumption'   => $r['avg_monthly_consumption'],
                'suggested_reserve_qty'     => $r['suggested_reserve_qty'],
                'confidence_score'          => $r['confidence_score'],
                'predicted_next_order_date' => $r['predicted_next_order_date'],
                'actual_reserved_qty'       => 0,
            ];
        }
        foreach ($actualRows as $a) {
            $pid = (int)$a['inv_product_id'];
            if (!isset($items[$pid])) {
                $items[$pid] = [
                    'inv_product_id'            => $pid,
                    'product'                   => $a['product'],
                    'sku'                       => $a['sku'],
                    'avg_monthly_consumption'   => '0',
                    'suggested_reserve_qty'     => '0',
                    'confidence_score'          => '0',
                    'predicted_next_order_date' => null,
                    'actual_reserved_qty'       => 0,
                ];
            }
            $items[$pid]['actual_reserved_qty'] = (float)$a['actual_reserved_qty'];
        }
        $items = array_values($items);

        $totalReserve = array_sum(array_map(fn($r) => (float)$r['suggested_reserve_qty'], $items));
        $totalActual  = array_sum(array_map(fn($r) => (float)$r['actual_reserved_qty'], $items));

        return [
            'dealer_id'               => $dealerId,
            'dealer'                  => $dealer['name'],
            'product_count'           => count($items),
            'total_suggested_reserve' => round($totalReserve, 3),
            'total_actual_reserved'   => round($totalActual, 3),
            'items'                   => $items,
        ];
    }

    /**
     * Average days between consecutive orders + the resulting next-order date.
     * $movements must be ordered newest-first.
     */
    private function predictNextOrderDate(array $movements): array
    {
        $count = count($movements);
        if ($count < 2) {
            return ['avg_days_between_orders' => null, 'predicted_next_order_date' => null];
        }

        // movements are newest-first; gaps between successive timestamps.
        $totalGap = 0;
        for ($i = 0; $i < $count - 1; $i++) {
            $newer = strtotime((string)$movements[$i]['created_at']);
            $older = strtotime((string)$movements[$i + 1]['created_at']);
            $totalGap += (int)floor(($newer - $older) / 86400);
        }
        $avgDays = $totalGap / ($count - 1);
        if ($avgDays <= 0) {
            return ['avg_days_between_orders' => round($avgDays, 1), 'predicted_next_order_date' => null];
        }

        $lastOrder = strtotime((string)$movements[0]['created_at']);
        $next = (new DateTime())->setTimestamp($lastOrder)->modify('+' . (int)round($avgDays) . ' days')->format('Y-m-d');

        return [
            'avg_days_between_orders'   => round($avgDays, 1),
            'predicted_next_order_date' => $next,
        ];
    }

    private function confidenceScore(int $orderCount): float
    {
        if ($orderCount >= 3) {
            return 85.0;
        }
        if ($orderCount === 2) {
            return 55.0;
        }
        if ($orderCount === 1) {
            return 25.0;
        }
        return 0.0;
    }

    private function confidenceFactor(float $confidenceScore): float
    {
        if ($confidenceScore >= 75) {
            return 1.0;
        }
        if ($confidenceScore >= 40) {
            return 0.8;
        }
        if ($confidenceScore >= 10) {
            return 0.5;
        }
        return 0.0;
    }

    /**
     * Upsert one (dealer, product) demand row. uq_demand_dealer_product makes
     * ON DUPLICATE KEY UPDATE the live-row update path.
     */
    private function upsertDealerDemand(array $d): void
    {
        Database::execute(
            "INSERT INTO inventory_dealer_demand
                (dealer_id, inv_product_id, avg_monthly_consumption, last_order_quantity,
                 last_order_date, predicted_next_order_date, suggested_reserve_qty, confidence_score)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                avg_monthly_consumption   = VALUES(avg_monthly_consumption),
                last_order_quantity       = VALUES(last_order_quantity),
                last_order_date           = VALUES(last_order_date),
                predicted_next_order_date = VALUES(predicted_next_order_date),
                suggested_reserve_qty     = VALUES(suggested_reserve_qty),
                confidence_score          = VALUES(confidence_score)",
            [
                $d['dealer_id'], $d['inv_product_id'], $d['avg_monthly_consumption'],
                $d['last_order_quantity'], $d['last_order_date'], $d['predicted_next_order_date'],
                $d['suggested_reserve_qty'], $d['confidence_score'],
            ]
        );
    }

    // ───────────────────────────────────────────────────────────────────────
    // ENGINE 3: Consumption Analytics
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Weekly consumption totals over the last $days days plus a trend direction
     * (INCREASING / DECREASING / STABLE based on the last 2 weeks vs the prior 2).
     */
    public function getConsumptionTrends(int $productId, int $days = 90): array
    {
        $product = Database::fetch(
            "SELECT inv_product_id, name, sku FROM inventory_products WHERE inv_product_id = ?",
            [$productId]
        );
        if ($product === null) {
            throw new RuntimeException('Product not found');
        }

        $placeholders = implode(',', array_fill(0, count(self::OUTFLOW_TYPES), '?'));
        $rows = Database::fetchAll(
            "SELECT YEARWEEK(created_at, 3) AS yw,
                    MIN(DATE(created_at)) AS week_start,
                    SUM(quantity) AS total_qty
             FROM inventory_stock_movements
             WHERE inv_product_id = ?
               AND movement_type IN ($placeholders)
               AND created_at >= (NOW() - INTERVAL ? DAY)
             GROUP BY YEARWEEK(created_at, 3)
             ORDER BY yw ASC",
            array_merge([$productId], self::OUTFLOW_TYPES, [$days])
        );

        $weekly = array_map(fn($r) => [
            'week_start' => $r['week_start'],
            'total_qty'  => (float)$r['total_qty'],
        ], $rows);

        return [
            'product_id'      => (int)$product['inv_product_id'],
            'product'         => $product['name'],
            'sku'             => $product['sku'],
            'period_days'     => $days,
            'weekly'          => $weekly,
            'trend_direction' => $this->trendDirection($weekly),
        ];
    }

    /**
     * Quantity consumed per movement type (the five outflow / loss types) over
     * the last 90 days.
     */
    public function getConsumptionBreakdown(int $productId): array
    {
        $rows = Database::fetchAll(
            "SELECT movement_type, SUM(quantity) AS total_qty
             FROM inventory_stock_movements
             WHERE inv_product_id = ?
               AND movement_type IN ('EMPLOYEE_ISSUE','DEALER_ALLOCATION','PRODUCTION_USE','DAMAGE','EMERGENCY_USE')
               AND created_at >= (NOW() - INTERVAL 90 DAY)
             GROUP BY movement_type",
            [$productId]
        );

        $byType = [];
        foreach ($rows as $row) {
            $byType[(string)$row['movement_type']] = (float)$row['total_qty'];
        }

        return [
            'employee_issue'    => $byType['EMPLOYEE_ISSUE'] ?? 0.0,
            'dealer_allocation' => $byType['DEALER_ALLOCATION'] ?? 0.0,
            'production_use'    => $byType['PRODUCTION_USE'] ?? 0.0,
            'damaged'           => $byType['DAMAGE'] ?? 0.0,
            'emergency_use'     => $byType['EMERGENCY_USE'] ?? 0.0,
        ];
    }

    /**
     * Top 10 dealers by DEALER_ALLOCATION quantity in the last $days days.
     */
    public function getTopConsumingDealers(int $days = 30): array
    {
        return Database::fetchAll(
            "SELECT m.dealer_id, u.name AS dealer,
                    SUM(m.quantity) AS total_qty, SUM(m.total_value) AS total_value
             FROM inventory_stock_movements m
             JOIN users u ON u.user_id = m.dealer_id
             WHERE m.movement_type = 'DEALER_ALLOCATION'
               AND m.created_at >= (NOW() - INTERVAL ? DAY)
             GROUP BY m.dealer_id, u.name
             ORDER BY total_qty DESC
             LIMIT 10",
            [$days]
        );
    }

    /**
     * Top 10 departments by EMPLOYEE_ISSUE quantity in the last $days days.
     * EMPLOYEE_ISSUE movements carry the employee in reference_id
     * (reference_type = 'EMPLOYEE_REQUEST'), joined to employees for department.
     */
    public function getTopConsumingDepartments(int $days = 30): array
    {
        return Database::fetchAll(
            "SELECT e.department,
                    SUM(m.quantity) AS total_qty, SUM(m.total_value) AS total_value
             FROM inventory_stock_movements m
             JOIN employees e ON e.employee_id = m.reference_id
             WHERE m.movement_type = 'EMPLOYEE_ISSUE'
               AND m.reference_type = 'EMPLOYEE_REQUEST'
               AND e.department IS NOT NULL
               AND m.created_at >= (NOW() - INTERVAL ? DAY)
             GROUP BY e.department
             ORDER BY total_qty DESC
             LIMIT 10",
            [$days]
        );
    }

    /**
     * Movement counts and quantities grouped by day-of-week (0=Sunday .. 6=Saturday)
     * and hour-of-day (0-23). DB connection runs at +05:30, so DAYOFWEEK/HOUR are IST.
     */
    public function getConsumptionHeatmap(int $productId): array
    {
        $placeholders = implode(',', array_fill(0, count(self::OUTFLOW_TYPES), '?'));
        $rows = Database::fetchAll(
            "SELECT (DAYOFWEEK(created_at) - 1) AS day, HOUR(created_at) AS hour,
                    COUNT(*) AS cnt, SUM(quantity) AS total_qty
             FROM inventory_stock_movements
             WHERE inv_product_id = ?
               AND movement_type IN ($placeholders)
               AND created_at >= (NOW() - INTERVAL 90 DAY)
             GROUP BY DAYOFWEEK(created_at), HOUR(created_at)
             ORDER BY day ASC, hour ASC",
            array_merge([$productId], self::OUTFLOW_TYPES)
        );

        return array_map(fn($r) => [
            'day'       => (int)$r['day'],
            'hour'      => (int)$r['hour'],
            'count'     => (int)$r['cnt'],
            'total_qty' => (float)$r['total_qty'],
        ], $rows);
    }

    private function trendDirection(array $weekly): string
    {
        $count = count($weekly);
        if ($count < 4) {
            return 'STABLE';
        }

        $recent = array_slice($weekly, -2);
        $prior  = array_slice($weekly, -4, 2);

        $recentSum = array_sum(array_map(fn($w) => $w['total_qty'], $recent));
        $priorSum  = array_sum(array_map(fn($w) => $w['total_qty'], $prior));

        if ($priorSum <= 0) {
            return $recentSum > 0 ? 'INCREASING' : 'STABLE';
        }

        $change = ($recentSum - $priorSum) / $priorSum;
        if ($change >= 0.15) {
            return 'INCREASING';
        }
        if ($change <= -0.15) {
            return 'DECREASING';
        }
        return 'STABLE';
    }

    // ───────────────────────────────────────────────────────────────────────
    // Shared helpers
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Average daily consumption = total outflow quantity over the last $days
     * days divided by $days. Matches InventoryIntelligence's definition.
     */
    private function getAverageDailyConsumption(int $productId, int $days = 30): float
    {
        $placeholders = implode(',', array_fill(0, count(self::OUTFLOW_TYPES), '?'));

        $row = Database::fetch(
            "SELECT COALESCE(SUM(quantity), 0) AS total_outflow
             FROM inventory_stock_movements
             WHERE inv_product_id = ?
               AND movement_type IN ($placeholders)
               AND created_at >= (NOW() - INTERVAL ? DAY)",
            array_merge([$productId], self::OUTFLOW_TYPES, [$days])
        );

        $totalOutflow = (float)($row['total_outflow'] ?? 0);
        return $days > 0 ? $totalOutflow / $days : 0.0;
    }
}
