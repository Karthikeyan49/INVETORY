/**
 * Reports API — live backend.
 * Endpoint: GET /admin/reports?module=<key>&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
import { apiFetch } from "./client";

export type ReportModule = "sales" | "orders" | "payments" | "expenses" | "production" | "forecast" | "inventory";

export interface ReportRow {
  date: string;
  reference: string;
  category: string;
  party: string;
  amount: number;
  status: string;
}

interface ApiResponse {
  success: boolean;
  data: {
    module: ReportModule;
    from: string;
    to: string;
    rows: ReportRow[];
    total: number;
    count: number;
  };
}

interface InvStockRow {
  name: string;
  sku: string;
  category: string | null;
  uom: string;
  total_quantity: number;
  stock_value: number;
  is_low_stock: boolean;
}

interface InvStockResponse {
  success: boolean;
  data: { rows: InvStockRow[]; count: number; total_value: number };
}

export const reportsApi = {
  async fetch(module: ReportModule, from: string, to: string): Promise<ReportRow[]> {
    if (module === "inventory") {
      const res = await apiFetch<InvStockResponse>("/admin/reports/inventory/stock-summary");
      const today = new Date().toISOString().slice(0, 10);
      return (res.data?.rows ?? []).map((r) => ({
        date: today,
        reference: r.sku,
        category: r.category ?? "Uncategorized",
        party: r.name,
        amount: r.stock_value,
        status: r.is_low_stock ? "Low Stock" : "In Stock",
      }));
    }
    const q = `?module=${encodeURIComponent(module)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await apiFetch<ApiResponse>("/admin/reports" + q);
    return res.data?.rows ?? [];
  },
};
