/**
 * Template guard — renders the shipped invoice + quotation templates with small
 * AND large datasets and asserts they produce valid, correctly-paginated PDFs.
 *
 * This is the automated replacement for hand-testing the PDFs after every change
 * or rebrand. It runs via `npm run verify:templates` and inside `deploy.sh`, so a
 * broken template def / engine fails loudly instead of shipping.
 */
import { describe, it, expect } from "vitest";
import { renderTemplate, type TemplateDef, type DocInputs } from "@/lib/templateEngine";
import quotationDef from "@/templates/quotation.template.json";
import invoiceDef from "@/templates/invoice.template.json";

const qItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Solar Panel N-type Topcon 625Wp #${i + 1}`,
    specifications: "RAYZON mono-perc, 25yr warranty",
    make: "RAYZON", qty: (i % 5) + 1, unit: "Nos", rate: 11500, gst_rate: i % 2 ? 18 : 5,
    components: i % 3 === 0 ? [{ name: "Earthing Kit", make: "ABB", qty: 1 }, { name: "ACDB", qty: 1 }] : [],
  }));

const invItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Line item ${i + 1} — long descriptive product name that may wrap`,
    hsn: "85414300", qty: (i % 7) + 1, unit: "Nos", rate: 4500 + i * 10, gst_rate: i % 2 ? 18 : 12,
  }));

const quotationInputs = (n: number): DocInputs => ({
  customer_name: "VELS Grand Square", customer_address: "No 1/1, Kancheepuram – 631 502",
  customer_gstin: "33AGLPM0183B2ZS", customer_contact: "Mr. Mohanavel", customer_contact_phone: "9443246060",
  reference_no: "VB_TN-2627", quotation_date: "2026-06-05", prepared_by_name: "M/S Baskaran",
  prepared_by_designation: "Marketing Manager", prepared_by_phone: "9445531605",
  system_title: "HYBRID WITH 60KW BACKUP", advance_amount: 300000, advance_date: "2026-05-14",
  terms: "1. 75% Advance\n2. Delivery in 2 days\n3. Transport at actuals\n4. Unloading included",
  items: qItems(n),
});

const invoiceInputs = (n: number): DocInputs => ({
  invoice_number: "INV-2026-0042", invoice_date: "2026-06-30", due_date: "2026-07-07",
  place_of_supply: "Tamil Nadu (33)", seller_state: "Tamil Nadu", customer_state: "Tamil Nadu",
  bill_to: "ACME Pvt Ltd\nChennai\nGSTIN: 33AAAAA0000A1Z5", delivery_fee: 500, discount: 1000,
  terms: "1. Goods once sold not returnable.\n2. Interest 24% p.a. on overdue.", items: invItems(n),
});

async function pdfPages(def: TemplateDef, inputs: DocInputs) {
  const doc = await renderTemplate(def, inputs);
  const bytes = doc.output("arraybuffer");
  return { pages: doc.getNumberOfPages(), size: bytes.byteLength };
}

// Decode the PDF content stream to raw text so we can assert what actually got
// drawn (jsPDF stores standard-font text as literal strings in the stream).
async function pdfText(def: TemplateDef, inputs: DocInputs): Promise<string> {
  const doc = await renderTemplate(def, inputs);
  const uri = doc.output("datauristring");
  return Buffer.from(uri.split(",")[1], "base64").toString("latin1");
}

// The first render of each template cold-loads/decodes the logo image, which is
// CPU-spiky on a loaded machine (it can briefly exceed vitest's 5s default). The
// assertions are the real guard, so give each render a generous timeout instead
// of letting a slow-but-correct render false-fail the deploy.
const RENDER_TIMEOUT = 30_000;

describe("PDF templates render correctly (guard)", () => {
  it("quotation — small dataset → single valid page", async () => {
    const r = await pdfPages(quotationDef as unknown as TemplateDef, quotationInputs(2));
    expect(r.pages).toBe(1);
    expect(r.size).toBeGreaterThan(2000);
  }, RENDER_TIMEOUT);

  it("quotation — 30 items → paginates onto multiple pages", async () => {
    const r = await pdfPages(quotationDef as unknown as TemplateDef, quotationInputs(30));
    expect(r.pages).toBeGreaterThanOrEqual(2);
    expect(r.size).toBeGreaterThan(5000);
  }, RENDER_TIMEOUT);

  it("invoice — small dataset (CGST/SGST split) → single valid page", async () => {
    const r = await pdfPages(invoiceDef as unknown as TemplateDef, invoiceInputs(2));
    expect(r.pages).toBe(1);
    expect(r.size).toBeGreaterThan(2000);
  }, RENDER_TIMEOUT);

  it("invoice — 40 items → paginates onto multiple pages", async () => {
    const r = await pdfPages(invoiceDef as unknown as TemplateDef, invoiceInputs(40));
    expect(r.pages).toBeGreaterThanOrEqual(2);
    expect(r.size).toBeGreaterThan(5000);
  }, RENDER_TIMEOUT);

  // Currency guard: jsPDF's built-in fonts have no ₹ glyph — it renders as "¹"
  // AND corrupts string-width measurement, which mis-aligns and CLIPS the total.
  // Assert amounts render with an ASCII prefix and full, un-clipped digits.
  it("quotation — currency renders correctly (no ₹ glyph, totals not clipped)", async () => {
    const raw = await pdfText(quotationDef as unknown as TemplateDef, quotationInputs(2));
    expect(raw.includes("₹")).toBe(false);       // never emit the unsupported glyph
    expect(raw).toContain("Rs.");                 // safe ASCII currency prefix
    expect(/Rs\. [\d,]+\.\d{2}/.test(raw)).toBe(true); // full amount with 2 decimals
  }, RENDER_TIMEOUT);

  it("invoice — currency renders correctly (no ₹ glyph, totals not clipped)", async () => {
    const raw = await pdfText(invoiceDef as unknown as TemplateDef, invoiceInputs(2));
    expect(raw.includes("₹")).toBe(false);
    expect(raw).toContain("Rs.");
    expect(/Rs\. [\d,]+\.\d{2}/.test(raw)).toBe(true);
  }, RENDER_TIMEOUT);
});
