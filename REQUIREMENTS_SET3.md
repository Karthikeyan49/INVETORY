# Requirements Set 3 — Autonomous Build Plan & Agent Instructions

> This file is the **single source of truth** for an autonomous agent completing
> Requirements Set 3 for the **Sri Vari Scales** ERP. It is committed to the repo
> so every scheduled run resumes from the checklist state here — **not** from
> session memory. Read it top-to-bottom on every run.

---

## 0. AUTONOMOUS AGENT PROTOCOL (read every run)

You are the autonomous engineering agent for the **Sri Vari Scales** machine‑dealer
ERP. Work like a senior engineer, not a demo author.

**Repo & stack**
- Repo: `/home/karthikeyan/vscode/api-EcoSudar/clone/inventory` (git remote `origin`
  = `github.com/Karthikeyan49/INVETORY`, branch `main`).
- Frontend: React 18 + TS + Vite + Tailwind + shadcn/ui (`frontend/`).
- Backend: vanilla‑PHP REST API (`api/`), MySQL. Live at **inventory.kynetropo.com**.
- Deploy: `SKIP_TEMPLATE_VERIFY=1 DEPLOY_DOMAIN=inventory.kynetropo.com ./deploy.sh`
  then rsync `inventory.kynetropo.com/public_html/` and (if backend changed)
  `inventory.kynetropo.com/backend/` to the server. SSH pw + DB creds are in the
  local gitignored `ssh.txt` / `db.txt`; SSH host `147.93.99.144` port `65002`
  user `u952547820`; remote paths `domains/inventory.kynetropo.com/{public_html,backend}`.
  Use the `SSH_ASKPASS`+`setsid` pattern. DB `u952547820_inventory`.

