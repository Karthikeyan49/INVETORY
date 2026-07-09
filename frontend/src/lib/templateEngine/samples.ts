/**
 * Demo + type-validation for the template engine.
 *
 * Imports the shipped template defs as TemplateDef (so they type-check and bundle)
 * and exposes one-call demos that render them with sample data taken from the
 * Inventory Management System FF.pdf. Wire these to a button to eyeball the output, or copy the
 * input shapes when integrating the engine into the real Invoices / Quotation
 * pages.
 */
import { downloadFromTemplate, type TemplateDef, type DocInputs } from "./index";
import quotationDef from "@/templates/quotation.template.json";
import invoiceDef from "@/templates/invoice.template.json";

const sampleQuotationInputs: DocInputs = {
  customer_name: "VELS GRAND SQUARE",
  customer_address: "No,1/1, Kailasanathar Kovil Street, Kancheepuram – 631 502",
  customer_gstin: "33AGLPM0183B2ZS",
  customer_contact: "Mr. MOHANAVEL SHANMUGAM",
  customer_contact_phone: "9443246060",
  reference_no: "VB_TN-2627-230",
  quotation_date: "2026-06-05",
  prepared_by_name: "M/S BASKARAN",
  prepared_by_designation: "Marketing Manager",
  prepared_by_phone: "9445531605",
  system_title: "HYBRID WITH 60KW BACKUP",
  advance_amount: 300000,
  advance_date: "2026-05-14",
  terms: "1. Payment will be 75% Advance\n2. Delivery Period Maximum 2 days from the date of 25% Advance\n3. Transport Including @ actuals\n4. Unloading Including",
  items: [
    { name: "Solar Panel N type Topcon 625wp", specifications: "RAYZON", qty: 70, unit: "Nos", rate: 11500, gst_rate: 18 },
    { name: "VSOLE Hybrid Inverter 60KW", specifications: "KW hv 3PhS (VS-HY60T) With wifi and with warranty card", qty: 1, unit: "Nos", rate: 496027, gst_rate: 5 },
  ],
};

const sampleInvoiceInputs: DocInputs = {
  invoice_number: "INV-2026-0039",
  invoice_date: "2026-06-05",
  due_date: "2026-06-12",
  place_of_supply: "Tamil Nadu (33)",
  seller_state: "Tamil Nadu",
  customer_state: "Tamil Nadu",
  bill_to: "VELS GRAND SQUARE\nNo,1/1, Kailasanathar Kovil Street, Kancheepuram – 631 502\nGSTIN: 33AGLPM0183B2ZS",
  delivery_fee: 0,
  terms: "1. Goods once sold will not be taken back.\n2. Interest @24% p.a. on overdue bills.\n3. Subject to Chennai jurisdiction.",
  items: [
    { name: "Solar Panel N type Topcon 625wp", hsn: "85414300", qty: 70, unit: "Nos", rate: 11500, gst_rate: 18 },
    { name: "VSOLE Hybrid Inverter 60KW (VS-HY60T)", hsn: "85044090", qty: 1, unit: "Nos", rate: 496027, gst_rate: 5 },
  ],
};

export function downloadSampleQuotation(): Promise<void> {
  return downloadFromTemplate(quotationDef as unknown as TemplateDef, sampleQuotationInputs, "SAMPLE-QUOTATION");
}

export function downloadSampleInvoice(): Promise<void> {
  return downloadFromTemplate(invoiceDef as unknown as TemplateDef, sampleInvoiceInputs, "SAMPLE-TAX-INVOICE");
}
