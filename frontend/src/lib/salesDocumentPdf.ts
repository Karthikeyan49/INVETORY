/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sales Document PDF (Quotation) — renders the exact "Sri Vari Scales" quotation
 * letterhead. The four formats (retail / industrial / service / stamping) are
 * selected by `document.quotation_kind` (defaults to "retail"). Amounts come
 * straight from the server payload.
 */
import { buildQuotation, type QuotationKind, type QuotationRow } from "./srivariQuotationPdf";
import { formatTemplateDate } from "./invoiceTemplatePdf";

const KINDS: QuotationKind[] = ["retail", "industrial", "service", "stamping"];

function addressBlock(d: any): string {
  return [
    d.customer_name,
    d.customer_address,
    [d.customer_city, d.customer_pincode].filter(Boolean).join(" - "),
    d.customer_state,
    d.customer_gstin ? `GSTIN: ${d.customer_gstin}` : "",
    d.customer_phone ? `Phone: ${d.customer_phone}` : "",
  ].filter((x) => x && String(x).trim()).join("\n");
}

export function downloadSalesDocumentPdf(d: any): void {
  const kind: QuotationKind = KINDS.includes(d.quotation_kind) ? d.quotation_kind : "retail";
  const items: any[] = Array.isArray(d.items) ? d.items : [];
  const rows: QuotationRow[] = items.map((it, i) => {
    const name = it.description || it.product_name || it.name || "";
    const base = Number(it.amount ?? Number(it.quantity || 0) * Number(it.unit_price || 0));
    const common = {
      sno: String(i + 1),
      qty: it.quantity != null ? String(it.quantity) : undefined,
      basicPrice: base || undefined,
    };
    return kind === "service"
      ? { ...common, description: name }
      : { ...common, model: it.model || name, capacity: it.capacity, accuracy: it.accuracy, platformSize: it.platform_size, unitPrice: Number(it.unit_price || 0) || undefined };
  });

  const doc = buildQuotation({
    to: addressBlock(d),
    refNo: d.document_number || "",
    date: d.document_date ? formatTemplateDate(d.document_date) : "",
    rows,
    total: Number(d.subtotal ?? d.total ?? 0),
  }, kind);
  doc.save(`${String(d.document_number || `${kind}-quotation`).replace(/[^\w.-]+/g, "_")}.pdf`);
}
