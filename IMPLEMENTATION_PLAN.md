# Implementation Plan — Inventory Management System

Weighing-machine dealer ERP, built on the rebranded EcoSudar ERP at `clone/inventory/`
(React `frontend/` + vanilla-PHP `api/`). Implements `requirement.txt`.

## Conventions (matched from existing code)
- **Backend model:** `api/models/<X>.php` — plain class, static methods, raw SQL via
  `Database::insert/query/select`, `?` placeholders (see `InventoryProduct.php`).
- **Backend controller:** `api/controllers/<X>Controller.php` — uses `Request`
  (`$request->only([...])`, `$request->query()`) and `Response::json/error`.
- **Routes:** registered in `api/index.php` via
  `$router->get/post/put/delete('/path/{id}', [Ctrl::class,'fn'], $auth)`
  (`$auth`: `false` = public, `true` = logged-in, or a role string).
- **Migrations:** numbered SQL in `api/migrations/` — next is **`007_*.sql`**;
  also fold new tables into `database/schema.sql` for fresh installs.
- **Frontend API client:** `frontend/src/lib/api/<x>.ts` — `apiFetch<Envelope<T>>`,
  `Envelope = {success,data,message?,pagination?}`, `qs()` helper (see `inventory.ts`).
- **Frontend page:** `frontend/src/pages/<X>.tsx`; **route** in `frontend/src/App.tsx`;
  **nav item** in `frontend/src/components/AppSidebar.tsx`; dashboard widgets in
  `frontend/src/pages/Dashboard.tsx`.
- **Roles:** `AuthContext` (`role`) on the client; `users.role` / `users.staff_role`
  on the server; route-level gating via the `$auth` role string.

---

## Module 1 — Machines (core entity)
Weighing machines as tracked inventory units made of parts. Nothing like this exists yet.

**Data model — `007_machines.sql`**
- `machines`: `id` PK, `code` VARCHAR UNIQUE, `model`, `category_id` FK→`categories`,
  `customer_id` FK→`customers` NULL, `status` ENUM(`in_stock`,`reserved`,`on_delivery`,`delivered`),
  `zone_id` FK NULL, `purchase_date` DATE NULL, `sold_date` DATE NULL, `notes`, timestamps.
- `machine_parts`: `id` PK, `machine_id` FK, `part_name`, `product_id` FK→`inventory_products` NULL,
  `qty` DECIMAL, `status` ENUM(`present`,`missing`,`transferred`), timestamps.

**Backend**
- `api/models/Machine.php` — `create/update/find/all($filters)/updateStatus`, plus
  `parts($machineId)`, `addPart`, `setPartStatus`.
- `api/controllers/MachineController.php` — `index` (filter category/status/customer/stamping),
  `show` (machine + parts), `store`, `update`, `updateStatus`.
- Routes: `GET/POST /machines`, `GET/PUT /machines/{id}`, `PUT /machines/{id}/status`,
  `GET /machines/{id}/parts`, `POST /machines/{id}/parts`.

**Frontend**
- `frontend/src/lib/api/machines.ts`; `frontend/src/pages/Machines.tsx` (list + filters) and a
  machine-detail view with a parts panel; route `/machines`; sidebar entry "Machines".

**Links:** feeds Stamping (2), Missing-part (3), Dispatch (4), Sales/Delivery.

---

## Module 2 — Stamping + renewal alerts
Legal-metrology stamping: on machine sale, set renewal ~1 year out; quarterly; dashboard alerts.

**Data model — `007` (same migration)**
- `stampings`: `id` PK, `machine_id` FK, `stamp_date` DATE, `renewal_due_date` DATE,
  `quarter` TINYINT (1–4), `certificate_no`, `status` ENUM(`valid`,`due_soon`,`overdue`),
  `remarks`, timestamps.

**Backend**
- `api/models/Stamping.php` — `create`, `renew`, `forMachine`, `dueList($window)`;
  helper to compute `quarter` + `status` from dates.
- `api/controllers/StampingController.php` — `index`, `store`, `renew`, `due`.
- Routes: `GET/POST /stampings`, `PUT /stampings/{id}/renew`, `GET /stampings/due`.
- Auto-create a stamping row (`renewal_due_date = sold_date + 1 year`) when a machine's
  status moves to `delivered`/`sold` (hook in `MachineController::updateStatus`).

