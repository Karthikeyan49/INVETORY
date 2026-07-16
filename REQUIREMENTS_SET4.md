# REQUIREMENTS_SET4 — Autonomous Set-4 Working Memory

Single source of truth for the Set-4 autonomous run on branch `fix/security-hardening`.
Repo: Sri Vari Scales ERP — React + TypeScript (Vite) frontend + PHP (Router/Controller/Model
over a static `Database` helper) backend on Hostinger shared hosting.

---

## 0. Autonomous Protocol (the rules)

- ONE stable branch: `fix/security-hardening`. Resume from its latest commit each window.
- Commit AND push to `origin/fix/security-hardening` AFTER EVERY task so the next window resumes cleanly.
- Cloud run: NO Hostinger deploy credentials. Implement + test + commit + push only. User deploys.
- MODULE-INTERCONNECTION MANDATE: for every task, study cross-module links (shared tables/models,
  nav, events, money flows), wire them as part of the task, re-verify existing links still work.
  Never ship an isolated feature.
- DUAL TAX VIEW wherever money appears: plain tax calc AND tax + extra-amount, gated by
  `tax_view` / `extra_amount`.
- Tests each task: `cd frontend && npm ci && npm run build`; `php -l` on every changed PHP file;
  for PDF/template work render + compare against reference PDFs.
- SAFETY: work only in this repo; never print/exfiltrate secrets; no blind/mass DB deletes, no
  destructive DROPs without explicit backup — prefer additive, idempotent migrations; use `rg`.
- Keep ONE open PR from `fix/security-hardening`, updated as progress is made.

---

## 1. Module Map (built from codebase analysis)

### Backend architecture
- Entry: `api/index.php` — requires all models/controllers, builds `Router`, registers every route,
  dispatches. Routes are registered inline in `index.php` (NOT a separate routes file), e.g.
  `$router->get('/vendors', [PurchaseController::class,'listVendors'])`.
- Config: `api/config/app.php` (env, JWT, rate limits, CORS), `api/config/database.php` (PDO).
- Core: `api/core/{Router,Request,Response,Database,AppException}.php`. `Database` is a static helper.
- Migrations: `api/migrations/NNN_*.sql` (currently up to `034_cash_bills.sql`). Idempotent SQL.
  Runner pattern: `api/run_XXX.php` one-off scripts. Migrations must be additive + idempotent.
- Helpers: `Money.php` (money math + rounding), `Validator.php`, `JWT.php`, `InventoryPermissions.php`.

### Frontend architecture
- `frontend/src/App.tsx` — react-router routes (all under `ProtectedRoutes` + `DashboardLayout`).
- `frontend/src/lib/navigation.ts` — sidebar `sections[]` (module → nav items). Source of nav truth.
- `frontend/src/components/AppSidebar.tsx` — renders active section from `navigation.ts`.
- `frontend/src/lib/api/*.ts` — one client module per domain, all over `client.ts` (fetch + JWT).
- `frontend/src/pages/*.tsx` — one page per route.

### Modules (nav section → pages → api client → controller → model → tables)
- **Inventory**: Dashboard/Machines/MachineIssues/Items/Spares/Stamping/Movements/DemandForecast.
  Controllers: MachineController, MachineIssueController, InventoryItemController, SpareController,
  StampingController. Models: Machine, MachineIssue, MachineMovement, InventoryItem, Spare, Stamping,
  Inventory* family. Machines are shared with Purchase Orders (PO line items reference machines) and
  Sales (orders/quotations reference machines).
- **Sales**: Customers/Orders/Invoices/DeliveryChallans/CashBills/QuotationBuilder.
  Controllers: OrderController, DeliveryController, CashBillController. Models: Order, DeliveryNote,
  CashBill, SalesDocument, Payment, PaymentInstallment. Money: dual tax view via extra_amount.
- **Purchase**: Vendors/Purchases/PurchaseOrders/Expenses.
  Controller: PurchaseController (vendors + PO + purchases). Models: Vendor, PurchaseOrder,
  PoRegister, Purchase, PurchaseRequest. Vendors shared: PO vendor dropdown must persist to Vendors.
- **Finance**: FinancialStatements/CapitalLoans/GST(SalesBilling)/ProfitLoss(Finance)/Planning/Reports.
  Models: FinanceAnalytics, Funding, GstCompliance, SalesDocument. HR payroll should flow into
  expenses/finance (B11).
- **Human Resources**: Employees/Attendance/Payroll/Incentives/AdvanceRegister.
  Models: Employee, Attendance, AttendanceShift, AttendanceAnalytics, Payroll, Incentive,
  EmployeeAdvance, EmployeeCompliance. API client: `hr.ts`, `incentives.ts`, `installments.ts`.
