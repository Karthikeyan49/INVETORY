import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// True when nothing in `options` roughly matches `query` — used so Enter closes a
// searchable combobox (same as Escape / clicking outside) instead of doing nothing
// when there's no suggestion to select.
export function noComboboxMatch(query: string, options: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return !options.some((o) => o.toLowerCase().includes(q));
}
