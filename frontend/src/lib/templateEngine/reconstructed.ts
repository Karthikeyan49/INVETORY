/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Reconstructed renderer — redraws a business document (invoice/quotation/…) as
 * vectors from a TemplateDef + inputs. Handles any number of line items, derives
 * GST (per-rate groups, or CGST/SGST/IGST split), amount-in-words, bank box and
 * notes. This is the reusable engine that replaces hand-coding each PDF.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ensurePdfFonts, calibriReady, CALIBRI } from "../pdfFonts";
import type { TemplateDef, TemplateColumn, CompanyInfo, RGB, DocInputs } from "./types";
import {
  resolveCompany, brandColor, fillTokens, fmtDate, money, rupees, num, s, trimRate, trimNum,
  round2, rupeesInWords, loadImage, gstGroups,
} from "./helpers";

function isInterState(inp: DocInputs): boolean {
  const a = s(inp.customer_state || inp.customerState);
  const b = s(inp.seller_state || inp.sellerState);
  if (!a || !b) return false;
  return a.toLowerCase() !== b.toLowerCase();
}

export async function renderReconstructed(def: TemplateDef, inputs: DocInputs): Promise<jsPDF> {
  const company = resolveCompany();
  const C: RGB = def.brand || brandColor(company.primaryColor);
  const items = (inputs[def.table?.items || "items"] as any[]) || [];
  const inter = def.taxMode === "split" ? isInterState(inputs) : false;

  // Match the source quotation forms' typeface (Calibri) via the OFL Carlito
  // substitute; falls back to Helvetica if the weights aren't available.
  await ensurePdfFonts();
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: def.page?.format || "a4" });
  const FONT = calibriReady() ? CALIBRI : "helvetica";
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = def.page?.margin ?? 36;
  let y = M;
  const T = (tpl?: string) => fillTokens(tpl || "", inputs, company);

  // ── header band: logo + right info box ─────────────────────────────────────
  if (def.header) {
    const bandH = 60;
    doc.setDrawColor(...C).setLineWidth(1).rect(M, y, W - 2 * M, bandH);
    if (def.header.logo) {
      const logo = await loadImage(company.logo);
      if (logo) {
        try {
          const maxW = 150, maxH = bandH - 12, scale = Math.min(maxW / logo.w, maxH / logo.h);
          doc.addImage(logo.data, logo.fmt, M + 8, y + (bandH - logo.h * scale) / 2, logo.w * scale, logo.h * scale, undefined, "FAST");
        } catch { /* ignore */ }
      }
    }
    const lines = def.header.rightBoxLines || [];
    if (lines.length) {
      const boxX = W - M - 200;
      doc.line(boxX, y, boxX, y + bandH);
      doc.setFont(FONT, "bold").setFontSize(11).setTextColor(...C);
      const step = Math.min(20, (bandH - 8) / lines.length);
      lines.forEach((l, i) => doc.text(T(l), boxX + 100, y + 20 + i * step, { align: "center" }));
    }
    y += bandH;
  }

  // ── title band ─────────────────────────────────────────────────────────────
  if (def.title) {
    doc.setDrawColor(...C).setLineWidth(1).rect(M, y, W - 2 * M, 22);
    doc.setFont(FONT, "bold").setFontSize(12).setTextColor(...C);
    doc.text(T(def.title).toUpperCase(), W / 2, y + 15, { align: "center" });
    y += 22;
  }
  // ── subtitle band ──────────────────────────────────────────────────────────
  if (def.subtitleField) {
    const st = T(def.subtitleField);
    if (st) {
      doc.setDrawColor(...C).setLineWidth(0.8).rect(M, y, W - 2 * M, 18);
      doc.setFont(FONT, "bold").setFontSize(10).setTextColor(60, 60, 60);
      doc.text(st.toUpperCase(), W / 2, y + 12, { align: "center" });
      y += 18;
    }
  }

  // ── party / info grid ──────────────────────────────────────────────────────
  if (def.party) {
    const ratio = def.party.leftRatio ?? 0.58;
    const colSplit = M + (W - 2 * M) * ratio;
    const leftBody = (def.party.leftBody || []).map(T).filter(Boolean);
    const rightBody = (def.party.rightBody || []).map(T).filter(Boolean);
    const meta = (def.party.metaRows || []).map(([l, v]) => [l, T(v)]).filter(([, v]) => v);
    const leftWrapped: string[] = [];
    leftBody.forEach((l) => leftWrapped.push(...doc.splitTextToSize(l, colSplit - M - 16)));
    const leftH = 16 + (def.party.leftHeading ? 12 : 0) + leftWrapped.length * 11
      + (rightBody.length ? 0 : 0) + 8;
    const rightH = 8 + (def.party.rightHeading ? 12 : 0) + rightBody.length * 11 + meta.length * 15 + 8;
    const gridH = Math.max(leftH, rightH, 64);

    doc.setDrawColor(170, 170, 170).setLineWidth(0.6).rect(M, y, W - 2 * M, gridH);
    doc.line(colSplit, y, colSplit, y + gridH);

    let ly = y + 14;
    if (def.party.leftHeading) {
      doc.setFont(FONT, "bold").setFontSize(9).setTextColor(40, 40, 40);
      doc.text(def.party.leftHeading, M + 6, ly); ly += 12;
    }
    doc.setFont(FONT, "normal").setFontSize(8.5).setTextColor(60, 60, 60);
    leftWrapped.forEach((l) => { doc.text(l, M + 6, ly); ly += 11; });

    let ry = y + 14;
    if (def.party.rightHeading) {
      doc.setFont(FONT, "bold").setFontSize(9).setTextColor(40, 40, 40);
      doc.text(def.party.rightHeading, colSplit + 8, ry); ry += 12;
      doc.setFont(FONT, "normal").setFontSize(8.5).setTextColor(60, 60, 60);
      rightBody.forEach((l) => { doc.text(l, colSplit + 8, ry); ry += 11; });
      ry += 2;
    }
    meta.forEach(([label, val]) => {
      doc.setFont(FONT, "bold").setFontSize(8.5).setTextColor(40, 40, 40);
      doc.text(label, colSplit + 8, ry);
      doc.setFont(FONT, "normal").setTextColor(60, 60, 60);
      doc.text(String(val), W - M - 6, ry, { align: "right" });
      ry += 15;
    });
    y += gridH;
  }
  y += 8;

  // ── items table ────────────────────────────────────────────────────────────
  if (def.table) {
    const cols = def.table.columns;
    const head = [cols.map((c) => c.header)];
    const compCol = def.table.componentsIntoColumn;
    const body = items.map((it, i) => cols.map((c, ci) => {
      let cell = cellValue(c, it, i, inter);
      if (compCol === ci && Array.isArray(it.components) && it.components.length) {
        const bullets = it.components
          .filter((cm: any) => s(cm.name) || s(cm.group))
          .map((cm: any) => `• ${[s(cm.name), s(cm.make)].filter(Boolean).join(" ")}${cm.qty ? ` x${trimNum(cm.qty)}` : ""}`)
          .join("\n");
        if (bullets) cell = (cell ? cell + "\n" : "") + bullets;
      }
      return cell;
    }));
    const columnStyles: any = {};
    cols.forEach((c, i) => { columnStyles[i] = { halign: c.align || "left", cellWidth: c.width }; });
    autoTable(doc, {
      startY: y,
      head, body,
      theme: "grid",
      // Keep a bottom margin so a paginated table never runs into the page edge,
      // and so trailing content (totals/notes) has a predictable break point.
      margin: { left: M, right: M, top: M, bottom: M },
      styles: { font: FONT, fontSize: 7.6, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.5, textColor: [40, 40, 40] },
      headStyles: { font: FONT, fillColor: C, textColor: 255, fontSize: 7.6, halign: "center", fontStyle: "bold" },
      columnStyles,
    });
    // autoTable leaves the document on its last page; finalY is the y on that page.
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Page-break helper: if `need` points won't fit above the bottom margin, start
  // a fresh page and reset y to the top margin. Used before every drawn block so
  // nothing overflows the page or overlaps the table on a break.
  const ensure = (need: number) => { if (y + need > H - M) { doc.addPage(); y = M; } };

  // ── totals ─────────────────────────────────────────────────────────────────
  const totalsCalc = computeTotals(items, inputs, inter, def.taxMode === "split");
  if (def.totals && def.totals.length) {
    const totW = 250, tx = W - M - totW;
    const rows: Array<[string, string, boolean?]> = [];
    for (const r of def.totals) {
      if (r.kind === "subtotal") rows.push([r.label, money(totalsCalc.subtotal)]);
      else if (r.kind === "gstGroups") totalsCalc.groups.forEach((g) => rows.push([`${trimRate(g.rate)}% ${r.label}`.trim(), money(g.gst)]));
      else if (r.kind === "cgst") { if (!inter) rows.push([r.label, money(totalsCalc.cgst)]); }
      else if (r.kind === "sgst") { if (!inter) rows.push([r.label, money(totalsCalc.sgst)]); }
      else if (r.kind === "igst") { if (inter) rows.push([r.label, money(totalsCalc.igst)]); }
      else if (r.kind === "discount") { if (totalsCalc.discount > 0) rows.push([r.label, "- " + money(totalsCalc.discount)]); }
      else if (r.kind === "value") { const v = num(inputs[r.bind || ""]); if (v) rows.push([r.label, money(v)]); }
      else if (r.kind === "grandTotal") rows.push([r.label, rupees(totalsCalc.grandTotal), true]);
    }
    // Keep the totals block together on one page (it's small); break before it if
    // it won't fit. Subsequent blocks self-paginate via their own ensure() calls.
    ensure(rows.length * 18);
    for (const [label, val, bold] of rows) {
      ensure(18);
      doc.setDrawColor(200, 200, 200).setLineWidth(0.5).rect(tx, y, totW, 18);
      doc.line(tx + totW * 0.5, y, tx + totW * 0.5, y + 18);
      if (bold) { doc.setFillColor(C[0], C[1], C[2]); doc.rect(tx, y, totW, 18, "F"); }
      doc.setFont(FONT, bold ? "bold" : "normal").setFontSize(9)
        .setTextColor(bold ? 255 : 40, bold ? 255 : 40, bold ? 255 : 40);
      doc.text(label, tx + totW * 0.5 - 6, y + 12, { align: "right" });
      doc.text(val, W - M - 6, y + 12, { align: "right" });
      y += 18;
    }
  }

  // ── amount in words ────────────────────────────────────────────────────────
  if (def.amountInWords) {
    const words = doc.splitTextToSize(rupeesInWords(totalsCalc.grandTotal), W - 2 * M - 90);
    const block = 14 + Math.max(1, words.length) * 11 + 6;
    ensure(block); y += 14;
    doc.setFont(FONT, "bold").setFontSize(8.5).setTextColor(40, 40, 40);
    doc.text("Amount in words:", M, y);
    doc.setFont(FONT, "normal").setTextColor(60, 60, 60);
    doc.text(words, M + 90, y);
    y += Math.max(1, words.length) * 11 + 4;
  }

  // ── deduction (advance / balance) ──────────────────────────────────────────
  if (def.deduction && num(inputs.advance_amount) > 0) {
    ensure(8 + 38 + 8); y += 8;
    const adv = num(inputs.advance_amount), bal = round2(totalsCalc.grandTotal - adv);
    doc.setDrawColor(...C).setLineWidth(0.8).rect(M, y, W - 2 * M, 38);
    doc.setFont(FONT, "bold").setFontSize(9).setTextColor(40, 40, 40);
    doc.text(`ADVANCE${inputs.advance_date ? " (" + fmtDate(inputs.advance_date) + ")" : ""} : ${rupees(adv)}`, M + 8, y + 15);
    doc.text(`Balance : ${rupees(bal)}`, M + 8, y + 31);
    doc.setFont(FONT, "normal").setFontSize(7.6).setTextColor(90, 90, 90);
    doc.text(rupeesInWords(bal), W - M - 8, y + 31, { align: "right" });
    y += 46;
  }

  // ── bank box + signature ───────────────────────────────────────────────────
  if (def.bank || def.signature) {
    const bankRows = def.bank ? [
      ["BANK & ACC NUMBER", company.bankAccount],
      ["IFSC CODE", company.bankIfsc],
      ["ADDRESS OF THE BANK", company.bankBranch],
      ["ACCOUNT TYPE", company.accountType],
      ["ACCOUNT NAME", company.accountName],
    ] : [];
    const boxW = (W - 2 * M) * 0.58;
    const boxH = Math.max(bankRows.length * 15 + 8, 60);
    ensure(boxH + 12);
    if (def.bank) {
      doc.setDrawColor(170, 170, 170).setLineWidth(0.6).rect(M, y, boxW, boxH);
      let bky = y + 14;
      for (const [label, val] of bankRows) {
        doc.setFont(FONT, "bold").setFontSize(7.6).setTextColor(40, 40, 40);
        doc.text(label, M + 6, bky);
        doc.setFont(FONT, "normal").setTextColor(60, 60, 60);
        doc.text(s(val), M + boxW * 0.45, bky);
        bky += 15;
      }
    }
    if (def.signature) {
      doc.setFont(FONT, "bold").setFontSize(9).setTextColor(40, 40, 40);
      doc.text(`For ${company.name.toUpperCase()}`, W - M - 6, y + 14, { align: "right" });
      doc.setFont(FONT, "normal").setFontSize(8).setTextColor(120, 120, 120);
      doc.text("(Authorised Signatory)", W - M - 6, y + boxH - 4, { align: "right" });
    }
    y += boxH + 12;
  }

  // ── notes / terms ──────────────────────────────────────────────────────────
  if (def.notesField) {
    const raw = inputs[def.notesField];
    const list = Array.isArray(raw) ? raw : s(raw).split("\n").map((t) => t.trim()).filter(Boolean);
    if (list.length) {
      // Keep the heading with at least the first note line so it never dangles
      // alone at the bottom of a page.
      ensure(12 + 9 + 4);
      doc.setFont(FONT, "bold").setFontSize(8.5).setTextColor(...C);
      doc.text(def.notesHeading || "Notes:", M, y); y += 12;
      doc.setFont(FONT, "normal").setFontSize(7.4).setTextColor(70, 70, 70);
      list.forEach((t: string) => {
        const lines = doc.splitTextToSize(t, W - 2 * M);
        ensure(lines.length * 9 + 4);
        doc.text(lines, M, y); y += lines.length * 9 + 2;
      });
    }
  }

  return doc;
}

