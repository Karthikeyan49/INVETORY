<?php
declare(strict_types=1);

/**
 * AI demand forecasting for inventory products, backed by the TimesFM 2.5
 * microservice (see TimesFmClient).
 *
 * It builds a zero-filled daily outflow series from inventory_stock_movements
 * (the same OUTFLOW_TYPES used by ReorderIntelligence), asks TimesFM to project
 * future daily demand, and derives a forecast-aware reorder point, suggested
 * quantity, and projected stockout date.
 *
 * Unlike ReorderIntelligence's flat 30-day average, this captures trend and
 * seasonality in the consumption curve. Every method degrades gracefully: if
 * the model service is unavailable or a product lacks enough history, it falls
 * back to a recent-average projection so callers always get a usable answer.
 * The `source` field ('timesfm' | 'average') tells the caller which was used.
 */
class DemandForecast
{
    /** Outflow movement types counted as consumption — matches ReorderIntelligence. */
    private const OUTFLOW_TYPES = ['STOCK_OUT', 'EMPLOYEE_ISSUE', 'DEALER_ALLOCATION', 'PRODUCTION_USE'];

    private const HISTORY_DAYS          = 180;
    private const MIN_ACTIVE_DAYS       = 21;   // need ~3 weeks of real movement before trusting the model
    private const DEFAULT_LEAD_TIME_DAYS = 7;
    private const SAFETY_FACTOR         = 0.25; // safety stock = 25% of lead-time demand

    /**
     * Zero-filled daily outflow quantities for the last $days days, oldest -> newest.
     * Days with no movement are 0 so the series is evenly spaced for the model.
     *
     * @return array{dates: string[], values: float[]}
     */
    public function dailyOutflowSeries(int $productId, int $days = self::HISTORY_DAYS): array
    {
        $placeholders = implode(',', array_fill(0, count(self::OUTFLOW_TYPES), '?'));
        $rows = Database::fetchAll(
            "SELECT DATE(created_at) AS d, SUM(quantity) AS qty
             FROM inventory_stock_movements
             WHERE inv_product_id = ?
               AND movement_type IN ($placeholders)
               AND created_at >= (CURDATE() - INTERVAL ? DAY)
             GROUP BY DATE(created_at)",
            array_merge([$productId], self::OUTFLOW_TYPES, [$days])
        );

        $byDate = [];
        foreach ($rows as $r) {
            $byDate[(string)$r['d']] = (float)$r['qty'];
        }

        $dates  = [];
        $values = [];
        $start  = new DateTimeImmutable('today');
        for ($i = $days - 1; $i >= 0; $i--) {
            $day      = $start->sub(new DateInterval("P{$i}D"))->format('Y-m-d');
            $dates[]  = $day;
            $values[] = $byDate[$day] ?? 0.0;
        }

        return ['dates' => $dates, 'values' => $values];
    }

    /**
     * Forecast daily demand for the next $horizon days. Uses TimesFM when there
     * is enough history and the service responds; otherwise a recent flat average.
     *
     * @return array{source:string, horizon:int, dates:string[], history:float[], forecast:float[], total_forecast:float}
     */
    public function forecast(int $productId, int $horizon = 30): array
    {
        $horizon = max(1, min(180, $horizon));
        $series  = $this->dailyOutflowSeries($productId);
        $values  = $series['values'];
        $activeDays = count(array_filter($values, static fn($v) => $v > 0));

        $forecast = null;
        $source   = 'average';

        if ($activeDays >= self::MIN_ACTIVE_DAYS) {
            $forecast = TimesFmClient::forecast($values, $horizon);
            if ($forecast !== null) {
                // The model can emit tiny negatives; demand can never be negative.
                $forecast = array_map(static fn($v) => max(0.0, (float)$v), $forecast);
                $source   = 'timesfm';
            }
        }

        if ($forecast === null) {
            $avg      = $this->recentDailyAverage($values, 30);
            $forecast = array_fill(0, $horizon, $avg);
        }

        return [
            'source'         => $source,
            'horizon'        => $horizon,
            'dates'          => $series['dates'],
            'history'        => $values,
            'forecast'       => array_map(static fn($v) => round((float)$v, 3), $forecast),
            'total_forecast' => round(array_sum($forecast), 3),
        ];
    }

    /**
     * Forecast-aware reorder analysis for one product: projects demand over the
     * lead time, derives a reorder point / suggested quantity, and estimates when
     * current stock will run out at the forecast pace.
     */
    public function reorderForecast(int $productId): array
    {
        $product = Database::fetch(
            "SELECT inv_product_id, name, sku, reorder_level
             FROM inventory_products WHERE inv_product_id = ?",
            [$productId]
        );
        if ($product === null) {
            throw new RuntimeException('Product not found');
        }

        $currentStock = (float)Database::fetch(
            "SELECT COALESCE(SUM(available_quantity), 0) AS total
             FROM inventory_stock WHERE inv_product_id = ?",
            [$productId]
        )['total'];

        $leadTime = $this->estimateLeadTime($productId);
        $horizon  = $leadTime + 30;                 // lead time + a 30-day planning window
        $fc       = $this->forecast($productId, $horizon);
        $daily    = $fc['forecast'];

        $leadDemand   = array_sum(array_slice($daily, 0, $leadTime));
        $safetyStock  = round($leadDemand * self::SAFETY_FACTOR, 3);
        $reorderPoint = round($leadDemand + $safetyStock, 3);
        $suggestedQty = round(max(0.0, array_sum($daily) + $safetyStock - $currentStock), 3);

        // Projected stockout: walk the forecast until cumulative demand exceeds stock.
        $daysUntilStockout = null;
        $running = 0.0;
        foreach ($daily as $i => $d) {
            $running += (float)$d;
            if ($running >= $currentStock) {
                $daysUntilStockout = $i + 1;
                break;
            }
        }

        return [
            'product_id'          => (int)$product['inv_product_id'],
            'product'             => $product['name'],
            'sku'                 => $product['sku'],
            'source'              => $fc['source'],
            'current_stock'       => round($currentStock, 3),
            'lead_time_days'      => $leadTime,
            'forecast_horizon'    => $horizon,
            'lead_time_demand'    => round($leadDemand, 3),
            'safety_stock'        => $safetyStock,
            'reorder_point'       => $reorderPoint,
            'suggested_qty'       => $suggestedQty,
            'needs_reorder'       => $currentStock <= $reorderPoint,
            'days_until_stockout' => $daysUntilStockout,
            'daily_forecast'      => $daily,
            'history'             => $fc['history'],
            'dates'               => $fc['dates'],
        ];
    }

    /** Average of the last $days values of a series. */
    private function recentDailyAverage(array $values, int $days): float
    {
        $recent = array_slice($values, -$days);
        $n = count($recent);
        return $n > 0 ? array_sum($recent) / $n : 0.0;
    }

    /**
     * Lead time = average days between PO order_date and GRN received_on for this
     * product's last 3 posted receipts. Falls back to 7 days with no history.
     * Mirrors ReorderIntelligence so both engines agree on lead time.
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

        $total = 0;
        $count = 0;
        foreach ($rows as $row) {
            $ordered  = strtotime((string)$row['order_date']);
            $received = strtotime((string)$row['received_on']);
            if ($ordered === false || $received === false || $received < $ordered) {
                continue;
            }
            $total += (int)floor(($received - $ordered) / 86400);
            $count++;
        }

        return $count === 0 ? self::DEFAULT_LEAD_TIME_DAYS : max(1, (int)round($total / $count));
    }
}
