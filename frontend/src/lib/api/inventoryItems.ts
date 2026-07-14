/**
 * Inventory Items API client — a simple stock register (add an item + how many
 * are in stock), shown in a table just like the Machines page.
 */
import { apiFetch } from "./client";

export interface InventoryItem {
  id: number;
  name: string;
  category: string | null;
  sku: string | null;
  quantity: number;
  unit_cost: number;
  // Machine buy price wins over unit_cost when this item matches a machine model — see stock_value.
  effective_unit_cost: number;
  stock_value: number;
  unit: string;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

interface Pagination { page: number; limit: number; total: number; total_pages: number; categories?: string[]; }
interface ListResponse { success: boolean; data: InventoryItem[]; pagination: Pagination; }
interface OneResponse { success: boolean; data: InventoryItem; message?: string; }

export async function fetchItems(params: { search?: string; category?: string } = {}): Promise<{ rows: InventoryItem[]; categories: string[] }> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.category) q.set("category", params.category);
  q.set("limit", "500");
  const res = await apiFetch<ListResponse>(`/inventory-items?${q.toString()}`);
  return { rows: res.data ?? [], categories: res.pagination?.categories ?? [] };
}

export type ItemInput = Partial<Pick<InventoryItem, "name" | "category" | "sku" | "quantity" | "unit_cost" | "unit" | "location" | "notes">>;

export async function createItem(data: ItemInput): Promise<InventoryItem> {
  const res = await apiFetch<OneResponse>(`/inventory-items`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function updateItem(id: number, data: ItemInput): Promise<InventoryItem> {
  const res = await apiFetch<OneResponse>(`/inventory-items/${id}`, { method: "PUT", body: JSON.stringify(data) });
  return res.data;
}

export async function deleteItem(id: number): Promise<void> {
  await apiFetch<void>(`/inventory-items/${id}`, { method: "DELETE" });
}
