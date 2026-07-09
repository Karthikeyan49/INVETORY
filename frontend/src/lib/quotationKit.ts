/**
 * Quotation "kit" reasoning — runs 100% in the browser (no backend, no AI model).
 *
 * Small rule-based reasoning: when a quotation line is a known main product
 * (e.g. a solar panel), expand it into the companion PRODUCTS it needs as extra
 * line items (inverter, mounting, cable …) and the COMPONENTS to attach to it
 * (earthing kit, ACDB, lightning arrestor …). The rules are editable in the UI
 * (persisted to localStorage), so prerequisites are configured in the frontend.
 *
 * This is the lightweight, deterministic alternative to an in-browser LLM for the
 * narrow job of "main product → required companions" off a known catalog.
 */
import type { UIProduct } from "./api/products";
import type { LibraryComponent } from "./api/components";

export interface KitProductAdd {
  query: string;       // catalog product to look for (fuzzy by name/category)
  qty: number;         // base quantity
  perUnit?: boolean;   // if true, qty is multiplied by the main item's quantity
}
export interface KitComponentAdd {
  name: string;        // component name (matched against the library, else added as-is)
  make?: string;
  qty: number;
  perUnit?: boolean;
}
export interface KitRule {
  id: string;
  name: string;                  // human label shown in the editor
  enabled?: boolean;
  whenNameIncludes?: string;     // lower-cased substring match on the main product name
  whenCategoryIncludes?: string; // lower-cased substring match on the main product category
  productAdds?: KitProductAdd[];
  componentAdds?: KitComponentAdd[];
}

const STORAGE_KEY = "quotation_kit_rules_v1";

/** Sensible default rules (solar). Fully editable/removable in the UI. */
export const DEFAULT_KIT_RULES: KitRule[] = [
  {
    id: "solar-panel-system",
    name: "Solar panel → system companions",
    enabled: true,
    whenNameIncludes: "panel",
    whenCategoryIncludes: "panel",
    productAdds: [
      { query: "inverter", qty: 1 },
      { query: "mounting structure", qty: 1 },
      { query: "dc cable", qty: 2, perUnit: true },
    ],
    componentAdds: [
      { name: "Earthing Kit", qty: 1 },
      { name: "ACDB", qty: 1 },
      { name: "Lightning Arrestor", qty: 1 },
    ],
  },
  {
    id: "inverter-protection",
    name: "Inverter → protection",
    enabled: true,
    whenNameIncludes: "inverter",
    componentAdds: [{ name: "ACDB", qty: 1 }],
  },
];

export function loadKitRules(): KitRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_KIT_RULES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_KIT_RULES;
  } catch {
    return DEFAULT_KIT_RULES;
  }
}
export function saveKitRules(rules: KitRule[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)); } catch { /* ignore */ }
}
export function resetKitRules(): KitRule[] {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return DEFAULT_KIT_RULES;
}

// ── matching helpers ─────────────────────────────────────────────────────────
const norm = (s: string) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length >= 2);

/** Best catalog product for a free-text query (token overlap, 0 if weak). */
function findProduct(query: string, catalog: UIProduct[]): UIProduct | null {
  const q = tokens(query);
  if (!q.length) return null;
  let best: { p: UIProduct; score: number } | null = null;
  for (const p of catalog) {
    const pt = new Set([...tokens(p.product), ...tokens(p.category || "")]);
    let hit = 0;
    for (const t of q) {
      if (pt.has(t)) hit += 1;
      else { for (const x of pt) { if (x.length >= 4 && (x.startsWith(t) || t.startsWith(x))) { hit += 0.7; break; } } }
    }
    const score = hit / q.length;
    if (!best || score > best.score) best = { p, score };
  }
  return best && best.score >= 0.5 ? best.p : null;
}

export interface KitExpansion {
  /** companion products to append as new line items */
  extraItems: Array<{ product: UIProduct; qty: number }>;
  /** components to attach (grouped by the main line they belong to) */
  itemComponents: Array<{ mainName: string; group?: string; name: string; make?: string; qty: number }>;
  notes: string[];
}

/**
 * Expand matched main products into their required companions per the rules.
 * `present` = product ids already in the quotation (so we don't double-add).
 */
export function expandKit(
  mains: Array<{ product: UIProduct; qty: number }>,
  catalog: UIProduct[],
  _components: LibraryComponent[],
  rules: KitRule[],
): KitExpansion {
  const presentIds = new Set(mains.map((m) => m.product.id));
  const extraById = new Map<number, { product: UIProduct; qty: number }>();
  const itemComponents: KitExpansion["itemComponents"] = [];
  const notes: string[] = [];

  for (const main of mains) {
    const nameL = norm(main.product.product);
    const catL = norm(main.product.category || "");
    for (const rule of rules) {
      if (rule.enabled === false) continue;
      const nameOk = rule.whenNameIncludes ? nameL.includes(norm(rule.whenNameIncludes)) : false;
      const catOk = rule.whenCategoryIncludes ? catL.includes(norm(rule.whenCategoryIncludes)) : false;
      if (!nameOk && !catOk) continue;

      for (const add of rule.productAdds || []) {
        const found = findProduct(add.query, catalog);
        if (!found) { notes.push(`No catalog product for "${add.query}"`); continue; }
        if (presentIds.has(found.id)) continue;            // already in the quote
        const qty = Math.max(1, add.perUnit ? add.qty * main.qty : add.qty);
        const prev = extraById.get(found.id);
        extraById.set(found.id, { product: found, qty: Math.max(prev?.qty || 0, qty) });
      }
      for (const c of rule.componentAdds || []) {
        itemComponents.push({
          mainName: main.product.product,
          group: rule.name,
          name: c.name, make: c.make,
          qty: Math.max(1, c.perUnit ? c.qty * main.qty : c.qty),
        });
      }
    }
  }
  return { extraItems: [...extraById.values()], itemComponents, notes };
}
