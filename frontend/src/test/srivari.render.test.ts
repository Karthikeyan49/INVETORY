/**
 * Render harness (not a real assertion test): writes each Sri Vari Scales
 * template to disk so it can be rasterised and eyeballed against the source PDFs.
 * Output dir is overridable via SRIVARI_OUT.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import {
  buildTaxInvoice, buildCashBill, buildDeliveryChallan,
} from "@/lib/srivariScalesPdf";
import { buildQuotation } from "@/lib/srivariQuotationPdf";

const OUT = process.env.SRIVARI_OUT || "/tmp/srivari_out";

function write(name: string, doc: { output: (t: string) => ArrayBuffer }) {
  const bytes = doc.output("arraybuffer");
  writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(bytes));
  return bytes.byteLength;
}

describe("Sri Vari templates render", () => {
  it("writes all seven", () => {
    mkdirSync(OUT, { recursive: true });
    // Blank forms (match the supplied source templates 1:1)
    write("INVOICE", buildTaxInvoice({}) as any);
    write("CASH_BILL", buildCashBill({}) as any);
    write("DC", buildDeliveryChallan({}) as any);
    write("RETAIL_QUOTATION", buildQuotation({}, "retail") as any);
    write("INDUSTRIAL_QUOTATION", buildQuotation({}, "industrial") as any);
    write("SERVICE_QUOTATION", buildQuotation({}, "service") as any);
    write("STAMPING_QUOTATION", buildQuotation({}, "stamping") as any);

    // Filled variants — confirm dynamic values land in the right cells.
    write("INVOICE_FILLED", buildTaxInvoice({
      invoiceNo: "SVS/25-26/017", date: "10/07/2026", orderNo: "PO-991", orderDate: "01/07/2026",
      dcNo: "F/SVS/18", dcDate: "05/07/2026", transport: "Self",
      to: "M/s. Anand Traders\nGandhi Road, Kanchipuram\nGSTIN 33ABCDE1234F1Z5",
      model: "DS-415", capacity: "100 kg", accuracy: "10 g", machineNo: "SN-7781",
      taxPct: 18, hsn: "84239010", qty: 1, uom: "No", rate: 25000, amount: 25000,
      total: 25000, taxAmount: 4500, grandTotal: 29500, advance: 10000, balance: 19500,
      cgst: 2250, sgst: 2250, igst: 0, amountInWords: "Twenty Nine Thousand Five Hundred",
    }) as any);
    write("SERVICE_QUOTATION_FILLED", buildQuotation({
      to: "M/s. Anand Traders\nKanchipuram", refNo: "44", date: "10.07.2026",
      rows: [{ description: "Load cell replacement + calibration", qty: "1", basicPrice: 3500 }], total: 3500,
    }, "service") as any);
    expect(true).toBe(true);
  });
});