- **Customer Care**: Follow-ups/DailyCallReport(DCR)/CustomerComplaints(Queries).
  Controllers: FollowupController, QueryController. Models: Followup, Dcr, (queries store).
- **Intelligence**: AI Insights (/insights) — model Insights.php. → TO REMOVE (B14).
- **Admin**: Data Interop (/data-interop) — DataImport/Export services. → TO REMOVE (B14).

### Cross-module money flows
- Orders/Invoices/CashBills/Quotations → Payment/PaymentInstallment → Finance (P&L, statements).
- Purchases/PO/Expenses → Finance. Payroll (HR) → Expenses/Finance (B11 target, verify wired).
- Dual tax view (`tax_view`, `extra_amount`) on every money-bearing document.

---

## 2. Definition of Done (per task)
- Builds green: `npm run build`, `php -l` on changed PHP.
- Cross-module links wired; existing ones re-verified.
- Dual tax / tax+extra gating wherever money appears.
- Checkbox ticked + Progress Log entry appended.
- Committed AND pushed to `origin/fix/security-hardening`.

---

## 3. Pending Work Checklist (priority order — B first, then deepen A)

### Priority B (specific fixes/features — do first)
- [x] B1. Fix pdf.js worker load error — serve `.mjs` with correct MIME so the worker module loads under nosniff. (2026-07-16)
- [x] B2. Customer page: button to add customer queries/enquiries + backing store + list. (2026-07-16)
- [x] B3. DCR add popup: widen so content fits WITHOUT bottom scrollbar (no inner scroll). (2026-07-16)
- [x] B4. DCR: add filter by location. (2026-07-16)
- [x] B5. Attendance page: remove 'Attendance Import', 'TMS Status', 'Face Attendance' buttons; bonus = 0. (2026-07-16)
- [x] B6. Employee ID card: replaced EcoSudar template with a generalized, code-drawn card; removed all EcoSudar assets. (2026-07-16)
- [x] B7. Payslip download: proper company-branded PDF template; single download path (View → Download). (2026-07-16)
- [x] B8. Settings: hide 'auto absent' card; add configurable 'leave credit days' (days per 1 leave credit) used in payroll. (2026-07-16)
- [ ] B9. HR module review: after B5–B8, audit HR for mismatches / poor connectivity; fix.
- [x] B10. Payroll: one-click generate&save (all OR single); excludes incentive-type employees; incentive flag at employee creation. (2026-07-16)
- [ ] B11. Ensure HR and Finance are properly connected (payroll → expenses/finance).
- [x] B12. Purchase Order: label item-row fields; single 'extra charges'; FIX item rows not saving (edit/detail reused item-less list rows). (2026-07-16)
- [x] B13. Purchase Order: dropdown of existing machines; only enter new if not listed. (2026-07-16)
- [x] B14. Remove 'AI Insights' and 'Data Import' modules entirely — pages, routes, nav, API clients, backend, dead refs. (2026-07-16)
- [ ] B15. Quotation Builder: 4 quotation types need DIFFERENT fields — analyse reference PDFs, build distinct page/field-set per type.

### Priority A (ongoing quality-gate audits — never fully complete)
- [ ] A1. UI/UX presentable & professional — number overflow / large counts, empty/loading states, no broken layouts.
- [ ] A2. Whole-website CRUD integrity — create saves; edit loads existing values + re-saves. Fix every add/edit/save bug.
- [x] A3. Vendors: PO-dropdown-created vendor now persists to the register (Vendor::ensureByName + backfill). (2026-07-16)
- [x] A4. GSTIN validation (format + official checksum) shared util applied on-save across all GSTIN fields. (2026-07-16)
- [ ] A5. Module audit: every module works; every page correctly wired (routes, API client, data).
- [ ] A6. Hidden-data audit: no page relies on data hidden/removed; everything connected to depended modules.

---

## 4. Progress Log

### 2026-07-16 (Set-4 window 1)
- Bootstrapped REQUIREMENTS_SET4.md from backlog. Built Module Map (section 1) by analysing routes
  (`api/index.php`), nav (`frontend/src/lib/navigation.ts`, `App.tsx`), controllers, models, api clients.
- Identified B14 targets: Intelligence section (AI Insights → /insights, Insights.php model) and
  Admin section (Data Interop → /data-interop, DataImport/Export services).
