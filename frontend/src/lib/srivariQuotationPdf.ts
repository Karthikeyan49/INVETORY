/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sri Vari Scales — the four Quotation formats (Retail / Industrial / Service /
 * Stamping), reproduced from the customer's printed templates. Shared header,
 * FROM/TO block, commercial terms, bank box and footer; the differences
 * (table columns, subject line, commercial terms, second-page General
 * Conditions) are driven by the per-kind config below.
 */
import jsPDF from "jspdf";

type RGB = [number, number, number];
const BLUE: RGB = [46, 117, 182];
const RED: RGB = [224, 20, 20];
const AMBER: RGB = [245, 191, 80];
const MAGENTA: RGB = [206, 0, 110];
const PURPLE: RGB = [112, 48, 160];
const BLACK: RGB = [0, 0, 0];
const LINK: RGB = [64, 100, 200];

const GSTIN = "33AGTPT3190M1ZM";
const money = (v: any) => Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Doc = jsPDF;
function txt(doc: Doc, s: string, x: number, y: number, o: { size?: number; bold?: boolean; italic?: boolean; color?: RGB; align?: "left" | "center" | "right"; underline?: boolean } = {}) {
  const style = o.bold && o.italic ? "bolditalic" : o.bold ? "bold" : o.italic ? "italic" : "normal";
  doc.setFont("helvetica", style).setFontSize(o.size ?? 10);
  doc.setTextColor(...(o.color ?? BLACK));
  doc.text(s, x, y, { align: o.align ?? "left" });
  if (o.underline) {
    const w = doc.getTextWidth(s);
    const x0 = o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x;
    doc.setDrawColor(...(o.color ?? BLACK)).setLineWidth(0.6);
    doc.line(x0, y + 1.5, x0 + w, y + 1.5);
  }
}

/** Word-wrapping multi-colour paragraph. Returns the y after the last line. */
type Span = { text: string; color?: RGB; bold?: boolean };
function flow(doc: Doc, spans: Span[], x: number, y: number, maxW: number, lineH: number, size: number, firstIndent = 0): number {
  doc.setFontSize(size);
  let cx = x + firstIndent, cy = y;
  for (const sp of spans) {
    doc.setFont("helvetica", sp.bold ? "bold" : "normal");
    const parts = sp.text.split(/(\s+)/);
    for (const w of parts) {
      if (w === "") continue;
      if (/^\s+$/.test(w)) { if (cx > x) cx += doc.getTextWidth(" "); continue; }
      const ww = doc.getTextWidth(w);
      if (cx + ww > x + maxW && cx > x) { cy += lineH; cx = x; }
      doc.setTextColor(...(sp.color ?? BLACK));
      doc.text(w, cx, cy);
      cx += ww;
    }
  }
  return cy;
}

function diamond(doc: Doc, x: number, y: number) {
  doc.setFillColor(0, 0, 0);
  (doc as any).triangle(x, y - 3, x - 3, y, x + 3, y, "F");
  (doc as any).triangle(x - 3, y, x + 3, y, x, y + 3, "F");
}

export interface QuotationRow {
  sno?: string; model?: string; capacity?: string; accuracy?: string;
  platformSize?: string; qty?: string; unitPrice?: number; basicPrice?: number; description?: string;
}
export interface QuotationData {
  to?: string; refNo?: string; date?: string; rows?: QuotationRow[]; total?: number;
  // Per-format commercial terms (B15). When provided they override the template
  // placeholders; when absent the reference default for the kind is used.
  paymentTerms?: string; deliverySchedule?: string; validity?: string;
  contactPerson?: string; contactNumber?: string; gstNote?: string;
}
export type QuotationKind = "retail" | "industrial" | "service" | "stamping";

const INTRO_LOWEST = "We are pleased to give our lowest offer as mentioned below for your weighing need should your require any clarification please feel to call undersigned.";
const INTRO_PLEASURE = "We have pleasure in submitting our quotation as below .";

