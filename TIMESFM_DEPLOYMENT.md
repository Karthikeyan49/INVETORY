# TimesFM 2.5 — Deployment & Setup Documentation

Documentation of the TimesFM 2.5 forecasting model: what it is, the offline package,
the alterations made to it, and how it is deployed as a live service on the server.

- **Model:** `google/timesfm-2.5-200m-pytorch` (TimesFM 2.5, 200M params, PyTorch)
- **Purpose:** Time-series forecasting for the ERP (demand / inventory / sales / cash-flow)
- **Mode:** CPU-only, runs offline, no GPU required
- **Last updated:** 2026-07-12

---

## 1. What the model is

TimesFM 2.5 is a pretrained **time-series foundation model** by Google. It forecasts the
future of any numeric series (oldest → newest) and returns a point forecast plus
uncertainty quantiles. It is **zero-shot** (no training needed).

- **What it does:** forecast demand, sales, traffic, energy, consumption, cash-flow, etc.
- **What it does NOT do:** text/chat, images, classification, recommendations, or reliable
  stock-price prediction. It is a forecaster only.
- **Loader class:** `timesfm.TimesFM_2p5_200M_torch`
- **Note on version:** the pip package is `timesfm==2.0.2`, but it already contains the
  `timesfm_2p5` module and the 2.5 model code. The weights are genuine TimesFM 2.5.

---

## 2. Offline package (local build) — `offline_timesfm.zip`

A self-contained, internet-free installer built on the local machine for air-gapped use.

### Files (in repo root, untracked)
| File | Purpose |
|---|---|
| `create_offline_timesfm.py` | Build script (downloads wheels + model, makes the zip) |
| `offline_timesfm/` | Extracted package (wheels, model, installers, verifier, manifest) |
| `offline_timesfm.zip` | The final self-contained package |
| `offline_timesfm.zip.part00` / `.part01` | Split parts for upload (rejoin with `cat`) |

### Package layout
```
offline_timesfm/
├── wheels/            # torch (CPU) + timesfm + all deps as .whl
├── model/             # model.safetensors + config.json + generation_config.json
├── install_offline.sh # offline installer (Linux)
├── install_offline.bat# offline installer (Windows)
├── verify_install.py  # post-install forecast test
├── manifest.json      # checksums + build metadata
└── README.md
```

### Offline install (on target machine)
```bash
unzip offline_timesfm.zip
cd offline_timesfm
bash install_offline.sh   # ends with: "TimesFM installed successfully"
```

---

## 3. Alterations made to the package

The original build was GPU-oriented and 3.6 GB. Two size reductions were applied and
verified (each tested end-to-end with a real forecast).

| Step | Change | Result |
|---|---|---|
| **Original** | Full CUDA/GPU wheels + fp32 model | **3.6 GB** |
| **1. CPU-only** | Replaced GPU torch + all `nvidia_*`/CUDA wheels with `torch 2.13.0+cpu` from PyTorch CPU index | **1.08 GB** |
| **2. fp16 model** | Converted `model.safetensors` fp32 → float16 (925 MB → 463 MB) | **0.65 GB** |
| **3. Split** | Split the 650 MB zip into 2 parts for upload | `part00` (330 MB) + `part01` (290 MB) |

### Accuracy impact of fp16
Negligible. fp32 vs fp16 forecasts on the same input differed by **max 0.0003**
(agree to ~4 decimal places). Acceptable for all ERP forecasting.

### To rejoin the split parts
```bash
cat offline_timesfm.zip.part00 offline_timesfm.zip.part01 > offline_timesfm.zip
# verify:  sha256sum offline_timesfm.zip
#   expected: abcd494918afe68e363c03b08fb3061e0d5245ed74ce3776331d431c3bbbeaee
```

### Package constraints
- Target: **Linux x86_64**, **Python 3.12** (wheels are `cp312`), **CPU-only**.
- Model weights in the package are **fp16**.

---

## 4. Server deployment (live)

The model is installed and running as a persistent service on the AWS server.

### Server
- **Host:** `ubuntu@3.81.221.119` (key: `testgen.pem`)
- **Specs:** Ubuntu 26.04, x86_64, 2 cores, 7.6 GB RAM, ~18 GB disk free, **no swap**
- **Existing sites (Docker, do NOT disturb):** `saas-erp-*` and `test-case-generation-*`
  (13 containers). Health baseline: `:80`→308, `:8080`→200, `:8090`→200.

### What was set up (all isolated from the Docker sites)
1. **Python 3.12.13** installed user-local via `uv` (system `python3` stays 3.14).
2. **Isolated venv** at `~/timesfm-svc/.venv` with `torch 2.13.0+cpu` + `timesfm`
   (installed from internet; CPU index used so no CUDA stack pulled).
3. **Model** downloaded to `~/timesfm-svc/model/` (fp32, 883 MB, from HuggingFace).
4. **CLI script** `~/timesfm-svc/forecast.py` (reads JSON on stdin — reloads model each call).
5. **Persistent service** `~/timesfm-svc/server.py` — loads model **once**, serves HTTP.

