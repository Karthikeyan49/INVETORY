import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { renderTemplate, type TemplateDef } from "@/lib/templateEngine";
import quotationDef from "@/templates/quotation.template.json";

/**
 * Pagination regression: a quotation with MANY line items (several carrying
 * components) plus long terms must paginate cleanly across multiple pages —
 * the items table (autoTable) splits, and the manually-drawn totals /
 * amount-in-words / deduction / bank / signature / notes blocks must not
 * overflow the bottom margin or overlap the table on page breaks.
 */

const OUT = "/home/karthikeyan/vscode/api-EcoSudar/clone/pdf-template-studio/out/quotation-paginated.pdf";

function makeItem(i: number) {
  const heavy = i % 4 === 0; // every 4th item carries components
  return {
    name: `Line Item ${i + 1} — Solar Component Assembly`,
    specifications: `Model SX-${1000 + i}, Tier-1, mono-PERC, with detailed spec text that wraps`,
    qty: (i % 5) + 1,
    unit: "Nos",
    rate: 11500 + i * 137,
    gst_rate: i % 2 === 0 ? 18 : 5,
    ...(heavy
      ? {
          components: Array.from({ length: 4 + (i % 3) }, (_, k) => ({
            group: `Group ${k + 1}`,
            name: `Sub-part ${k + 1}`,
            make: `MakerCorp-${k}`,
            qty: k + 1,
          })),
        }
      : {}),
  };
}

const inputs = {
  customer_name: "Big Solar Enterprises Pvt Ltd",
  customer_address: "12 Industrial Estate, Phase II, Coimbatore, Tamil Nadu 641021",
  customer_gstin: "33ABCDE1234F1Z5",
  reference_no: "REF/2026/0099",
  quotation_no: "QT/030/26-27",
  quotation_date: "2026-06-30",
  system_title: "HYBRID 250KW GROUND-MOUNT",
  prepared_by_name: "Sales Team",
  prepared_by_designation: "Manager",
  prepared_by_phone: "9000000000",
  advance_amount: 300000,
  advance_date: "2026-06-25",
  items: Array.from({ length: 30 }, (_, i) => makeItem(i)),
  terms: Array.from(
    { length: 12 },
    (_, i) =>
      `${i + 1}. This is term number ${i + 1} which is intentionally long so that it wraps across multiple lines and exercises the notes pagination logic at the bottom of the document where overflow is most likely to occur.`,
  ).join("\n"),
};

describe("quotation pagination (many items + components)", () => {
  it("paginates onto multiple pages and saves a valid PDF", async () => {
    const def = quotationDef as unknown as TemplateDef;
    const doc = await renderTemplate(def, inputs);

    const pages = doc.getNumberOfPages();
    // eslint-disable-next-line no-console
    console.log("[quotationPagination] page count =", pages);
    expect(pages).toBeGreaterThanOrEqual(2);

    const bytes = doc.output("arraybuffer") as ArrayBuffer;
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(bytes));

    const size = fs.statSync(OUT).size;
    // eslint-disable-next-line no-console
    console.log("[quotationPagination] pdf bytes =", size, "->", OUT);
    expect(size).toBeGreaterThan(5000);
  });
});
