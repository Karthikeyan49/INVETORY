import { describe, it, expect } from "vitest";
import { expandKit, DEFAULT_KIT_RULES } from "@/lib/quotationKit";
import type { UIProduct } from "@/lib/api/products";

const P = (id: number, product: string, category: string, price: number): UIProduct =>
  ({ id, product, category, description: "", sizes: [], purposes: [], subPurposes: {}, minOrderQty: 1, imageUrl: "", _raw: { base_price: price, unit: "Nos" } } as unknown as UIProduct);

const catalog = [
  P(1, "Solar Panel N-type Topcon 625Wp", "Solar Panels", 11500),
  P(2, "VSOLE Hybrid Inverter 60KW", "Inverters", 496027),
  P(3, "Mounting Structure (per kW)", "Accessories", 3500),
  P(4, "DC Cable (4 sq mm)", "Accessories", 65),
];

describe("expandKit", () => {
  it("expands a panel into companion products + components", () => {
    const exp = expandKit([{ product: catalog[0], qty: 10 }], catalog, [], DEFAULT_KIT_RULES);
    const ids = exp.extraItems.map((e) => e.product.id).sort();
    expect(ids).toContain(2); // inverter
    expect(ids).toContain(3); // mounting
    expect(ids).toContain(4); // dc cable
    // dc cable is perUnit:2 → 2 * 10 panels = 20
    expect(exp.extraItems.find((e) => e.product.id === 4)?.qty).toBe(20);
    const comps = exp.itemComponents.map((c) => c.name);
    expect(comps).toEqual(expect.arrayContaining(["Earthing Kit", "ACDB", "Lightning Arrestor"]));
    exp.itemComponents.forEach((c) => expect(c.mainName).toMatch(/Solar Panel/));
  });

  it("does not double-add a companion already present", () => {
    // inverter already in the quote → should not be re-added as a companion
    const exp = expandKit(
      [{ product: catalog[0], qty: 1 }, { product: catalog[1], qty: 1 }],
      catalog, [], DEFAULT_KIT_RULES,
    );
    expect(exp.extraItems.map((e) => e.product.id)).not.toContain(2);
  });

  it("returns nothing for a product with no matching rule", () => {
    const exp = expandKit([{ product: P(9, "Office Chair", "Furniture", 5000), qty: 1 }], catalog, [], DEFAULT_KIT_RULES);
    expect(exp.extraItems.length).toBe(0);
    expect(exp.itemComponents.length).toBe(0);
  });
});
