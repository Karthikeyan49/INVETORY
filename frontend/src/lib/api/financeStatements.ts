/**
 * Financial Statements API — the "single frame" report (P&L + Balance Sheet +
 * Cash Flow) plus the manual finance-setup config and Capital & Loans ledger.
 */
import { apiFetch } from "./client";

export interface ExpenseGroup { category: string; amount: number; }

export type TxType = "Revenue" | "Expense" | "Asset" | "Liability";
export interface TxRow {
  date: string; particulars: string; type: TxType;
  inflow: number; outflow: number; balance: number;
}

export interface Statements {
  period: { from: string; to: string; months: number };
  extended: boolean;
  pnl: {
    revenue: number; cogs: number; gross_profit: number;
    expense_groups: ExpenseGroup[]; operating_expenses: number;
    ebitda: number; depreciation: number; ebit: number;
    interest: number; ebt: number; tax: number; net_profit: number;
  };
  balance_sheet: {
    assets: {
      fixed_assets_gross: number; inventory: number; inventory_machines: number;
      inventory_items: number; receivables: number; cash_bank: number; total: number;
    };
    liabilities: { capital: number; surplus: number; loans: number; creditors: number; total: number; };
    difference: number;
  };
  cash_flow: {
    net_profit: number; depreciation: number; working_capital: number; operating: number;
    investing: number; financing: number; opening_cash: number; net_cash: number; closing_cash: number;
  };
  transactions: {
    opening_cash: number; rows: TxRow[];
    total_in: number; total_out: number; closing: number;
  };
}

export async function fetchStatements(from?: string, to?: string): Promise<Statements> {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const res = await apiFetch<{ success: boolean; data: Statements }>(`/admin/finance/statements${q.toString() ? `?${q}` : ""}`);
  return res.data;
}

// ── Finance setup config (opening_cash, depreciation_rate_pct, fixed_assets_gross) ──
export interface FinanceConfig { [key: string]: { value: number; notes?: string | null }; }
export async function fetchFinanceConfig(): Promise<FinanceConfig> {
  const res = await apiFetch<{ success: boolean; data: FinanceConfig }>(`/admin/finance/config`);
  return res.data ?? {};
}
export async function updateFinanceConfig(values: Record<string, number>): Promise<void> {
  await apiFetch(`/admin/finance/config`, { method: "PUT", body: JSON.stringify(values) });
}
