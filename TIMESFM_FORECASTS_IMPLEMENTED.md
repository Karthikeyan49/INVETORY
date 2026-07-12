# TimesFM Forecasts — What Is Implemented

This documents exactly which forecasts in this project are produced by the **TimesFM 2.5**
model. It covers only the AI/TimesFM-backed predictions that are actually wired in — not the
older heuristic (average-based) logic that already existed.

- **Model:** `google/timesfm-2.5-200m-pytorch` (served at `http://127.0.0.1:8600`)
- **Where it lives:** Reorder Intelligence module (Smart Inventory)
- **Single endpoint:** `GET /admin/inventory/reorder/forecast/{productId}`
- **Fallback:** if the model service is down or a product's history is thin, it falls back to a
  recent flat average. The `source` field reports `"timesfm"` (AI used) or `"average"` (fallback).

---

## Input the model sees

For the requested product, a **zero-filled daily outflow (consumption) series** is built from
`inventory_stock_movements` over the last **180 days**, oldest → newest.

- Outflow = movement types `STOCK_OUT`, `EMPLOYEE_ISSUE`, `DEALER_ALLOCATION`, `PRODUCTION_USE`.
- Days with no movement are filled with `0` so the series is evenly spaced.
- The model is only used when the product has **≥ 21 active days** of real movement; otherwise
  it falls back to the average.

Source: `api/services/DemandForecast.php` → `dailyOutflowSeries()`.

---

## Forecasts implemented (what TimesFM predicts)

All of the below come from one call to the model and are returned by the endpoint.

### 1. Daily demand forecast
Predicted **daily consumption for the next `lead_time + 30` days**.
- Field: `daily_forecast[]` (one value per future day)
- Field: `forecast_horizon` (number of days predicted)
- Captures **trend and seasonality** in consumption — the key improvement over the previous
  flat 30-day average.

### 2. Lead-time demand
Total demand the model expects to occur **during the supplier lead time** (sum of the first
`lead_time_days` of the daily forecast).
- Field: `lead_time_demand`
- `lead_time_days` is estimated from the product's last 3 posted purchase receipts (PO → GRN),
  defaulting to 7 days.

### 3. Forecast-aware reorder point
The stock level at which the product should be reordered, derived from the forecast (not a flat
average): `reorder_point = lead_time_demand + safety_stock`, where `safety_stock` = 25% of
lead-time demand.
- Fields: `reorder_point`, `safety_stock`
- Field: `needs_reorder` (true when current stock ≤ reorder point)

### 4. Suggested reorder quantity
How much to order now, based on total forecast demand over the horizon minus current stock (plus
safety): `suggested_qty = max(0, total_forecast_demand + safety_stock − current_stock)`.
- Field: `suggested_qty`

### 5. Days until stockout (runout projection)
When current stock is expected to run out, by walking the daily forecast until cumulative
predicted demand exceeds current stock.
- Field: `days_until_stockout` (or `null` if stock outlasts the horizon)
- Uses the forecast **curve**, so an accelerating demand trend shortens the runout correctly —
  unlike a constant-rate estimate.

---

## Endpoint response (shape)

```
GET /admin/inventory/reorder/forecast/{productId}
Auth: admin:owner, store_keeper, accountant

{
  "product_id":         123,
  "product":            "…",
  "sku":                "…",
  "source":             "timesfm" | "average",
  "current_stock":       420.0,
  "lead_time_days":      7,
  "forecast_horizon":    37,
  "lead_time_demand":    58.4,      // forecast #2
  "safety_stock":        14.6,      // forecast #3
  "reorder_point":       73.0,      // forecast #3
  "suggested_qty":       210.0,     // forecast #4
  "needs_reorder":       false,
  "days_until_stockout": 19,        // forecast #5
  "daily_forecast":     [ … ],      // forecast #1 (per-day)
  "history":            [ … ],      // the input series (for charting)
  "dates":              [ … ]       // matching history dates
}
```

---

## Code map

| File | Role |
|---|---|
| `api/helpers/TimesFmClient.php` | Calls the model service; returns null on any failure |
| `api/services/DemandForecast.php` | Builds the series, calls TimesFM, computes forecasts 1–5 |
| `api/controllers/admin/ReorderIntelligenceController.php` → `getForecast()` | Endpoint handler |
| `api/index.php` | Route registration + file includes |
| `api/config/database.php` | `TIMESFM_URL` constant |
| `frontend/src/lib/api/inventory.ts` | `DemandForecast` type + `getDemandForecast(productId)` |

---

## Status

- **Implemented & verified:** forecasts 1–5 above, the endpoint, and the fallback. The PHP
  client was tested end-to-end against the live model service; frontend types compile.
- **Not run against the production DB yet** (no local DB) — the SQL mirrors the existing,
  working ReorderIntelligence queries.
- **UI panel not built yet** — the data binding (`getDemandForecast`) is ready, but no chart/card
  has been added to the Inventory Intelligence page.

## Not yet forecast by TimesFM (opportunities)

These are natural next uses of the model that are **not** implemented yet:
- Per-dealer demand / next-order forecasting (currently heuristic in `ReorderIntelligence`).
- Sales / revenue forecasting, cash-flow forecasting.
- Anomaly detection (compare actual vs forecast to flag abnormal consumption).
- Nightly precompute of forecasts into a table for instant, cached reads.
