/**
 * Cash Bill API client — Sri Vari Cash Bill (F/SVS/34), a cash-sale receipt.
 * A cash bill can reference a machine and is downloaded as a PDF on the client.
 */
import { apiFetch } from "./client";

export interface CashBill {
  id: number;
  bill_no: string;
  customer_id: number | null;
  customer_name: string | null;
  cell_no: string | null;
  machine_id: number | null;
  machine_code?: string | null;
  machine_model?: string | null;
  description: string | null;
  qty: string | null;
  amount?: number | null;
  total?: number | null;
  bill_date: string | null;
  notes: string | null;
  created_at?: string;
}

export type CashBillInput = Partial<Pick<CashBill,
  "customer_id" | "customer_name" | "cell_no" | "machine_id" |
  "description" | "qty" | "amount" | "total" | "bill_date" | "notes">>;

interface Pagination { page: number; limit: number; total: number; total_pages: number; next_bill?: string; }
interface ListResponse { success: boolean; data: CashBill[]; pagination: Pagination; }
interface OneResponse { success: boolean; data: CashBill; message?: string; }

function qs(p: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") s.set(k, String(v)); });
  const t = s.toString();
  return t ? `?${t}` : "";
}

export async function fetchCashBills(
  filters: { search?: string; customer_id?: number; customer_name?: string } = {},
): Promise<{ rows: CashBill[]; nextBill: string }> {
  const res = await apiFetch<ListResponse>(`/cash-bills${qs({ ...filters, limit: 200 })}`);
  return { rows: res.data ?? [], nextBill: res.pagination?.next_bill ?? "" };
}

export async function createCashBill(data: CashBillInput): Promise<CashBill> {
  const res = await apiFetch<OneResponse>(`/cash-bills`, { method: "POST", body: JSON.stringify(data) });
  return res.data;
}

export async function deleteCashBill(id: number): Promise<void> {
  await apiFetch(`/cash-bills/${id}`, { method: "DELETE" });
}
