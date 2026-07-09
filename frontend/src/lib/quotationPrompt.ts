/**
 * Prompt → quotation parser (runs 100% in the browser, NO backend, NO AI model).
 *
 * Turns a free-text request like:
 *   "Quote for VELS Grand Square: 70 solar panels, 1 hybrid inverter 60kw, 100 m dc cable"
 * into line items matched against the loaded product catalog + an extracted
 * customer name.
 *
 * Approach (deterministic, instant, offline): tokenize the prompt, split it into
 * clauses, pull a quantity out of each clause, and fuzzy-match the remaining
 * words to a product by token overlap + substring scoring. This is the practical
 * alternative to shipping an in-browser LLM (WebLLM / Transformers.js) for the
 * narrow job of mapping a request onto a known product list.
 */
import type { UIProduct } from "./api/products";

export interface PromptMatch {
  product: UIProduct;
  qty: number;
  source: string;   // the clause this came from
  score: number;
}
export interface ParsedQuotation {
  customerName?: string;
  matches: PromptMatch[];
  unmatched: string[];  // clauses that mentioned something but matched no product
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "and", "with", "qty", "quantity", "nos",
  "no", "pcs", "pc", "unit", "units", "set", "sets", "x", "each", "quote",
  "quotation", "please", "need", "want", "give", "make", "add", "include",
  "customer", "client", "company", "ms", "m/s", "mr", "mrs",
]);

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, fifteen: 15, twenty: 20,
  fifty: 50, hundred: 100,
};

// Tokens that carry no product meaning (quantities / bare units) — ignored when
// scoring a clause against a product so a short clause like "two inverters"
// still matches on its one real content word.
const UNIT_TOKENS = new Set(["m", "mtr", "mtrs", "meter", "meters", "kg", "kgs", "ltr", "ltrs", "l", "w", "wp", "kwp", "watt", "watts"]);
const isContentToken = (t: string) =>
  t.length >= 2 && !/^\d/.test(t) && WORD_NUMBERS[t] == null && !UNIT_TOKENS.has(t);

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s.]/gu, " ").replace(/\s+/g, " ").trim();

function tokenize(s: string): string[] {
  return norm(s).split(" ").filter((t) => t && !STOPWORDS.has(t));
}

/** First quantity in a clause: digits ("70", "2.5") or a number word ("two"). */
function extractQty(clause: string): number {
  const digit = clause.match(/(\d+(?:\.\d+)?)/);
  if (digit) return Math.max(0, parseFloat(digit[1]));
  for (const w of norm(clause).split(" ")) {
    if (WORD_NUMBERS[w] != null) return WORD_NUMBERS[w];
  }
  return 1; // default: one
}

/**
 * Score a clause against a product (0..1+). Scored against the clause's CONTENT
 * tokens (quantities/units removed) so a short clause matches on its real words:
 * fraction of clause content words covered by the product's tokens, + a bonus
 * when the clause contains the full product name.
 */
function scoreProduct(clauseTokens: string[], clauseNorm: string, p: UIProduct): number {
  const content = clauseTokens.filter(isContentToken);
  if (content.length === 0) return 0;
  const prodTokens = new Set([...tokenize(p.product), ...tokenize(p.category || "")].filter(isContentToken));
  if (prodTokens.size === 0) return 0;

  let covered = 0;
  for (const t of content) {
    if (prodTokens.has(t)) { covered += 1; continue; }
    // partial token (e.g. "panels" vs "panel", "inverters" vs "inverter")
    for (const pt of prodTokens) {
      if (pt.length >= 4 && (pt.startsWith(t) || t.startsWith(pt))) { covered += 0.7; break; }
    }
  }
  let score = covered / content.length;     // how much of the request the product covers
  const nameNorm = norm(p.product);
  if (clauseNorm.includes(nameNorm)) score += 0.4;   // clause spells out the full product name
  return score;
}

/** Pull a likely customer name from the prompt (for/to/M-S/customer …). */
function extractCustomer(prompt: string): string | undefined {
  const patterns = [
    /\b(?:quote|quotation)\s+(?:for|to)\s+([^,;:.\n]+)/i,
    /\bfor\s+(?:m\/s\.?\s*)?([A-Z][^,;:.\n]*?)(?=[,;:.\n]|\s+\d|\s+with\b|$)/,
    /\b(?:m\/s\.?|customer|client)\s*[:\-]?\s*([^,;:.\n]+)/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m && m[1]) {
      const name = m[1].trim().replace(/\s+/g, " ");
      // reject if it's actually a product/qty fragment
      if (name.length >= 2 && !/^\d/.test(name) && name.split(" ").length <= 8) return name;
    }
  }
  return undefined;
}

export function parseQuotationPrompt(prompt: string, products: UIProduct[]): ParsedQuotation {
  const customerName = extractCustomer(prompt);

  // Remove a leading "quote for X:" / "for X," so the customer isn't parsed as an item.
  let body = prompt;
  if (customerName) {
    body = body.replace(new RegExp(customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  }

  // Split into clauses on commas / semicolons / newlines / " and " / " + ".
  const clauses = body
    .split(/[\n,;]+|\s+\+\s+|\s+\band\b\s+/i)
    .map((c) => c.trim())
    .filter((c) => c && /[a-z]/i.test(c));

  const matches: PromptMatch[] = [];
  const unmatched: string[] = [];

  for (const clause of clauses) {
    const clauseNorm = norm(clause);
    const tokens = tokenize(clause);
    if (tokens.length === 0) continue;

    let best: { p: UIProduct; score: number } | null = null;
    for (const p of products) {
      const score = scoreProduct(tokens, clauseNorm, p);
      if (!best || score > best.score) best = { p, score };
    }

    if (best && best.score >= 0.5) {
      matches.push({ product: best.p, qty: extractQty(clause), source: clause.trim(), score: round2(best.score) });
    } else if (tokens.some((t) => t.length >= 3)) {
      unmatched.push(clause.trim());
    }
  }

  return { customerName, matches, unmatched };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
