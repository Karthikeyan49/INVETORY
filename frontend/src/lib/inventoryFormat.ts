/**
 * Shared formatting helpers for the Smart Inventory pages.
 * ₹ Indian number formatting + DD/MM/YYYY HH:mm dates, per the module's UI rules.
 */
export const num = (n: unknown): number => Number(n ?? 0);

export const inr = (n: unknown): string =>
  `₹${num(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const inr0 = (n: unknown): string =>
  `₹${num(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const qty = (n: unknown): string =>
  num(n).toLocaleString("en-IN", { maximumFractionDigits: 3 });

/** DD/MM/YYYY HH:mm — empty string for missing/invalid dates. */
export const formatDateTime = (value: unknown): string => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** DD/MM/YYYY — date only. */
export const formatDate = (value: unknown): string => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** Severity / risk → chip classes shared across intelligence + approvals. */
export const severityChip: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700",
  HIGH: "bg-orange-100 text-orange-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
  WRITE_OFF_CANDIDATE: "bg-red-100 text-red-700",
  DEAD: "bg-orange-100 text-orange-700",
  SLOW_MOVING: "bg-amber-100 text-amber-700",
};
