import { apiFetch } from "@/lib/api/client";

type Envelope<T> = { success?: boolean; message?: string; data: T };

export type QuotationComponent = {
  group?: string;
  name: string;
  make?: string;
  qty?: number;
};

export type QuotationItem = {
  item_id?: number;
  name: string;
  make?: string;
  qty: number;
  unit?: string;
  specifications?: string;
  capacity?: string;
  accuracy?: string;
  platform_size?: string;
  gst_rate?: number;
  rate: number;
  amount: number;
  components: QuotationComponent[];
};

export type QuotationStatus = "Draft" | "Sent" | "Accepted" | "Rejected";

export type QuotationKind = "retail" | "industrial" | "service" | "stamping";
export const QUOTATION_KINDS: { value: QuotationKind; label: string; description: string }[] = [
  { value: "retail", label: "Retail", description: "ESSAE electronic weighing scale sale — Model, Capacity, Accuracy, Platform Size, Basic Price." },
  { value: "industrial", label: "Industrial", description: "Weighing scale with quantity, delivery schedule & validity — Model, Capacity, Accuracy, Platform Size, Qty, Basic Price." },
  { value: "service", label: "Service", description: "Repair / service work — just Description, Qty and Price, no machine spec columns." },
  { value: "stamping", label: "Stamping", description: "Legal stamping / calibration — Model, Capacity, Accuracy, Qty, Unit Price, Basic Price." },
];

export type QuotationListRow = {
  quotation_id: number;
  quotation_no: string;
  customer_name: string;
  particular: string | null;
  reference_no: string | null;
  system_title: string | null;
  quotation_date: string | null;
  quotation_kind?: QuotationKind;
  subtotal: number;
  gst_rate: number;
  gst_amount: number;
  grand_total: number;
  advance_amount: number;
  status: QuotationStatus;
  created_at: string;
};

export type Quotation = QuotationListRow & {
  customer_address: string | null;
  customer_gstin: string | null;
  customer_contact: string | null;
  customer_contact_phone: string | null;
  prepared_by_name: string | null;
  prepared_by_designation: string | null;
  prepared_by_phone: string | null;
  advance_date: string | null;
  terms: string | null;
  notes: string | null;
  items: QuotationItem[];
};

export type QuotationInput = {
  customer_name: string;
  customer_address?: string;
  customer_gstin?: string;
  customer_contact?: string;
  customer_contact_phone?: string;
  particular?: string;
  reference_no?: string;
  prepared_by_name?: string;
  prepared_by_designation?: string;
  prepared_by_phone?: string;
  system_title?: string;
  quotation_kind?: QuotationKind;
  quotation_date?: string;
  gst_rate?: number;
  advance_amount?: number;
  advance_date?: string;
  terms?: string;
  notes?: string;
  status?: QuotationStatus;
  items: QuotationItem[];
};

export async function listQuotations(): Promise<QuotationListRow[]> {
  const res = await apiFetch<Envelope<QuotationListRow[]>>("/admin/quotations");
  return res.data ?? [];
}

export async function getQuotation(id: number): Promise<Quotation> {
  const res = await apiFetch<Envelope<Quotation>>(`/admin/quotations/${id}`);
  return res.data;
}

export async function createQuotation(payload: QuotationInput): Promise<Quotation> {
  const res = await apiFetch<Envelope<Quotation>>("/admin/quotations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateQuotation(id: number, payload: QuotationInput): Promise<Quotation> {
  const res = await apiFetch<Envelope<Quotation>>(`/admin/quotations/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function deleteQuotation(id: number): Promise<void> {
  await apiFetch(`/admin/quotations/${id}`, { method: "DELETE" });
}
