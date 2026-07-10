/**
 * Installment ledger API client (R12 / T3) — the reusable, polymorphic payment
 * ledger shared by purchase orders, stampings, purchases, incentives, invoices.
 * Records advance + N installments (category Bank Transfer / Cash / UPI + UTR)
 * and derives a live outstanding = grand_total − Σ(installments).
 */
import { apiFetch } from "./client";

export const PAYMENT_CATEGORIES = ["Bank Transfer", "Cash", "UPI"] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

export type InstallmentRefType = "purchase_order" | "stamping" | "purchase" | "incentive" | "invoice";

export interface Installment {
  id: number;
  ref_type: InstallmentRefType;
  ref_id: number;
  seq: number;
  label: string | null;
  amount: number;
  category: PaymentCategory;
  utr_no: string | null;
  paid_on: string;
  notes: string | null;
  created_by: number | null;
  created_at: string;
}

export interface InstallmentLedger {
  ref_type: InstallmentRefType;
  ref_id: number;
  grand_total: number;
  paid_total: number;
  outstanding: number;
  payment_status: "unpaid" | "partial" | "paid";
  installments: Installment[];
}

interface Envelope<T> { success: boolean; data: T; message?: string; }

export async function fetchLedger(refType: InstallmentRefType, refId: number): Promise<InstallmentLedger> {
  const res = await apiFetch<Envelope<InstallmentLedger>>(
    `/admin/installments?ref_type=${encodeURIComponent(refType)}&ref_id=${refId}`
  );
  return res.data;
}

export interface RecordInstallmentInput {
  ref_type: InstallmentRefType;
  ref_id: number;
  amount: number;
  category: PaymentCategory;
  utr_no?: string | null;
  paid_on?: string;
  label?: string;
  notes?: string;
}

export async function recordInstallment(
  input: RecordInstallmentInput
): Promise<{ installment: Installment; ledger: InstallmentLedger }> {
  const res = await apiFetch<Envelope<{ installment: Installment; ledger: InstallmentLedger }>>(
    "/admin/installments",
    { method: "POST", body: JSON.stringify(input) }
  );
  return res.data;
}

export async function deleteInstallment(id: number): Promise<void> {
  await apiFetch(`/admin/installments/${id}`, { method: "DELETE" });
}
