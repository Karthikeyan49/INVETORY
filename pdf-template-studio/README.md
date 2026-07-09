# PDF Template Studio

Turn an **uploaded PDF** into a **reusable, data-driven PDF generator**. Instead of
hand-coding each invoice/quotation layout, you extract a *template definition* once
and render it with any number of input values.

```
upload.pdf ──► extract evidence ──► template def (JSON) ──► render engine ──► PDF
              (deterministic)        (AI-assisted, editable)   (def + inputs)
```

There are **two render modes**:

| Mode | What it does | Best for |
|------|--------------|----------|
| **reconstructed** | Redraws the layout as vectors from the def. Any number of line items, recolorable, rebrandable. | Invoices, quotations, POs (variable rows) |
| **overlay** | Stamps values onto the uploaded page image at fixed coordinates. Pixel-identical. | Fixed-layout forms / blank printed templates |

---

## 1. Extract a template from a PDF

```bash
# deterministic evidence only (always works): words+bboxes, page image, logo
node pdf-template-studio/extract-evidence.mjs <file.pdf> --name my-doc

# evidence + AI-built template def (uses codex), written to the app's templates dir
node pdf-template-studio/extract-template.mjs <file.pdf> --name my-doc --mode reconstructed
```

Outputs:
- `pdf-template-studio/out/<name>/evidence.json` — page size + every word with its
  bounding box + grouped lines + a heuristic table region + image list.
- `pdf-template-studio/out/<name>/page-1.png` — the rendered page (overlay background / review).
- `pdf-template-studio/out/<name>/logo.png` — largest embedded image (likely the logo).
- `frontend/src/templates/<name>.template.json` — the **draft template def** (review it).

> The AI step produces a **draft**. Open the `.template.json`, sanity-check the
> `{{tokens}}`, table columns and totals, then render. If codex isn't available the
> tool still leaves you the evidence + a scaffold def to fill in by hand.

---

## 2. Render a template with data

```ts
import { downloadFromTemplate, type TemplateDef } from "@/lib/templateEngine";
import invoiceDef from "@/templates/invoice.template.json";

await downloadFromTemplate(invoiceDef as unknown as TemplateDef, {
  invoice_number: "INV-2026-0042",
  invoice_date: "2026-06-30",
  bill_to: "ACME Pvt Ltd\nChennai\nGSTIN: 33AAAAA0000A1Z5",
  seller_state: "Tamil Nadu", customer_state: "Tamil Nadu",
  items: [
    { name: "Solar Panel 625wp", hsn: "85414300", qty: 70, unit: "Nos", rate: 11500, gst_rate: 18 },
    { name: "Hybrid Inverter 60KW", hsn: "85044090", qty: 1, unit: "Nos", rate: 496027, gst_rate: 5 },
  ],
}, "INV-2026-0042");
```

`renderTemplate(def, inputs)` returns the `jsPDF` document if you want the bytes
instead of a download. Try it now with the bundled demos
(`frontend/src/lib/templateEngine/samples.ts`):

```ts
import { downloadSampleQuotation, downloadSampleInvoice } from "@/lib/templateEngine/samples";
downloadSampleQuotation();  // renders quotation.template.json with VB Solar FF.pdf data
downloadSampleInvoice();    // renders invoice.template.json (CGST/SGST split)
```

---

## Template def cheatsheet

- `mode`: `"reconstructed"` | `"overlay"`.
- `brand`: `[r,g,b]` accent color.
- `header.rightBoxLines`: token strings, e.g. `"GSTIN : {{company.gstin}}"`.
- `title` / `subtitleField`: token strings.
- `party`: `leftHeading` + `leftBody[]`, optional `rightHeading`/`rightBody[]`,
  `metaRows: [label, "{{token}}"]`.
- `table.columns[]`: `header` + `kind` (`serial|text|qtyUnit|money|taxable|lineTotal|gstPct|gstAmt`)
  + `bind` + `align` + `width`. `componentsIntoColumn` appends `item.components` bullets.
- `taxMode`: `"none"` (per-rate `gstGroups`) or `"split"` (CGST/SGST intra-state, IGST inter-state).
- `totals[]`: `subtotal | gstGroups | cgst | sgst | igst | value(bind) | grandTotal`.
- `amountInWords`, `deduction` (advance/balance), `bank`, `signature`, `notesField`.

**Tokens** resolve against the inputs object (dot-path) plus `company.*` (seller
profile from Settings, falling back to VB Solar constants). Filters: `{{date|date}}`,
`{{amount|money}}`.

Full type contract: [`frontend/src/lib/templateEngine/types.ts`](../frontend/src/lib/templateEngine/types.ts).

---

## How this relates to the existing PDFs & rebrand tool

- The **rebrand tool** (`rebrand/`) only swaps text/logo/brand — it does **not**
  build PDF layouts. This studio is the layout side.
- The current `quotationPdf.ts` / `invoiceTemplatePdf.ts` are hand-coded. The
  shipped `quotation.template.json` / `invoice.template.json` reproduce the same
  FF.pdf layouts through the engine — so new documents are config, not code.
- To switch a page over, replace its `downloadXxxPdf(draft)` call with
  `downloadFromTemplate(def, inputs, filename)`. (Left un-wired by default to avoid
  regressing the working generators.)

## Limitations

- AI extraction is a **draft + review** flow, not guaranteed pixel-perfect for
  arbitrary PDFs. Complex/scanned layouts need manual tuning of the def.
- Overlay mode needs a **blank** template page (no sample data baked in) for clean results.
- Requires `poppler-utils` (`pdftotext`, `pdftoppm`, `pdfimages`, `pdfinfo`) for extraction.
