/**
 * Incentives API client (R7 / T10) — output-based HR pay, separate from fixed
 * payroll. Off-books extra is extended-login only. Paying an incentive posts an
 * expense (Finance link).
 */
import { apiFetch } from "./client";

export const INCENTIVE_BASES = ["per_sale", "per_visit", "per_collection", "fixed", "percentage"] as const;
export type IncentiveBasis = (typeof INCENTIVE_BASES)[number];
export const BASIS_LABELS: Record<IncentiveBasis, string> = {
  per_sale: "Per sale", per_visit: "Per visit", per_collection: "Per collection", fixed: "Fixed bonus", percentage: "% of turnover",
};

export interface Incentive {
  id: number;
  employee_id: number | null;
  employee_name?: string | null;
  employee_designation?: string | null;
  person_name: string;
  basis: IncentiveBasis;
  rate: number;
  units: number;
  base_amount: number;
  amount: number;
  extra_amount?: number;      // extended login only
  period: string | null;
  status: "unpaid" | "paid";
  payment_category: string | null;
  utr_no: string | null;
  paid_on: string | null;
  expense_code?: string | null;
  notes: string | null;
  created_at: string;
}

interface Pagination { total: number; summary?: { paid: number; unpaid: number } }
interface ListResponse { success: boolean; data: Incentive[]; pagination: Pagination }
interface OneResponse { success: boolean; data: Incentive; message?: string }

export interface IncentiveInput {
  employee_id?: number | null;
  person_name: string;
  basis: IncentiveBasis;
  rate?: number;
  units?: number;
  base_amount?: number;
  extra_amount?: number;
  period?: string;
  payment_category?: string;
  utr_no?: string;
  notes?: string;
}

function qs(p: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") s.set(k, String(v)); });
  const t = s.toString();
  return t ? `?${t}` : "";
}

export async function fetchIncentives(
  filters: { status?: string; period?: string; search?: string } = {},
): Promise<{ rows: Incentive[]; summary: { paid: number; unpaid: number } }> {
  const res = await apiFetch<ListResponse>(`/admin/incentives${qs(filters)}`);
  return { rows: res.data ?? [], summary: res.pagination?.summary ?? { paid: 0, unpaid: 0 } };
}

export async function createIncentive(data: IncentiveInput): Promise<Incentive> {
  const res = await apiFetch<OneResponse>(`/admin/incentives`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function updateIncentive(id: number, data: Partial<IncentiveInput>): Promise<Incentive> {
  const res = await apiFetch<OneResponse>(`/admin/incentives/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}

export async function payIncentive(
  id: number,
  data: { paid_on?: string; payment_category?: string; utr_no?: string } = {},
): Promise<Incentive> {
  const res = await apiFetch<OneResponse>(`/admin/incentives/${id}/pay`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function deleteIncentive(id: number): Promise<void> {
  await apiFetch(`/admin/incentives/${id}`, { method: "DELETE" });
}
