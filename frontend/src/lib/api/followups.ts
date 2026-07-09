/**
 * Follow-ups API client (requirement.txt — Module 6: salesperson follow-up alerts).
 */
import { apiFetch } from "./client";

export type FollowupStatus = "open" | "done" | "snoozed";

export interface Followup {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  machine_id: number | null;
  machine_code?: string | null;
  assigned_to: number | null;
  assigned_name?: string | null;
  title: string;
  category?: string | null;
  note: string | null;
  followup_date: string | null;
  status: FollowupStatus;
}

interface Pagination { page: number; limit: number; total: number; total_pages: number; }
interface ListResponse { success: boolean; data: Followup[]; pagination: Pagination; }
interface OneResponse { success: boolean; data: Followup; }
interface DueResponse { success: boolean; data: Followup[]; }

export const FOLLOWUP_LABELS: Record<FollowupStatus, string> = {
  open: "Open", done: "Done", snoozed: "Snoozed",
};

function qs(p: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") s.set(k, String(v)); });
  const t = s.toString();
  return t ? `?${t}` : "";
}

export async function fetchFollowups(
  filters: { status?: string; category?: string; search?: string } = {},
): Promise<Followup[]> {
  const res = await apiFetch<ListResponse>(`/followups${qs({ ...filters, limit: 200 })}`);
  return res.data ?? [];
}

export async function fetchDueFollowups(days = 0): Promise<Followup[]> {
  const res = await apiFetch<DueResponse>(`/followups/due${qs({ days })}`);
  return res.data ?? [];
}

export async function createFollowup(data: Partial<Followup>): Promise<Followup> {
  const res = await apiFetch<OneResponse>(`/followups`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function updateFollowup(id: number, data: Partial<Followup>): Promise<Followup> {
  const res = await apiFetch<OneResponse>(`/followups/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}