const CONDITIONS: Array<[string, string]> = [
  ["WARRANTY:", "Our equipment's are warranted for a period of twelve months from the date of delivery. The Company agrees and undertakes that any defect developed, during the warranty period due to faulty workmanship or faulty material will be replaced/repaired free of charge. The warranty does not cover print heads, battery and other consumables as applicable."],
  ["SERVICING:", "After the warranty period you may enter into an Annual Maintenance Agreement with our nearest Service Centre Kanchipuram for periodical maintenance of the equipment at an additional cost."],
  ["UNDERTAKING:", "We will only be responsible for the performance of the equipment supplied being sufficient and/or suitable for your purpose provided you have given us full and correct particulars of your requirement in this respect and the condition, under which the equipment will be required to operate."],
  ["DISPATCH & DELIVERY:", "Every effort will be made to dispatch the equipment on the date given but we will not accept any liability for failure to do so, should dispatch be hindered or delayed by your instructions or by any cause whatsoever beyond our control."],
  ["FORCE MAJEURE:", "SRI VARI SCALES shall not be liable for failure to perform any of its obligation under or arising out of this contract if such failure results force majeure, Act of GOD, fire, storm, earthquake, explosion, accidents, strikes, lockouts, immense or incidents of or the existence of emergency, warlike conditions, civil commotion, riots, inability to obtain raw materials, refusal of license or any other conditions which makes it impossible for SRI VARI SCALES to fulfill its obligations under this contract."],
  ["JURISDICTION:", "All disputes arising out of this transaction shall be subject of and filed in a court of Jurisdiction of Kanchipuram."],
];

interface KindCfg {
  fromPin: string; orderPin: string; subject: string; intro: string;
  headers: string[]; weights: number[]; bodyH: number;
  numbered: boolean; totalRow: "none" | "amount" | "TOTAL";
  page2: boolean; footerCode: string; footerCellSuffix: string; bodySno?: string;
}

const CFG: Record<QuotationKind, KindCfg> = {
  retail: {
    fromPin: "631 502.", orderPin: "631 502", subject: "Quotation for ESSAE ELECTRONIC WEIGHING SCALE – Reg.",
    intro: INTRO_LOWEST, headers: ["S.NO", "MODEL", "CAPACITY", "ACCURACY", "PLATFORM SIZE", "BASIC PRICE"],
    weights: [0.6, 1, 1, 1, 1, 1.1], bodyH: 62,
    numbered: false, totalRow: "none", page2: true, footerCode: "F/SVS/12", footerCellSuffix: "",
  },
  industrial: {
    fromPin: "631 501.", orderPin: "631 501", subject: "Quotation for ELECTRONIC WEIGHING SCALE – Reg.",
    intro: INTRO_LOWEST, headers: ["S.NO", "MODEL", "CAPACITY", "ACCURACY", "PLATFORM SIZE", "QTY", "BASIC PRICE"],
    weights: [0.6, 1, 1, 1, 1.2, 0.6, 1], bodyH: 62,
    numbered: true, totalRow: "none", page2: true, footerCode: "F/SVS/13", footerCellSuffix: "", bodySno: "1.",
  },
  service: {
    fromPin: "631 502.", orderPin: "631 502", subject: "QUOTATION FOR ELECTRONIC WEIGHING SCALE SERVICE – REG.",
    intro: INTRO_PLEASURE, headers: ["S.NO", "DESCRIPTION", "QTY", "BASIC PRICE"],
    weights: [0.6, 3, 0.7, 1.1], bodyH: 200,
    numbered: false, totalRow: "amount", page2: false, footerCode: "F/SVS/15", footerCellSuffix: ".",
  },
  stamping: {
    fromPin: "631 502.", orderPin: "631 502", subject: "Quotation for ELECTRONIC WEIGHING SCALE STAMPING – Reg.",
    intro: INTRO_LOWEST, headers: ["S.NO", "MODEL", "CAPACITY", "ACCURACY", "QTY", "UNIT PRICE", "BASIC PRICE"],
    weights: [0.6, 1, 1, 1, 0.6, 1, 1], bodyH: 120,
    numbered: false, totalRow: "TOTAL", page2: false, footerCode: "F/SVS/14", footerCellSuffix: ".",
  },
};

