/* eslint-disable @typescript-eslint/no-explicit-any */
/** Shared helpers for the template engine: tokens, currency, words, logo, company. */
import { getCompanyProfile } from "../companyProfile";
import fallbackLogo from "@/assets/inventory-logo.png";
import type { CompanyInfo, RGB } from "./types";

/** Inventory Management System defaults used whenever the tenant profile leaves a field blank. */
export const COMPANY_FALLBACK = {
  name: "INVENTORY MANAGEMENT SYSTEM",
  gstin: "33AUSPB5370L2ZB",
  phone: "9445531605",
  address: "Tamil Nadu, India",
  bankName: "KARUR VYSYA BANK",
  bankAccount: "1138011000000143",
  bankIfsc: "KVBL0001138",
  bankBranch: "KARUR VYSYA BANK",
  accountType: "CURRENT ACCOUNT",
  accountName: "INVENTORY MANAGEMENT SYSTEM",
} as const;

export const s = (v: any): string => (v == null ? "" : String(v).trim());
export const num = (v: any): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const pick = (...vals: any[]): string => {
  for (const v of vals) { const t = s(v); if (t) return t; }
  return "";
};
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const money = (n: any): string =>
  num(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Currency prefix for PDFs. jsPDF's built-in Helvetica/Times fonts use
// WinAnsiEncoding and have NO glyph for ₹ (U+20B9): it renders as "¹" AND
// corrupts jsPDF's string-width measurement (breaking right-alignment, which
// clips the value off the page). "Rs." is ASCII, always renders, and measures
// correctly. Use this everywhere a currency amount is drawn into a PDF.
export const CUR = "Rs. ";
export const rupees = (n: any): string => CUR + money(n);
export const trimRate = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2));
export const trimNum = (v: any): string => {
  const n = num(v);
  return Number.isInteger(n) ? String(n) : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

export function brandColor(raw?: string): RGB {
  if (!raw) return [31, 90, 58];
  const hex = raw.replace("#", "");
  const n = hex.length === 3
    ? hex.split("").map((c) => parseInt(c + c, 16))
    : [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  return (n.some(Number.isNaN) ? [31, 90, 58] : n) as RGB;
}

/** Merge the live company profile over the Inventory Management System fallback. */
export function resolveCompany(): CompanyInfo {
  const cp = getCompanyProfile();
  return {
    name: pick(cp.name === "Your Company" ? "" : cp.name, COMPANY_FALLBACK.name),
    gstin: pick(cp.gstin, COMPANY_FALLBACK.gstin),
    phone: pick(cp.phone, COMPANY_FALLBACK.phone),
    address: pick(cp.address, COMPANY_FALLBACK.address),
    bankName: pick(cp.bankName, COMPANY_FALLBACK.bankName),
    bankAccount: pick(cp.bankAccount, COMPANY_FALLBACK.bankAccount),
    bankIfsc: pick(cp.bankIfsc, COMPANY_FALLBACK.bankIfsc),
    bankBranch: pick(cp.bankBranch, COMPANY_FALLBACK.bankBranch),
    accountType: COMPANY_FALLBACK.accountType,
    accountName: pick(cp.bankName ? cp.name : "", COMPANY_FALLBACK.accountName),
    logo: cp.logo,
    primaryColor: cp.primaryColor,
  };
}

/** Resolve a dot-path against an object (a.b.c). */
function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Replace {{path}} tokens in a string against {...inputs, company}.
 * Supports filters: {{path|date}} (dd-mm-yyyy) and {{path|money}} (Indian 2dp).
 */
export function fillTokens(tpl: string, inputs: any, company: CompanyInfo): string {
  const ctx = { ...inputs, company };
  return s(tpl).replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (_, p, filter) => {
    const v = getPath(ctx, p);
    if (v == null || v === "") return "";
    if (filter === "date") return fmtDate(String(v));
    if (filter === "money") return money(v);
    return String(v);
  });
}

/** dd-mm-yyyy from an ISO-ish date; "" when blank. (Date-only token formatter.) */
export function fmtDate(d?: string | null): string {
  const v = s(d);
  if (!v) return "";
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const dt = new Date(v);
  return isNaN(dt.getTime()) ? v : dt.toLocaleDateString("en-GB").replace(/\//g, "-");
}

// ── Indian number-to-words ───────────────────────────────────────────────────
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")).trim();
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100), rest = n % 100, parts: string[] = [];
  if (h) parts.push(ONES[h] + " Hundred");
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}
export function numToWordsIndian(num0: number): string {
  let n = num0;
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const parts: string[] = [];
  if (crore) parts.push(threeDigits(crore) + " Crore");
  if (lakh) parts.push(threeDigits(lakh) + " Lakh");
  if (thousand) parts.push(threeDigits(thousand) + " Thousand");
  if (n) parts.push(threeDigits(n));
  return parts.join(" ").trim();
}
export function rupeesInWords(amount: number): string {
  const total = round2(Math.abs(num(amount)));
  const rupees = Math.floor(total);
  const paise = Math.round((total - rupees) * 100);
  let words = `Indian Rupees ${numToWordsIndian(rupees)}`;
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return words + " Only.";
}

// ── logo loading ─────────────────────────────────────────────────────────────
function logoFormat(dataUrl: string): "JPEG" | "WEBP" | "PNG" {
  if (dataUrl.startsWith("data:image/jpeg")) return "JPEG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}
export async function loadImage(srcMaybe?: string):
  Promise<{ data: string; fmt: "PNG" | "JPEG" | "WEBP"; w: number; h: number } | null> {
  const src = srcMaybe && srcMaybe.trim() ? srcMaybe : fallbackLogo;
  try {
    let dataUrl = src;
    if (!src.startsWith("data:")) {
      const blob = await (await fetch(src)).blob();
      dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    }
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth || 1079, h: im.naturalHeight || 231 });
      im.onerror = () => resolve({ w: 1079, h: 231 });
      im.src = dataUrl;
    });
    return { data: dataUrl, fmt: logoFormat(dataUrl), w: dims.w, h: dims.h };
  } catch {
    return null;
  }
}

/** Per-rate GST groups from items (missing rate → defaultRate). */
export function gstGroups(items: any[], defaultRate = 18):
  Array<{ rate: number; taxable: number; gst: number }> {
  const map = new Map<number, number>();
  for (const it of items || []) {
    const taxable = num(it.amount) || num(it.qty) * num(it.rate);
    const rate = it.gst_rate == null ? defaultRate : num(it.gst_rate);
    map.set(rate, (map.get(rate) || 0) + taxable);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0])
    .map(([rate, taxable]) => ({ rate, taxable: round2(taxable), gst: round2(taxable * rate / 100) }));
}
