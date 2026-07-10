/**
 * Spares API client (R6 / T6) — spare-parts stock register with low-stock
 * notification and stock-out forecasting. Stock changes go through /move
 * (receive / consume / issue), which can reference the machine fitted.
 */
import { apiFetch } from "./client";

export const SPARE_REASONS = ["receive", "consume", "issue", "adjust"] as const;
export type SpareReason = (typeof SPARE_REASONS)[number];

export interface Spare {
  id: number;
  name: string;
  part_no: string | null;
  category: string | null;
  quantity: number;
  unit: string | null;
  unit_cost: number;
  reorder_level: number;
  location: string | null;
  notes: string | null;
  low_stock: boolean;
  created_at?: string;
  movements?: SpareMovement[];
}

export interface SpareMovement {
  id: number;
  spare_id: number;
  change_qty: number;
  reason: SpareReason;
  machine_id: number | null;
  machine_code?: string | null;
  note: string | null;
  created_at: string;
}

export interface SpareForecast {
  id: number;
  name: string;
  part_no: string | null;
  category: string | null;
  quantity: number;
  reorder_level: number;
  low_stock: boolean;
  consumed_window: number;
  avg_daily_use: number;
  days_to_stockout: number | null;
  suggested_reorder: number;
  window_days: number;
}

interface Pagination { total: number; categories?: string[] }
interface ListResponse { success: boolean; data: Spare[]; pagination: Pagination }
interface OneResponse { success: boolean; data: Spare; message?: string }

export type SpareInput = Partial<Pick<Spare,
  "name" | "part_no" | "category" | "quantity" | "unit" | "unit_cost" | "reorder_level" | "location" | "notes">>;

function qs(p: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") s.set(k, String(v)); });
  const t = s.toString();
  return t ? `?${t}` : "";
}

export async function fetchSpares(
  filters: { search?: string; category?: string; low_stock?: boolean } = {},
): Promise<{ rows: Spare[]; categories: string[] }> {
  const res = await apiFetch<ListResponse>(`/spares${qs({
    search: filters.search, category: filters.category && filters.category !== "all" ? filters.category : undefined,
    low_stock: filters.low_stock ? 1 : undefined,
  })}`);
  return { rows: res.data ?? [], categories: res.pagination?.categories ?? [] };
}

export async function getSpare(id: number): Promise<Spare> {
  const res = await apiFetch<OneResponse>(`/spares/${id}`);
  return res.data;
}

export async function createSpare(data: SpareInput): Promise<Spare> {
  const res = await apiFetch<OneResponse>(`/spares`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function updateSpare(id: number, data: SpareInput): Promise<Spare> {
  const res = await apiFetch<OneResponse>(`/spares/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}

export async function moveSpare(
  id: number,
  data: { qty: number; reason: SpareReason; machine_id?: number; note?: string },
): Promise<{ spare: Spare; quantity: number }> {
  const res = await apiFetch<{ success: boolean; data: { spare: Spare; quantity: number } }>(
    `/spares/${id}/move`, { method: "POST", body: JSON.stringify(data) }
  );
  return res.data;
}

export async function deleteSpare(id: number): Promise<void> {
  await apiFetch(`/spares/${id}`, { method: "DELETE" });
}

export async function fetchLowStockSpares(): Promise<{ count: number; rows: Spare[] }> {
  const res = await apiFetch<{ success: boolean; data: { count: number; rows: Spare[] } }>(`/spares/low-stock`);
  return res.data ?? { count: 0, rows: [] };
}

export async function fetchSpareForecast(window = 90): Promise<SpareForecast[]> {
  const res = await apiFetch<{ success: boolean; data: SpareForecast[] }>(`/spares/forecast?window=${window}`);
  return res.data ?? [];
}
