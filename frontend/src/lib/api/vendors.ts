/**
 * Vendors API client — the vendor master (supplier directory). Each vendor row
 * also carries its purchase cost, matched from the Purchases register by name
 * (purchase_total / purchase_count / purchase_outstanding).
 */
import { apiFetch } from "./client";

export interface Vendor {
  vendor_id: number;
  id: string;
  vendor_code: string | null;
  name: string;
  gstin: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  payment_terms: string | null;
  notes: string | null;
  is_active: boolean;
  purchase_total: number;
  purchase_count: number;
  purchase_outstanding: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface VendorAnalytics {
  total_vendors: number;
  total_purchase_cost: number;
  outstanding_payable: number;
}

export type VendorInput = Partial<Pick<Vendor,
  "vendor_code" | "name" | "gstin" | "contact_name" | "phone" | "email" |
  "address" | "city" | "state" | "pincode" | "payment_terms" | "notes" | "is_active">>;

interface Pagination { page: number; limit: number; total: number; total_pages: number; }
interface ListResponse { success: boolean; data: Vendor[]; pagination: Pagination; }
interface OneResponse { success: boolean; data: Vendor; message?: string; }

export async function fetchVendors(params: { search?: string; active?: boolean } = {}): Promise<Vendor[]> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.active !== undefined) q.set("active", String(params.active));
  q.set("limit", "100");
  const res = await apiFetch<ListResponse>(`/admin/vendors?${q.toString()}`);
  return res.data ?? [];
}

export async function fetchVendorAnalytics(): Promise<VendorAnalytics> {
  const res = await apiFetch<{ success: boolean; data: VendorAnalytics }>(`/admin/vendors/analytics`);
  return res.data;
}

export async function createVendor(data: VendorInput): Promise<Vendor> {
  const res = await apiFetch<OneResponse>(`/admin/vendors`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function updateVendor(id: number, data: VendorInput): Promise<Vendor> {
  const res = await apiFetch<OneResponse>(`/admin/vendors/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}

export async function deactivateVendor(id: number): Promise<void> {
  await apiFetch<void>(`/admin/vendors/${id}`, { method: "DELETE" });
}
