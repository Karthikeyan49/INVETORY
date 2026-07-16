/**
 * Rule-based DCR PDF parser (NO AI).
 *
 * Reads a Daily Call Report PDF (form F-SVS-01, as produced by dcrPdf.ts) fully
 * in the browser with pdf.js and returns the structured { header, lines } that
 * pre-fills the New-DCR form. Nothing is sent to any server or AI service.
 *
 * How it works: pdf.js gives every text fragment an (x, y). The header fields
 * are read by label regex; the visit-line table is reconstructed by (a) reading
 * each column's left-edge X from the header row, then (b) bucketing every data
 * fragment into a column by X and grouping wrapped lines under the row that
 * carries the leading serial number.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ExtractedDcr, DcrLine } from "./api/dcr";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface Frag { x: number; y: number; str: string }

// Header labels in table order → the DcrLine field they map to. "Staff" covers
// the "Staff Sign" column (its header wraps to a second line).
const COL_MAP: Array<{ label: string; field: keyof DcrLine }> = [
  { label: "Customer", field: "customer" },
  { label: "Address", field: "address" },
  { label: "Mobile", field: "mobile" },
  { label: "Model", field: "model" },
  { label: "Status", field: "cust_status" },
  { label: "Type", field: "cust_type" },
  { label: "Category", field: "category" },
  { label: "Stamping", field: "stamping" },
  { label: "Service", field: "service" },
  { label: "Payment", field: "payment" },
  { label: "Remarks", field: "remarks" },
  { label: "Staff", field: "staff_sign" },
];

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const num0 = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };

function normDate(s: string): string {
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); // DD/MM/YYYY or DD-MM-YY
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return "";
}

/** Group a page's fragments into visual rows (top→bottom), each sorted left→right. */
function toRows(frags: Frag[]): Frag[][] {
  const sorted = [...frags].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const rows: Frag[][] = [];
  let cur: Frag[] = [];
  let lastY: number | null = null;
  for (const f of sorted) {
    if (lastY !== null && Math.abs(f.y - lastY) > 3) { if (cur.length) rows.push(cur); cur = []; }
    cur.push(f); lastY = f.y;
  }
  if (cur.length) rows.push(cur);
  rows.forEach((r) => r.sort((a, b) => a.x - b.x));
  return rows;
}

const isHeaderRow = (r: Frag[]) => {
  const j = r.map((f) => f.str).join(" ");
  return /Customer/i.test(j) && /Mobile/i.test(j) && /Remarks/i.test(j);
};

export async function parseDcrPdf(file: File): Promise<ExtractedDcr> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: Frag[][] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const frags: Frag[] = [];
      for (const it of content.items as Array<{ str?: string; transform?: number[] }>) {
        if (typeof it.str !== "string" || it.str.trim() === "" || !it.transform) continue;
        frags.push({ x: it.transform[4], y: it.transform[5], str: it.str });
      }
      pages.push(frags);
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  if (!pages.length) throw new Error("Couldn't read this PDF.");
  return parseDcrFrags(pages);
}

/** Pure parsing step (no pdf.js) — takes per-page (x,y,str) fragments. Exported for tests. */
export function parseDcrFrags(pages: Frag[][]): ExtractedDcr {
  // ── Header (from page 1 text above the table) ──────────────────────────────
  const page1rows = toRows(pages[0]);
  const headerText = page1rows.map((r) => r.map((f) => f.str).join(" ")).join("\n");
  const g = (re: RegExp) => (headerText.match(re)?.[1] ?? "").trim();
  const header = {
    employee_name: clean(g(/Employee:\s*(.*?)(?:\s+Date:|\s+Area:|\n|$)/i)),
    report_date: normDate(g(/Date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i)),
    area: clean(g(/Area:\s*(.*?)(?:\n|$)/i)).replace(/^[—-]$/, ""),
    opening_km: num0(g(/Opening KM:\s*([\d.]+)/i)),
    closing_km: num0(g(/Closing KM:\s*([\d.]+)/i)),
    total_km: num0(g(/Total KM:\s*([\d.]+)/i)),
    notes: "",
  };

  // ── Column X positions from the (first) header row ─────────────────────────
  let headerRow: Frag[] | null = null;
  for (const r of page1rows) { if (isHeaderRow(r)) { headerRow = r; break; } }
  if (!headerRow) {
    // No table header found — return header only so the user can fill lines.
    return { header, lines: [] };
  }
  const colX: Array<{ field: keyof DcrLine; x: number }> = [];
  for (const { label, field } of COL_MAP) {
    const frag = headerRow.find((f) => f.str.trim().toLowerCase().startsWith(label.toLowerCase()));
    if (frag) colX.push({ field, x: frag.x });
  }
  colX.sort((a, b) => a.x - b.x);
  // Serial ("#") column sits left of Customer; anything left of this cutoff is
  // the row number and is ignored for cell content.
  const serialCut = colX.length ? colX[0].x - 6 : 0;
  // Interval boundaries midway between adjacent column left-edges.
  const bounds = colX.map((c, i) => ({
    field: c.field,
    lo: i === 0 ? -Infinity : (colX[i - 1].x + c.x) / 2,
    hi: i === colX.length - 1 ? Infinity : (c.x + colX[i + 1].x) / 2,
  }));
  const colFor = (x: number) => bounds.find((b) => x >= b.lo && x < b.hi)?.field ?? null;

  // ── Walk every page's rows, building records ───────────────────────────────
  const lines: DcrLine[] = [];
  let cur: Record<string, string> | null = null;
  const flush = () => {
    if (cur && (clean(cur.customer || "") || clean(cur.mobile || ""))) {
      lines.push(normalizeLine(cur));
    }
    cur = null;
  };

  for (let p = 0; p < pages.length; p++) {
    const rows = toRows(pages[p]);
    let started = false;
    for (const r of rows) {
      if (!started) { if (isHeaderRow(r)) started = true; continue; } // skip title/meta/header
      if (isHeaderRow(r)) continue;                 // repeated header on later pages
      const j = clean(r.map((f) => f.str).join(" "));
      if (j === "" || /^Sign$/i.test(j)) continue;   // header "Sign" wrap / blank
      // New record when a pure integer sits in the serial column.
      const isNew = r.some((f) => f.x < serialCut && /^\d+$/.test(f.str.trim()));
      if (isNew) { flush(); cur = {}; }
      if (!cur) continue;
      for (const f of r) {
        if (f.x < serialCut) continue;              // the row number itself
        const field = colFor(f.x);
        if (!field) continue;
        cur[field] = cur[field] ? `${cur[field]} ${f.str.trim()}` : f.str.trim();
      }
    }
  }
  flush();

  return { header, lines };
}

function normalizeLine(raw: Record<string, string>): DcrLine {
  const t = (k: string) => clean(raw[k] || "");
  const status = t("cust_status").toLowerCase();
  const type = t("cust_type").toLowerCase();
  return {
    customer: t("customer"),
    address: t("address") || null,
    mobile: t("mobile").replace(/[^0-9]/g, "") || null,
    model: t("model") || null,
    cust_status: status.includes("exist") ? "existing" : status.includes("new") ? "new" : (status || null),
    cust_type: type.includes("prospect") ? "prospect" : type.includes("customer") ? "customer" : (type || null),
    category: t("category") || null,
    stamping: t("stamping") || null,
    service: t("service") || null,
    payment: t("payment") || null,
    remarks: t("remarks") || null,
    staff_sign: t("staff_sign") || null,
  };
}
