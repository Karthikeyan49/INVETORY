/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GST Tax Invoice PDF — renders the exact "Sri Vari Scales" TAX INVOICE
 * letterhead template (see srivariScalesPdf.ts). Maps the InvoiceTemplateDraft
 * onto the template's fields; CGST/SGST (intra-state) vs IGST (inter-state) and
 * advance/balance come straight from the draft when supplied, otherwise are
 * derived from the line items.
 *
 * The public API is unchanged so the Invoices / GST Invoicing pages and the Sales
 * Document generator keep working:
 *   - downloadInvoiceTemplatePdf, formatTemplateDate, placeOfSupplyLabel,
 *     TERMS_AND_CONDITIONS, InvoiceTemplateLine, InvoiceTemplateDraft
 */
import { buildTaxInvoice, type InvoiceData } from "./srivariScalesPdf";

export interface InvoiceTemplateLine {
  description: string;
  hsn?: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  gstRate: number;
  discount?: number;
}

export interface InvoiceTemplateDraft {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  placeOfSupply: string;
  billTo: string;
  shipTo: string;
  subject: string;
  notes: string;
  termsAndConditions?: string;
  sellerState: string;
  customerState: string;
  deliveryFee?: number;
  discount?: number;
  balanceDue?: number;
  lines: InvoiceTemplateLine[];
  // Sri Vari TAX INVOICE extras (all optional; blank fields match the printed form)
  orderNo?: string;
  orderDate?: string;
  dcNo?: string;
  dcDate?: string;
  transport?: string;
  machineModel?: string;
  capacity?: string;
  accuracy?: string;
  machineNo?: string;
  cgst?: number;
  sgst?: number;
  igst?: number;
  taxAmount?: number;
  grandTotal?: number;
  advance?: number;
}

export const TERMS_AND_CONDITIONS = [
  "1. Payment Terms: 100% advance payment is required before processing the order. If any delay in payment exceeds 7 days, an interest of 24% per annum will be levied on the outstanding invoice amount.",
  "2. Delivery: Delivery is at the customer's scope or actual transport cost will be settled by the customer.",
  "3. Returns & Claims: No returns accepted after delivery. Any quality-related claims must be reported within 48 hours of receipt.",
  "4. Pricing: Prices are subject to change based on raw material costs and market conditions. Please confirm current rate before placing new orders.",
  "5. Taxes: Applicable taxes (GST) are extra and charged as per government norms.",
  "6. Handling & Storage: Store in a dry, ventilated area to maintain product quality.",
  "7. Legal: All disputes are subject to Chennai jurisdiction only.",
];

const GST_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "01", "Himachal Pradesh": "02", Punjab: "03", Chandigarh: "04",
  Uttarakhand: "05", Haryana: "06", Delhi: "07", Rajasthan: "08", "Uttar Pradesh": "09",
  Bihar: "10", Sikkim: "11", "Arunachal Pradesh": "12", Nagaland: "13", Manipur: "14",
  Mizoram: "15", Tripura: "16", Meghalaya: "17", Assam: "18", "West Bengal": "19",
  Jharkhand: "20", Odisha: "21", Chhattisgarh: "22", "Madhya Pradesh": "23", Gujarat: "24",
  "Dadra and Nagar Haveli and Daman and Diu": "26", Maharashtra: "27", Karnataka: "29",
  Goa: "30", Lakshadweep: "31", Kerala: "32", "Tamil Nadu": "33", Puducherry: "34",
  "Andaman and Nicobar Islands": "35", Telangana: "36", "Andhra Pradesh": "37", Ladakh: "38",
};

export function placeOfSupplyLabel(state: string): string {
  const clean = (state || "").trim() || "Tamil Nadu";
  const code = GST_STATE_CODES[clean];
  return code ? `${clean} (${code})` : clean;
}

export function formatTemplateDate(value: string): string {
  if (!value) return "";
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear(),
  ].join("/");
}

const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** Map the draft onto the Sri Vari Scales TAX INVOICE template and download it. */
export async function downloadInvoiceTemplatePdf(draft: InvoiceTemplateDraft): Promise<void> {
  const lines = draft.lines || [];
  const lineBase = (l: InvoiceTemplateLine) => Math.max(0, n(l.qty) * n(l.unitPrice) - n(l.discount));
  const subtotal = lines.reduce((s, l) => s + lineBase(l), 0);
  const totalQty = lines.reduce((s, l) => s + n(l.qty), 0);
  const first = lines[0];
  const interState = (draft.sellerState || "").trim().toLowerCase() !== (draft.customerState || "").trim().toLowerCase();
  const taxAmount = draft.taxAmount ?? lines.reduce((s, l) => s + lineBase(l) * n(l.gstRate) / 100, 0);
  const igst = draft.igst ?? (interState ? taxAmount : 0);
  const cgst = draft.cgst ?? (interState ? 0 : taxAmount / 2);
  const sgst = draft.sgst ?? (interState ? 0 : taxAmount / 2);
  const grandTotal = draft.grandTotal ?? (subtotal + taxAmount + n(draft.deliveryFee));
  const balance = n(draft.balanceDue);
  const advance = draft.advance ?? Math.max(0, grandTotal - balance);

  const data: InvoiceData = {
    invoiceNo: draft.invoiceNumber,
    date: formatTemplateDate(draft.invoiceDate),
    orderNo: draft.orderNo,
    orderDate: draft.orderDate ? formatTemplateDate(draft.orderDate) : "",
    dcNo: draft.dcNo,
    dcDate: draft.dcDate ? formatTemplateDate(draft.dcDate) : "",
    transport: draft.transport,
    to: draft.billTo || "",
    model: draft.machineModel ?? (first ? first.description : ""),
    capacity: draft.capacity,
    accuracy: draft.accuracy,
    machineNo: draft.machineNo,
    taxPct: first ? n(first.gstRate) : 18,
    hsn: first?.hsn,
    qty: totalQty || undefined,
    uom: first?.unit,
    rate: first ? n(first.unitPrice) : undefined,
    amount: subtotal,
    total: subtotal,
    taxAmount,
    roundOff: 0,
    grandTotal,
    advance,
    balance,
    cgst, sgst, igst,
  };
  buildTaxInvoice(data).save(`${String(draft.invoiceNumber || "TAX-INVOICE").replace(/[^\w.-]+/g, "_")}.pdf`);
}