function cellValue(c: TemplateColumn, it: any, i: number, inter: boolean): string {
  const taxable = num(it.amount) || num(it.qty) * num(it.rate);
  const rate = num(it.gst_rate ?? 18);
  switch (c.kind) {
    case "serial": return String(i + 1);
    case "text": return s(c.bind ? it[c.bind] : "");
    case "qtyUnit": return `${trimNum(it.qty)}${it.unit ? " " + it.unit : ""}`;
    case "money": return money(c.bind ? it[c.bind] : 0);
    case "taxable": return money(taxable);
    case "lineTotal": return money(taxable + taxable * rate / 100);
    case "gstPct": return `${trimRate(c.half ? rate / 2 : rate)}%`;
    case "gstAmt": return money(taxable * (c.half ? rate / 2 : rate) / 100);
    default: return "";
  }
}

function computeTotals(items: any[], inputs: DocInputs, inter: boolean, split: boolean) {
  const groups = gstGroups(items);
  const subtotal = round2(groups.reduce((sum, g) => sum + g.taxable, 0));
  // Invoice-level discount reduces the taxable base; GST scales proportionally.
  const discount = Math.max(0, num(inputs.discount));
  const taxable = Math.max(0, round2(subtotal - discount));
  const factor = subtotal > 0 ? taxable / subtotal : 1;
  const totalTax = round2(groups.reduce((sum, g) => sum + g.gst, 0) * factor);
  const delivery = num(inputs.delivery_fee ?? inputs.deliveryFee);
  const cgst = split && !inter ? round2(totalTax / 2) : 0;
  const sgst = split && !inter ? round2(totalTax / 2) : 0;
  const igst = split && inter ? totalTax : 0;
  const grandTotal = Math.round(taxable + totalTax + delivery);
  return { subtotal, discount, totalTax, groups, cgst, sgst, igst, grandTotal };
}
