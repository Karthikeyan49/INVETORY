/**
 * Capital & Loans (funding) API client — equity brought in, loans received/repaid.
 */
import { apiFetch } from "./client";

export type FundingType = "capital" | "loan_in" | "loan_repaid";

export interface FundingEntry {
  id: number;
  entry_type: FundingType;
  amount: number;
  entry_date: string | null;
  party: string | null;
  notes: string | null;
  created_at: string;
}

export interface FundingSummary {
  capital: number; loan_in: number; loan_repaid: number; loan_outstanding: number;
}

export const FUNDING_LABELS: Record<FundingType, string> = {
  capital: "Capital brought in",
  loan_in: "Loan received",
  loan_repaid: "Loan repaid",
};

export async function fetchFunding(): Promise<{ rows: FundingEntry[]; summary: FundingSummary }> {
  const res = await apiFetch<{ success: boolean; data: FundingEntry[]; pagination: { summary: FundingSummary } }>(`/funding`);
  return { rows: res.data ?? [], summary: res.pagination?.summary ?? { capital: 0, loan_in: 0, loan_repaid: 0, loan_outstanding: 0 } };
}

export async function createFunding(data: { entry_type: FundingType; amount: number; entry_date?: string; party?: string; notes?: string }): Promise<FundingEntry> {
  const res = await apiFetch<{ success: boolean; data: FundingEntry }>(`/funding`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function deleteFunding(id: number): Promise<void> {
  await apiFetch<void>(`/funding/${id}`, { method: "DELETE" });
}
