<?php
declare(strict_types=1);

/**
 * Smart Inventory — Intelligence Hub Part 1.
 *
 * Four read-mostly engines over the existing 9 tables (no new tables):
 *   1. Health Score   — 0-100 composite score per product, cached on inventory_stock.health_score
 *   2. Dead Stock     — products with on-hand quantity but no outflow in X days
 *   3. Runout Predictor — consumption-rate based stockout forecasting
 *   4. Abnormal Movements — flags unusual recent movements
 *
 * All queries read from inventory_stock_movements using idx_mov_product_date
 * (inv_product_id, created_at) and inventory_stock's PK/zone indexes — no new
 * indexes required. Batch operations chunk products in groups of 50.
 */
class InventoryIntelligence
{
    private const BATCH_SIZE = 50;

    private const OUTFLOW_TYPES = ['STOCK_OUT', 'EMPLOYEE_ISSUE', 'DEALER_ALLOCATION', 'PRODUCTION_USE'];

    // ───────────────────────────────────────────────────────────────────────
    // ENGINE 1: Health Score
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Calculate the 0-100 health score for a single product and persist it to
     * every inventory_stock row for that product (inventory_stock.health_score).
     */
    public function calculateHealthScore(int $productId): array
    {
        $product = Database::fetch(
            "SELECT inv_product_id, name, sku, reorder_level FROM inventory_products WHERE inv_product_id = ?",
            [$productId]
        );
        if ($product === null) {
            throw new RuntimeException('Product not found');
        }

        $stockRows = Database::fetchAll(
            "SELECT s.stock_id, s.current_quantity, s.available_quantity, z.zone_type
             FROM inventory_stock s
             JOIN inventory_zones z ON z.zone_id = s.zone_id
             WHERE s.inv_product_id = ?",
            [$productId]
        );

        $reorderLevel  = (float)$product['reorder_level'];
        $availableQty  = array_sum(array_map(fn($r) => (float)$r['available_quantity'], $stockRows));
        $totalStock    = array_sum(array_map(fn($r) => (float)$r['current_quantity'], $stockRows));

        if ($totalStock == 0.0) {
            foreach ($stockRows as $row) {
                Database::execute(
                    "UPDATE inventory_stock SET health_score = 0 WHERE stock_id = ?",
                    [(int)$row['stock_id']]
                );
            }

            return [
                'product_id'   => (int)$product['inv_product_id'],
                'product_name' => $product['name'],
                'sku'          => $product['sku'],
                'health_score' => 0.0,
                'risk_level'   => 'CRITICAL',
                'breakdown'    => [
                    'stock_level_score'       => 0.0,
                    'movement_velocity_score' => 0.0,
                    'zone_distribution_score' => 0.0,
                    'reorder_status_score'    => 0.0,
                ],
            ];
        }

        $movementCount = (int)Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_stock_movements
             WHERE inv_product_id = ? AND created_at >= (NOW() - INTERVAL 30 DAY)",
            [$productId]
        );

        $stockLevelScore   = $this->stockLevelScore($availableQty, $reorderLevel);
        $velocityScore     = $this->movementVelocityScore($movementCount);
        $zoneScore         = $this->zoneDistributionScore($stockRows);
        $reorderScore      = $this->reorderStatusScore($availableQty, $reorderLevel);

        $total = $stockLevelScore + $velocityScore + $zoneScore + $reorderScore;
        $total = max(0.0, min(100.0, $total));

        // Persist to every balance row for this product (denormalized cache).
        foreach ($stockRows as $row) {
            Database::execute(
                "UPDATE inventory_stock SET health_score = ? WHERE stock_id = ?",
                [$total, (int)$row['stock_id']]
            );
        }

