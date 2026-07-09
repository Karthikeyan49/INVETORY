/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sri Vari Scales — exact letterhead reproductions of the customer's own
 * printed formats (Tax Invoice, Cash Bill, Delivery Challan, and the four
 * Quotation formats: Retail / Industrial / Service / Stamping).
 *
 * These are hand-drawn with jsPDF primitives (boxes, rules, text) so the output
 * matches the supplied templates 1:1. Static letterhead text is baked in exactly
 * as printed; only the dynamic fields (party, numbers, dates, line items,
 * amounts) are filled from records. Page size is US Letter (612×792 pt) to match
 * the source PDFs.
 *
 * Each `build*` returns the jsPDF doc (used by the node render-harness); the
 * `download*` wrappers save it in the browser.
 */
import jsPDF from "jspdf";

// ── Brand palette (sampled from the source templates) ───────────────────────
const BLUE: [number, number, number] = [46, 117, 182];   // header + "FOR SRI VARI SCALES" on invoice/quotation
const RED: [number, number, number] = [224, 20, 20];     // big name on cash bill/DC, GSTIN, signature label
const TEAL: [number, number, number] = [95, 150, 160];   // ESSAE line + "FOR SRI VARI SCALES" on cash bill/DC
const LINK: [number, number, number] = [64, 100, 200];   // email
const AMBER: [number, number, number] = [245, 191, 80];  // quotation table header fill
const MAGENTA: [number, number, number] = [206, 0, 110]; // general-conditions section labels
const PURPLE: [number, number, number] = [112, 48, 160]; // "GENERAL CONDITION OF SALE"
const BLACK: [number, number, number] = [0, 0, 0];

// ── Company constants (verbatim from the templates) ─────────────────────────
const GSTIN = "33AGTPT3190M1ZM";
const BANK = {
  bank: "Tamilnad Mercantile Bank",
  branch: "Vanigar Street, Kanchipuram Branch",
  acno: "105700150950136",
  ifsc: "TMBL0000105",
};

const money = (v: any) =>
  Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Drawing helpers ─────────────────────────────────────────────────────────