**Work loop (repeat until the usage/session limit)**
1. `cd` to the repo and `git pull --rebase` (get any prior run's progress).
2. Read the **Pending Work Checklist** (§3) and **Progress Log** (§4).
3. Pick the highest‑priority **unchecked** task that is not Blocked.
3a. **Analyse module interconnections FIRST.** Before writing any code, study how this
    feature connects to the rest of the system — which existing tables/models it reads or
    writes, which nav sections it belongs in, and which events it must trigger or react to
    (see the Module Map in §1a). Design those links up front; **implementing a feature
    includes wiring its cross‑module integrations.** Never ship an isolated page — the
    ERP's value is the interlinking.
4. Implement it **end‑to‑end** and to the quality bar (§0 "Definition of done").
5. **Test**: `npm run build` (frontend), `php -l` on changed PHP, and for any PDF/
   template change render → `pdftoppm` → eyeball vs `docs/reference-pdfs/`.
6. **Deploy** the change to inventory.kynetropo.com via the process above; smoke‑test
   the endpoint/page; **clean up any test data** written to the live DB.
7. Tick the task's checkbox, append a dated line to the **Progress Log** (§4), then
   `git add -A && git commit -m "..."` **and `git push`**.
8. Go to step 3 for the next task. Keep going until you run out of budget.
9. If a task is **blocked** (needs an asset/photo/decision you don't have), move it to
   **§5 Blocked**, note exactly what's needed, and pick another task.

**Definition of done (per task)**
- Backend: model (static methods over `Database::insert/fetch/fetchAll/execute/count`
  — `count()` reads `$row['cnt']`, so `SELECT COUNT(*) AS cnt`), controller
  (`Response::success/error/paginated`, `Request::only/query/param`), **idempotent**
  SQL migration (information_schema guards; `CREATE TABLE IF NOT EXISTS`;
  `INSERT ... WHERE NOT EXISTS` for seeds), routes registered (literal routes before
  `{id}` routes). FKs to `machines.id` must be `BIGINT(20) UNSIGNED`. **PK names are
  not uniform**: `invoices.invoice_id`, `expenses.expense_id`, `machines.id`,
  `funding_entries.id` — never assume `id`.
- Frontend: page + `lib/api/*` client (`apiFetch`), nav entry in
  `frontend/src/lib/navigation.ts`, route in `frontend/src/App.tsx`, charts follow the
  `dataviz` palette when used. No stubs, no `TODO`, no placeholder data.
- Dual **`tax_view`** gating wherever money/`extra_amount` is involved (see §1).
- **Interconnection**: the feature's cross‑module links (data + nav + events) from step 3a
  are built and verified as part of the task — not deferred. A task is not done until its
  connections to the modules named in §1a / §2 exist and work.

**Safety — NON‑NEGOTIABLE**
- Make changes **only** in this repo. Deploy **only** inventory.kynetropo.com.
- **Never** touch `vbsolar.kynetropo.com` or any other site/domain/folder.
- **Never** read the server's `.env` / `.api_token` / `.bash_history`.
- No blind/mass DB deletes. Always clean up test data after a live test.
- Commit + push after each completed unit so work is never lost between runs.

---

## 1. Context carried from prior sessions

- **Dual‑login `extra_amount` (off‑books) pattern.** `request->user['tax_view']`:
  `extended` (tax@ login) sees and includes `extra_amount`; `standard` (admin@) never
  sees it and it's excluded from all calculations. **"Extra amount" = amount WITHOUT
  tax** (off‑books). This pattern MUST be applied to **every** new payment/finance
  feature in Set 3 (purchases, purchase orders, stamping, incentives, DCR payments,
  invoices). Reference: `AdminInvoiceController::isExtended()`,
  `AdminFinanceController::pnl()` `$includeExtra`.
- **PDF templates (done & deployed).** Sri Vari **TAX INVOICE**, **CASH BILL**,
  **DELIVERY CHALLAN**, and 4 **QUOTATIONS** (retail / industrial / service / stamping)
  are implemented in `frontend/src/lib/srivariScalesPdf.ts` and
  `frontend/src/lib/srivariQuotationPdf.ts` and verified 1:1 against the source PDFs in
  **`docs/reference-pdfs/`**. Wired: Tax Invoice → Invoices/GST pages; Delivery Challan
  → Deliveries; Quotation → Sales‑Documents download (defaults retail).
  `buildCashBill`/`downloadCashBill` exist but are **not yet triggered from any UI**.
- **Module integration already wired**: machine add → expense; invoice → order; paid →
  P&L revenue; items auto‑increment; machine movements log; stamping alerts; Financial
  Statements "single frame" (Transactions/P&L/Balance Sheet/Cash Flow tabs).
- Reference source PDFs live in `docs/reference-pdfs/` (invoice, cash-bill,
  delivery-challan, quotation-{retail,industrial,service,stamping},
  dcr-daily-call-report).

## 1a. Module Map — analyse & preserve/build these connections

**Existing wires (must stay intact — verify after each change):**
- Machine added → **Expense** ("Machine Purchase") → **P&L / Financial Statements**.
- Invoice created → **Sales Order** (net of GST); Payment/paid → order paid → **P&L revenue**.
- Machine (model+category) added → **Inventory Item** qty +1.
- Machine status / parts / issue changes → **Machine Movements** log (`/movements`).
- Machine stamping_date → **Stamping** row + **dashboard alerts**.
- Invoice `extra_amount` (extended login) carried from machine → **P&L includes it**.

**Set‑3 wires to BUILD (each task owns its links):**
- Quotation (any of the 4 kinds) → convert to **Invoice** and **Delivery Challan**, prefilled [T7].
- Delivery Challan (carries tax + extra) → convert to **Invoice** with an include‑extra
  checkbox (extended login only); Invoice can display extra [T8].
- Payment category = Cash → **Cash Bill** document [T9].
- Purchase / Purchase Order / Stamping payments (advance + installments) → **outstanding
  ledger** → single‑page **Total Outstanding** widget → **Finance** [T3, T4, T5].
- Spare consumption (machine parts / movements) → **Spare stock** decrement →
  **low‑stock notification** + **forecast** [T6].
- DCR field visits → **leads** → **Quotation** / **Customer follow‑ups** [T11, T13-rename].
- Incentive payments → **HR** + **Finance** (expense), extra_amount‑gated [T10].
- Every payment feature → `extra_amount` (extended‑only) → **Finance** calculations
  (P&L / Financial Statements) [T12].

When a task touches any node above, wire the edges to/from it in the SAME task and
re‑verify the existing edges still work.

---

## 2. Requirement analysis (Set 3) → implementation approach

**R1 — Extra amount everywhere payment is involved (lines 3‑4).** Every feature that
records or calculates a payment gets an `extra_amount` column and input, gated by
`tax_view`: extended login sees/edits it and it flows into totals/outstanding/reports;
standard login never sees it and it's excluded. Extra amount is *without tax*.

**R2 — Quotation Builder: 4 formats (lines 10‑13).** The Quotation Builder must offer
**4 build options** → map to the existing Sri Vari builders:
`product selling → retail`, `service → service`, `stamp → stamping`,
`industry → industrial` (`buildQuotation(data, kind)` in `srivariQuotationPdf.ts`).
Add a **format selector**; capture the right fields per kind (machine rows:
model/capacity/accuracy/platform/qty/unit‑price/basic‑price; service: description/qty/
price). Source formats: `docs/reference-pdfs/quotation-*.pdf`.
*(This answers the earlier open question — the quotation "kind" selector lives here.)*

**R3 — Quotation → Invoice & Delivery Challan (lines 8, 25).** After a quotation is
created, add actions to convert it to an **Invoice** and to a **Delivery Challan**,
prefilling from the quotation.

**R4 — Delivery Challan ↔ Invoice + extra amount (lines 7, 8).** DC is produced for
**both** tax and extra amount. **Invoice** gets an **option to display the extra
amount** (extended login only). DC→Invoice conversion gets a **checkbox to include the
extra amount on the invoice** — shown only to the extended (tax) login.

**R5 — Cash Bill trigger (carried pending).** Wire `downloadCashBill`. Per Set‑3 payment
model, a **cash**‑category payment/sale produces a **Cash Bill** (service/cash sales).
Add a "Cash Bill" action on cash‑type invoices and on service/cash records. Format:
`docs/reference-pdfs/cash-bill.pdf`.

**R6 — Spare module (lines 15‑18).** In the Inventory module add a **Spares** page
modelled like Machines: `spares` table (name, part_no, category, quantity, unit,
unit_cost, reorder_level, location, notes). Full CRUD + API + nav + route. **Low‑stock
notification** when `quantity ≤ reorder_level` (dashboard alert + list badge).
**Forecasting**: from consumption (movements/usage) project stock‑out date and a reorder
suggestion. Connect to machine parts/movements where relevant.

**R7 — HR Incentive Payments (lines 20‑22).** Payroll today covers fixed employees.
Add an **Incentive Payments** page for people paid *by output* (per sale/visit/
collection): `incentives` table (employee/person, basis, rate/amount, period, computed
amount, status paid/unpaid, notes). Generate an incentive payslip. Keep separate from
fixed payroll; apply R1 extra‑amount gating.

**R8 — Rename "Complaints" → "Customer Complaints" (line 23).** Update nav label,
page heading, and any legacy label mapping in `navigation.ts`.

**R9 — Stamping outstanding (line 27).** When stamping advance is paid but an amount is
pending, the pending amount must post to **outstanding**. Add advance/paid/outstanding
to stamping records and surface it (and roll into the global outstanding widget, R10).

**R10 — Purchase Order register (lines 29‑32, 38).** New **Purchase Order** page:
marketing gives the record, staff enters it. `purchase_orders` (+ lines): vendor,
category, items, taxable + `extra_amount` (extended‑only), advance, paid, **pending/
outstanding**, payment category, UTR, location, status. **Credit‑based purchase with
extra amount.** Viewable **by category**. A **single‑page total‑outstanding** widget
(sum across POs/purchases/stamping) with **download** (Excel/PDF). *(A reference photo
is promised but not yet provided — if absent, build from this description and mark the
layout "provisional" until the photo arrives; see §5.)*

**R11 — Machine local vs brand (line 34).** Add `machine_type` (`local` | `brand`) to
machines: form option + list filter.

**R12 — Payment overhaul (lines 36, 40, 42).** Reusable payment handling used by
purchases, POs, stamping, invoices, incentives:
- **Category dropdown**: `Bank transfer` / `Cash` / `UPI` on every payment entry.
- **UTR number** field for tracking (required emphasis for vendor purchases).
- **Multiple installments**: advance + 1st + 2nd + … + Nth payment; outstanding =
  total − Σ(payments). Store a payments ledger per document; compute outstanding live.

**R13 — DCR page (line 44).** Implement the **Daily Call Report** (format
`docs/reference-pdfs/dcr-daily-call-report.pdf`, code F‑SVS‑01). Header: employee, date,
area, opening/closing/total KM, status (approved). Lines table: `# | Customer | Address
| Mobile | Model | Status (new/existing) | Type (customer/prospect) | Category |
Stamping | Service | Payment | Remarks | Staff Sign`. Model `dcr` + `dcr_lines`;
create/list/approve; generate the DCR PDF; connect field visits → leads/quotations.

---

## 3. Pending Work Checklist (priority order — tick as done)

- [x] **T1** Rename "Complaints" → "Customer Complaints" (R8). *(quick)*
- [x] **T2** Machine `local` vs `brand` option + filter (R11). *(quick)*
- [ ] **T3** Payment core: category dropdown (Bank/Cash/UPI) + UTR field + multi‑installment
      ledger + live outstanding, as a reusable pattern (R12). Retrofit existing
      Purchases/Payments to it.
- [ ] **T4** Purchase Order register page: by‑category, advance/paid/outstanding,
      credit + extra_amount (extended‑only), payment category + UTR, single‑page total
      outstanding widget + Excel/PDF download (R10, R12). *(photo pending — see §5)*
- [ ] **T5** Stamping advance → outstanding (R9), rolled into the outstanding widget.
- [ ] **T6** Spare module: page like Machines + CRUD + low‑stock notification +
      forecasting (R6).
- [ ] **T7** Quotation Builder 4‑format selector wired to Sri Vari builders (R2), and
      quotation → Invoice + Delivery Challan conversion (R3).
- [ ] **T8** Delivery Challan carries tax + extra; Invoice shows extra (extended);
      DC→Invoice include‑extra checkbox (extended only) (R4).
- [ ] **T9** Cash Bill trigger on cash‑category invoices / service records (R5).
- [ ] **T10** HR Incentive Payments page + incentive payslip (R7).
- [ ] **T11** DCR (Daily Call Report) page + PDF (R13).
- [ ] **T12** Cross‑cutting sweep: confirm `extra_amount` gating is present and correct
      in every payment feature above (R1). Verify standard vs extended totals differ by
      exactly the extra.

After all boxes are ticked and deployed, add a final Progress Log entry "SET 3 COMPLETE"
and stop.

---

## 4. Progress Log (agent appends newest‑last; date = IST)

- 2026-07-10 — Plan created; 8 reference PDFs added to `docs/reference-pdfs/`; PDF
  templates (invoice/cash-bill/DC/4 quotations) already built, wired (except Cash Bill
  trigger) and deployed. Checklist T1–T12 pending.
- 2026-07-09 — **T1 done**: nav label + Queries page heading "Complaints" → "Customer
  Complaints". **T2 done**: added `machine_type` (`local`|`brand`) — migration
  `021_machine_type.sql` (idempotent, default `brand`), Machine model create/update/
  filter, MachineController store/update `only()` + index filter, machines API
  type/filter, Machines page form selector + list filter + Type column badge. Frontend
  `npm run build` green; `php -l` clean on Machine model + controller. (cloud run: no deploy)

---

## 5. Blocked / needs input

- **T4 Purchase Order layout** — user mentioned "I will attach the photo accordingly".
  If no photo is in `docs/reference-pdfs/` (or the repo) at run time, build from the R10
  description and mark the UI "provisional"; refine when the photo lands.
