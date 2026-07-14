/**
 * Purchase Order register API client (R10 / T4) — credit-purchase records with
 * taxable + off-books extra (extended login only), payment category + UTR,
 * viewable by category. Advance + installments live in the shared installment
 * ledger (ref_type = 'po_register'); outstanding is returned live per row.
 * Also exposes the single-page Total Outstanding widget aggregate.
 */
import { apiFetch } from "./client";

export const PO_STATUSES = ["open", "confirmed", "closed", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export interface PoItem {
  id?: number;
  description: string;
  qty: number;
  unit_price: number;
  amount?: number;
}

export interface PurchaseOrder {
  id: number;
  po_no: string;
  vendor_name: string;
  category: string | null;
  location: string | null;
  taxable: number;
  gst_pct: number;
  gst_amount: number;
  extra_amount?: number;      // extended login only
  other_charges: number;
  total: number;
  grand_total: number;        // total (+ extra when extended)
  amount_paid: number;
  outstanding: number;
  payment_status: "unpaid" | "partial" | "paid";
  payment_category: string | null;
  utr_no: string | null;
  status: PoStatus;
  notes: string | null;
  items?: PoItem[];
  created_at: string;
}

interface Pagination { total: number; categories?: string[] }
interface ListResponse { success: boolean; data: PurchaseOrder[]; pagination: Pagination }
interface OneResponse { success: boolean; data: PurchaseOrder; message?: string }

export interface PoInput {
  vendor_name: string;
  category?: string;
  location?: string;
  taxable?: number;
  gst_pct?: number;
  extra_amount?: number;
  other_charges?: number;
  payment_category?: string;
  utr_no?: string;
  status?: PoStatus;
  notes?: string;
  items?: PoItem[];
  advance?: number;
  purchase_date?: string;
}

export async function fetchPurchaseOrders(
  params: { search?: string; category?: string; status?: string } = {}
): Promise<{ rows: PurchaseOrder[]; categories: string[] }> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.category && params.category !== "all") q.set("category", params.category);
  if (params.status && params.status !== "all") q.set("status", params.status);
  const res = await apiFetch<ListResponse>(`/admin/po-register?${q.toString()}`);
  return { rows: res.data ?? [], categories: res.pagination?.categories ?? [] };
}

export async function getPurchaseOrder(id: number): Promise<PurchaseOrder> {
  const res = await apiFetch<OneResponse>(`/admin/po-register/${id}`);
  return res.data;
}

export async function createPurchaseOrder(data: PoInput): Promise<PurchaseOrder> {
  const res = await apiFetch<OneResponse>(`/admin/po-register`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function updatePurchaseOrder(id: number, data: Partial<PoInput>): Promise<PurchaseOrder> {
  const res = await apiFetch<OneResponse>(`/admin/po-register/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}

export async function deletePurchaseOrder(id: number): Promise<void> {
  await apiFetch(`/admin/po-register/${id}`, { method: "DELETE" });
}

export interface OutstandingRow {
  source: string;
  ref_no: string;
  party: string | null;
  category: string | null;
  grand_total: number;
  paid: number;
  outstanding: number;
}

export interface OutstandingSummary {
  as_of: string;
  tax_view: "standard" | "extended";
  total_outstanding: number;
  by_source: { purchase_orders: number; purchases: number; stamping: number };
  rows: OutstandingRow[];
}

export async function fetchOutstanding(): Promise<OutstandingSummary> {
  const res = await apiFetch<{ success: boolean; data: OutstandingSummary }>(`/admin/outstanding`);
  return res.data;
}