- **B14 DONE**: Removed AI Insights + Data Interop modules.
  - Frontend: deleted `pages/Insights.tsx`, `pages/DataInterop.tsx`; removed their imports+routes in
    `App.tsx`; removed "Intelligence" + "Admin" nav sections and unused icons (Sparkles, DatabaseZap)
    in `lib/navigation.ts`; trimmed `phase2.ts` `interop` object to only `template` + `aiMap`.
  - Backend: deleted `models/Insights.php`, `models/DataExportService.php`, `models/BackupService.php`,
    `controllers/admin/AdminInsightsController.php`; slimmed `AdminDataInteropController` to just
    `template` + `aiMap`; removed dead requires + routes in `index.php`.
  - KEPT (shared, NOT dead): `interop.template` + `interop.aiMap` and their routes/controller methods —
    the **HR Import Wizard** (`components/HrImportWizard.tsx`, used by Employees + Attendance import)
    depends on them. `DataImportMapper`, `ImportEngine`, `GroqAPI` kept (used by HR imports + aiMap).
  - Verified: `rg` shows zero dangling frontend refs; `php -l` clean on index.php + controller;
    `npm run build` green.
  - Note for later tasks: build emits `dist/assets/pdf.worker.min-*.mjs` (B1 context) and
    `id-front`/`id-back` PNGs = EcoSudar ID card assets (B6 context).

---

- **B5 DONE**: Attendance page cleanup + zero bonus.
  - Removed buttons: 'Attendance Import' (tmsImportOpen), 'Task Status (TMS)' (taskImportOpen),
    'Face Attendance' (faceScannerOpen) in `pages/Attendance.tsx`. Removed the related state,
    `onFaceMatch` handler, the two attendance/tasks `HrImportWizard` instances, the FaceScanner
    overlay, and unused imports (Camera, FileUp, ListChecks, FaceAttendanceScanner). Deleted the now
    dead `components/FaceAttendanceScanner.tsx`. Header subtitle → "Scan by QR, or add entries manually."
  - `HrImportWizard` kept (still used by Employees employee-import) → `interop.template`/`aiMap`
    dependency from B14 confirmed still needed.
  - Attendance bonus → 0 everywhere: `attendance_bonus_amount` fallback 750→0 in
    `AdminPayrollController.php`, `Employee.php`, `hr.ts`, and Employees form default + placeholder;
    added idempotent migration `035_attendance_bonus_zero.sql` (column DEFAULT 0 + zero existing rows)
    and updated `database/schema.sql` default. php -l clean, npm build green.

- **B3 + B4 DONE**: DCR popup width + location filter.
  - B3: create dialog widened `max-w-5xl` → `w-[96vw] max-w-7xl` so the 12-column visit-lines table
    (~1064px) fits inside the ~1232px inner width — no horizontal scrollbar on desktop.
  - B4: added a Location filter (Select) to the DCR list, populated from distinct areas.
    Backend: `Dcr::all()` accepts an `area` filter (exact match); new `Dcr::distinctAreas()`;
    `AdminDcrController::areas()` + route `GET /admin/dcr/areas` (registered BEFORE `/admin/dcr/{id}`
    so the literal wins over the `{id}` param). Frontend: `fetchDcrAreas()` in `dcr.ts`, `area` added
    to `fetchDcrs` filters, location Select wired into `load()` deps; locations refresh after save.
  - Cross-module: DCR area feeds Follow-ups on approval (lead title includes area) — unchanged, verified.
  - php -l clean, npm build green.

- **B8 DONE**: Settings — hide auto-absent card + configurable leave credit days.
  - Hid the "Attendance Cutoff Time" (auto-absent) card behind `SHOW_AUTO_ABSENT_CARD = false`
    (code stays wired so cutoffs/working-days still drive attendance; just not shown).
  - Added `leave_credit_days` setting (default 20): `settings.ts` type, Settings DEFAULTS, a new
    "Payroll → Leave credit days" card with validation (1–31). Backend `AdminSettingsController`:
    added to ALLOWED_SCALAR + update whitelist + show() output + range validation (422 on bad).
  - Payroll now COMPUTES leave credits with the configurable divisor: `AdminPayrollController`
    `resolveLeaveCreditDays()` (reads setting, default 20), threaded into `run()`+`calculate()`→
    `buildSlip($leaveCreditDays)`; `earnedLeaveCredit = floor(presentDays / days)`,
    `leaveCredit = max(0, earned − availed)`. Persisted via `Payroll::upsert` (existing `leave_credit`
    column) and returned by `Payroll::format`. Additive — does NOT change earned/net pay.
  - No migration needed: `leave_credit` column pre-exists in schema; setting defaults gracefully.
  - php -l clean (3 files), npm build green.

