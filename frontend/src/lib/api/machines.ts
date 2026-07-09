/**
 * Machines API client (requirement.txt — Module 1).
 * Mirrors the customers/inventory client conventions: apiFetch<Envelope<T>>.
 */
import { apiFetch } from "./client";

export type MachineStatus = "in_stock" | "reserved" | "on_delivery" | "delivered" | "maintenance";
export type MachineType = "local" | "brand";
export type PartStatus = "present" | "missing" | "transferred";

export interface MachinePart {
  id: number;
  machine_id: number;
  part_name: string;
  product_id: number | null;
  qty: number;
  status: PartStatus;
}

export interface PartTransfer {
  id: number;
  part_name: string;
  qty: number;
  from_code?: string | null;
  to_code?: string | null;
  created_at?: string;
}

export interface Machine {
  id: number;
  code: string;
  model: string | null;
  category: string | null;
  machine_type?: MachineType;
  accuracy?: string | null;
  platform_size?: string | null;
  capacity?: string | null;
  hsn?: string | null;
  invoice_date?: string | null;
  stamping_date?: string | null;
  customer_id: number | null;
  zone_id: number | null;
  status: MachineStatus;
  purchase_date: string | null;
  sold_date: string | null;
  notes: string | null;
  buy_price?: number | null;
  buy_gst_pct?: number | null;
  sale_price?: number | null;
  sale_gst_pct?: number | null;
  tax_amount?: number | null;
  extra_amount?: number | null;       // Module 5: extra given TO customer (extended view only)
  extra_from_vendor?: number | null;  // extra received FROM vendor (extended view only)
  missing_parts_count?: number;
  parts?: MachinePart[];
  missing_parts?: { part_name: string; qty: number }[];
  transfers?: PartTransfer[];
  // Module 4 dispatch ranking (present only on /dispatch-recommendations)
  dispatch_rank?: number;
  dispatch_score?: number;
  dispatch_reason?: string;
  days_in_stock?: number;
}

interface Pagination { page: number; limit: number; total: number; total_pages: number; tax_view?: "standard" | "extended"; }
interface ListResponse { success: boolean; data: Machine[]; pagination: Pagination; }
interface OneResponse { success: boolean; data: Machine; message?: string; }

export interface MachineFilters {
  status?: MachineStatus | "";
  category?: string;
  machine_type?: MachineType | "";
  search?: string;
  page?: number;
  limit?: number;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  });
  const t = s.toString();
  return t ? `?${t}` : "";
}

export async function fetchMachines(filters: MachineFilters = {}): Promise<{ rows: Machine[]; pagination: Pagination }> {
  const res = await apiFetch<ListResponse>(`/machines${qs({ ...filters, limit: filters.limit ?? 100 })}`);
  return { rows: res.data ?? [], pagination: res.pagination };
}

export async function fetchDispatchRecommendations(limit = 20): Promise<Machine[]> {
  const res = await apiFetch<{ success: boolean; data: Machine[] }>(`/machines/dispatch-recommendations${qs({ limit })}`);
  return res.data ?? [];
}

export interface MachineAlert {
  id: number; code: string; model: string | null; status: MachineStatus;
  missing_parts_count: number; missing_parts: string | null;
}
export async function fetchMachineAlerts(): Promise<MachineAlert[]> {
  const res = await apiFetch<{ success: boolean; data: MachineAlert[] }>(`/machines/alerts`);
  return res.data ?? [];
}

export interface TaxSummary {
  total_sales: number; total_tax: number;
  total_extra_to_customer: number; total_extra_from_vendor: number; total_with_extra: number;
}
export async function fetchTaxSummary(): Promise<TaxSummary> {
  const res = await apiFetch<{ success: boolean; data: TaxSummary }>(`/machines/tax-summary`);
  return res.data;
}

export async function transferPart(
  machineId: number, partId: number, toMachineId: number, notes?: string,
): Promise<void> {
  await apiFetch(`/machines/${machineId}/parts/${partId}/transfer`, {
    method: "POST",
    body: JSON.stringify({ to_machine_id: toMachineId, notes }),
  });
}

export async function getMachine(id: number): Promise<Machine> {
  const res = await apiFetch<OneResponse>(`/machines/${id}`);
  return res.data;
}

