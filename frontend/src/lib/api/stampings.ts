/**
 * Stampings API client (requirement.txt — Module 2: stamping + renewal alerts).
 */
import { apiFetch } from "./client";

export type StampingStatus = "pending" | "stamped" | "due" | "expired" | "renewed";

export interface Stamping {
  id: number;
  machine_id: number;
  machine_code?: string | null;
  machine_model?: string | null;
  machine_category?: string | null;
  customer_id: number | null;
  certificate_no: string | null;
  stamp_date: string | null;
  expiry_date: string | null;
  quarter: string | null;
  status: StampingStatus;
  notes: string | null;
  // Fee + outstanding (R9 / T5) — populated by the API, tax_view-gated
  total_amount?: number;
  extra_amount?: number;      // extended login only
  grand_total?: number;
  amount_paid?: number;
  outstanding?: number;
  payment_status?: "unpaid" | "partial" | "paid";
}

interface Pagination { page: number; limit: number; total: number; total_pages: number; }
interface ListResponse { success: boolean; data: Stamping[]; pagination: Pagination; }
interface OneResponse { success: boolean; data: Stamping; }
interface DueResponse { success: boolean; data: Stamping[]; }

export const STAMP_LABELS: Record<StampingStatus, string> = {
  pending: "Pending", stamped: "Stamped", due: "Renewal Due", expired: "Expired", renewed: "Renewed",
};

function qs(p: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") s.set(k, String(v)); });
  const t = s.toString();
  return t ? `?${t}` : "";
}

export async function fetchStampings(
  filters: { status?: string; search?: string; machine_id?: number } = {},
): Promise<Stamping[]> {
  const res = await apiFetch<ListResponse>(`/stampings${qs({ ...filters, limit: 200 })}`);
  return res.data ?? [];
}

export async function fetchDueStampings(days = 30): Promise<Stamping[]> {
  const res = await apiFetch<DueResponse>(`/stampings/due${qs({ days })}`);
  return res.data ?? [];
}

export async function createStamping(data: Partial<Stamping>): Promise<Stamping> {
  const res = await apiFetch<OneResponse>(`/stampings`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export interface StampingAlerts {
  overdue: Stamping[]; due_soon: Stamping[]; pending: Stamping[];
  counts: { overdue: number; due_soon: number; pending: number };
}
export async function fetchStampingAlerts(days = 7): Promise<StampingAlerts> {
  const res = await apiFetch<{ success: boolean; data: StampingAlerts }>(`/stampings/alerts${qs({ days })}`);
  return res.data ?? { overdue: [], due_soon: [], pending: [], counts: { overdue: 0, due_soon: 0, pending: 0 } };
}

export async function renewStamping(id: number, stamp_date?: string): Promise<void> {
  await apiFetch(`/stampings/${id}/renew`, { method: "PUT", body: JSON.stringify({ stamp_date }) });
}

export async function setStampingStatus(id: number, status: StampingStatus): Promise<void> {
  await apiFetch(`/stampings/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export async function updateStampingFee(
  id: number,
  data: { total_amount?: number; extra_amount?: number },
): Promise<Stamping> {
  const res = await apiFetch<OneResponse>(`/stampings/${id}/fee`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}
