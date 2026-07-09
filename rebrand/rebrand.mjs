#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";

/** bcrypt-hash a password via PHP (matches the API's password_hash, cost 12). "" on failure. */
function bcryptHash(plain) {
  try {
    return execFileSync("php", ["-r", "echo password_hash($argv[1], PASSWORD_BCRYPT, ['cost'=>12]);", plain], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const configPath = path.join(scriptDir, "brand.config.json");

const sourceBusinessDescription = "solar energy systems company";
const sourceProductsLine = "solar panels and hybrid inverters";

const args = process.argv.slice(2);
const apply = args.includes("--apply");

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

// Guided/interactive setup: prompts for every required value, writes brand.config.json,
// and tells you which asset files to drop into rebrand/assets/. Then exits.
if (args[0] === "init" || args.includes("--init") || args.includes("--guided")) {
  try { await runInit(); } catch (e) { console.error("\nSetup aborted: " + (e?.message || e)); process.exit(1); }
  process.exit(0);
}

const unknownArgs = args.filter((arg) => arg !== "--apply");
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs.join(", ")}`);
  console.error("Run node rebrand/rebrand.mjs --help for usage.");
  process.exit(1);
}

const config = loadConfig();
validateConfig(config);

const excludedDirectories = new Set(["node_modules", ".git", "dist", "dist-dealer", "graphify-out", "rebrand"]);
const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".ico", ".ttf", ".pdf", ".lockb", ".zip"]);

const tokenRules = buildTokenRules(config);
const genericFiles = collectGenericFiles();
const guardedItems = [];
const textPlans = [];
const tokenTotals = new Map(tokenRules.map((rule) => [rule.label, 0]));
const specificTotals = new Map();

for (const filePath of genericFiles) {
  const plan = planTextFile(filePath, (text, relPath) => {
    let next = text;
    const counts = [];

    for (const rule of tokenRules) {
      const result = replaceRule(next, rule);
      next = result.text;
      if (result.count > 0) {
        counts.push([rule.label, result.count]);
        tokenTotals.set(rule.label, (tokenTotals.get(rule.label) || 0) + result.count);
      }
    }

    const specific = applySpecificEdits(next, relPath, config);
    next = specific.text;
    for (const [label, count] of specific.counts) {
      counts.push([label, count]);
      specificTotals.set(label, (specificTotals.get(label) || 0) + count);
    }

    return { text: next, counts };
  });

  if (plan.replacements > 0 || plan.changed) {
    textPlans.push(plan);
  }
}

planGuardedEnv(textPlans, specificTotals, guardedItems, config);
planGuardedSftp(textPlans, specificTotals, guardedItems, config);
addStaticSkippedItems(guardedItems);

const assetPlans = planAssets(config);

if (apply) {
  for (const plan of textPlans) {
    if (plan.changed) {
      fs.writeFileSync(plan.absPath, plan.nextText, "utf8");
    }
  }
  applyAssetPlans(assetPlans);
}

printReport({
  mode: apply ? "apply" : "dry-run",
  textPlans,
  tokenTotals,
  specificTotals,
  assetPlans,
  guardedItems,
});

function printHelp() {
  console.log(`Reusable rebranding tool

Usage:
  node rebrand/rebrand.mjs init     Guided setup — prompts for every value, writes brand.config.json.
  node rebrand/rebrand.mjs          Dry-run only. Prints the plan and writes nothing.
  node rebrand/rebrand.mjs --apply  Apply text replacements and asset renames/copies.
  node rebrand/rebrand.mjs --help   Show this help.

Typical flow:
  1) node rebrand/rebrand.mjs init        (answer the prompts)
  2) drop logo.png / favicon.ico into rebrand/assets/  (optional, recommended)
  3) node rebrand/rebrand.mjs             (preview)
  4) node rebrand/rebrand.mjs --apply     (apply)
  5) cd frontend && npm run build && bash ../deploy-admin.sh