export interface MachineMovement {
  id: number;
  machine_id: number;
  movement_type: string;
  description: string | null;
  from_status: string | null;
  to_status: string | null;
  by_name: string | null;
  created_at: string;
  machine_code?: string | null;
  machine_model?: string | null;
}
export async function fetchMachineMovements(id: number): Promise<MachineMovement[]> {
  const res = await apiFetch<{ success: boolean; data: MachineMovement[] }>(`/machines/${id}/movements`);
  return res.data ?? [];
}

/** Global machine-movement feed across all machines. */
export async function fetchMovementsFeed(search = ""): Promise<MachineMovement[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await apiFetch<{ success: boolean; data: MachineMovement[] }>(`/machine-movements${q}`);
  return res.data ?? [];
}

export async function createMachine(data: Partial<Machine>): Promise<Machine> {
  const res = await apiFetch<OneResponse>(`/machines`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function updateMachine(id: number, data: Partial<Machine>): Promise<Machine> {
  const res = await apiFetch<OneResponse>(`/machines/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}

export async function updateMachineStatus(id: number, status: MachineStatus): Promise<Machine> {
  const res = await apiFetch<OneResponse>(`/machines/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
  return res.data;
}

export async function fetchParts(id: number): Promise<MachinePart[]> {
  const res = await apiFetch<{ success: boolean; data: MachinePart[] }>(`/machines/${id}/parts`);
  return res.data ?? [];
}

export async function addPart(id: number, data: { part_name: string; qty?: number; status?: PartStatus }): Promise<MachinePart[]> {
  const res = await apiFetch<{ success: boolean; data: MachinePart[] }>(`/machines/${id}/parts`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data ?? [];
}

export async function updatePart(
  id: number, partId: number, data: { part_name?: string; qty?: number; status?: PartStatus },
): Promise<MachinePart[]> {
  const res = await apiFetch<{ success: boolean; data: MachinePart[] }>(`/machines/${id}/parts/${partId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return res.data ?? [];
}

export interface CatalogModel {
  model: string; category: string | null; accuracy: string | null; platform_size: string | null; capacity: string | null; hsn: string | null;
  buy_price: number | null; buy_gst_pct: number | null; sale_price: number | null; sale_gst_pct: number | null;
}
export interface MachineCatalog {
  models: CatalogModel[]; categories: string[]; accuracies: string[]; platform_sizes: string[]; capacities: string[]; hsns: string[]; part_names: string[];
}
export async function fetchCatalog(): Promise<MachineCatalog> {
  const res = await apiFetch<{ success: boolean; data: MachineCatalog }>(`/machines/catalog`);
  return res.data ?? { models: [], categories: [], accuracies: [], platform_sizes: [], capacities: [], hsns: [], part_names: [] };
}

export interface DeliveryConvertInput {
  customer_name?: string; category?: string; amount?: number | null; tax_amount?: number | null;
  delivery_date?: string; items?: string; notes?: string;
  extra_amount?: number | null; extra_from_vendor?: number | null;
}
export async function convertToDelivery(id: number, body: DeliveryConvertInput = {}): Promise<{ challan_no: string; id: number }> {
  const res = await apiFetch<{ success: boolean; data: { challan_no: string; id: number } }>(`/machines/${id}/convert/delivery`, {
    method: "POST", body: JSON.stringify(body),
  });
  return res.data;
}

export interface InvoiceConvertInput {
  customer_name?: string; description?: string; hsn?: string;
  quantity?: number; unit_price?: number | null; gst_pct?: number | null; notes?: string;
}
export async function convertToInvoice(id: number, body: InvoiceConvertInput = {}): Promise<{ invoice_number: string; total: number }> {
  const res = await apiFetch<{ success: boolean; data: { invoice_number: string; total: number } }>(`/machines/${id}/convert/invoice`, {
    method: "POST", body: JSON.stringify(body),
  });
  return res.data;
}

export const STATUS_LABELS: Record<MachineStatus, string> = {
  in_stock: "In Stock",
  reserved: "Reserved",
  on_delivery: "On Delivery",
  delivered: "Delivered",
  maintenance: "Maintenance",
};
