/**
 * Daily Call Report API client (R13 / T11), form code F-SVS-01. Field-visit
 * reports with visit lines; approval seeds follow-ups (leads) from prospect lines.
 */
import { apiFetch } from "./client";

export interface DcrLine {
  id?: number;
  customer: string;
  address?: string | null;
  mobile?: string | null;
  model?: string | null;
  cust_status?: string | null;   // new | existing
  cust_type?: string | null;     // customer | prospect
  category?: string | null;
  stamping?: string | null;
  service?: string | null;
  payment?: string | null;
  remarks?: string | null;
  staff_sign?: string | null;
  followup_id?: number | null;
}

export interface Dcr {
  id: number;
  dcr_no: string;
  employee_id: number | null;
  employee_name: string;
  report_date: string;
  area: string | null;
  opening_km: number;
  closing_km: number;
  total_km: number;
  status: "submitted" | "approved";
  notes: string | null;
  approved_at?: string | null;
  line_count?: number;
  lines?: DcrLine[];
  created_at: string;
}

interface Pagination { total: number }
interface ListResponse { success: boolean; data: Dcr[]; pagination: Pagination }
interface OneResponse { success: boolean; data: Dcr; message?: string }

export interface DcrInput {
  employee_id?: number | null;
  employee_name: string;
  report_date: string;
  area?: string;
  opening_km?: number;
  closing_km?: number;
  notes?: string;
  lines: DcrLine[];
}

function qs(p: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") s.set(k, String(v)); });
  const t = s.toString();
  return t ? `?${t}` : "";
}

export async function fetchDcrs(filters: { status?: string; search?: string } = {}): Promise<Dcr[]> {
  const res = await apiFetch<ListResponse>(`/admin/dcr${qs(filters)}`);
  return res.data ?? [];
}

export async function getDcr(id: number): Promise<Dcr> {
  const res = await apiFetch<OneResponse>(`/admin/dcr/${id}`);
  return res.data;
}

export async function createDcr(data: DcrInput): Promise<Dcr> {
  const res = await apiFetch<OneResponse>(`/admin/dcr`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

/** Header fields the PDF extractor can pre-fill on the New-DCR form. */
export interface ExtractedDcrHeader {
  employee_name: string;
  report_date: string;
  area: string;
  opening_km: number;
  closing_km: number;
  total_km: number;
  notes: string;
}

export interface ExtractedDcr {
  header: ExtractedDcrHeader;
  lines: DcrLine[];
}

/**
 * Upload a DCR PDF and get back a structured { header, lines } payload to
 * pre-fill the form. Nothing is saved — the user reviews / edits, then saves
 * via createDcr(). Mirrors the bill-extract flow.
 */
export async function extractDcrFromPdf(file: File): Promise<ExtractedDcr> {
  // 100% in the browser, NO AI and NO server call: pdf.js reads the F-SVS-01
  // layout and a rule-based parser reconstructs the header + visit rows. The
  // parser (with pdf.js) is lazy-loaded so it only ships on actual upload.
  const { parseDcrPdf } = await import("../dcrPdfParse");
  const result = await parseDcrPdf(file);
  if (!result.lines.length && !result.header.employee_name) {
    throw new Error("Couldn't read this DCR PDF. It may be a scanned image or a different layout — please enter the report manually.");
  }
  return result;
}

export async function updateDcr(id: number, data: Partial<DcrInput>): Promise<Dcr> {
  const res = await apiFetch<OneResponse>(`/admin/dcr/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}

export async function approveDcr(id: number): Promise<{ dcr: Dcr; leads_seeded: number }> {
  const res = await apiFetch<{ success: boolean; data: { dcr: Dcr; leads_seeded: number } }>(
    `/admin/dcr/${id}/approve`, { method: "POST" }
  );
  return res.data;
}

export async function deleteDcr(id: number): Promise<void> {
  await apiFetch(`/admin/dcr/${id}`, { method: "DELETE" });
}
