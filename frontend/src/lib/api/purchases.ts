/**
 * Purchases API client — vendor purchases (cash/credit) with taxable+GST+extra,
 * advance/outstanding and location. Each purchase posts an expense → P&L.
 */
import { apiFetch } from "./client";

export type PurchaseType = "cash" | "credit";

export interface Purchase {
  id: number;
  purchase_no: string | null;
  vendor_name: string;
  location: string | null;
  purchase_type: PurchaseType;
  taxable: number;
  gst_pct: number;
  gst_amount: number;
  extra_amount: number;
  total: number;
  advance: number;
  amount_paid: number;
  outstanding: number;
  payment_method: string | null;
  utr_no: string | null;
  purchase_date: string | null;
  notes: string | null;
  created_at: string;
}

interface Pagination { page: number; limit: number; total: number; total_pages: number; locations?: string[]; }
interface ListResponse { success: boolean; data: Purchase[]; pagination: Pagination; }
interface OneResponse { success: boolean; data: Purchase; message?: string; }

export const PURCHASE_PAYMENT_MODES = ["Cash", "Bank Transfer", "UPI", "Cheque", "Card"] as const;

export type PurchaseInput = Partial<Pick<Purchase,
  "vendor_name" | "location" | "purchase_type" | "taxable" | "gst_pct" | "extra_amount" | "advance" | "payment_method" | "utr_no" | "purchase_date" | "notes">>
  & { machine_id?: number };

export async function fetchPurchases(params: { search?: string; type?: string; location?: string } = {}): Promise<{ rows: Purchase[]; locations: string[] }> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.type && params.type !== "all") q.set("type", params.type);
  if (params.location && params.location !== "all") q.set("location", params.location);
  q.set("limit", "500");
  const res = await apiFetch<ListResponse>(`/purchases?${q.toString()}`);
  return { rows: res.data ?? [], locations: res.pagination?.locations ?? [] };
}

export async function createPurchase(data: PurchaseInput): Promise<Purchase> {
  const res = await apiFetch<OneResponse>(`/purchases`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function updatePurchase(id: number, data: PurchaseInput): Promise<Purchase> {
  const res = await apiFetch<OneResponse>(`/purchases/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}

export async function recordPurchasePayment(id: number, amount: number): Promise<Purchase> {
  const res = await apiFetch<OneResponse>(`/purchases/${id}/payment`, { method: "POST", body: JSON.stringify({ amount }) });
  return res.data;
}

export async function deletePurchase(id: number): Promise<void> {
  await apiFetch<void>(`/purchases/${id}`, { method: "DELETE" });
}
