/**
 * Quotation Builder PDF — now powered by the PDF Template Studio engine.
 *
 * This used to hand-draw the layout; it now maps the Quotation onto generic
 * template inputs and renders quotation.template.json through the engine. Edit
 * the layout in the JSON def, not here. Exported signature is unchanged so the
 * Quotation Builder page keeps calling downloadQuotationPdf(quotation).
 */
import { downloadFromTemplate, type TemplateDef, type DocInputs } from "./templateEngine";
import quotationDef from "@/templates/quotation.template.json";
import type { Quotation } from "./api/quotations";

export async function downloadQuotationPdf(q: Quotation): Promise<void> {
  // The Quotation shape is already snake_case and matches the template tokens;
  // pass it straight through as the engine inputs.
  const inputs = q as unknown as DocInputs;
  await downloadFromTemplate(quotationDef as unknown as TemplateDef, inputs, q.quotation_no || "quotation");
}
