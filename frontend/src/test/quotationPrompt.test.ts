import { describe, it, expect } from "vitest";
import { parseQuotationPrompt } from "@/lib/quotationPrompt";
import type { UIProduct } from "@/lib/api/products";

const P = (id: number, product: string, category: string, price: number, unit: string): UIProduct =>
  ({ id, product, category, description: "", sizes: [], purposes: [], subPurposes: {}, minOrderQty: 1, imageUrl: "", _raw: { base_price: price, unit } } as unknown as UIProduct);

const products = [
  P(1, "Solar Panel N-type Topcon 625Wp", "Solar Panels", 11500, "Nos"),
  P(2, "VSOLE Hybrid Inverter 60KW", "Inverters", 496027, "Nos"),
  P(3, "DC Cable (4 sq mm)", "Accessories", 65, "Mtr"),
];

describe("parseQuotationPrompt", () => {
  it("extracts customer + items with quantities from a natural prompt", () => {
    const r = parseQuotationPrompt(
      "Quote for VELS Grand Square: 70 solar panels, 1 hybrid inverter 60kw, 100 m dc cable",
      products,
    );
    expect(r.customerName?.toLowerCase()).toContain("vels");
    const byName = Object.fromEntries(r.matches.map((m) => [m.product.id, m.qty]));
    expect(byName[1]).toBe(70);   // solar panels
    expect(byName[2]).toBe(1);    // inverter
    expect(byName[3]).toBe(100);  // dc cable
    expect(r.matches.length).toBe(3);
  });

  it("handles word-numbers and 'and' separators", () => {
    const r = parseQuotationPrompt("two inverters and five solar panels", products);
    const byName = Object.fromEntries(r.matches.map((m) => [m.product.id, m.qty]));
    expect(byName[2]).toBe(2);
    expect(byName[1]).toBe(5);
  });

  it("reports unmatched clauses without crashing", () => {
    const r = parseQuotationPrompt("3 widgets of unobtainium", products);
    expect(r.matches.length).toBe(0);
    expect(r.unmatched.length).toBeGreaterThan(0);
  });
});