// Build the printed COMMERCIAL TERMS rows for a kind, using per-quote values
// where given and falling back to the reference-template placeholders. The GST
// line always shows "<rate>% Extra" (matching the four printed templates).
function commercialFor(kind: QuotationKind, d: QuotationData): Array<[string, string]> {
  const pay = d.paymentTerms, del = d.deliverySchedule, val = d.validity;
  const person = d.contactPerson, number = d.contactNumber, gst = d.gstNote || "18% Extra";
  switch (kind) {
    case "retail":
      return [["Payment Terms", pay || "100% payment along with order"], ["Delivery Schedule", del || "Immediately"], ["GST", gst]];
    case "industrial":
      return [["1. Delivery Schedule", del || "14 Days from the Purchase Order Date."], ["2. Payment Terms", pay || "100% pay in advance"], ["3. Validity", val || ""], ["4. Contact Person", person || "M.THANIGAIMALAI"], ["5. Contact Number", number || "9345027134, 9865668414"], ["6. GST", gst]];
    case "service":
      return [["Payment Terms", pay || "100% payment in advance"], ["GST", gst]];
    case "stamping":
      return [["Payment Terms", pay || "100% pay in advance"], ["Delivery Schedule", del || "One week"], ["GST", gst], ["Quotation validity", val || ""]];
  }
}

const L = 48, R = 560, CX = (L + R) / 2;

function header(doc: Doc) {
  txt(doc, "SRI VARI SCALES", R, 42, { size: 22, bold: true, color: BLUE, align: "right" });
  // "Authorised Sales & Service Provider (Essae-Teraoka Pvt Ltd)" — trailing red
  doc.setFont("helvetica", "normal").setFontSize(11);
  const a = "Authorised Sales & Service Provider ", b = "(Essae-Teraoka Pvt Ltd)";
  const wa = doc.getTextWidth(a), wb = doc.getTextWidth(b);
  const startX = CX - (wa + wb) / 2;
  doc.setTextColor(...BLACK); doc.text(a, startX, 60);
  doc.setTextColor(...RED); doc.text(b, startX + wa, 60);
  txt(doc, "QUOTATION", CX, 82, { size: 12, bold: true, color: BLUE, align: "center" });
}

function footer(doc: Doc, cfg: KindCfg) {
  const y = 742;
  doc.setFont("helvetica", "bold").setFontSize(10.5);
  const s1a = "NO: 64-A, SALAI STREET, KANCHIPURAM-631 502. ", s1b = `GSTIN: ${GSTIN}`;
  const w1 = doc.getTextWidth(s1a) + doc.getTextWidth(s1b);
  let x = CX - w1 / 2;
  doc.setTextColor(...BLACK); doc.text(s1a, x, y); x += doc.getTextWidth(s1a);
  doc.setTextColor(...RED); doc.text(s1b, x, y);
  txt(doc, `Sales Service Spares – All kinds of weighing scales CELL NO: 9865668414, 9345027134${cfg.footerCellSuffix}`, CX, y + 15, { size: 10.5, bold: true, align: "center" });
  txt(doc, `(${cfg.footerCode})`, L, y + 30, { size: 9, italic: true });
}

