#!/usr/bin/env node
/**
 * PDF Template Studio — Evidence Extractor (deterministic, no AI).
 *
 * Turns any uploaded PDF into structured "evidence" the template tools consume:
 *   - <out>/evidence.json : page size + every word with its bounding box + grouped
 *                           lines + a heuristic table-region guess + image list
 *   - <out>/page-1.png    : the first page rendered (overlay background / AI vision)
 *   - <out>/logo-*.png    : embedded images (largest = likely logo)
 *
 * Uses poppler CLI tools (pdftotext, pdftoppm, pdfimages, pdfinfo) — no npm deps.
 *
 * Usage:
 *   node pdf-template-studio/extract-evidence.mjs <input.pdf> [--name <slug>] [--dpi 150]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function fail(msg) { console.error("✖ " + msg); process.exit(1); }

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
  console.log(`PDF Template Studio — evidence extractor
Usage: node pdf-template-studio/extract-evidence.mjs <input.pdf> [--name <slug>] [--dpi 150]
Outputs to pdf-template-studio/out/<slug>/`);
  process.exit(0);
}
const input = args[0];
if (!fs.existsSync(input)) fail(`Input PDF not found: ${input}`);
const nameFlag = args.indexOf("--name");
const dpiFlag = args.indexOf("--dpi");
const slug = nameFlag !== -1 ? args[nameFlag + 1]
  : path.basename(input).replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
const dpi = dpiFlag !== -1 ? Number(args[dpiFlag + 1]) || 150 : 150;

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(scriptDir, "out", slug);
fs.mkdirSync(outDir, { recursive: true });

function run(cmd, cmdArgs) {
  try { return execFileSync(cmd, cmdArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { fail(`${cmd} failed: ${e.message}`); }
}
function which(cmd) {
  try { execFileSync("which", [cmd], { stdio: "ignore" }); return true; } catch { return false; }
}
for (const t of ["pdftotext", "pdftoppm", "pdfimages", "pdfinfo"]) {
  if (!which(t)) fail(`Required tool "${t}" not found (install poppler-utils).`);
}

// ── 1. page geometry ─────────────────────────────────────────────────────────
const info = run("pdfinfo", [input]);
const pagesM = info.match(/Pages:\s+(\d+)/);
const sizeM = info.match(/Page size:\s+([\d.]+)\s+x\s+([\d.]+)/);
const pageCount = pagesM ? Number(pagesM[1]) : 1;
const pageWidth = sizeM ? Number(sizeM[1]) : 595.32;
const pageHeight = sizeM ? Number(sizeM[2]) : 841.92;

// ── 2. words with bounding boxes (top-left origin, PDF points) ────────────────
const bboxXml = run("pdftotext", ["-bbox-layout", input, "-"]);
const pages = [];
const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}
let pm;
while ((pm = pageRe.exec(bboxXml)) !== null) {
  const [, pw, ph, inner] = pm;
  const words = [];
  let wm;
  while ((wm = wordRe.exec(inner)) !== null) {
    const x = +wm[1], y = +wm[2], xMax = +wm[3], yMax = +wm[4];
    const text = decode(wm[5]).trim();
    if (!text) continue;
    words.push({
      text, x: round(x), y: round(y),
      w: round(xMax - x), h: round(yMax - y),
      fontSize: round(yMax - y), // height ≈ font size in pt
    });
  }
  pages.push({ width: +pw, height: +ph, words });
}

// ── 3. group words into lines, lines into blocks (by y proximity) ─────────────
function groupLines(words) {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const w of sorted) {
    const cy = w.y + w.h / 2;
    let line = lines.find((l) => Math.abs(l.cy - cy) <= Math.max(3, w.h * 0.5));
    if (!line) { line = { cy, y: w.y, words: [] }; lines.push(line); }
    line.words.push(w);
  }
  return lines.map((l) => {
    const ws = l.words.sort((a, b) => a.x - b.x);
    return {
      y: round(Math.min(...ws.map((w) => w.y))),
      x: round(Math.min(...ws.map((w) => w.x))),
      xMax: round(Math.max(...ws.map((w) => w.x + w.w))),
      fontSize: round(Math.max(...ws.map((w) => w.h))),
      text: ws.map((w) => w.text).join(" "),
      words: ws,
    };
  }).sort((a, b) => a.y - b.y);
}

// ── 4. heuristic table region: a run of >=3 lines each with >=3 well-spaced words
function detectTable(lines) {
  const cols = (l) => l.words.length;
  let best = null, run = [];
  for (const l of lines) {
    if (cols(l) >= 3) run.push(l);
    else { if (run.length >= 3 && (!best || run.length > best.length)) best = run; run = []; }
  }
  if (run.length >= 3 && (!best || run.length > best.length)) best = run;
  if (!best) return null;
  // x-positions of column starts = median of word x across the run
  const xs = {};
  for (const l of best) for (const w of l.words) {
    const key = Math.round(w.x / 8) * 8;
    (xs[key] ||= []).push(w.x);
  }
  const columnX = Object.keys(xs).map(Number).sort((a, b) => a - b);
  return {
    yStart: best[0].y,
    yEnd: round(best[best.length - 1].y + best[best.length - 1].fontSize),
    rowCount: best.length,
    headerText: best[0].text,
    columnX,
  };
}

// ── 5. embedded images (largest = likely logo) ───────────────────────────────
run("pdfimages", ["-png", "-f", "1", "-l", "1", input, path.join(outDir, "img")]);
const imgFiles = fs.readdirSync(outDir).filter((f) => /^img-\d+\.png$/.test(f));
const images = imgFiles.map((f) => {
  const p = path.join(outDir, f);
  return { file: f, bytes: fs.statSync(p).size };
}).sort((a, b) => b.bytes - a.bytes);
if (images[0]) fs.copyFileSync(path.join(outDir, images[0].file), path.join(outDir, "logo.png"));

// ── 6. render page 1 as background image ─────────────────────────────────────
run("pdftoppm", ["-png", "-r", String(dpi), "-f", "1", "-l", "1", input, path.join(outDir, "page")]);
const pageImg = fs.readdirSync(outDir).find((f) => /^page-?0*1\.png$/.test(f) || /^page-\d+\.png$/.test(f));
if (pageImg && pageImg !== "page-1.png") fs.renameSync(path.join(outDir, pageImg), path.join(outDir, "page-1.png"));

// ── 7. assemble evidence ─────────────────────────────────────────────────────
const page1 = pages[0] || { width: pageWidth, height: pageHeight, words: [] };
const lines = groupLines(page1.words);
const evidence = {
  source: path.resolve(input),
  slug,
  pageCount,
  page: { width: round(page1.width || pageWidth), height: round(page1.height || pageHeight), dpi },
  meta: {
    title: (info.match(/Title:\s+(.*)/) || [])[1]?.trim() || "",
    producer: (info.match(/Producer:\s+(.*)/) || [])[1]?.trim() || "",
  },
  table: detectTable(lines),
  lineCount: lines.length,
  lines: lines.map((l) => ({ y: l.y, x: l.x, xMax: l.xMax, fontSize: l.fontSize, text: l.text })),
  words: page1.words,
  images,
  assets: { pageImage: "page-1.png", logo: images[0] ? "logo.png" : null },
};
fs.writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));

function round(n) { return Math.round(n * 100) / 100; }

console.log(`✓ Evidence extracted to ${path.relative(process.cwd(), outDir)}/`);
console.log(`  page: ${evidence.page.width}x${evidence.page.height}pt · words: ${page1.words.length} · lines: ${lines.length}`);
console.log(`  table: ${evidence.table ? `~${evidence.table.rowCount} rows, ${evidence.table.columnX.length} cols, y ${evidence.table.yStart}-${evidence.table.yEnd}` : "not detected"}`);
console.log(`  images: ${images.length} (logo => ${evidence.assets.logo || "none"})`);
console.log(`  files: evidence.json, page-1.png${evidence.assets.logo ? ", logo.png" : ""}`);
