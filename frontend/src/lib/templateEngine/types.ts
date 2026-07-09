/**
 * PDF Template Studio — template definition types.
 *
 * A TemplateDef is a declarative description of a business document (invoice,
 * quotation, proforma, PO …) produced by the extractor from an uploaded PDF and
 * rendered by the engine with arbitrary input data. Two render modes:
 *   - "reconstructed": redraw the layout as vectors from the def (dynamic rows).
 *   - "overlay":       stamp values onto a background image at fixed coordinates.
 *
 * Tokens: any string may contain {{path}} placeholders resolved against the
 * inputs object (dot-path, e.g. {{customer.name}} or {{invoice_number}}).
 * Company/bank tokens resolve against the merged company profile, e.g.
 * {{company.gstin}}, {{company.bankAccount}}.
 */

export type RGB = [number, number, number];
export type Align = "left" | "center" | "right";

export interface TemplateColumn {
  header: string;
  /** input item field path, e.g. "name", "hsn", "specifications" */
  bind?: string;
  /**
   * serial      → 1,2,3…
   * text        → raw bound string
   * qtyUnit     → qty + unit
   * money       → bound number, Indian currency
   * taxable     → qty*rate (line taxable)
   * lineTotal   → taxable + line GST (incl tax)
   * gstPct      → item gst % (optionally halved for CGST/SGST via `half`)
   * gstAmt      → item GST amount (optionally halved)
   */
  kind: "serial" | "text" | "qtyUnit" | "money" | "taxable" | "lineTotal" | "gstPct" | "gstAmt";
  half?: boolean;        // for split CGST/SGST columns
  align?: Align;
  width: number;         // points
}

export interface TotalRow {
  label: string;
  /**
   * subtotal   → Σ line taxable
   * gstGroups  → one rendered row PER distinct item gst rate ("{rate}% GST")
   * cgst/sgst/igst → split tax components (intra/inter-state)
   * discount   → invoice-level discount (shown as a deduction)
   * value      → a bound input number (delivery, advance…)
   * grandTotal → final total (bold, brand fill)
   */
  kind: "subtotal" | "gstGroups" | "cgst" | "sgst" | "igst" | "discount" | "value" | "grandTotal";
  bind?: string;         // for kind "value"
}

export interface TemplateDef {
  name: string;
  mode: "reconstructed" | "overlay";
  page?: { format?: "a4"; width?: number; height?: number; margin?: number };
  brand?: RGB;

  // ── reconstructed-mode layout ──────────────────────────────────────────────
  header?: {
    logo?: boolean;
    rightBoxLines?: string[];   // token strings, e.g. "GSTIN : {{company.gstin}}"
  };
  title?: string;               // token string, e.g. "TAX INVOICE"
  subtitleField?: string;       // token string for a band, e.g. "{{system_title}}"
  party?: {
    leftHeading?: string;       // "To," / "Bill To,"
    leftBody?: string[];        // token strings
    rightHeading?: string;      // "Kindly Attached," (optional)
    rightBody?: string[];
    metaRows?: Array<[string, string]>;  // [label, tokenValue]
    leftRatio?: number;         // 0..1 width split (default 0.58)
  };
  table?: {
    items?: string;             // input path, default "items"
    columns: TemplateColumn[];
    componentsIntoColumn?: number; // append item.components as bullet lines into this column index
  };
  taxMode?: "none" | "split";   // split = derive CGST/SGST vs IGST from states
  totals?: TotalRow[];
  amountInWords?: boolean;
  deduction?: boolean;          // advance/balance block (uses advance_amount/advance_date)
  bank?: boolean;               // bank-details box from company profile
  signature?: boolean;          // "For {{company.name}}"
  notesField?: string;          // input path for terms/notes text (newline list)
  notesHeading?: string;

  // ── overlay-mode layout ────────────────────────────────────────────────────
  overlay?: {
    /** public URL or data URL of the blank background image (rendered page) */
    background: string;
    /** background pixel size; fields are positioned in these pixel coords */
    pageW: number;
    pageH: number;
    fields: OverlayField[];
    table?: OverlayTable;
  };
}

export interface OverlayField {
  bind: string;                 // token string
  x: number; y: number;         // top-left in background pixels
  fontSize?: number;
  bold?: boolean;
  align?: Align;
  maxWidth?: number;
  color?: RGB;
}

export interface OverlayTable {
  items: string;                // input path
  xStart: number; yStart: number; rowH: number; maxRows: number;
  columns: Array<{ bind?: string; kind: TemplateColumn["kind"]; x: number; w: number; align?: Align }>;
}

/** Generic document inputs — header fields live at the top level, rows in `items`. */
export interface DocInputs {
  items?: Array<{
    name?: string; specifications?: string; make?: string; hsn?: string;
    qty?: number; unit?: string; rate?: number; amount?: number; gst_rate?: number;
    components?: Array<{ group?: string; name?: string; make?: string; qty?: number }>;
  }>;
  [key: string]: any;
}

/** Company/bank info merged from the tenant profile + fallback constants. */
export interface CompanyInfo {
  name: string; gstin: string; phone: string; address: string;
  bankName: string; bankAccount: string; bankIfsc: string; bankBranch: string;
  accountType: string; accountName: string; logo?: string; primaryColor?: string;
}
