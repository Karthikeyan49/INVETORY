# Financial Statements ("Single Frame") — Build Plan

Goal: generate the same style of report as `Financials in Single Frame.xlsx` for the
Sri Vari Scales ERP — **Profit & Loss + Balance Sheet + Cash Flow on one page**,
assembled from the data the system already captures, plus a few small new inputs
that fill the gaps.

Basis: **accrual** (Sales = invoiced, COGS = cost of machines sold, purchases/expenses
as incurred) — matching the Excel model. Clearly labelled; a balancing check is shown.

---

## Gap analysis → what to add

| Statement line | Source in ERP today | Action |
|---|---|---|
| Revenue (net of GST) | invoices | ✅ derive |
| COGS | sold machines' `buy_price` | ✅ derive |
| Operating expenses (by category) | `expenses` | ✅ derive |
| Receivables | credit invoices `balance_due` | ✅ derive |
| Payables (creditors) | credit purchases `outstanding` | ✅ derive |
| Advances (customer / vendor) | invoice `advance` / purchase `advance` | ✅ derive |
| Inventory — machines | in-stock machines `buy_price` | ✅ derive |
| Inventory — spare items | items `quantity` × **`unit_cost`** | NEW: add `unit_cost` on items |
| Fixed assets (own equipment) + Depreciation | — | NEW: `fixed_assets_gross` + `depreciation_rate_pct` in `finance_config` |
| Cash & Bank | payments exist, no anchor | NEW: `opening_cash` in `finance_config` |
| Capital / Equity | — | NEW: **Capital & Loans** ledger (`funding_entries`) |
| Loans (received / repaid) | — | NEW: **Capital & Loans** ledger |

---

## Features to build

### 1. Capital & Loans ledger (NEW module)
- Table `funding_entries(id, entry_type ENUM('capital','loan_in','loan_repaid'), amount, entry_date, party, notes, created_by, created_at)`.
- Model `Funding` + `FundingController`: list / create / delete + `summary()` →
  `{ capital, loan_outstanding = Σloan_in − Σloan_repaid, loan_in, loan_repaid }`.
- Routes `/funding*`. Small page **Finance → Capital & Loans**.

### 2. Financial setup values (finance_config, reuse existing table)
- Keys: `opening_cash`, `depreciation_rate_pct` (annual %), `fixed_assets_gross`.
- Editable from the report page ("Setup" dialog) via the existing `/admin/finance/config`.

### 3. Inventory item cost
- Add `inventory_items.unit_cost DECIMAL`. Show/edit on Items page. Used for stock value.

### 4. Financial Statements report (NEW page)
- Endpoint `GET /admin/finance/statements?from&to` → one payload:
  - **P&L**: Revenue, COGS, Gross Profit, expense groups, Depreciation, EBITDA/EBIT/EBT, Tax, Net Profit.
  - **Balance Sheet** (as of `to`): Assets (fixed net, inventory, receivables, advances-to-vendor, cash) vs Liabilities (capital, surplus, loans, creditors, advances-from-customer) + **balancing check**.
  - **Cash Flow**: Operating (profit + depreciation − ΔWC), Investing (fixed-asset buys), Financing (capital + loans), Opening → Net → Closing cash.
  - Respects the dual-login **extra amount** (extended sees with-extra).
- Page **Finance → Financial Statements**: three stacked cards (P&L / Balance Sheet / Cash Flow) + date range + Setup dialog + Capital & Loans link. Export/print later.

---

## Build order & status
- [ ] Migration 020: `funding_entries`, `inventory_items.unit_cost`, seed `finance_config` keys
- [ ] Backend: `Funding` model + `FundingController` + routes
- [ ] Backend: `AdminFinanceController::statements()` + route (assembles all three)
- [ ] Backend: item `unit_cost` in InventoryItem model/controller
- [ ] Frontend: `financeStatements.ts` + `funding.ts` API clients
- [ ] Frontend: `FinancialStatements.tsx` page (+ Setup dialog) and `CapitalLoans.tsx`
- [ ] Frontend: Items page `unit_cost` field; nav + routes
- [ ] Build, migrate live, deploy, smoke-test, clean up test data

## Assumptions / notes
- Machines are **stock** (inventory / COGS), not fixed assets. Fixed assets = own equipment, entered manually via `fixed_assets_gross`.
- Working-capital change in Cash Flow uses current outstanding balances (no historical snapshots yet) — approximate, labelled as such.
- The Balance Sheet shows a **difference line** if assets ≠ liabilities+equity (honest, since some inputs are manual).
