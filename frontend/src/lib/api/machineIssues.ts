/**
 * Machine Issues API client — report/track machine faults (place + process)
 * and resolve them to return the machine to the Machines page.
 */
import { apiFetch } from "./client";

export type IssueStatus = "open" | "in_progress" | "resolved";

export interface MachineIssue {
  id: number;
  machine_id: number;
  title: string;
  description: string | null;
  place: string | null;
  process: string | null;
  status: IssueStatus;
  reported_by: number | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string | null;
  machine_code?: string | null;
  machine_model?: string | null;
  machine_category?: string | null;
  machine_status?: string | null;
}

interface Pagination { page: number; limit: number; total: number; total_pages: number; stages?: string[]; }
interface ListResponse { success: boolean; data: MachineIssue[]; pagination: Pagination; }
interface OneResponse { success: boolean; data: MachineIssue; message?: string; }

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

export async function fetchIssues(params: { status?: IssueStatus | ""; search?: string } = {}): Promise<{ rows: MachineIssue[]; stages: string[] }> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.search) q.set("search", params.search);
  q.set("limit", "200");
  const res = await apiFetch<ListResponse>(`/machine-issues?${q.toString()}`);
  return { rows: res.data ?? [], stages: res.pagination?.stages ?? [] };
}

export interface CreateIssueInput {
  machine_id: number;
  title: string;
  description?: string;
  place?: string;
  process?: string;
}
export async function createIssue(data: CreateIssueInput): Promise<MachineIssue> {
  const res = await apiFetch<OneResponse>(`/machine-issues`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function updateIssue(id: number, data: Partial<Pick<MachineIssue, "title" | "description" | "place" | "process" | "status">>): Promise<MachineIssue> {
  const res = await apiFetch<OneResponse>(`/machine-issues/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}

export async function resolveIssue(id: number): Promise<MachineIssue> {
  const res = await apiFetch<OneResponse>(`/machine-issues/${id}/resolve`, { method: "PUT" });
  return res.data;
}

export async function reopenIssue(id: number): Promise<MachineIssue> {
  const res = await apiFetch<OneResponse>(`/machine-issues/${id}/reopen`, { method: "PUT" });
  return res.data;
}

export async function deleteIssue(id: number): Promise<void> {
  await apiFetch<void>(`/machine-issues/${id}`, { method: "DELETE" });
}
