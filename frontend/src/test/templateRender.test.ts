import { describe, it, expect } from "vitest";
import { renderTemplate, type TemplateDef } from "@/lib/templateEngine";
import quotationDef from "@/templates/quotation.template.json";
import invoiceDef from "@/templates/invoice.template.json";

/**
 * Regression test: prove the declarative PDF template engine actually executes
 * end-to-end and produces a non-trivial PDF for both reconstructed templates.
 *
 * The engine's logo loader (helpers.loadImage) reaches out via fetch/Image; in
 * jsdom those fail, but loadImage catches and returns null, so rendering still
 * succeeds (logo simply skipped). In a real browser the logo would load.
 */

const quotationInputs = {
  customer_name: "Test Co",
  quotation_no: "QT/001/26-27",
  quotation_date: "2026-06-30",
  system_title: "HYBRID 60KW",
  advance_amount: 300000,
  items: [
    { name: "Solar Panel", specifications: "RAYZON", qty: 70, unit: "Nos", rate: 11500, gst_rate: 18 },
    { name: "Inverter", qty: 1, unit: "Nos", rate: 496027, gst_rate: 5 },
  ],
  terms: "1. 75% advance",
};

const invoiceInputs = {
  invoice_number: "INV-1",
  invoice_date: "2026-06-30",
  bill_to: "Test Co\nGSTIN: 33ABCDE1234F1Z5",
  seller_state: "Tamil Nadu",
  customer_state: "Tamil Nadu",
  items: [
    { name: "Panel", hsn: "85414300", qty: 70, unit: "Nos", rate: 11500, gst_rate: 18 },
  ],
};

describe("templateEngine renderTemplate", () => {
  it("renders the quotation template to a real PDF", async () => {
    const def = quotationDef as unknown as TemplateDef;
    const doc = await renderTemplate(def, quotationInputs);

    // returns a jsPDF instance
    expect(typeof doc.save).toBe("function");
    expect(typeof doc.output).toBe("function");

    const bytes = doc.output("arraybuffer") as ArrayBuffer;
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("renders the invoice template (split GST) to a real PDF", async () => {
    const def = invoiceDef as unknown as TemplateDef;
    const doc = await renderTemplate(def, invoiceInputs);

    // returns a jsPDF instance
    expect(typeof doc.save).toBe("function");
    expect(typeof doc.output).toBe("function");

    const bytes = doc.output("arraybuffer") as ArrayBuffer;
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
