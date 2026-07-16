/**
 * Finance API — live backend.
 * Endpoints:
 *   GET /admin/finance/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /admin/finance/ratios?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /admin/finance/config
 *   PUT /admin/finance/config
 */
import { apiFetch } from "./client";

export interface MonthlyPoint {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface ExpenseSlice {
  category: string;
  amount: number;
}

export interface PnLSummary {
  periodFrom: string;
  periodTo: string;
  revenue: number;
  expenses: number;
  grossProfit: number;
  netProfit: number;
  taxes: number;
  monthly: MonthlyPoint[];
  expenseBreakdown: ExpenseSlice[];
  revenueBreakdown: { source: string; amount: number }[];
}

export interface FinancialRatios {
  profitMargin: number;
  expenseRatio: number;
  roi: number;
  currentRatio: number;
  grossMargin: number;
  operatingMargin: number;
  currentAssets: number;
  currentLiabilities: number;
  investment: number;
}

export interface FinanceConfig {
  [key: string]: { value: number; notes: string | null };
}

interface ApiEnvelope<T> { success: boolean; data: T }

function buildQuery(params?: { from?: string; to?: string }): string {
  if (!params) return "";
  const parts: string[] = [];
  if (params.from) parts.push(`from=${encodeURIComponent(params.from)}`);
  if (params.to)   parts.push(`to=${encodeURIComponent(params.to)}`);
  return parts.length ? "?" + parts.join("&") : "";
}

export const financeApi = {
  async pnl(params?: { from?: string; to?: string }): Promise<PnLSummary> {
    const res = await apiFetch<ApiEnvelope<PnLSummary>>("/admin/finance/pnl" + buildQuery(params));
    return res.data;
  },
  async ratios(params?: { from?: string; to?: string }): Promise<FinancialRatios> {
    const res = await apiFetch<ApiEnvelope<FinancialRatios>>("/admin/finance/ratios" + buildQuery(params));
    return res.data;
  },
  async config(): Promise<FinanceConfig> {
    const res = await apiFetch<ApiEnvelope<FinanceConfig>>("/admin/finance/config");
    return res.data;
  },
  async updateConfig(patch: Partial<Record<"investment" | "current_assets" | "current_liabilities" | "tax_rate" | "opex_tax_portion", number>>): Promise<void> {
    await apiFetch("/admin/finance/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },
};