type Doc = jsPDF;
const setC = (doc: Doc, c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
const setDraw = (doc: Doc, c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);
const setFill = (doc: Doc, c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);

function txt(
  doc: Doc, s: string, x: number, y: number,
  o: { size?: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; align?: "left" | "center" | "right" } = {},
) {
  const style = o.bold && o.italic ? "bolditalic" : o.bold ? "bold" : o.italic ? "italic" : "normal";
  doc.setFont("helvetica", style).setFontSize(o.size ?? 10);
  setC(doc, o.color ?? BLACK);
  doc.text(s, x, y, { align: o.align ?? "left" });
}

const rect = (doc: Doc, x: number, y: number, w: number, h: number) => doc.rect(x, y, w, h);
const hline = (doc: Doc, x1: number, y: number, x2: number) => doc.line(x1, y, x2, y);
const vline = (doc: Doc, x: number, y1: number, y2: number) => doc.line(x, y1, x, y2);

function newDoc(): Doc {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  doc.setLineWidth(0.9);
  setDraw(doc, BLACK);
  return doc;
}

const save = (doc: Doc, name: string) => doc.save(`${String(name).replace(/[^\w.-]+/g, "_")}.pdf`);

// ════════════════════════════════════════════════════════════════════════════
// 1. TAX INVOICE  (F/SVS/17)
// ════════════════════════════════════════════════════════════════════════════
export interface InvoiceData {
  invoiceNo?: string; date?: string;
  orderNo?: string; orderDate?: string; dcNo?: string; dcDate?: string; transport?: string;
  to?: string;                                  // buyer block (multi-line)
  model?: string; capacity?: string; accuracy?: string; machineNo?: string;
  taxPct?: number; hsn?: string; qty?: number; uom?: string; rate?: number; amount?: number;
  total?: number; taxAmount?: number; roundOff?: number; grandTotal?: number;
  advance?: number; balance?: number; amountInWords?: string;
  cgst?: number; sgst?: number; igst?: number;
}

export function buildTaxInvoice(d: InvoiceData): Doc {
  const doc = newDoc();
  const L = 30, R = 582, W = R - L;
  const cx = (L + R) / 2;

  // Above the box
  txt(doc, "ORIGINAL  FOR  BUYER", R, 34, { size: 11, bold: true, align: "right" });
  txt(doc, "TAX  INVOICE", cx, 56, { size: 12, bold: true, align: "center" });

  // Outer box
  const top = 70;
  // Header block
  txt(doc, "SRI VARI SCALES", cx, 92, { size: 20, bold: true, color: BLUE, align: "center" });
  txt(doc, "No.64-A, Salai Street, Kanchipuram – 631 502.", cx, 107, { size: 9.5, bold: true, align: "center" });
  txt(doc, "Mobile : 93450 27134", cx, 119, { size: 9.5, bold: true, align: "center" });
  txt(doc, `GSTIN : ${GSTIN}`, cx, 131, { size: 9.5, bold: true, color: RED, align: "center" });
  const hdrBottom = 140;
  hline(doc, L, hdrBottom, R);

  // TO / Inv-No-Date row
  const toBottom = 206;
  const rightColX = 372;
  vline(doc, rightColX, hdrBottom, toBottom);
  txt(doc, "TO", L + 6, hdrBottom + 14, { size: 10, bold: true });
  txt(doc, doc.splitTextToSize(d.to || "", rightColX - L - 14) as any, L + 6, hdrBottom + 28, { size: 9.5 });
  txt(doc, "Inv. No     :", rightColX + 8, hdrBottom + 26, { size: 10, bold: true });
  txt(doc, d.invoiceNo || "", rightColX + 78, hdrBottom + 26, { size: 10 });
  txt(doc, "Date        :", rightColX + 8, hdrBottom + 48, { size: 10, bold: true });
  txt(doc, d.date || "", rightColX + 78, hdrBottom + 48, { size: 10 });
  hline(doc, L, toBottom, R);

  // Order / DC / Transport row
  const orderBottom = 244;
  const dcColX = 300, transColX = 466;
  vline(doc, dcColX, toBottom, orderBottom);
  vline(doc, transColX, toBottom, orderBottom);
  txt(doc, "Order No   :", L + 6, toBottom + 15, { size: 10, bold: true });
  txt(doc, d.orderNo || "", L + 82, toBottom + 15, { size: 10 });
  txt(doc, "Order Date :", L + 6, toBottom + 30, { size: 10, bold: true });
  txt(doc, d.orderDate || "", L + 82, toBottom + 30, { size: 10 });
  txt(doc, "DC No  :", dcColX + 6, toBottom + 15, { size: 10, bold: true });
  txt(doc, d.dcNo || "", dcColX + 60, toBottom + 15, { size: 10 });
  txt(doc, "DC Date  :", dcColX + 6, toBottom + 30, { size: 10, bold: true });
  txt(doc, d.dcDate || "", dcColX + 60, toBottom + 30, { size: 10 });
  txt(doc, "Transport :", transColX + 6, toBottom + 15, { size: 10, bold: true });
  txt(doc, d.transport || "", transColX + 70, toBottom + 15, { size: 10 });
  hline(doc, L, orderBottom, R);

  // Items table header
  // cols: S.NO | PARTICULARS | TAX% | HSN CODE | QTY | UOM | RATE | AMOUNT
  const cX = [L, 70, 262, 308, 366, 408, 452, 516, R];
  const headBottom = 284;
  for (const x of cX.slice(1, -1)) vline(doc, x, orderBottom, headBottom);
  const hc = (i: number) => (cX[i] + cX[i + 1]) / 2;
  txt(doc, "S.", hc(0), orderBottom + 16, { size: 9.5, bold: true, align: "center" });
  txt(doc, "NO", hc(0), orderBottom + 30, { size: 9.5, bold: true, align: "center" });
  txt(doc, "PARTICULARS", hc(1), orderBottom + 23, { size: 10, bold: true, align: "center" });
  txt(doc, "TAX", hc(2), orderBottom + 16, { size: 9.5, bold: true, align: "center" });
  txt(doc, "%", hc(2), orderBottom + 30, { size: 9.5, bold: true, align: "center" });
  txt(doc, "HSN", hc(3), orderBottom + 16, { size: 9.5, bold: true, align: "center" });
  txt(doc, "CODE", hc(3), orderBottom + 30, { size: 9.5, bold: true, align: "center" });
  txt(doc, "QTY", hc(4), orderBottom + 23, { size: 9.5, bold: true, align: "center" });
  txt(doc, "UOM", hc(5), orderBottom + 23, { size: 9.5, bold: true, align: "center" });
  txt(doc, "RATE", hc(6), orderBottom + 23, { size: 9.5, bold: true, align: "center" });
  txt(doc, "AMOUNT", hc(7), orderBottom + 23, { size: 9.5, bold: true, align: "center" });
  hline(doc, L, headBottom, R);

  // Item row
  const itemBottom = 430;
  for (const x of cX.slice(1, -1)) vline(doc, x, headBottom, itemBottom);
  txt(doc, "1.", hc(0), headBottom + 42, { size: 10, bold: true, align: "center" });
  let py = headBottom + 20;
  txt(doc, "ELECTRONIC WEIGHING SCALE", cX[1] + 6, py, { size: 9.5, bold: true });
  py += 22;
  for (const [lbl, val] of [["MODEL", d.model], ["CAPACITY", d.capacity], ["ACCURACY", d.accuracy], ["MACHINE NO", d.machineNo]] as [string, string | undefined][]) {
    txt(doc, `${lbl.padEnd(11, " ")}:`, cX[1] + 6, py, { size: 9.5, bold: true });
    if (val) txt(doc, String(val), cX[1] + 92, py, { size: 9.5 });
    py += 17;
  }
  const midY = (headBottom + itemBottom) / 2 + 4;
  txt(doc, d.taxPct != null ? `${d.taxPct}%` : "18%", hc(2), midY, { size: 10, bold: true, align: "center" });
  txt(doc, d.hsn || "", hc(3), midY, { size: 10, align: "center" });
  txt(doc, d.qty != null ? String(d.qty) : "NO", hc(4), midY, { size: 10, align: "center" });
  txt(doc, d.uom || "-", hc(5), midY, { size: 10, align: "center" });
  txt(doc, d.rate != null ? money(d.rate) : ".00", cX[7] - 6, midY, { size: 10, bold: true, align: "right" });
  txt(doc, money(d.amount), R - 6, midY, { size: 10, bold: true, align: "right" });
  hline(doc, L, itemBottom, R);

  // E&OE / Total M/C Qty / TOTAL row
  const eoeBottom = 464;
  // dividers: after E&OE cell, and the RATE|AMOUNT columns keep their verticals
  vline(doc, cX[3], itemBottom, eoeBottom);  // right of HSN ~ boundary for "Total M/C Qty" area
  vline(doc, cX[6], itemBottom, eoeBottom);  // start of TOTAL amount region
  txt(doc, "E& OE.", L + 6, itemBottom + 20, { size: 10, bold: true });
  txt(doc, "Total M/C Qty", cX[3] + 8, itemBottom + 20, { size: 10, bold: true });
  txt(doc, "TOTAL", (cX[6] + cX[7]) / 2 + 6, itemBottom + 21, { size: 11, bold: true, align: "center" });
  txt(doc, money(d.total), R - 6, itemBottom + 21, { size: 11, bold: true, align: "right" });
  hline(doc, L, eoeBottom, R);

  // GST breakdown (left) + Tax/RoundOff/Grand (right, 3 rows)
  const sumX = 400;                       // divider between GST text and summary labels
  const sumValX = 512;                    // divider between summary label and value
  const gstBottom = 560;
  const r1 = eoeBottom + 34, r2 = eoeBottom + 66, r3 = eoeBottom + 96;
  vline(doc, sumX, eoeBottom, gstBottom);
  vline(doc, sumValX, eoeBottom, gstBottom);
  hline(doc, sumX, r1, R);
  hline(doc, sumX, r2, R);
  const cg = money(d.cgst ?? 0), sg = money(d.sgst ?? 0), ig = d.igst ? money(d.igst) : "0";
  txt(doc, `GST 18% ${money(d.taxAmount)},(CGST@ 9% ${cg}, SGST 9% ${sg},`, L + 6, eoeBottom + 26, { size: 9.5 });
  txt(doc, `IGST@ ${ig})`, L + 6, eoeBottom + 48, { size: 9.5 });
  txt(doc, "Tax Amount", sumX + 8, r1 - 10, { size: 10, bold: true });
  txt(doc, money(d.taxAmount), R - 6, r1 - 10, { size: 10, align: "right" });
  txt(doc, "Round Off", sumX + 8, r2 - 10, { size: 10, bold: true });
  txt(doc, money(d.roundOff ?? 0), R - 6, r2 - 10, { size: 10, align: "right" });
  txt(doc, "Grand Total", sumX + 8, r3 - 8, { size: 10, bold: true });
  txt(doc, money(d.grandTotal ?? d.total), R - 6, r3 - 8, { size: 10, align: "right" });
  hline(doc, L, gstBottom, R);

  // Bank details (left) + Advance/Balance (right)
  const bankBottom = 616;
  const abMid = (gstBottom + bankBottom) / 2;
  vline(doc, sumX, gstBottom, bankBottom);
  vline(doc, sumValX, gstBottom, bankBottom);
  hline(doc, sumX, abMid, R);
  txt(doc, `Bank    : ${BANK.bank}`, L + 6, gstBottom + 18, { size: 9.5, bold: true });
  txt(doc, `Branch : ${BANK.branch}`, L + 6, gstBottom + 33, { size: 9.5, bold: true });
  txt(doc, `A/C No : ${BANK.acno}, IFSC : ${BANK.ifsc}`, L + 6, gstBottom + 48, { size: 9.5, bold: true });
  txt(doc, "Advance :", sumX + 8, gstBottom + 26, { size: 10, bold: true });
  txt(doc, money(d.advance ?? 0), R - 6, gstBottom + 26, { size: 10, align: "right" });
  txt(doc, "Balance :", sumX + 8, abMid + 20, { size: 10, bold: true });
  txt(doc, money(d.balance ?? 0), R - 6, abMid + 20, { size: 10, align: "right" });
  hline(doc, L, bankBottom, R);

  // Rupees in words
  const wordsBottom = 648;
  txt(doc, `RUPEES:   ${(d.amountInWords || "RUPEES").toUpperCase()} ONLY.`, L + 6, bankBottom + 20, { size: 10, bold: true });
  hline(doc, L, wordsBottom, R);

  // Signature row
  const signBottom = 726;
  vline(doc, sumX, wordsBottom, signBottom);
  txt(doc, "FOR SRI VARI SCALES", (sumX + R) / 2, wordsBottom + 34, { size: 11, bold: true, color: BLUE, align: "center" });

  // Outer border last (so it sits on top cleanly)
  rect(doc, L, top, W, signBottom - top);
  txt(doc, "(F/SVS/17)", L, signBottom + 14, { size: 9, italic: true });
  return doc;
}
export function downloadTaxInvoice(d: InvoiceData): void { save(buildTaxInvoice(d), d.invoiceNo || "TAX-INVOICE"); }

// ════════════════════════════════════════════════════════════════════════════
// 2. CASH BILL  (F/SVS/34)
// ════════════════════════════════════════════════════════════════════════════
export interface CashBillData {
  refNo?: string; date?: string; to?: string; cellNo?: string;
  description?: string; qty?: string; amount?: number; total?: number;
}
export function buildCashBill(d: CashBillData): Doc {
  const doc = newDoc();
  const L = 60, R = 552, cx = (L + R) / 2;

  // "CASH BILL" boxed label
  const lblW = 92;
  setDraw(doc, BLACK); doc.setLineWidth(0.8);
  rect(doc, cx - lblW / 2, 30, lblW, 22);
  txt(doc, "CASH BILL", cx, 45, { size: 11, bold: true, color: BLUE, align: "center" });

  // Big red name + address
  txt(doc, "SRI VARI SCALES", cx, 92, { size: 30, bold: true, color: RED, align: "center" });
  txt(doc, "No.1D, vanigar street,(Anna Arangam back side),", cx, 112, { size: 9.5, align: "center" });
  txt(doc, "Kanchipuram-631 502.  Cell no:9345027134,9865668414", cx, 125, { size: 9.5, align: "center" });
  txt(doc, "Email Id:srivariscale@gmail.com", cx, 138, { size: 9.5, color: LINK, align: "center" });

  // Ref / Date
  txt(doc, `Ref. No.  ${d.refNo || "F/SVS/34"}`, L + 8, 168, { size: 10, bold: true });
  txt(doc, `Date: ${d.date || "00.00.2026"}`, R, 168, { size: 10, bold: true, align: "right" });

  // TO box
  const toTop = 182, toBottom = 236;
  rect(doc, L, toTop, R - L, toBottom - toTop);
  txt(doc, "TO:", L + 8, toTop + 16, { size: 10, bold: true });
  txt(doc, d.to || "", L + 34, toTop + 16, { size: 10 });
  txt(doc, "CELL NO :", L + 40, toBottom - 10, { size: 10, bold: true });
  txt(doc, d.cellNo || "", L + 108, toBottom - 10, { size: 10 });

  // Items table: S.NO | DESCRIPTION | QTY | AMOUNT
  const tTop = toBottom + 12;
  const cX = [L, L + 62, 400, 470, R];
  const headB = tTop + 30, bodyB = tTop + 210;
  rect(doc, L, tTop, R - L, bodyB - tTop);
  for (const x of cX.slice(1, -1)) vline(doc, x, tTop, bodyB);
  hline(doc, L, headB, R);
  const hc = (i: number) => (cX[i] + cX[i + 1]) / 2;
  txt(doc, "S.NO.", hc(0), tTop + 20, { size: 10, bold: true, align: "center" });
  txt(doc, "DESCRIPTION", hc(1), tTop + 20, { size: 10, bold: true, align: "center" });
  txt(doc, "QTY", hc(2), tTop + 20, { size: 10, bold: true, align: "center" });
  txt(doc, "AMOUNT", hc(3), tTop + 20, { size: 10, bold: true, align: "center" });
  txt(doc, "1.", hc(0), headB + 44, { size: 10, bold: true, align: "center" });
  txt(doc, d.description || "ELECTRONIC WEIGHING SCALE SERVICE", cX[1] + 8, headB + 24, { size: 9.5, bold: true });
  txt(doc, d.qty || "1NO", hc(2), headB + 44, { size: 10, bold: true, align: "center" });
  txt(doc, money(d.amount), hc(3), headB + 44, { size: 10, bold: true, align: "center" });
  // subtotal line near lower part of amount column
  const subY = headB + 140;
  hline(doc, cX[2], subY, R);
  txt(doc, money(d.total ?? d.amount), hc(3), subY + 16, { size: 10, bold: true, align: "center" });
  hline(doc, cX[2], subY + 28, R);

  // Signatures
  txt(doc, "CUSTOMER 'S SIGNATURE", L, bodyB + 70, { size: 10, bold: true, color: RED });
  txt(doc, "FOR SRI VARI SCALES", R, bodyB + 70, { size: 10, bold: true, color: TEAL, align: "right" });
  return doc;
}
export function downloadCashBill(d: CashBillData): void { save(buildCashBill(d), d.refNo || "CASH-BILL"); }

// ════════════════════════════════════════════════════════════════════════════
// 3. DELIVERY CHALLAN  (F/SVS/18)
// ════════════════════════════════════════════════════════════════════════════
export interface ChallanData {
  refNo?: string; date?: string; to?: string; cellNo?: string;
  model?: string; capacity?: string; accuracy?: string; platformSize?: string; machineNo?: string;
  qty?: string; amount?: number; total?: number;
}
export function buildDeliveryChallan(d: ChallanData): Doc {
  const doc = newDoc();
  const L = 60, R = 552, cx = (L + R) / 2;

  // "DELIVERY CHALLAN" boxed label
  const lblW = 150;
  setFill(doc, [223, 237, 242]);
  rect(doc, cx - lblW / 2, 24, lblW, 22);
  doc.rect(cx - lblW / 2, 24, lblW, 22, "FD");
  txt(doc, "DELIVERY CHALLAN", cx, 39, { size: 11, bold: true, align: "center" });

  // ESSAE lines
  txt(doc, "ESSAE-TERAOKA PRIVATE LIMITED", cx, 62, { size: 13, bold: true, color: TEAL, align: "center" });
  txt(doc, "(An Indo-Japanese joint venture)", cx, 76, { size: 9, align: "center" });
  txt(doc, "Authorised Dealer", cx, 89, { size: 9, align: "center" });

  // Big red name + address
  txt(doc, "SRI VARI SCALES", cx, 124, { size: 28, bold: true, color: RED, align: "center" });
  txt(doc, "No.1D, vanigar street, (Anna Arangam back side),", cx, 143, { size: 9.5, align: "center" });
  txt(doc, "Kanchipuram- 631 502.  Cell no: 9345027134, 9865668414", cx, 156, { size: 9.5, align: "center" });
  txt(doc, "Email Id:srivariscale@gmail.com", cx, 169, { size: 9.5, color: LINK, align: "center" });

  // Ref / Date
  txt(doc, `Ref. No. ${d.refNo || "F/SVS/18"}`, L + 8, 196, { size: 10, bold: true });
  txt(doc, `Date: ${d.date || "00-00-2026"}`, R, 196, { size: 10, bold: true, align: "right" });

  // TO box
  const toTop = 210, toBottom = 268;
  rect(doc, L, toTop, R - L, toBottom - toTop);
  txt(doc, "TO:", L + 8, toTop + 16, { size: 10, bold: true });
  txt(doc, d.to || "", L + 34, toTop + 16, { size: 10 });
  txt(doc, "CELL NO:", L + 40, toBottom - 10, { size: 10, bold: true });
  txt(doc, d.cellNo || "", L + 104, toBottom - 10, { size: 10 });

  // Items table: S.NO | DESCRIPTION | QTY | AMOUNT
  const tTop = toBottom + 12;
  const cX = [L, L + 62, 400, 470, R];
  const headB = tTop + 30, bodyB = tTop + 210;
  rect(doc, L, tTop, R - L, bodyB - tTop);
  for (const x of cX.slice(1, -1)) vline(doc, x, tTop, bodyB);
  hline(doc, L, headB, R);
  const hc = (i: number) => (cX[i] + cX[i + 1]) / 2;
  txt(doc, "S.NO.", hc(0), tTop + 20, { size: 10, bold: true, align: "center" });
  txt(doc, "DESCRIPTION", hc(1), tTop + 20, { size: 10, bold: true, align: "center" });
  txt(doc, "QTY", hc(2), tTop + 20, { size: 10, bold: true, align: "center" });
  txt(doc, "AMOUNT", hc(3), tTop + 20, { size: 10, bold: true, align: "center" });
  txt(doc, "1.", hc(0), headB + 40, { size: 10, bold: true, align: "center" });
  let py = headB + 20;
  txt(doc, "ELECTRONIC WEIGHING SCALE", cX[1] + 8, py, { size: 9.5, bold: true });
  py += 20;
  for (const [lbl, val] of [["MODEL", d.model], ["CAPACITY", d.capacity], ["ACCURACY", d.accuracy], ["PLATFORM SIZE", d.platformSize], ["MACHINE NO", d.machineNo]] as [string, string | undefined][]) {
    txt(doc, `${lbl.padEnd(13, " ")}:`, cX[1] + 12, py, { size: 9, bold: true });
    if (val) txt(doc, String(val), cX[1] + 110, py, { size: 9 });
    py += 15;
  }
  txt(doc, d.qty || "1NO", hc(2), headB + 40, { size: 10, bold: true, align: "center" });
  txt(doc, money(d.amount ?? 0), hc(3), headB + 40, { size: 10, bold: true, align: "center" });
  const subY = headB + 140;
  hline(doc, cX[2], subY, R);
  txt(doc, money(d.total ?? d.amount ?? 0), hc(3), subY + 16, { size: 10, bold: true, align: "center" });
  hline(doc, cX[2], subY + 28, R);

  // Signatures
  txt(doc, "CUSTOMER 'S SIGNATURE", L, bodyB + 70, { size: 10, bold: true, color: RED });
  txt(doc, "FOR SRI VARI SCALES", R, bodyB + 70, { size: 10, bold: true, color: TEAL, align: "right" });
  return doc;
}
export function downloadDeliveryChallan(d: ChallanData): void { save(buildDeliveryChallan(d), d.refNo || "DELIVERY-CHALLAN"); }

// re-export brand bits the quotation module (below) reuses
export const _brand = { BLUE, RED, TEAL, LINK, AMBER, MAGENTA, PURPLE, BLACK, GSTIN, BANK, money, txt, rect, hline, vline, newDoc, save, setFill, setDraw };