export function buildQuotation(d: QuotationData, kind: QuotationKind): Doc {
  const cfg = CFG[kind];
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  doc.setLineWidth(0.8); doc.setDrawColor(...BLACK);

  header(doc);

  // FROM / TO box
  const boxTop = 92, boxBot = 176, divX = 300, subDivX = 432;
  doc.rect(L, boxTop, R - L, boxBot - boxTop);
  doc.line(divX, boxTop, divX, boxBot);
  doc.line(divX, boxBot - 22, R, boxBot - 22);
  doc.line(subDivX, boxBot - 22, subDivX, boxBot);
  txt(doc, "FROM", L + 6, boxTop + 12, { size: 9, bold: true, color: BLUE });
  txt(doc, "TO", divX + 8, boxTop + 12, { size: 9, bold: true, color: BLUE });
  const fromLines: Array<[string, RGB]> = [
    ["SRI VARI SCALES,", BLACK], ["NO: 64-A, SALAI STREET,", BLACK], [`KANCHIPURAM-${cfg.fromPin}`, BLACK],
    ["CELL NO : 9865668414, 9345027134", BLACK], [`GSTIN : ${GSTIN}`, RED], ["GMAIL : srivariscale@gmail.com", RED],
  ];
  fromLines.forEach((ln, i) => txt(doc, ln[0], L + 10, boxTop + 26 + i * 11, { size: 9, bold: true, color: ln[1] }));
  if (d.to) txt(doc, doc.splitTextToSize(d.to, R - divX - 16) as any, divX + 8, boxTop + 26, { size: 9 });
  txt(doc, `SVS/ MT/ ${d.refNo || ""}`, (divX + subDivX) / 2, boxBot - 8, { size: 9.5, bold: true, align: "center" });
  txt(doc, `Dated : ${d.date || "00.00.2026"}`, (subDivX + R) / 2, boxBot - 8, { size: 9.5, bold: true, align: "center" });

  // Salutation + intro
  txt(doc, "Dear Sir/Madam,", L, boxBot + 16, { size: 10 });
  const introY = flow(doc, [{ text: cfg.intro }], L, boxBot + 32, R - L, 13, 10, 40);
  // Subject
  txt(doc, `SUB: ${cfg.subject}`, CX, introY + 26, { size: 10.5, bold: true, align: "center", underline: true });

  // Items table
  const tTop = introY + 40;
  const tot = cfg.weights.reduce((a, b) => a + b, 0);
  const xs = [L]; let ax = L;
  for (const w of cfg.weights) { ax += (R - L) * w / tot; xs.push(ax); }
  const headH = 34, bodyH = cfg.bodyH;
  const bodyBot = tTop + headH + bodyH;
  // header fill
  doc.setFillColor(...AMBER);
  doc.rect(L, tTop, R - L, headH, "F");
  doc.rect(L, tTop, R - L, headH + bodyH); // outer
  for (let i = 1; i < xs.length - 1; i++) doc.line(xs[i], tTop, xs[i], bodyBot);
  doc.line(L, tTop + headH, R, tTop + headH);
  cfg.headers.forEach((h, i) => {
    const cxc = (xs[i] + xs[i + 1]) / 2;
    const lines = doc.splitTextToSize(h, xs[i + 1] - xs[i] - 4) as string[];
    const startY = tTop + headH / 2 - (lines.length - 1) * 5 + 3;
    lines.forEach((ln, li) => txt(doc, ln, cxc, startY + li * 10, { size: 9.5, bold: true, align: "center" }));
  });
  // rows
  const rows = d.rows || [];
  // The industrial template pre-prints a "1." row number on the blank form;
  // only show that placeholder when there are no real rows to number.
  if (cfg.bodySno && rows.length === 0) txt(doc, cfg.bodySno, (xs[0] + xs[1]) / 2, tTop + headH + 22, { size: 10, align: "center" });
  rows.forEach((r, i) => {
    const y = tTop + headH + 16 + i * 16;
    const cell = (idx: number, v?: string, align: "left" | "center" | "right" = "center") => {
      if (!v) return;
      const x = align === "center" ? (xs[idx] + xs[idx + 1]) / 2 : align === "right" ? xs[idx + 1] - 4 : xs[idx] + 4;
      txt(doc, v, x, y, { size: 9, align });
    };
    if (kind === "service") { cell(0, r.sno || String(i + 1)); cell(1, r.description, "left"); cell(2, r.qty); cell(3, r.basicPrice != null ? money(r.basicPrice) : undefined, "right"); }
    else if (kind === "stamping") { cell(0, r.sno || String(i + 1)); cell(1, r.model); cell(2, r.capacity); cell(3, r.accuracy); cell(4, r.qty); cell(5, r.unitPrice != null ? money(r.unitPrice) : undefined, "right"); cell(6, r.basicPrice != null ? money(r.basicPrice) : undefined, "right"); }
    else if (kind === "industrial") { cell(0, r.sno || String(i + 1)); cell(1, r.model); cell(2, r.capacity); cell(3, r.accuracy); cell(4, r.platformSize); cell(5, r.qty); cell(6, r.basicPrice != null ? money(r.basicPrice) : undefined, "right"); }
    else { cell(0, r.sno || String(i + 1)); cell(1, r.model); cell(2, r.capacity); cell(3, r.accuracy); cell(4, r.platformSize); cell(5, r.basicPrice != null ? money(r.basicPrice) : undefined, "right"); }
  });
  // total row inside the table
  if (cfg.totalRow === "amount") {
    const li = xs.length - 2;
    doc.line(xs[li], bodyBot - 26, R, bodyBot - 26);
    txt(doc, money(d.total), (xs[li] + R) / 2, bodyBot - 10, { size: 10, bold: true, align: "center" });
  } else if (cfg.totalRow === "TOTAL") {
    doc.line(L, bodyBot - 26, R, bodyBot - 26);
    txt(doc, "TOTAL", (xs[3] + xs[4]) / 2, bodyBot - 10, { size: 10, bold: true, align: "center" });
    if (d.total != null) txt(doc, money(d.total), R - 6, bodyBot - 10, { size: 10, bold: true, align: "right" });
  }

  // COMMERCIAL TERMS
  const commercial = commercialFor(kind, d);
  let y = bodyBot + 26;
  txt(doc, cfg.numbered ? "COMMERCIAL TERMS :" : (kind === "retail" ? "COMMERCIAL TERMS" : "COMMERCIAL TERMS :"), L, y, { size: 10, bold: true });
  y += 8;
  const ctH = commercial.length * 15 + 12;
  doc.rect(L + 4, y, R - L - 8, ctH);
  commercial.forEach(([k, v], i) => {
    const ly = y + 15 + i * 15;
    if (cfg.numbered) { txt(doc, k, L + 14, ly, { size: 9.5 }); txt(doc, `: ${v}`, L + 150, ly, { size: 9.5 }); }
    else { diamond(doc, L + 20, ly - 3); txt(doc, k, L + 30, ly, { size: 9.5 }); txt(doc, `: ${v}`, L + 150, ly, { size: 9.5 }); }
  });
  y += ctH + 16;

  // BANK DETAILS
  txt(doc, cfg.numbered || kind !== "retail" ? "BANK DETAILS:" : "BANK DETAILS", L, y, { size: 10, bold: true });
  y += 8;
  const bank = [["Bank", "Tamilnad Mercantile Bank"], ["Branch", "Vanigar Street, Kanchipuram Branch"], ["A/C No", "105700150950136"], ["IFSC", "TMBL0000105"]];
  const bH = bank.length * 15 + 12;
  doc.rect(L + 4, y, R - L - 8, bH);
  bank.forEach(([k, v], i) => {
    const ly = y + 15 + i * 15;
    diamond(doc, L + 20, ly - 3);
    txt(doc, k, L + 30, ly, { size: 9.5 });
    txt(doc, `: ${v}`, L + 96, ly, { size: 9.5 });
  });
  y += bH + 14;

  // Closing paragraph (mixed colour)
  y = flow(doc, [
    { text: "Now, we request you to kindly release your valuable order in favour of " },
    { text: "M/s. ", bold: true },
    { text: `Sri vari Scales, No.64-A, Salai Street, Kanchipuram – ${cfg.orderPin}`, color: BLUE, bold: true },
    { text: ". And send the P.O. to our office." },
  ], L, y, R - L, 14, 10);
  y = flow(doc, [{ text: "Thanking you and assuring you of our best and personalized services at all times." }], L, y + 16, R - L, 14, 10);
  txt(doc, "For Sri Vari Scales", R, y + 24, { size: 10, bold: true, color: BLUE, align: "right" });

  footer(doc, cfg);

  // ── Page 2: General Conditions of Sale (retail / industrial) ──────────────
  if (cfg.page2) {
    doc.addPage();
    header(doc);
    txt(doc, "GENERAL CONDITION OF SALE", CX, 128, { size: 15, bold: true, color: PURPLE, align: "center" });
    txt(doc, "The Acceptance of this Order includes the Acceptance of the Following Terms and Condition", L + 4, 158, { size: 10, bold: true });
    let cy = 186;
    for (const [label, body] of CONDITIONS) {
      cy = flow(doc, [{ text: label + " ", color: MAGENTA, bold: true }, { text: body, bold: true }], L + 4, cy, R - L - 8, 14, 10);
      cy += 24;
    }
    footer(doc, cfg);
  }

  return doc;
}

export function downloadQuotation(d: QuotationData, kind: QuotationKind): void {
  buildQuotation(d, kind).save(`${(d.refNo || kind.toUpperCase() + "-QUOTATION").replace(/[^\w.-]+/g, "_")}.pdf`);
}