The script has zero npm dependencies.`);
}

// ── Guided setup ─────────────────────────────────────────────────────────────
async function runInit() {
  const prior = fs.existsSync(configPath) ? safeJson(fs.readFileSync(configPath, "utf8")) : {};
  const slug = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const kebabOf = (str) => String(str || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  console.log(`\n=== Rebrand: guided setup ===`);
  console.log(`Answer each prompt. Press Enter to accept the [default]. Ctrl+C to abort.\n`);

  // Line queue: works both interactively (waits for typed lines) and with piped
  // input (buffers all lines). On stream end, pending reads resolve to "" → default.
  const rl = readline.createInterface({ input });
  const buffered = [];
  const waiters = [];
  let ended = false;
  rl.on("line", (l) => { const w = waiters.shift(); if (w) w(l); else buffered.push(l); });
  rl.on("close", () => { ended = true; while (waiters.length) waiters.shift()(null); });
  function nextLine() {
    if (buffered.length) return Promise.resolve(buffered.shift());
    if (ended) return Promise.resolve(null);
    return new Promise((res) => waiters.push(res));
  }
  async function ask(label, def) {
    output.write(`${label}${def ? ` [${def}]` : ""}: `);
    const l = await nextLine();
    const a = (l == null ? "" : String(l)).trim();
    return a || def || "";
  }
  async function askBool(label, def) {
    output.write(`${label} (y/n) [${def ? "y" : "n"}]: `);
    const l = await nextLine();
    const a = (l == null ? "" : String(l)).trim().toLowerCase();
    if (!a) return def;
    return a.startsWith("y");
  }

  console.log("── Company identity ──");
  const displayName = await ask("Company display name (e.g. VB Solar System)", prior.displayName);
  const compactName = await ask("Compact name (no spaces; used in app text)", prior.compactName || displayName);
  const legalName = await ask("Legal/full name", prior.legalName || displayName);
  const division = await ask("Sub-label / division (shown under the name)", prior.division || "");
  const primaryColor = await ask("Brand color (hex — themes the app, sidebar & ID card)", prior.primaryColor || "#1f5a3a");

  console.log("\n── Identifiers (domains, emails, codes) ──");
  const stem = await ask("Lowercase stem (domains/emails/db)", prior.stem || slug(compactName));
  const kebab = await ask("Kebab name (asset/file names)", prior.kebab || kebabOf(displayName));
  const qrPrefix = await ask("Employee QR prefix", prior.qrPrefix || "EMP");
  const poPrefix = await ask("Purchase-order prefix", prior.poPrefix || `${(stem || "co").slice(0, 3).toUpperCase()}-PO`);

  console.log("\n── Business context (used in AI prompts & PDFs) ──");
  const description = await ask("Business description", prior.business?.description || "");
  const productsLine = await ask("Products line", prior.business?.productsLine || "");
  const tagline = await ask("Tagline (PDF header)", prior.business?.tagline || "");

  console.log("\n── Contact / tax ──");
  const address = await ask("Address", prior.contact?.address || "");
  const gstin = await ask("GSTIN", prior.contact?.gstin || "");

  console.log("\n── Bank (shown on quotations/invoices) ──");
  const accountName = await ask("Bank account name", prior.bank?.accountName || displayName.toUpperCase());
  const accountNo = await ask("Account number", prior.bank?.accountNo || "");
  const ifsc = await ask("IFSC", prior.bank?.ifsc || "");
  const branchLine = await ask("Bank / branch line", prior.bank?.branchLine || "");

  console.log("\n── Web / deploy ──");
  const apiBaseUrl = await ask("API base URL", prior.domains?.apiBaseUrl || `https://api.${stem}.com/api`);
  const dbName = await ask("DB name", prior.database?.name || `u000000_${stem}`);
  const dbUser = await ask("DB user", prior.database?.user || dbName);
  const applyToEnv = await askBool("Write DB name/user into root .env?", prior.database?.applyToEnv ?? false);
  const sftpRemotePath = await ask("SFTP remote path", prior.deploy?.sftpRemotePath || `/domains/api.${stem}.com/public_html`);
  const applyToSftp = await askBool("Write SFTP remote path into .vscode/sftp.json?", prior.deploy?.applyToSftp ?? false);

  console.log("\n── Admin login (seeded into the database schema) ──");
  const emailDomain = (apiBaseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^api\./, "")) || `${stem}.com`;
  const adminName = await ask("Admin name", prior.admin?.name || "Administrator");
  const adminEmail = await ask("Admin email (this is the login)", prior.admin?.email || `admin@${emailDomain}`);
  const adminPhone = await ask("Admin phone", prior.admin?.phone || "");
  const adminPassword = await ask("Admin password (Enter to keep existing / skip)", "");
  let passwordHash = prior.admin?.passwordHash || "";
  if (adminPassword) {
    const h = bcryptHash(adminPassword);
    if (h) { passwordHash = h; console.log("  ✓ password hashed (bcrypt) — stored as a hash, not plaintext"); }
    else console.log("  ⚠ couldn't hash (php not found) — admin seed skipped until a password is set");
  }

  rl.close();

  const cfg = {
    displayName, compactName, legalName, division, primaryColor, stem, kebab, qrPrefix, poPrefix,
    business: { description, productsLine, tagline },
    contact: { address, gstin },
    bank: { accountName, accountNo, ifsc, branchLine },
    domains: { apiBaseUrl },
    database: { name: dbName, user: dbUser, applyToEnv },
    deploy: { sftpRemotePath, applyToSftp },
    admin: { name: adminName, email: adminEmail, phone: adminPhone, staffRole: "owner", passwordHash },
  };
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`\n✓ Wrote ${rel(configPath)}`);

  // Asset guidance
  const assetDir = path.join(scriptDir, "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  const hasLogo = fs.existsSync(path.join(assetDir, "logo.png"));
  const hasFav = fs.existsSync(path.join(assetDir, "favicon.ico"));
  console.log(`\n── Assets (optional but recommended) ──`);
  console.log(`Drop these into ${rel(assetDir)}/ before applying:`);
  console.log(`  • logo.png      ${hasLogo ? "✓ present" : "… not found — add your logo"}`);
  console.log(`  • favicon.ico   ${hasFav ? "✓ present" : "… not found — add your favicon"}`);
  console.log(`(If omitted, the existing logo/favicon are kept but renamed to the new brand.)`);

  console.log(`\n── Admin login ──`);
  if (passwordHash) {
    console.log(`  ${adminEmail} — seeded into database/schema.sql (run build-schema / deploy.sh to regenerate).`);
  } else {
    console.log(`  No admin password set yet — re-run init with a password, or the schema seeds no login.`);
  }

  console.log(`\n── Next steps ──`);
  console.log(`  node rebrand/rebrand.mjs            # preview (dry-run)`);
  console.log(`  node rebrand/rebrand.mjs --apply    # apply text/asset rebrand`);
  console.log(`  bash database/build-schema.sh       # rebuild schema.sql (incl. admin login)`);
  console.log(`  ./deploy.sh                         # build the Hostinger bundle`);
}