- **B1 DONE**: pdf.js worker load error.
  - Root cause: the worker URL resolution is already correct (built as
    `new URL("pdf.worker.min-*.mjs", import.meta.url)` in `dcrPdfParse.ts`, lazy-loaded). The failure
    is that Hostinger's Apache/LiteSpeed doesn't map `.mjs` → JS MIME, so the worker is served as
    octet-stream; the SPA `.htaccess` sends `X-Content-Type-Options: nosniff`, so the browser refuses
    to run it as a module ⇒ "Setting up fake worker failed: Failed to fetch dynamically imported module".
  - Fix: added `AddType text/javascript .js .mjs` + `AddType application/wasm .wasm` (mod_mime) to BOTH
    generated `.htaccess` blocks in `deploy.sh` (admin `public_html` + dealer portal). No frontend code
    change needed. `bash -n deploy.sh` OK.
  - **Requires redeploy** via deploy.sh for the fixed `.htaccess` to take effect (cloud run can't deploy).

- **B2 DONE**: Customer enquiries/queries.
  - Backing store: migration `036_queries_customer_id.sql` adds `queries.customer_id` (additive,
    idempotent) + index; schema.sql updated.
  - Backend: `AdminQueryController::store()` (POST /admin/queries) logs an enquiry with optional
    `customer_id`; `index()` gained a `customer_id` filter and returns `customer_id`. Route registered.
  - Frontend: `queries.ts` — `create()`, `listForCustomer()`, `customerId` on Query. Customers page:
    new **Enquiries** tab (grid-cols-4) with an "Add Enquiry" textarea + list of that customer's
    enquiries (status, date, reply).
  - Cross-module: enquiries land in the shared `queries` table, so they also appear in the **Customer
    Complaints** (Queries) module where staff reply (status → email) — verified same store/flow.
  - php -l clean, npm build green.

- **B12 DONE**: PO line items save/reload + clearer fields.
  - Root cause of "item rows always empty": `openEdit`/detail reused the po-register **list** row,
    but `PoRegister::all()` omits line items — so items were never populated. Fixed: `openEdit` and new
    `openDetail` fetch the full record via `getPurchaseOrder(id)` and hydrate items/charges. Backend
    persistence (`replaceItems`) was already correct.
  - Added persistent column headers (Item/Qty/Unit price/Amount) + a computed read-only Amount cell.
  - Relabeled "Other charges" → "Extra charges (freight, loading, etc.)"; kept the off-books
    `extra_amount` (extended view) SEPARATE — the dual-tax mandate forbids merging it into on-books
    charges. npm build green.
- **B13 DONE**: PO line-item machine dropdown.
  - Load existing machines once (`fetchMachines`), build `machineOptions` (brand+model+capacity, else
    code, de-duped/sorted). The item "description" is now a free-text `Combobox` — pick a listed
    machine or type a new one ("your typed value will be used"). Cross-module: Inventory Machines →
    PO line items. npm build green.

- **A3 DONE**: PO-created vendors now reach the Vendors register.
  - Root cause: PO `vendor_name` was free text; `PoRegister::create/update` never wrote a vendor row,
    and the PO dropdown only suggested names from existing POs — so PO-added vendors couldn't be found.
  - Fix: `Vendor::ensureByName($name)` (case/space-insensitive find-or-create, auto vendor_code) called
    from `PoRegister::create()` and `update()`. Migration `037_backfill_vendors_from_po.sql` backfills
    the register with distinct historical `po_register` + `purchases` vendor names (additive/idempotent)
    and fills any missing vendor_code. PO vendor Combobox now also lists register vendors
    (`fetchVendors`) and refreshes after save.
  - php -l clean, npm build green.

- **A4 DONE**: consistent GSTIN validation site-wide.
  - New shared `frontend/src/lib/gstin.ts`: `GSTIN_REGEX`, `gstinCheckDigit` (official GSTN modulo-36
    algorithm), `isValidGstin`, `gstinError`. Backend: `Validator::isValidGstin()` (same algorithm) and
    the `gst` rule now enforces the checksum.
  - Verified against real data: `33AGTPT3190M1ZM` (Sri Vari) and `33AUSPB5370L2ZB` (company default)
    pass; wrong check digits and the placeholder `29ABCDE1234F1Z5` are rejected.
  - Applied on-save: Vendors, Settings (company GSTIN), Invoices (create + edit), QuotationBuilder,
    SalesBilling (frontend `gstinError`); backend AdminVendorController + AdminSettingsController now
    checksum-validate. php -l clean, npm build green.

## 5. Blocked items
- **Open PR from `fix/security-hardening` → `main`**: BLOCKED. GitHub returns
  "no history in common with main" (422). `git merge-base fix/security-hardening origin/main`
  is empty — the branch is an *unrelated root* ("first commit" dc435f8) vs main's root (906fb1c),
  and also unrelated to `autonomous/set3`. This is a pre-existing repo condition, not something a
  code change can fix without history rewriting (out of scope / destructive). All Set-4 work still
  commits + pushes to `origin/fix/security-hardening` normally. To get a PR, the branch would need to
  be rebased/replayed onto a `main`-descended base, or main re-pointed — a decision for the repo owner.