### Server layout
```
~/timesfm-svc/
├── .venv/          # Python 3.12 venv (torch+cpu, timesfm)
├── model/          # TimesFM 2.5 weights (fp32, 883 MB)
├── forecast.py     # one-off CLI (stdin JSON -> forecast)
└── server.py       # persistent HTTP service (loads once)
```

---

## 5. Persistent service (how the ERP uses it)

- **Endpoint:** `http://127.0.0.1:8600` (localhost only — not exposed to the internet)
- **Managed by:** systemd unit `/etc/systemd/system/timesfm.service`
- **Loads model once** at startup and stays in memory (~1 GB steady, ~1.6 GB peak).

### API
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/forecast` | `{"series":[...],"horizon":14}` | `{"horizon":14,"forecast":[...]}` |
| GET | `/health` | — | `{"status":"ok"}` |

### Example
```bash
curl -s -X POST http://127.0.0.1:8600/forecast \
  -H 'Content-Type: application/json' \
  -d '{"series":[10,12,11,13,14],"horizon":7}'
```

### Safety caps (protect the websites)
Set in the systemd unit so the model can never starve the live sites:
- `CPUQuota=90%` — max ~1 core, always leaves cores for the websites
- `MemoryMax=2G` — hard RAM cap (service uses ~1 GB)
- `Nice=10` — websites get CPU priority
- `torch.set_num_threads(1)` + `OMP_NUM_THREADS=1` — single-core compute

### Manage the service
```bash
sudo systemctl status timesfm     # check
sudo systemctl restart timesfm    # restart
sudo systemctl stop timesfm       # stop (frees ~1 GB RAM)
sudo journalctl -u timesfm -n 50  # logs
```

---

## 6. Measured performance

| Metric | Value |
|---|---|
| Model load (startup, one-time) | ~2–4 s |
| One forecast (persistent service) | ~0.7 s compute (~1.2 s incl. HTTP) |
| One forecast (CLI, reloads model) | ~2.7 s |
| RAM (steady / peak) | ~1 GB / ~1.6 GB |
| Runs on 1 core | Yes (~0.68 s/forecast) |
| Throughput (1 core, persistent) | ~85 forecasts/min → ~100+ typical ERP users |

---

## 7. Notes & safety guarantees

- All server work is **isolated** from the Docker websites — no container, nginx, docker,
  or system-Python changes; no `apt upgrade`; nothing installed with sudo into system paths
  (only the systemd unit). Website health was checked before/after every step and was
  unchanged throughout.
- **No swap** on the server — a swap file was NOT added (per request to skip optimizations);
  the `MemoryMax=2G` cap mitigates OOM risk.
- Model on the **server** is fp32 (883 MB). The **local package** model is fp16 (463 MB).
  The server model can be converted to fp16 later to reclaim ~400 MB if needed.

---

## 8. ERP integration (built)

TimesFM is wired into the **Reorder Intelligence** module as a forecast-aware upgrade
to the existing flat-average demand estimate. Graceful fallback: if the model service is
unavailable or a product has thin history, it falls back to a recent average (`source`
field reports `timesfm` vs `average`), so the ERP never breaks.

### Backend (PHP)
| File | Role |
|---|---|
| `api/config/database.php` | New `TIMESFM_URL` constant (env `timesfm_url`, default `http://127.0.0.1:8600`) |
| `api/helpers/TimesFmClient.php` | HTTP client for the model service (`forecast()`, `healthy()`); returns null on any failure |
| `api/services/DemandForecast.php` | Builds zero-filled daily outflow series from `inventory_stock_movements`, calls TimesFM, derives reorder point / suggested qty / days-until-stockout |
| `api/controllers/admin/ReorderIntelligenceController.php` | `getForecast()` method |
| `api/index.php` | Registers the two new files + route |

### Endpoint
```
GET /admin/inventory/reorder/forecast/{productId}
  -> { source, current_stock, lead_time_days, lead_time_demand, reorder_point,
       suggested_qty, needs_reorder, days_until_stockout, daily_forecast[], history[], dates[] }
```
Auth: `admin:owner,store_keeper,accountant` (same as the other reorder routes).

### Frontend (React/TS)
- `frontend/src/lib/api/inventory.ts` — `DemandForecast` type + `getDemandForecast(productId)`.
- UI panel on the Inventory Intelligence page: **not yet added** (data binding is ready).

### Verified
- All PHP linted clean (`php -l`).
- `TimesFmClient` tested end-to-end against the **live** model service (via SSH tunnel) —
  returned a real 14-day forecast.
- Frontend `tsc --noEmit` passes.
- NOT yet run against the production DB (no local DB) — the SQL mirrors the existing,
  working `ReorderIntelligence` queries.

## 9. Suggested next steps (not yet done)

- Connect the `saas-erp` Docker container to `http://<host>:8600/forecast`.
- Feed real product sales history and surface forecasts / reorder suggestions in the ERP
  (natural fit: Inventory Intelligence, Reorder Intelligence).
- Optional: precompute forecasts nightly into a DB table so many users read cached results
  (removes any concurrency limit).
- Optional: convert the server model to fp16, add a swap file for safety.