function safeJson(text) { try { return JSON.parse(text); } catch { return {}; } }

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${rel(configPath)}`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function validateConfig(value) {
  const requiredStrings = [
    ["displayName"],
    ["compactName"],
    ["legalName"],
    ["division"],
    ["stem"],
    ["kebab"],
    ["qrPrefix"],
    ["poPrefix"],
    ["business", "description"],
    ["business", "productsLine"],
    ["business", "tagline"],
    ["contact", "address"],
    ["contact", "gstin"],
    ["bank", "accountName"],
    ["bank", "accountNo"],
    ["bank", "ifsc"],
    ["bank", "branchLine"],
    ["domains", "apiBaseUrl"],
    ["database", "name"],
    ["database", "user"],
    ["deploy", "sftpRemotePath"],
  ];

  for (const keyPath of requiredStrings) {
    const actual = getPath(value, keyPath);
    if (typeof actual !== "string" || actual.trim() === "") {
      throw new Error(`brand.config.json requires non-empty string: ${keyPath.join(".")}`);
    }
  }

  for (const keyPath of [["database", "applyToEnv"], ["deploy", "applyToSftp"]]) {
    if (typeof getPath(value, keyPath) !== "boolean") {
      throw new Error(`brand.config.json requires boolean: ${keyPath.join(".")}`);
    }
  }
}

function getPath(value, keyPath) {
  return keyPath.reduce((current, key) => (current == null ? undefined : current[key]), value);
}

function buildTokenRules(brand) {
  // Source tokens retargeted for a VB Solar base (this copy is already VB Solar-branded,
  // not pristine EcoSudar). Order matters: longer/more-specific strings first so a
  // substring like "VB Solar" never pre-empts "VB Solar System".
  return [
    literalRule("VB SOLAR SYSTEM (upper)", "VB SOLAR SYSTEM", brand.legalName.toUpperCase()),
    literalRule("VB Solar System", "VB Solar System", brand.legalName),
    literalRule("division", "Solar Energy Solutions", brand.division),
    literalRule("tagline", "Solar Power Systems", brand.business.tagline),
    literalRule("VB Solar (residual)", "VB Solar", brand.displayName),
    regexRule("vb-solar", /vb-solar/g, brand.kebab),
    literalRule("vbsolar", "vbsolar", brand.stem),
    literalRule("VBS- (qr prefix)", "VBS-", `${brand.qrPrefix}-`),
    literalRule("VB-PO- (po prefix)", "VB-PO-", `${brand.poPrefix}-`),
    literalRule("business.description phrase", sourceBusinessDescription, brand.business.description),
    literalRule("business.productsLine phrase", sourceProductsLine, brand.business.productsLine),
  ];
}

function literalRule(label, source, target) {
  return { kind: "literal", label, source, target };
}

function regexRule(label, source, target) {
  return { kind: "regex", label, source, target };
}

function replaceRule(text, rule) {
  if (rule.target === rule.source) {
    return { text, count: 0 };
  }

  if (rule.kind === "literal") {
    const count = countLiteral(text, rule.source);
    return count === 0 ? { text, count } : { text: text.split(rule.source).join(rule.target), count };
  }

  const matches = text.match(rule.source);
  const count = matches ? matches.length : 0;
  return count === 0 ? { text, count } : { text: text.replace(rule.source, () => rule.target), count };
}

function countLiteral(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const next = text.indexOf(needle, offset);
    if (next === -1) return count;
    count += 1;
    offset = next + needle.length;
  }
}

function collectGenericFiles() {
  const files = new Set();

  addWalkedFiles(files, path.join(repoRoot, "api"), (file) => [".php", ".sh"].includes(path.extname(file)));
  addWalkedFiles(files, path.join(repoRoot, "frontend", "src"), (file) => {
    return [".ts", ".tsx", ".css"].includes(path.extname(file));
  });

  for (const file of [
    "frontend/index.html",
    "frontend/dealer.html",
    "frontend/.env",
    "frontend/.env.example",
    "admin/index.html",
  ]) {
    addIfFile(files, path.join(repoRoot, file));
  }

  const controlRoot = path.join(repoRoot, "frontend");
  if (fs.existsSync(controlRoot)) {
    for (const entry of fs.readdirSync(controlRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        addIfFile(files, path.join(controlRoot, entry.name));
      }
    }
  }

  return [...files].filter(isAllowedTextFile).sort((a, b) => rel(a).localeCompare(rel(b)));
}

function addWalkedFiles(files, dir, predicate) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isExcludedDirectory(absPath)) continue;
      addWalkedFiles(files, absPath, predicate);
    } else if (entry.isFile() && predicate(absPath)) {
      addIfFile(files, absPath);
    }
  }
}

function addIfFile(files, filePath) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    files.add(path.resolve(filePath));
  }
}

function isAllowedTextFile(filePath) {
  const relative = rel(filePath);
  if (relative === ".env" || relative === ".vscode/sftp.json") return false;
  if (relative.startsWith("rebrand/")) return false;
  if (relative.startsWith("database/") && relative.endsWith(".sql")) return false;
  if (relative.startsWith("admin/assets/")) return false;
  if (binaryExtensions.has(path.extname(relative).toLowerCase())) return false;
  return !relative.split("/").some((part) => excludedDirectories.has(part));
}

function isExcludedDirectory(dirPath) {
  const relative = rel(dirPath);
  return relative.split("/").some((part) => excludedDirectories.has(part));
}

function planTextFile(absPath, transformer) {
  const original = fs.readFileSync(absPath, "utf8");
  const { text: nextText, counts } = transformer(original, rel(absPath));
  const replacements = counts.reduce((sum, [, count]) => sum + count, 0);
  return {
    absPath,
    relPath: rel(absPath),
    original,
    nextText,
    counts,
    replacements,
    changed: nextText !== original,
  };
}

function applySpecificEdits(text, relPath, brand) {
  let next = text;
  const counts = [];

  if (relPath === "frontend/src/lib/salesDocumentPdf.ts") {
    const companyLines = `lines: [${quoteJs(brand.business.tagline)}, ${quoteJs(brand.contact.address)}, ${quoteJs(`GSTIN: ${brand.contact.gstin}`)}],`;
    const lineResult = replaceRegex(next, /lines:\s*\[[^\n]*\],/, companyLines);
    next = lineResult.text;
    if (lineResult.count > 0) counts.push(["sales PDF company lines", lineResult.count]);

    const bankDetails = [
      "const BANK_DETAILS = [",
      `  ${quoteJs("BANK DETAILS:")},`,
      `  ${quoteJs(brand.bank.accountName)},`,
      `  ${quoteJs(`A/C No: ${brand.bank.accountNo} · IFSC: ${brand.bank.ifsc}`)},`,
      `  ${quoteJs(brand.bank.branchLine)},`,
      "];",
    ].join("\n");
    const bankResult = replaceRegex(next, /const BANK_DETAILS = \[[\s\S]*?\];/, bankDetails);
    next = bankResult.text;
    if (bankResult.count > 0) counts.push(["sales PDF bank details", bankResult.count]);
  }

  if (relPath === "frontend/.env" || relPath === "frontend/.env.example") {
    const envResult = replaceRegex(next, /^VITE_API_BASE_URL=.*$/gm, `VITE_API_BASE_URL=${JSON.stringify(brand.domains.apiBaseUrl)}`);
    next = envResult.text;
    if (envResult.count > 0) counts.push(["VITE_API_BASE_URL", envResult.count]);
  }

  return { text: next, counts };
}

function replaceRegex(text, regex, replacement) {
  let count = 0;
  const next = text.replace(regex, (match) => {
    if (match !== replacement) count += 1;
    return replacement;
  });
  return { text: next, count };
}

function quoteJs(value) {
  return JSON.stringify(value);
}

function planGuardedEnv(textPlans, totals, guarded, brand) {
  const envPath = path.join(repoRoot, ".env");
  if (!brand.database.applyToEnv) {
    guarded.push("root .env DB_NAME/DB_USER skipped because database.applyToEnv is false");
    return;
  }
  if (!fs.existsSync(envPath)) {
    guarded.push("root .env DB_NAME/DB_USER requested but .env was not found");
    return;
  }

  const plan = planTextFile(envPath, (text) => {
    let next = text;
    const counts = [];
    const dbName = replaceRegex(next, /^DB_NAME=.*$/m, `DB_NAME=${brand.database.name}`);
    next = dbName.text;
    if (dbName.count > 0) counts.push(["guarded root .env DB_NAME", dbName.count]);

    const dbUser = replaceRegex(next, /^DB_USER=.*$/m, `DB_USER=${brand.database.user}`);
    next = dbUser.text;
    if (dbUser.count > 0) counts.push(["guarded root .env DB_USER", dbUser.count]);

    return { text: next, counts };
  });

  if (plan.replacements > 0 || plan.changed) {
    textPlans.push(plan);
    for (const [label, count] of plan.counts) totals.set(label, (totals.get(label) || 0) + count);
  }
}

function planGuardedSftp(textPlans, totals, guarded, brand) {
  const sftpPath = path.join(repoRoot, ".vscode", "sftp.json");
  if (!brand.deploy.applyToSftp) {
    guarded.push(".vscode/sftp.json remotePath skipped because deploy.applyToSftp is false");
    return;
  }
  if (!fs.existsSync(sftpPath)) {
    guarded.push(".vscode/sftp.json remotePath requested but file was not found");
    return;
  }

  const plan = planTextFile(sftpPath, (text) => {
    const result = replaceRegex(text, /"remotePath"\s*:\s*"[^"]*"/, `"remotePath": ${JSON.stringify(brand.deploy.sftpRemotePath)}`);
    return {
      text: result.text,
      counts: result.count > 0 ? [["guarded SFTP remotePath", result.count]] : [],
    };
  });

  if (plan.replacements > 0 || plan.changed) {
    textPlans.push(plan);
    for (const [label, count] of plan.counts) totals.set(label, (totals.get(label) || 0) + count);
  }
}

function addStaticSkippedItems(guarded) {
  if (fs.existsSync(path.join(repoRoot, "database"))) {
    guarded.push("database/*.sql excluded; database dumps are data snapshots handled separately");
  }
  guarded.push("admin/assets, dist, dist-dealer, graphify-out, node_modules, .git, rebrand, and binary files excluded");
}

function planAssets(brand) {
  return [
    planAsset({
      label: "logo",
      providedRel: "rebrand/assets/logo.png",
      oldRel: "frontend/src/assets/vb-solar-logo.png",
      newRel: `frontend/src/assets/${brand.kebab}-logo.png`,
    }),
    planAsset({
      label: "favicon",
      providedRel: "rebrand/assets/favicon.ico",
      oldRel: "frontend/public/myvbsolar.ico",
      newRel: `frontend/public/my${brand.stem}.ico`,
    }),
  ];
}

function planAsset({ label, providedRel, oldRel, newRel }) {
  const providedAbs = path.join(repoRoot, providedRel);
  const oldAbs = path.join(repoRoot, oldRel);
  const newAbs = path.join(repoRoot, newRel);
  const providedExists = fs.existsSync(providedAbs);
  const oldExists = fs.existsSync(oldAbs);
  const newExists = fs.existsSync(newAbs);

  let status = "ready";
  if (!providedExists && !oldExists && !newExists) {
    status = "missing-source";
  } else if (!providedExists && !oldExists && newExists) {
    status = "already-renamed";
  }

  return {
    label,
    providedRel,
    oldRel,
    newRel,
    providedAbs,
    oldAbs,
    newAbs,
    providedExists,
    oldExists,
    newExists,
    status,
  };
}

function applyAssetPlans(assetPlans) {
  for (const plan of assetPlans) {
    if (plan.status === "missing-source" || plan.status === "already-renamed") continue;

    fs.mkdirSync(path.dirname(plan.newAbs), { recursive: true });
    if (plan.providedExists) {
      fs.copyFileSync(plan.providedAbs, plan.newAbs);
    } else if (plan.oldExists) {
      fs.copyFileSync(plan.oldAbs, plan.newAbs);
    }

    if (plan.oldExists && plan.oldAbs !== plan.newAbs) {
      fs.rmSync(plan.oldAbs);
    }
  }
}

function printReport({ mode, textPlans, tokenTotals, specificTotals, assetPlans, guardedItems }) {
  const totalReplacements = textPlans.reduce((sum, plan) => sum + plan.replacements, 0);
  const filesChanged = textPlans.filter((plan) => plan.changed).length;
  const assetsCopied = assetPlans.filter((plan) => plan.providedExists && plan.status === "ready").length;
  const filesRenamed = assetPlans.filter((plan) => plan.oldExists && plan.oldRel !== plan.newRel && plan.status === "ready").length;

  console.log(`Rebrand ${mode === "apply" ? "apply" : "dry-run"} plan`);
  console.log(`Config: ${rel(configPath)}`);
  console.log("");
  console.log("Per-file replacements:");
  if (textPlans.length === 0) {
    console.log("  No text replacements planned.");
  } else {
    for (const plan of textPlans) {
      console.log(`  ${plan.relPath}: ${plan.replacements} replacement${plan.replacements === 1 ? "" : "s"}`);
      for (const [label, count] of plan.counts) {
        console.log(`    - ${label}: ${count}`);
      }
    }
  }

  console.log("");
  console.log("Token replacement totals:");
  let printedAnyToken = false;
  for (const [label, count] of [...tokenTotals, ...specificTotals]) {
    if (count === 0) continue;
    printedAnyToken = true;
    console.log(`  ${label}: ${count}`);
  }
  if (!printedAnyToken) console.log("  No token replacements planned.");

  console.log("");
  console.log("Asset plan:");
  for (const plan of assetPlans) {
    if (plan.status === "missing-source") {
      console.log(`  ${plan.label}: skipped; neither ${plan.providedRel} nor ${plan.oldRel} exists`);
    } else if (plan.status === "already-renamed") {
      console.log(`  ${plan.label}: already renamed at ${plan.newRel}`);
    } else {
      const source = plan.providedExists ? plan.providedRel : plan.oldRel;
      console.log(`  ${plan.label}: write ${plan.newRel} from ${source}; remove ${plan.oldRel}`);
    }
  }

  console.log("");
  console.log("Skipped/guarded items:");
  for (const item of guardedItems) {
    console.log(`  - ${item}`);
  }

  console.log("");
  console.log("Summary:");
  console.log(`  Mode: ${mode}`);
  console.log(`  Files ${mode === "apply" ? "changed" : "to change"}: ${filesChanged}`);
  console.log(`  Total replacements: ${totalReplacements}`);
  console.log(`  Assets copied from rebrand/assets: ${assetsCopied}`);
  console.log(`  Files renamed: ${filesRenamed}`);
  console.log(`  Guarded/skipped notes: ${guardedItems.length}`);
  if (mode !== "apply") {
    console.log("  Dry-run only: no files were written. Re-run with --apply to write changes.");
  }
}

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}
