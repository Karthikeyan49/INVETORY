#!/usr/bin/env node
/**
 * PDF Template Studio — AI-assisted template extractor.
 *
 * Pipeline:  upload.pdf  ->  evidence (bbox + page image + logo)  ->  codex  ->
 *            <slug>.template.json  (a TemplateDef the render engine consumes)
 *
 * It always produces the deterministic evidence first, then asks codex to map
 * that evidence onto the TemplateDef schema. The emitted def is a *draft* — open
 * it, sanity-check tokens/columns, then render with the engine. If codex is not
 * available it still leaves you the evidence + a scaffold def to fill in.
 *
 * Usage:
 *   node pdf-template-studio/extract-template.mjs <input.pdf> --name <slug> [--mode reconstructed|overlay] [--no-ai]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(here, "..");
const args = process.argv.slice(2);
if (!args[0] || args.includes("-h") || args.includes("--help")) {
  console.log(`Usage: node pdf-template-studio/extract-template.mjs <input.pdf> --name <slug> [--mode reconstructed|overlay] [--no-ai]`);
  process.exit(args[0] ? 0 : 1);
}
const input = args[0];
const flag = (k, d) => { const i = args.indexOf(k); return i !== -1 ? args[i + 1] : d; };
const slug = flag("--name", path.basename(input).replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase());
const mode = flag("--mode", "reconstructed");
const useAi = !args.includes("--no-ai");
const outDir = path.join(here, "out", slug);
const templatesDir = path.join(repoRoot, "frontend", "src", "templates");
fs.mkdirSync(templatesDir, { recursive: true });

// ── 1. deterministic evidence ────────────────────────────────────────────────
console.log("→ extracting evidence …");
execFileSync("node", [path.join(here, "extract-evidence.mjs"), input, "--name", slug], { stdio: "inherit" });
const evidence = JSON.parse(fs.readFileSync(path.join(outDir, "evidence.json"), "utf8"));

// ── 2. codex prompt ──────────────────────────────────────────────────────────
const schema = fs.existsSync(path.join(repoRoot, "frontend/src/lib/templateEngine/types.ts"))
  ? fs.readFileSync(path.join(repoRoot, "frontend/src/lib/templateEngine/types.ts"), "utf8")
  : "";

function codexAvailable() {
  try { execFileSync("which", ["codex"], { stdio: "ignore" }); return true; } catch { return false; }
}

function buildPrompt() {
  const lines = evidence.lines.map((l) => `[y=${l.y} x=${l.x} fs=${l.fontSize}] ${l.text}`).join("\n");
  return `You convert an extracted PDF business document into a TemplateDef JSON for our render engine.

TEMPLATE DEF TYPES (authoritative — emit JSON valid against TemplateDef):
\`\`\`ts
${schema}
\`\`\`

RULES:
- mode = "${mode}".
- Use {{token}} placeholders for every DYNAMIC value (customer name/address/gstin, invoice or quotation number, dates, contact, prepared-by, items). Use {{company.gstin}}, {{company.phone}}, {{company.name}}, {{company.bankAccount}} etc. for the SELLER's own details.
- Static labels stay literal. Dates use {{field|date}}.
- The line-items table: infer columns (header text + kind serial/text/qtyUnit/money/taxable/lineTotal/gstPct/gstAmt) from the table headers. Put descriptive/specification text columns as kind "text" with a bind.
- Pick brand color [r,g,b] from the document's dominant heading color if obvious, else [31,90,58].
- For a GST tax invoice set taxMode "split" and include cgst/sgst/igst total rows; for a quotation/performa use taxMode "none" with a gstGroups total row.
- Output ONLY the JSON object, no prose, no code fences.

EXTRACTED DOCUMENT (page ${evidence.page.width}x${evidence.page.height}pt; table region ${evidence.table ? `y ${evidence.table.yStart}-${evidence.table.yEnd}` : "n/a"}):
${lines}
`;
}

const scaffold = {
  name: slug,
  mode,
  page: { format: "a4", margin: 36 },
  brand: [31, 90, 58],
  taxMode: "none",
  header: { logo: true, rightBoxLines: ["GSTIN : {{company.gstin}}", "Ph : {{company.phone}}"] },
  title: "DOCUMENT TITLE — EDIT ME",
  party: { leftHeading: "To,", leftBody: ["M/S {{customer_name}}", "{{customer_address}}"], metaRows: [["Date", "{{date|date}}"]] },
  table: { items: "items", columns: [
    { header: "S.No", kind: "serial", align: "center", width: 28 },
    { header: "Description", kind: "text", bind: "name", align: "left", width: 200 },
    { header: "Qty", kind: "qtyUnit", align: "right", width: 50 },
    { header: "Rate", kind: "money", bind: "rate", align: "right", width: 70 },
    { header: "Amount", kind: "taxable", align: "right", width: 80 },
  ] },
  totals: [{ label: "Subtotal", kind: "subtotal" }, { label: "GST", kind: "gstGroups" }, { label: "Grand Total", kind: "grandTotal" }],
  amountInWords: true, bank: true, signature: true, notesField: "terms", notesHeading: "Note:",
  _note: "SCAFFOLD — codex was unavailable or failed; edit this by hand. Evidence in pdf-template-studio/out/" + slug + "/",
};

const outFile = path.join(templatesDir, `${slug}.template.json`);

function extractJson(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

if (useAi && codexAvailable()) {
  console.log("→ asking codex to build the template def …");
  const lastMsg = path.join(outDir, "codex-out.txt");
  try {
    execFileSync("codex", [
      "exec", "-C", repoRoot, "-s", "read-only", "--skip-git-repo-check",
      "--output-last-message", lastMsg, "-",
    ], { input: buildPrompt(), stdio: ["pipe", "inherit", "inherit"], timeout: 240000 });
    const raw = fs.existsSync(lastMsg) ? fs.readFileSync(lastMsg, "utf8") : "";
    const def = extractJson(raw);
    if (def) {
      fs.writeFileSync(outFile, JSON.stringify(def, null, 2) + "\n");
      console.log(`✓ template def written: ${path.relative(process.cwd(), outFile)}`);
      console.log("  Review it, then render with renderTemplate(def, inputs).");
      process.exit(0);
    }
    console.log("⚠ codex output was not valid JSON; writing scaffold instead.");
  } catch (e) {
    console.log("⚠ codex step failed (" + e.message + "); writing scaffold instead.");
  }
}

fs.writeFileSync(outFile, JSON.stringify(scaffold, null, 2) + "\n");
console.log(`✓ scaffold def written: ${path.relative(process.cwd(), outFile)} (edit by hand; evidence in ${path.relative(process.cwd(), outDir)}/)`);
