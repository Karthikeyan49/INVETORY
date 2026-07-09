// Tiny localStorage-backed store for persistent autocomplete options.
//
// Each "field" (e.g. "unit", "make", "customer", "group") keeps its own list of
// previously-entered values. Values are deduped case-insensitively, trimmed, and
// blanks are ignored. Used to seed <datalist> options so dropdowns persist and
// grow as the user types new values.

const PREFIX = "quotation:fieldOptions:";

const keyFor = (field: string) => `${PREFIX}${field}`;

function read(field: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(field));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function write(field: string, values: string[]): void {
  try {
    localStorage.setItem(keyFor(field), JSON.stringify(values));
  } catch {
    /* storage may be full or unavailable — autocomplete is best-effort */
  }
}

/** Return the persisted options for a field (in insertion order). */
export function getOptions(field: string): string[] {
  return read(field);
}

/**
 * Persist a new value for a field if it isn't already present (case-insensitive,
 * trimmed). Blanks are ignored. Returns the updated list.
 */
export function addOption(field: string, value: string): string[] {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return read(field);
  const existing = read(field);
  const lower = trimmed.toLowerCase();
  if (existing.some((v) => v.trim().toLowerCase() === lower)) return existing;
  const next = [...existing, trimmed];
  write(field, next);
  return next;
}

/**
 * Merge persisted options with any seed values (e.g. from products / library /
 * existing items) and sensible defaults, deduped case-insensitively & trimmed.
 * Returns a sorted list suitable for rendering into a <datalist>.
 */
export function mergedOptions(field: string, ...seeds: (string | null | undefined)[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const v = (raw ?? "").trim();
    if (!v) return;
    const lower = v.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(v);
  };
  for (const v of getOptions(field)) push(v);
  for (const seed of seeds) for (const v of seed) push(v);
  return out.sort((a, b) => a.localeCompare(b));
}