**Frontend**
- `frontend/src/lib/api/stamping.ts`; `frontend/src/pages/Stamping.tsx` (quarter view + renew);
  a **Dashboard alert card** "Machines due for stamping" (calls `/stampings/due`);
  route `/stamping`; sidebar entry.

**Links:** Machines, Dashboard.

---

## Module 3 — Missing-part notification
When a part (e.g. battery) is pulled from machine A into delivery machine B, flag A as
missing that part, and warn at invoice/delivery time.

**Data model — `007`**
- `part_transfers`: `id` PK, `from_machine_id` FK, `to_machine_id` FK, `part_name`,
  `product_id` FK NULL, `qty`, `reason`, `ref_delivery_id` NULL, `created_at`.
  On transfer: source `machine_parts.status → missing`, target → `present`.

**Backend**
- `api/models/PartTransfer.php` — `create` (transactional flip of both parts), `index`.
- `api/controllers/PartTransferController.php` — `store`, `index`.
- A guard `Machine::missingParts($id)` invoked in the invoice/delivery generation path
  (existing `SalesDocument`/`OrderController`) that returns a **blocking warning** payload.
- Routes: `GET/POST /part-transfers`.

**Frontend**
- Transfer action on machine detail; a **warning banner** in `Invoices.tsx` /
  `SalesBilling.tsx` when the machine has missing parts.

**Links:** Machines, Invoices, SalesBilling.

---

## Module 4 — "Which machine to move first" recommendation
Rank in-stock machines for dispatch.

**Backend**
- `api/services/MachineDispatchIntelligence.php` (mirrors existing `ReorderIntelligence`):
  ranks in-stock machines by stamping validity, age (oldest first), completeness (no missing parts).
- Route: `GET /machines/dispatch-recommendations`.

**Frontend**
- Ranked "Recommended to dispatch" list on `Machines.tsx` and a Dashboard widget.

**Links:** Machines, Stamping, Missing-part.

---

## Module 5 — Dual tax login (pure-tax ↔ tax + extra)
Two connected logins over the same data; the "extra" amount (extra to customer +
recovered from vendor) is visible/editable only in the extended login.

**Data model — `007`**
- Add `extra_to_customer` DECIMAL, `extra_from_vendor` DECIMAL to `sales_documents`
  (and/or `orders`/`invoices` per where money lines live).
- Two roles: `tax_standard`, `tax_extended` (extend `users.role` / `staff_role` and
  `AuthContext` `AuthRole`), linked to the same dealer/org.

**Backend**
- Auth middleware + Finance/Invoice/Sales controllers **strip** `extra_*` fields for
  `tax_standard`; extended-only endpoints accept them.
- Routes gated by role string on the `$auth` param.

**Frontend**
- `extra_*` inputs/columns rendered only when `role === 'tax_extended'` (via `AuthContext`);
  otherwise pure tax view. Both logins share the same lists.

**Links:** Finance, Invoices, SalesBilling; the cross-cutting "tax + extra everywhere".

---

## Module 6 — Salesperson follow-up alerts
When a customer reschedules a contact/meeting, create a follow-up shown on **both**
the salesperson and admin dashboards.

**Data model — `007`**
- Add `salesperson` role. Extend `meetings`/`tasks` with `followup_due_date`,
  `followup_status` ENUM(`pending`,`done`), `reschedule_reason`.

**Backend**
- `api/controllers/FollowupController.php` — `index` (mine / all), `complete`.
- Routes: `GET /followups`, `PUT /followups/{id}/complete`. Feed into dashboard payload.

**Frontend**
- Follow-up widget on the salesperson dashboard **and** admin Dashboard; create-on-reschedule
  in `Meetings.tsx`.

**Links:** Meetings, Tasks, Customers, Dashboard.

---

## Cross-cutting
- **Categorization:** ensure a `category` field + filter UI on Machines, Products, Expenses,
  Customers, Sales (requirement: "categorizing view in every module").
- **Inter-linking:** the FK links noted per module (Machine ↔ Stamping ↔ Sales ↔ Parts ↔ Dashboard).

## Build sequence (each = backend + UI + verify before next)
1 Machines → 2 Stamping+alerts → 3 Missing-part → 4 Dispatch rec → 5 Dual tax login →
6 Follow-ups → 7 Categorization / inter-link polish.

## Verify & deploy
- Local: run PHP api + `npm run dev` (Vite) and click through each module.
- Migrations run once (phpMyAdmin/SSH). Build via `deploy.sh` → bundle → deploy to a
  **new/staging subdomain** (never vbsolar). All work stays inside `clone/inventory/`.