        return [
            'product_id'   => (int)$product['inv_product_id'],
            'product_name' => $product['name'],
            'sku'          => $product['sku'],
            'health_score' => round($total, 2),
            'risk_level'   => $this->riskLevel($total),
            'breakdown'    => [
                'stock_level_score'      => round($stockLevelScore, 2),
                'movement_velocity_score'=> round($velocityScore, 2),
                'zone_distribution_score'=> round($zoneScore, 2),
                'reorder_status_score'   => round($reorderScore, 2),
            ],
        ];
    }

    /**
     * Calculate health scores for all active products, in chunks of 50.
     */
    public function calculateAllHealthScores(): array
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
                $results[] = $this->calculateHealthScore((int)$row['inv_product_id']);
            }
            $offset += self::BATCH_SIZE;
        } while (count($ids) === self::BATCH_SIZE);

        return $results;
    }

    private function stockLevelScore(float $availableQty, float $reorderLevel): float
    {
        if ($reorderLevel <= 0) {
            return 30.0;
        }
        $score = ($availableQty / $reorderLevel) * 30.0;
        return max(0.0, min(30.0, $score));
    }

    private function movementVelocityScore(int $movementCount): float
    {
        if ($movementCount > 10) {
            return 25.0;
        }
        if ($movementCount >= 6) {
            return 18.0;
        }
        if ($movementCount >= 3) {
            return 12.0;
        }
        if ($movementCount >= 1) {
            return 6.0;
        }
        return 0.0;
    }

    private function zoneDistributionScore(array $stockRows): float
    {
        $zonesWithStock = array_filter($stockRows, fn($r) => (float)$r['current_quantity'] > 0);
        if (empty($zonesWithStock)) {
            return 0.0;
        }

        $types = array_unique(array_map(fn($r) => (string)$r['zone_type'], $zonesWithStock));

        if (count($zonesWithStock) === 1) {
            $onlyType = $types[array_key_first($types)];
            return $onlyType === 'DAMAGED' ? 0.0 : 15.0;
        }

        $hasReadyStock = in_array('READY_STOCK', $types, true);
        $hasOther = count(array_diff($types, ['READY_STOCK'])) > 0;
        if ($hasReadyStock && $hasOther) {
            return 25.0;
        }

        return 15.0;
    }

    private function reorderStatusScore(float $availableQty, float $reorderLevel): float
    {
        if ($reorderLevel <= 0) {
            return 20.0;
        }
        if ($availableQty > $reorderLevel) {
            return 20.0;
        }
        if ($availableQty == $reorderLevel) {
            return 10.0;
        }
        return 0.0;
    }

    private function riskLevel(float $score): string
    {
        if ($score >= 80) {
            return 'HEALTHY';
        }
        if ($score >= 60) {
            return 'WARNING';
        }
        if ($score >= 40) {
            return 'AT_RISK';
        }
        return 'CRITICAL';
    }

    // ───────────────────────────────────────────────────────────────────────
    // ENGINE 2: Dead Stock Detection
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Products holding on-hand stock with no outflow movement (STOCK_OUT,
     * EMPLOYEE_ISSUE, DEALER_ALLOCATION, PRODUCTION_USE) in the last $days days.
     */
    public function detectDeadStock(int $days = 90): array
    {
        $placeholders = implode(',', array_fill(0, count(self::OUTFLOW_TYPES), '?'));

        $rows = Database::fetchAll(
            "SELECT p.inv_product_id, p.name, p.sku, p.standard_cost,
                    SUM(s.current_quantity) AS total_quantity,
                    (SELECT MAX(m.created_at)
                       FROM inventory_stock_movements m
                      WHERE m.inv_product_id = p.inv_product_id
                        AND m.movement_type IN ($placeholders)) AS last_outflow_at
             FROM inventory_products p
             JOIN inventory_stock s ON s.inv_product_id = p.inv_product_id
             WHERE p.is_deleted = 0
             GROUP BY p.inv_product_id, p.name, p.sku, p.standard_cost
             HAVING total_quantity > 0
                AND (last_outflow_at IS NULL OR last_outflow_at < (NOW() - INTERVAL ? DAY))",
            array_merge(self::OUTFLOW_TYPES, [$days])
        );

        $result = [];
        foreach ($rows as $row) {
            $qty = (float)$row['total_quantity'];
            $cost = (float)$row['standard_cost'];
            $lastOutflow = $row['last_outflow_at'];

            $createdAt = $this->productCreatedAt((int)$row['inv_product_id']);
            $daysSinceCreated = $createdAt !== null
                ? (int)floor((time() - strtotime((string)$createdAt)) / 86400)
                : PHP_INT_MAX;

            // New products haven't had time to move yet — don't flag as dead stock.
            if ($daysSinceCreated < 7) {
                continue;
            }

            $daysSince = $lastOutflow !== null
                ? (int)floor((time() - strtotime((string)$lastOutflow)) / 86400)
                : $daysSinceCreated;

            $severity = $this->deadStockSeverity($daysSince);

            $result[] = [
                'product_id'         => (int)$row['inv_product_id'],
                'product_name'       => $row['name'],
                'sku'                => $row['sku'],
                'quantity_stuck'     => $qty,
                'days_since_movement'=> $daysSince,
                'estimated_value'    => round($qty * $cost, 2),
                'severity'           => $severity,
                'suggested_action'   => $this->deadStockAction($severity),
            ];
        }

        usort($result, fn($a, $b) => $b['days_since_movement'] <=> $a['days_since_movement']);

        return $result;
    }

    /**
     * Aggregate value impact of all current dead stock (90-day default window).
     */
    public function calculateDeadStockValue(): array
    {
        $deadStock = $this->detectDeadStock(90);

        $totalValue = 0.0;
        $writeOffCandidates = 0;
        $bySeverity = ['SLOW_MOVING' => 0, 'DEAD' => 0, 'WRITE_OFF_CANDIDATE' => 0];

        foreach ($deadStock as $item) {
            $totalValue += $item['estimated_value'];
            $bySeverity[$item['severity']]++;
            if ($item['severity'] === 'WRITE_OFF_CANDIDATE') {
                $writeOffCandidates++;
            }
        }

        return [
            'total_products'       => count($deadStock),
            'total_value'          => round($totalValue, 2),
            'write_off_candidates' => $writeOffCandidates,
            'by_severity'          => $bySeverity,
            'items'                => $deadStock,
        ];
    }

    private function deadStockSeverity(int $daysSince): string
    {
        if ($daysSince >= 365) {
            return 'WRITE_OFF_CANDIDATE';
        }
        if ($daysSince >= 180) {
            return 'DEAD';
        }
        return 'SLOW_MOVING';
    }

    private function deadStockAction(string $severity): string
    {
        return match ($severity) {
            'WRITE_OFF_CANDIDATE' => 'Write off and clear from books',
            'DEAD'                => 'Liquidate or discount to clear stock',
            default               => 'Review demand; consider promotion or transfer',
        };
    }

    private function productCreatedAt(int $productId): ?string
    {
        $row = Database::fetch(
            "SELECT created_at FROM inventory_products WHERE inv_product_id = ?",
            [$productId]
        );
        return $row['created_at'] ?? null;
    }

    // ───────────────────────────────────────────────────────────────────────
    // ENGINE 3: Low Stock Prediction
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Predict when a product will run out of stock based on its 30-day
     * average daily consumption (outflow movements).
     */
    public function predictStockRunout(int $productId): array
    {
        $product = Database::fetch(
            "SELECT inv_product_id, name, sku, reorder_quantity FROM inventory_products WHERE inv_product_id = ?",
            [$productId]
        );
        if ($product === null) {
            throw new RuntimeException('Product not found');
        }

        $available = (float)Database::fetch(
            "SELECT COALESCE(SUM(available_quantity), 0) AS total FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        )['total'];

        $avgDaily = $this->getAverageDailyConsumption($productId, 30);

        if ($avgDaily <= 0) {
            return [
                'product_id'              => (int)$product['inv_product_id'],
                'product_name'            => $product['name'],
                'sku'                     => $product['sku'],
                'current_stock'           => $available,
                'avg_daily_consumption'   => 0.0,
                'days_until_stockout'     => null,
                'predicted_stockout_date' => null,
                'risk_level'              => 'STABLE',
                'suggested_reorder_qty'   => 0.0,
            ];
        }

        $daysUntilStockout = $available / $avgDaily;
        $stockoutDate = (new DateTime())->modify('+' . (int)floor($daysUntilStockout) . ' days')->format('Y-m-d');

        return [
            'product_id'              => (int)$product['inv_product_id'],
            'product_name'            => $product['name'],
            'sku'                     => $product['sku'],
            'current_stock'           => $available,
            'avg_daily_consumption'   => round($avgDaily, 3),
            'days_until_stockout'     => round($daysUntilStockout, 1),
            'predicted_stockout_date' => $stockoutDate,
            'risk_level'              => $this->runoutRiskLevel($daysUntilStockout),
            'suggested_reorder_qty'   => round($avgDaily * 30, 3),
        ];
    }

    /**
     * Predict runouts for all active products, in chunks of 50. Auto-creates
     * a PENDING reorder suggestion for any product with a CRITICAL/HIGH/MEDIUM
     * risk level that does not already have a pending suggestion.
     */
    public function predictAllRunouts(): array
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
                $prediction = $this->predictStockRunout((int)$row['inv_product_id']);
                $results[] = $prediction;

                if (in_array($prediction['risk_level'], ['CRITICAL', 'HIGH', 'MEDIUM'], true)) {
                    $this->maybeCreateReorderSuggestion($prediction);
                }
            }
            $offset += self::BATCH_SIZE;
        } while (count($ids) === self::BATCH_SIZE);

        return $results;
    }

    /**
     * Average daily consumption = total outflow quantity over the last $days
     * days, divided by $days.
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

    private function runoutRiskLevel(float $daysUntilStockout): string
    {
        if ($daysUntilStockout < 7) {
            return 'CRITICAL';
        }
        if ($daysUntilStockout <= 14) {
            return 'HIGH';
        }
        if ($daysUntilStockout <= 30) {
            return 'MEDIUM';
        }
        return 'LOW';
    }

    /**
     * Create a PENDING reorder suggestion for a predicted runout, unless one
     * is already pending for this product.
     */
    private function maybeCreateReorderSuggestion(array $prediction): void
    {
        $productId = $prediction['product_id'];

        $existing = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_reorder_suggestions
             WHERE inv_product_id = ? AND status = 'PENDING'",
            [$productId]
        );
        if ($existing > 0) {
            return;
        }

        $product = Database::fetch(
            "SELECT reorder_level FROM inventory_products WHERE inv_product_id = ?",
            [$productId]
        );

        Database::insert(
            "INSERT INTO inventory_reorder_suggestions
                (inv_product_id, current_stock, reorder_level, suggested_quantity, prediction_basis, status)
             VALUES (?, ?, ?, ?, 'usage_trend', 'PENDING')",
            [
                $productId,
                $prediction['current_stock'],
                (float)($product['reorder_level'] ?? 0),
                $prediction['suggested_reorder_qty'],
            ]
        );
    }

    // ───────────────────────────────────────────────────────────────────────
    // ENGINE 4: Abnormal Movement Detection
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Scan movements from the last $days days and flag any that look abnormal.
     */
    public function detectAbnormalMovements(int $days = 7): array
    {
        $movements = Database::fetchAll(
            "SELECT m.*, p.name AS product_name, p.sku, z.zone_type, z.zone_name,
                    u.user_type AS moved_by_type
             FROM inventory_stock_movements m
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             JOIN inventory_zones z ON z.zone_id = m.zone_id
             LEFT JOIN users u ON u.user_id = m.moved_by
             WHERE m.created_at >= (NOW() - INTERVAL ? DAY)
               -- Exclude the allocation engine's own internal zone-to-zone moves.
               -- These are deterministic system placements (they don't change total
               -- on-hand) and would otherwise flood the feed with false 'spike' flags.
               AND NOT (m.movement_type IN ('TRANSFER', 'DEALER_ALLOCATION')
                        AND m.remarks LIKE 'Auto-allocated from intake zone%')
             ORDER BY m.created_at DESC",
            [$days]
        );

        $flagged = [];
        foreach ($movements as $movement) {
            if ($this->flagSuspiciousPattern($movement)) {
                $result = $this->buildAbnormalResult($movement);
                $flagged[] = $result;
                $this->logAbnormalFlagOnce((int)$movement['movement_id'], $result);
            }
        }

        return $flagged;
    }

    /**
     * Compare a product's current 30-day average movement quantity against its
     * historical (31-90 days ago) average. Used as the baseline for spike detection.
     */
    private function compareUsageToBaseline(int $productId): array
    {
        $current = Database::fetch(
            "SELECT COALESCE(AVG(quantity), 0) AS avg_qty
             FROM inventory_stock_movements
             WHERE inv_product_id = ? AND created_at >= (NOW() - INTERVAL 30 DAY)",
            [$productId]
        );
        $historical = Database::fetch(
            "SELECT COALESCE(AVG(quantity), 0) AS avg_qty
             FROM inventory_stock_movements
             WHERE inv_product_id = ?
               AND created_at < (NOW() - INTERVAL 30 DAY)
               AND created_at >= (NOW() - INTERVAL 90 DAY)",
            [$productId]
        );

        return [
            'current_avg_qty'    => (float)($current['avg_qty'] ?? 0),
            'historical_avg_qty' => (float)($historical['avg_qty'] ?? 0),
        ];
    }

    /**
     * Returns true if the given movement row matches any abnormal pattern.
     */
    private function flagSuspiciousPattern(array $movement): bool
    {
        return $this->reasonsForMovement($movement) !== [];
    }

    /**
     * Compute the list of flag reasons for a movement (empty = not flagged).
     */
    private function reasonsForMovement(array $movement): array
    {
        $reasons = [];
        $productId = (int)$movement['inv_product_id'];
        $quantity  = (float)$movement['quantity'];

        // 1. Quantity spike: > 3x the 30-day average movement quantity for this product.
        $baseline = $this->compareUsageToBaseline($productId);
        if ($baseline['current_avg_qty'] > 0 && $quantity > ($baseline['current_avg_qty'] * 3)) {
            $reasons[] = 'QUANTITY_SPIKE';
        }

        // 2. Unusual timing: outside 7am-9pm IST. DB connection sets time_zone = +05:30.
        $hour = (int)date('G', strtotime((string)$movement['created_at']));
        if ($hour < 7 || $hour >= 21) {
            $reasons[] = 'UNUSUAL_TIMING';
        }

        // 3. Rapid drain: same product moved OUT 3+ times in the 24h window ending at this movement.
        if (in_array($movement['movement_type'], self::OUTFLOW_TYPES, true)) {
            $placeholders = implode(',', array_fill(0, count(self::OUTFLOW_TYPES), '?'));
            $count = Database::count(
                "SELECT COUNT(*) AS cnt FROM inventory_stock_movements
                 WHERE inv_product_id = ?
                   AND movement_type IN ($placeholders)
                   AND created_at <= ?
                   AND created_at >= (? - INTERVAL 24 HOUR)",
                array_merge([$productId], self::OUTFLOW_TYPES, [$movement['created_at'], $movement['created_at']])
            );
            if ($count >= 3) {
                $reasons[] = 'RAPID_DRAIN';
            }
        }

        // 4. Large value movement, approved, by a non-admin user.
        $totalValue = (float)$movement['total_value'];
        if ($totalValue > 100000 && $movement['approval_status'] === 'APPROVED'
            && ($movement['moved_by_type'] ?? '') !== 'admin') {
            $reasons[] = 'LARGE_VALUE_NO_ADMIN';
        }

        // 5. Zone anomaly: stock moved OUT of EMERGENCY_BUFFER without an emergency flag.
        if ($movement['zone_type'] === 'EMERGENCY_BUFFER'
            && in_array($movement['movement_type'], self::OUTFLOW_TYPES, true)
            && $movement['movement_type'] !== 'EMERGENCY_USE') {
            $reasons[] = 'EMERGENCY_BUFFER_WITHOUT_FLAG';
        }

        return $reasons;
    }

    private function buildAbnormalResult(array $movement): array
    {
        $reasons  = $this->reasonsForMovement($movement);
        $severity = $this->abnormalSeverity($reasons);

        return [
            'movement_id'      => (int)$movement['movement_id'],
            'product_id'       => (int)$movement['inv_product_id'],
            'product_name'     => $movement['product_name'],
            'sku'              => $movement['sku'],
            'movement_type'    => $movement['movement_type'],
            'quantity'         => (float)$movement['quantity'],
            'total_value'      => (float)$movement['total_value'],
            'zone_name'        => $movement['zone_name'],
            'zone_type'        => $movement['zone_type'],
            'created_at'       => $movement['created_at'],
            'flag_reasons'     => $reasons,
            'severity'         => $severity,
            'recommended_action' => $this->abnormalAction($reasons, $severity),
        ];
    }

    /**
     * Append an inventory_audit_log 'UPDATE' entry the first time a movement is
     * flagged abnormal. Subsequent scans (e.g. dashboard refreshes) do not
     * re-log the same movement_id + reason set.
     */
    private function logAbnormalFlagOnce(int $movementId, array $result): void
    {
        $existing = Database::count(
            "SELECT COUNT(*) AS cnt FROM inventory_audit_log
             WHERE table_name = 'inventory_stock_movements'
               AND record_id = ?
               AND action_type = 'UPDATE'
               AND JSON_EXTRACT(new_value, '$.abnormal_flag') = TRUE",
            [$movementId]
        );
        if ($existing > 0) {
            return;
        }

        InventoryMovement::audit(
            'inventory_stock_movements',
            $movementId,
            'UPDATE',
            null,
            [
                'abnormal_flag' => true,
                'flag_reasons'  => $result['flag_reasons'],
                'severity'      => $result['severity'],
            ],
            null,
            null
        );
    }

    private function abnormalSeverity(array $reasons): string
    {
        if (in_array('LARGE_VALUE_NO_ADMIN', $reasons, true) || in_array('EMERGENCY_BUFFER_WITHOUT_FLAG', $reasons, true)) {
            return 'CRITICAL';
        }
        if (in_array('RAPID_DRAIN', $reasons, true)) {
            return 'HIGH';
        }
        if (in_array('QUANTITY_SPIKE', $reasons, true)) {
            return 'MEDIUM';
        }
        return 'LOW';
    }

    private function abnormalAction(array $reasons, string $severity): string
    {
        if (in_array('LARGE_VALUE_NO_ADMIN', $reasons, true)) {
            return 'Escalate to admin for review of approval authority';
        }
        if (in_array('EMERGENCY_BUFFER_WITHOUT_FLAG', $reasons, true)) {
            return 'Verify emergency buffer withdrawal and confirm justification';
        }
        if (in_array('RAPID_DRAIN', $reasons, true)) {
            return 'Investigate repeated outflows for this product within 24 hours';
        }
        if (in_array('QUANTITY_SPIKE', $reasons, true)) {
            return 'Confirm large movement against supporting documentation';
        }
        return 'Review movement for unusual timing';
    }

    // ───────────────────────────────────────────────────────────────────────
    // Intelligence Summary
    // ───────────────────────────────────────────────────────────────────────

    public function getSummary(): array
    {
        $healthScores = $this->calculateAllHealthScores();
        $overview = ['healthy' => 0, 'warning' => 0, 'at_risk' => 0, 'critical' => 0];
        foreach ($healthScores as $h) {
            switch ($h['risk_level']) {
                case 'HEALTHY': $overview['healthy']++; break;
                case 'WARNING': $overview['warning']++; break;
                case 'AT_RISK': $overview['at_risk']++; break;
                default:        $overview['critical']++; break;
            }
        }

        $deadStockValue = $this->calculateDeadStockValue();

        $runouts = $this->predictAllRunouts();
        $runoutCounts = ['critical' => 0, 'high' => 0, 'medium' => 0];
        foreach ($runouts as $r) {
            switch ($r['risk_level']) {
                case 'CRITICAL': $runoutCounts['critical']++; break;
                case 'HIGH':     $runoutCounts['high']++; break;
                case 'MEDIUM':   $runoutCounts['medium']++; break;
            }
        }

        $abnormal = $this->detectAbnormalMovements(7);
        $highSeverity = count(array_filter($abnormal, fn($a) => in_array($a['severity'], ['HIGH', 'CRITICAL'], true)));

        $topRisks = [];
        $criticalRunouts = array_filter($runouts, fn($r) => $r['risk_level'] === 'CRITICAL');
        usort($criticalRunouts, fn($a, $b) => ($a['days_until_stockout'] ?? PHP_INT_MAX) <=> ($b['days_until_stockout'] ?? PHP_INT_MAX));
        foreach (array_slice($criticalRunouts, 0, 5) as $r) {
            $topRisks[] = [
                'product' => $r['product_name'],
                'risk'    => 'Stockout in ' . (int)floor($r['days_until_stockout']) . ' days',
                'action'  => 'Reorder immediately',
            ];
        }

        return [
            'generated_at' => date('Y-m-d H:i:s'),
            'overview' => array_merge(['total_products' => count($healthScores)], $overview),
            'dead_stock' => [
                'total_products'       => $deadStockValue['total_products'],
                'total_value'          => $deadStockValue['total_value'],
                'write_off_candidates' => $deadStockValue['write_off_candidates'],
            ],
            'runout_risks' => $runoutCounts,
            'abnormal_movements' => [
                'flagged_last_7_days' => count($abnormal),
                'high_severity'       => $highSeverity,
            ],
            'top_risks' => $topRisks,
        ];
    }
}
