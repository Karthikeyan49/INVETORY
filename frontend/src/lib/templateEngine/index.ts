/**
 * PDF Template Studio — render entry point.
 *
 * One call renders any template (invoice, quotation, …) from a TemplateDef +
 * inputs, dispatching to the reconstructed or overlay engine. This is the
 * reusable replacement for hand-coding each PDF generator.
 *
 * Usage:
 *   import invoiceDef from "@/templates/invoice.template.json";
 *   await downloadFromTemplate(invoiceDef as TemplateDef, inputs, "INV-2026-0001");
 */
import { loadCompanyProfile } from "../companyProfile";
import { renderReconstructed } from "./reconstructed";
import { renderOverlay } from "./overlay";
import type { TemplateDef, DocInputs } from "./types";

export * from "./types";

/** Build the jsPDF document for a template + inputs (no download). */
export async function renderTemplate(def: TemplateDef, inputs: DocInputs) {
  await loadCompanyProfile(); // refresh company/bank/logo from Settings
  return def.mode === "overlay" ? renderOverlay(def, inputs) : renderReconstructed(def, inputs);
}

/** Render + trigger a browser download. */
export async function downloadFromTemplate(def: TemplateDef, inputs: DocInputs, filename: string): Promise<void> {
  const doc = await renderTemplate(def, inputs);
  const safe = (filename || def.name || "document").replace(/[^\w.-]+/g, "_");
  doc.save(safe.endsWith(".pdf") ? safe : `${safe}.pdf`);
}
