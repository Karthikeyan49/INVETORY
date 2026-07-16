/**
 * Delivery challan API client (requirement.txt lines 6, 8, 14).
 * A challan can reference a machine; the API warns if that machine is missing parts.
 */
import { apiFetch } from "./client";

export type DeliveryStatus = "draft" | "issued" | "delivered" | "cancelled";

export interface DeliveryNote {
  id: number;
  challan_no: string;
  customer_id: number | null;
  customer_name: string | null;
  machine_id: number | null;
  machine_code?: string | null;
  machine_model?: string | null;
  category: string | null;
  items: string | null;
  amount?: number | null;
  tax_amount?: number | null;
  extra_amount?: number | null;       // extended view only
  extra_from_vendor?: number | null;  // extended view only
  status: DeliveryStatus;
  delivery_date: string | null;
  missing_flag: number;
  missing_parts_count?: number;
  missing_parts?: { part_name: string; qty: number }[];
  notes: string | null;
  warning?: string | null;
}

interface Pagination { page: number; limit: number; total: number; total_pages: number; next_challan?: string; }
interface ListResponse { success: boolean; data: DeliveryNote[]; pagination: Pagination; }
interface OneResponse { success: boolean; data: DeliveryNote; message?: string; }

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  draft: "Draft", issued: "Issued", delivered: "Delivered", cancelled: "Cancelled",
};

function qs(p: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") s.set(k, String(v)); });
  const t = s.toString();
  return t ? `?${t}` : "";
}

export async function fetchDeliveries(
  filters: { status?: string; category?: string; search?: string; customer_id?: number; customer_name?: string } = {},
): Promise<{ rows: DeliveryNote[]; nextChallan: string }> {
  const res = await apiFetch<ListResponse>(`/deliveries${qs({ ...filters, limit: 200 })}`);
  return { rows: res.data ?? [], nextChallan: res.pagination?.next_challan ?? "" };
}

export async function createDelivery(data: Partial<DeliveryNote>): Promise<DeliveryNote & { warning?: string | null }> {
  const res = await apiFetch<OneResponse>(`/deliveries`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function setDeliveryStatus(id: number, status: DeliveryStatus): Promise<void> {
  await apiFetch(`/deliveries/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}
