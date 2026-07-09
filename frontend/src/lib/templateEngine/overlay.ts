/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Overlay renderer — pixel-faithful mode. Draws an uploaded blank template page
 * as a full-page background image, then stamps input values at fixed coordinates
 * (given in the background's pixel space, scaled to the PDF page). Best for fixed
 * layout forms; the reconstructed engine is better for variable-row documents.
 */
import jsPDF from "jspdf";
import type { TemplateDef, DocInputs, RGB } from "./types";
import { resolveCompany, fillTokens, money, num, s, trimNum, loadImage } from "./helpers";

export async function renderOverlay(def: TemplateDef, inputs: DocInputs): Promise<jsPDF> {
  if (!def.overlay) throw new Error("overlay template requires an `overlay` block");
  const o = def.overlay;
  const company = resolveCompany();
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: def.page?.format || "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const sx = W / o.pageW;     // px -> pt scale (x)
  const sy = H / o.pageH;     // px -> pt scale (y)
  const T = (tpl?: string) => fillTokens(tpl || "", inputs, company);

  // background
  const bg = await loadImage(o.background);
  if (bg) {
    try { doc.addImage(bg.data, bg.fmt, 0, 0, W, H, undefined, "FAST"); } catch { /* ignore */ }
  }

  // stamped fields
  for (const f of o.fields) {
    const val = T(f.bind);
    if (!val) continue;
    doc.setFont("helvetica", f.bold ? "bold" : "normal").setFontSize((f.fontSize || 10) * sy);
    const col: RGB = f.color || [20, 20, 20];
    doc.setTextColor(col[0], col[1], col[2]);
    const opts: any = { align: f.align || "left" };
    const x = f.x * sx, yy = f.y * sy;
    if (f.maxWidth) doc.text(doc.splitTextToSize(val, f.maxWidth * sx), x, yy, opts);
    else doc.text(val, x, yy, opts);
  }

  // table rows stamped into the reserved region
  if (o.table) {
    const items = (inputs[o.table.items] as any[]) || [];
    let ry = o.table.yStart;
    doc.setTextColor(20, 20, 20).setFont("helvetica", "normal");
    items.slice(0, o.table.maxRows).forEach((it, i) => {
      for (const c of o.table!.columns) {
        const v = cell(c, it, i);
        if (v === "") continue;
        doc.setFontSize(9 * sy);
        doc.text(String(v), (c.x) * sx, ry * sy, { align: c.align || "left" });
      }
      ry += o.table!.rowH;
    });
  }

  return doc;
}

function cell(c: any, it: any, i: number): string {
  const taxable = num(it.amount) || num(it.qty) * num(it.rate);
  switch (c.kind) {
    case "serial": return String(i + 1);
    case "text": return s(c.bind ? it[c.bind] : "");
    case "qtyUnit": return `${trimNum(it.qty)}${it.unit ? " " + it.unit : ""}`;
    case "money": return money(c.bind ? it[c.bind] : 0);
    case "taxable": return money(taxable);
    default: return s(c.bind ? it[c.bind] : "");
  }
}
