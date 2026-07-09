import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart as LineChartIcon, Settings2, RefreshCw, Landmark, FileSpreadsheet, FileText,
  ArrowLeftRight, Scale, TrendingUp, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from "recharts";
import { getCompanyProfile } from "@/lib/companyProfile";
import {
  fetchStatements, fetchFinanceConfig, updateFinanceConfig, type Statements,
} from "@/lib/api/financeStatements";

// Validated categorical palette (dataviz skill — light-mode set, CVD ΔE 24.2).
// Identity is never colour-alone: every chart ships direct value labels.
const CAT = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const GOOD = "#0ca30c", CRIT = "#d03b3b", PRIMARY = "#2a78d6";
const axisFmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
};
const tip = (v: number | string) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const inr = (v: number) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const money = (v: number | string) => (typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : v);

type LR = [string, number | string];

// ── Statement line builders (shared by tables + exports) ────────────────────
function plLines(p: Statements["pnl"]): LR[] {
  return [
    ["Revenue (net of GST)", p.revenue],
    ["Less: Cost of goods sold", p.cogs],
    ["Gross Profit", p.gross_profit],
    ...p.expense_groups.map((g) => [`  ${g.category}`, g.amount] as LR),
    ["Total operating expenses", p.operating_expenses],
    ["EBITDA", p.ebitda],
    ["Depreciation", p.depreciation],
    ["EBIT", p.ebit],
    ["Interest", p.interest],
    ["Profit before tax (EBT)", p.ebt],
    ["Tax", p.tax],
    ["Net Profit", p.net_profit],
  ];
}
function bsLines(b: Statements["balance_sheet"]): LR[] {
  return [
    ["ASSETS", ""],
    ["Fixed assets (gross)", b.assets.fixed_assets_gross],
    ["Inventory", b.assets.inventory],
    ["Receivables", b.assets.receivables],
    ["Cash & Bank", b.assets.cash_bank],
    ["Total Assets", b.assets.total],
    ["", ""],
    ["LIABILITIES & EQUITY", ""],
    ["Capital", b.liabilities.capital],
    ["Surplus (period profit)", b.liabilities.surplus],
    ["Loans", b.liabilities.loans],
    ["Creditors (payables)", b.liabilities.creditors],
    ["Total Liabilities & Equity", b.liabilities.total],
    ["Difference", b.difference],
  ];
}
function cfLines(c: Statements["cash_flow"]): LR[] {
  return [
    ["Net profit", c.net_profit],
    ["Add: Depreciation", c.depreciation],
    ["Less: Working capital", c.working_capital],
    ["Cash from Operations", c.operating],
    ["Cash from Investing", c.investing],
    ["Cash from Financing", c.financing],
    ["Net cash generated", c.net_cash],
    ["Opening cash balance", c.opening_cash],
    ["Closing cash balance", c.closing_cash],
  ];
}

// ── Downloads ───────────────────────────────────────────────────────────────
const fileStem = (name: string, p: Statements["period"]) =>
  `${name.replace(/[^\w]+/g, "-")}_${p.from}_${p.to}`;

function stExcel(name: string, rows: LR[], d: Statements) {
  const cp = getCompanyProfile();
  const aoa: (string | number)[][] = [
    [`${cp.name || "Financial Statements"} — ${name}`],
    [`Period: ${d.period.from} to ${d.period.to}${d.extended ? "  (includes extra amount)" : ""}`],
    [],
    [name, "Amount (₹)"],
    ...rows.map(([l, v]) => [l, v] as (string | number)[]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 34 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  XLSX.writeFile(wb, `${fileStem(name, d.period)}.xlsx`);
}

function stPdf(name: string, rows: LR[], d: Statements) {
  const cp = getCompanyProfile();
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  doc.setFont("helvetica", "bold").setFontSize(15);
  doc.text(cp.name || "Financial Statements", 40, 44);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100);
  doc.text(`${name}  ·  ${d.period.from} to ${d.period.to}${d.extended ? "  (incl. extra)" : ""}`, 40, 60);
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 78,
    head: [[name, "Amount (₹)"]],
    body: rows.map(([l, v]) => [l, money(v)]),
    headStyles: { fillColor: [46, 160, 218], textColor: 255 },
    columnStyles: { 1: { halign: "right" } },
    styles: { fontSize: 9, cellPadding: 4 },
    margin: { left: 40, right: 40 },
    theme: "grid",
  });
  doc.save(`${fileStem(name, d.period)}.pdf`);
}

/** Transactions ledger rows as an array-of-arrays (with opening/closing lines). */
function txAoa(d: Statements): (string | number)[][] {
  const t = d.transactions;
  return [
    ["Date", "Particulars", "Category", "Inflow (₹)", "Outflow (₹)", "Balance (₹)"],
    [d.period.from, "Opening balance", "", "", "", t.opening_cash],
    ...t.rows.map((r) => [r.date, r.particulars, r.type, r.inflow || "", r.outflow || "", r.balance] as (string | number)[]),
    ["", "Total / Closing balance", "", t.total_in, t.total_out, t.closing],
  ];
}
function txExcel(d: Statements) {
  const cp = getCompanyProfile();
  const aoa: (string | number)[][] = [
    [`${cp.name || "Financial Statements"} — Transactions (Cash Book)`],
    [`Period: ${d.period.from} to ${d.period.to}`],
    [],
    ...txAoa(d),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 12 }, { wch: 36 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  XLSX.writeFile(wb, `${fileStem("Transactions", d.period)}.xlsx`);
}
function txPdf(d: Statements) {
  const cp = getCompanyProfile();
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  doc.setFont("helvetica", "bold").setFontSize(15);
  doc.text(cp.name || "Financial Statements", 40, 44);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100);
  doc.text(`Transactions (Cash Book)  ·  ${d.period.from} to ${d.period.to}`, 40, 60);
  doc.setTextColor(0);
  const [head, ...body] = txAoa(d);
  autoTable(doc, {
    startY: 78,
    head: [head.map(String)],
    body: body.map((r) => r.map((c) => (typeof c === "number" ? money(c) : String(c)))),
    headStyles: { fillColor: [46, 160, 218], textColor: 255 },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    styles: { fontSize: 8, cellPadding: 3 },
    margin: { left: 30, right: 30 },
    theme: "grid",
  });
  doc.save(`${fileStem("Transactions", d.period)}.pdf`);
}

/** Overall — the single-frame workbook: P&L | Balance Sheet | Cash Flow side-by-side + a Transactions sheet. */
function overallExcel(d: Statements) {
  const cp = getCompanyProfile();
  const pl = plLines(d.pnl), bs = bsLines(d.balance_sheet), cf = cfLines(d.cash_flow);
  const n = Math.max(pl.length, bs.length, cf.length);
  const aoa: (string | number)[][] = [
    [`${cp.name || "Financial Statements"} — Financial Statements (Single Frame)`],
    [`Period: ${d.period.from} to ${d.period.to}${d.extended ? "  (includes extra amount)" : ""}`],
    [],
    ["PROFIT & LOSS", "", "", "BALANCE SHEET", "", "", "CASH FLOW", ""],
  ];
  for (let i = 0; i < n; i++) {
    const [pl0, pl1] = pl[i] ?? ["", ""];
    const [bs0, bs1] = bs[i] ?? ["", ""];
    const [cf0, cf1] = cf[i] ?? ["", ""];
    aoa.push([pl0, pl1, "", bs0, bs1, "", cf0, cf1]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 2 }, { wch: 26 }, { wch: 14 }, { wch: 2 }, { wch: 24 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Financials");
  const wsTx = XLSX.utils.aoa_to_sheet(txAoa(d));
  wsTx["!cols"] = [{ wch: 12 }, { wch: 36 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsTx, "Transactions");
  XLSX.writeFile(wb, `${fileStem("Financial-Statements", d.period)}.xlsx`);
}
function overallPdf(d: Statements) {
  const cp = getCompanyProfile();
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  doc.setFont("helvetica", "bold").setFontSize(15);
  doc.text(cp.name || "Financial Statements", 40, 44);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100);
  doc.text(`Financial Statements  ·  ${d.period.from} to ${d.period.to}${d.extended ? "  (incl. extra)" : ""}`, 40, 60);
  doc.setTextColor(0);
  const section = (title: string, rows: LR[], startY: number) => {
    autoTable(doc, {
      startY,
      head: [[title, "Amount (₹)"]],
      body: rows.map(([l, v]) => [l, money(v)]),
      headStyles: { fillColor: [46, 160, 218], textColor: 255 },
      columnStyles: { 1: { halign: "right" } },
      styles: { fontSize: 9, cellPadding: 4 },
      margin: { left: 40, right: 40 },
      theme: "grid",
    });
    // @ts-expect-error augmented instance
    return doc.lastAutoTable.finalY + 16;
  };
  let y = 78;
  y = section("PROFIT & LOSS", plLines(d.pnl), y);
  y = section("BALANCE SHEET", bsLines(d.balance_sheet), y);
  section("CASH FLOW", cfLines(d.cash_flow), y);
  // Transactions on its own page.
  doc.addPage();
  doc.setFont("helvetica", "bold").setFontSize(13);
  doc.text("Transactions (Cash Book)", 40, 40);
  const [thead, ...tbody] = txAoa(d);
  autoTable(doc, {
    startY: 54,
    head: [thead.map(String)],
    body: tbody.map((r) => r.map((c) => (typeof c === "number" ? money(c) : String(c)))),
    headStyles: { fillColor: [46, 160, 218], textColor: 255 },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    styles: { fontSize: 8, cellPadding: 3 },
    margin: { left: 30, right: 30 },
    theme: "grid",
  });
  doc.save(`${fileStem("Financial-Statements", d.period)}.pdf`);
}

const firstOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

export default function FinancialStatements() {
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<Statements | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [cfg, setCfg] = useState({ opening_cash: "", depreciation_rate_pct: "", fixed_assets_gross: "" });
  const [savingCfg, setSavingCfg] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setData(await fetchStatements(from, to));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load statements");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function openSetup() {
    try {
      const c = await fetchFinanceConfig();
      setCfg({
        opening_cash: String(c.opening_cash?.value ?? 0),
        depreciation_rate_pct: String(c.depreciation_rate_pct?.value ?? 0),
        fixed_assets_gross: String(c.fixed_assets_gross?.value ?? 0),
      });
    } catch { /* defaults */ }
    setSetupOpen(true);
  }
  async function saveSetup() {
    setSavingCfg(true);
    try {
      await updateFinanceConfig({
        opening_cash: Number(cfg.opening_cash) || 0,
        depreciation_rate_pct: Number(cfg.depreciation_rate_pct) || 0,
        fixed_assets_gross: Number(cfg.fixed_assets_gross) || 0,
      });
      toast.success("Finance setup saved");
      setSetupOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingCfg(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><LineChartIcon className="h-6 w-6" /> Financial Statements</h1>
          <p className="text-sm text-muted-foreground">Transactions, Profit &amp; Loss, Balance Sheet and Cash Flow — each with its own dashboard and download.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted-foreground text-sm">to</span>
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Run</Button>
          <Button variant="outline" onClick={openSetup}><Settings2 className="h-4 w-4 mr-1" /> Setup</Button>
          <Link to="/capital-loans"><Button variant="outline"><Landmark className="h-4 w-4 mr-1" /> Capital &amp; Loans</Button></Link>
        </div>
      </div>

      {data?.extended && (
        <p className="text-xs text-amber-600">Extended (tax) view — figures include the off-books extra amount.</p>
      )}

      {loading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Tabs defaultValue="overview" className="space-y-5">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview"><Scale className="h-4 w-4 mr-1.5" /> Overall</TabsTrigger>
            <TabsTrigger value="transactions"><ArrowLeftRight className="h-4 w-4 mr-1.5" /> Transactions</TabsTrigger>
            <TabsTrigger value="pnl"><TrendingUp className="h-4 w-4 mr-1.5" /> Profit &amp; Loss</TabsTrigger>
            <TabsTrigger value="bs"><Scale className="h-4 w-4 mr-1.5" /> Balance Sheet</TabsTrigger>
            <TabsTrigger value="cf"><Wallet className="h-4 w-4 mr-1.5" /> Cash Flow</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-5"><OverviewTab d={data} /></TabsContent>
          <TabsContent value="transactions" className="space-y-5"><TransactionsTab d={data} /></TabsContent>
          <TabsContent value="pnl" className="space-y-5"><PnlTab d={data} /></TabsContent>
          <TabsContent value="bs" className="space-y-5"><BalanceSheetTab d={data} /></TabsContent>
          <TabsContent value="cf" className="space-y-5"><CashFlowTab d={data} /></TabsContent>
        </Tabs>
      )}

      <p className="text-xs text-muted-foreground">
        Accrual basis for P&amp;L / Balance Sheet (Revenue = invoiced sales; COGS = cost of machines sold). The Transactions tab is a
        cash book (real cash in/out). Capital, loans, opening cash, depreciation % and fixed-asset value come from Setup / Capital &amp; Loans.
      </p>

      {/* Setup dialog */}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Finance setup</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Opening cash / bank balance (₹)</label>
              <Input type="number" value={cfg.opening_cash} onChange={(e) => setCfg({ ...cfg, opening_cash: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Fixed assets — own equipment (₹, gross)</label>
              <Input type="number" value={cfg.fixed_assets_gross} onChange={(e) => setCfg({ ...cfg, fixed_assets_gross: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Depreciation rate (% per year on fixed assets)</label>
              <Input type="number" value={cfg.depreciation_rate_pct} onChange={(e) => setCfg({ ...cfg, depreciation_rate_pct: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">Capital brought in and loans are managed on the Capital &amp; Loans page.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetupOpen(false)}>Cancel</Button>
            <Button onClick={saveSetup} disabled={savingCfg}>{savingCfg ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ════════════════════════════ TABS ═════════════════════════════════════════

function OverviewTab({ d }: { d: Statements }) {
  return (
    <>
      <DlBar label="Download the whole document" onExcel={() => overallExcel(d)} onPdf={() => overallPdf(d)} allLabel />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Revenue" value={d.pnl.revenue} />
        <Kpi label="Net Profit" value={d.pnl.net_profit} tone={d.pnl.net_profit >= 0 ? "good" : "crit"} />
        <Kpi label="Cash Balance" value={d.cash_flow.closing_cash} />
        <Kpi label="Receivables" value={d.balance_sheet.assets.receivables} />
        <Kpi label="Payables" value={d.balance_sheet.liabilities.creditors} tone={d.balance_sheet.liabilities.creditors > 0 ? "crit" : undefined} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PnlLevelsChart p={d.pnl} />
        <ExpenseBreakdownChart p={d.pnl} />
        <AssetsVsLiabChart b={d.balance_sheet} />
        <CashFlowChart c={d.cash_flow} />
      </div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase pt-2">Detailed statements</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4"><PnlTable p={d.pnl} /></div>
        <div className="rounded-xl border bg-card p-4"><BsTable b={d.balance_sheet} to={d.period.to} /></div>
        <div className="rounded-xl border bg-card p-4"><CfTable c={d.cash_flow} /></div>
      </div>
    </>
  );
}

function TransactionsTab({ d }: { d: Statements }) {
  const t = d.transactions;
  const balSeries = [
    { name: "Open", balance: t.opening_cash },
    ...t.rows.map((r) => ({ name: r.date, balance: r.balance })),
  ];
  const cats: Array<Statements["transactions"]["rows"][number]["type"]> = ["Revenue", "Asset", "Expense", "Liability"];
  const byCat = cats
    .map((c) => {
      const rows = t.rows.filter((r) => r.type === c);
      const inflow = rows.reduce((s, r) => s + r.inflow, 0);
      const outflow = rows.reduce((s, r) => s + r.outflow, 0);
      return { name: c, net: Math.round((inflow - outflow) * 100) / 100 };
    })
    .filter((x) => x.net !== 0);

  return (
    <>
      <DlBar label="Cash book" onExcel={() => txExcel(d)} onPdf={() => txPdf(d)} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Opening cash" value={t.opening_cash} />
        <Kpi label="Total inflow" value={t.total_in} tone="good" />
        <Kpi label="Total outflow" value={t.total_out} tone="crit" />
        <Kpi label="Closing cash" value={t.closing} tone={t.closing >= 0 ? "good" : "crit"} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Cash in vs cash out">
          <BarChart data={[{ name: "Inflow", v: t.total_in }, { name: "Outflow", v: t.total_out }]} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
            <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip formatter={(v) => tip(v as number)} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="v" name="Amount" radius={[4, 4, 0, 0]} maxBarSize={80}>
              <Cell fill={GOOD} /><Cell fill={CRIT} />
              <LabelList dataKey="v" position="top" formatter={axisFmt} style={{ fontSize: 11, fill: "#52514e" }} />
            </Bar>
          </BarChart>
        </ChartCard>
        <ChartCard title="Running cash balance">
          {balSeries.length <= 1 ? <Empty text="No cash movements in this period." /> : (
            <AreaChart data={balSeries} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} width={44} />
              <Tooltip formatter={(v) => tip(v as number)} />
              <Area type="monotone" dataKey="balance" name="Balance" stroke={PRIMARY} strokeWidth={2} fill="url(#balGrad)" />
            </AreaChart>
          )}
        </ChartCard>
        {byCat.length > 0 && (
          <ChartCard title="Net by category (Revenue / Asset / Expense / Liability)">
            <BarChart data={byCat} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" horizontal={false} />
              <XAxis type="number" tickFormatter={axisFmt} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => tip(v as number)} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
              <Bar dataKey="net" name="Net" radius={[0, 4, 4, 0]} maxBarSize={26}>
                {byCat.map((x, i) => <Cell key={i} fill={x.net >= 0 ? GOOD : CRIT} />)}
                <LabelList dataKey="net" position="right" formatter={axisFmt} style={{ fontSize: 11, fill: "#52514e" }} />
              </Bar>
            </BarChart>
          </ChartCard>
        )}
      </div>
      <div className="rounded-xl border bg-card p-4">
        <h2 className="font-semibold mb-3">Ledger</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1.5 pr-3 font-medium">Date</th>
                <th className="py-1.5 pr-3 font-medium">Particulars</th>
                <th className="py-1.5 pr-3 font-medium">Category</th>
                <th className="py-1.5 pr-3 font-medium text-right">Inflow</th>
                <th className="py-1.5 pr-3 font-medium text-right">Outflow</th>
                <th className="py-1.5 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b text-muted-foreground">
                <td className="py-1.5 pr-3 tabular-nums">{d.period.from}</td>
                <td className="py-1.5 pr-3">Opening balance</td>
                <td className="py-1.5 pr-3" />
                <td className="py-1.5 pr-3" />
                <td className="py-1.5 pr-3" />
                <td className="py-1.5 text-right tabular-nums">{inr(t.opening_cash)}</td>
              </tr>
              {t.rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{r.date}</td>
                  <td className="py-1.5 pr-3">{r.particulars}</td>
                  <td className="py-1.5 pr-3"><TypeTag t={r.type} /></td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-green-700">{r.inflow ? inr(r.inflow) : ""}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-red-600">{r.outflow ? inr(r.outflow) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{inr(r.balance)}</td>
                </tr>
              ))}
              {t.rows.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No cash transactions in this period.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="py-2 pr-3" />
                <td className="py-2 pr-3">Closing balance</td>
                <td className="py-2 pr-3" />
                <td className="py-2 pr-3 text-right tabular-nums text-green-700">{inr(t.total_in)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-red-600">{inr(t.total_out)}</td>
                <td className="py-2 text-right tabular-nums">{inr(t.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}

function PnlTab({ d }: { d: Statements }) {
  const p = d.pnl;
  return (
    <>
      <DlBar label="Profit & Loss A/C" onExcel={() => stExcel("Profit and Loss", plLines(p), d)} onPdf={() => stPdf("Profit and Loss", plLines(p), d)} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Revenue" value={p.revenue} />
        <Kpi label="Gross Profit" value={p.gross_profit} tone={p.gross_profit >= 0 ? "good" : "crit"} />
        <Kpi label="EBITDA" value={p.ebitda} />
        <Kpi label="Net Profit" value={p.net_profit} tone={p.net_profit >= 0 ? "good" : "crit"} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PnlLevelsChart p={p} />
        <ExpenseBreakdownChart p={p} />
      </div>
      <div className="rounded-xl border bg-card p-4"><PnlTable p={p} /></div>
    </>
  );
}

function BalanceSheetTab({ d }: { d: Statements }) {
  const b = d.balance_sheet;
  const assetRows = [
    { name: "Fixed assets", v: b.assets.fixed_assets_gross },
    { name: "Inventory", v: b.assets.inventory },
    { name: "Receivables", v: b.assets.receivables },
    { name: "Cash & Bank", v: b.assets.cash_bank },
  ].filter((r) => r.v);
  const liabRows = [
    { name: "Capital", v: b.liabilities.capital },
    { name: "Surplus", v: b.liabilities.surplus },
    { name: "Loans", v: b.liabilities.loans },
    { name: "Creditors", v: b.liabilities.creditors },
  ].filter((r) => r.v);
  return (
    <>
      <DlBar label="Balance Sheet" onExcel={() => stExcel("Balance Sheet", bsLines(b), d)} onPdf={() => stPdf("Balance Sheet", bsLines(b), d)} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total Assets" value={b.assets.total} />
        <Kpi label="Liab. & Equity" value={b.liabilities.total} />
        <Kpi label="Inventory" value={b.assets.inventory} />
        <Kpi label="Difference" value={b.difference} tone={Math.abs(b.difference) > 0.5 ? "crit" : "good"} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CompositionChart title="Assets composition" rows={assetRows} />
        <CompositionChart title="Liabilities & equity composition" rows={liabRows} />
        <AssetsVsLiabChart b={b} />
      </div>
      <div className="rounded-xl border bg-card p-4"><BsTable b={b} to={d.period.to} /></div>
    </>
  );
}

function CashFlowTab({ d }: { d: Statements }) {
  const c = d.cash_flow;
  const waterfall = [
    { name: "Opening", v: c.opening_cash },
    { name: "Operating", v: c.operating },
    { name: "Investing", v: c.investing },
    { name: "Financing", v: c.financing },
    { name: "Closing", v: c.closing_cash },
  ];
  return (
    <>
      <DlBar label="Cash Flow Statement" onExcel={() => stExcel("Cash Flow", cfLines(c), d)} onPdf={() => stPdf("Cash Flow", cfLines(c), d)} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="From Operations" value={c.operating} tone={c.operating >= 0 ? "good" : "crit"} />
        <Kpi label="From Financing" value={c.financing} tone={c.financing >= 0 ? "good" : "crit"} />
        <Kpi label="Net cash" value={c.net_cash} tone={c.net_cash >= 0 ? "good" : "crit"} />
        <Kpi label="Closing cash" value={c.closing_cash} tone={c.closing_cash >= 0 ? "good" : "crit"} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CashFlowChart c={c} />
        <ChartCard title="Opening → activities → closing">
          <BarChart data={waterfall} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
            <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip formatter={(v) => tip(v as number)} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="v" name="Cash" radius={[4, 4, 0, 0]} maxBarSize={54}>
              {waterfall.map((x, i) => <Cell key={i} fill={i === 0 || i === waterfall.length - 1 ? PRIMARY : x.v >= 0 ? GOOD : CRIT} />)}
              <LabelList dataKey="v" position="top" formatter={axisFmt} style={{ fontSize: 11, fill: "#52514e" }} />
            </Bar>
          </BarChart>
        </ChartCard>
      </div>
      <div className="rounded-xl border bg-card p-4"><CfTable c={c} /></div>
    </>
  );
}

// ════════════════════════════ CHARTS ═══════════════════════════════════════

function PnlLevelsChart({ p }: { p: Statements["pnl"] }) {
  return (
    <ChartCard title="Profit & Loss — key levels">
      <BarChart data={[
        { name: "Revenue", v: p.revenue },
        { name: "Gross", v: p.gross_profit },
        { name: "EBITDA", v: p.ebitda },
        { name: "Net", v: p.net_profit },
      ]} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
        <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} width={44} />
        <Tooltip formatter={(v) => tip(v as number)} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="v" name="Amount" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={64}>
          <LabelList dataKey="v" position="top" formatter={axisFmt} style={{ fontSize: 11, fill: "#52514e" }} />
        </Bar>
      </BarChart>
    </ChartCard>
  );
}

function ExpenseBreakdownChart({ p }: { p: Statements["pnl"] }) {
  const rows = [
    ...(p.cogs > 0 ? [{ name: "COGS", v: p.cogs }] : []),
    ...p.expense_groups.map((g) => ({ name: g.category, v: g.amount })),
    ...(p.depreciation > 0 ? [{ name: "Depreciation", v: p.depreciation }] : []),
  ];
  return (
    <ChartCard title="Expense breakdown">
      {rows.length === 0 ? <Empty text="No expenses in this period." /> : (
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" horizontal={false} />
          <XAxis type="number" tickFormatter={axisFmt} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => tip(v as number)} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Bar dataKey="v" name="Amount" radius={[0, 4, 4, 0]} maxBarSize={26}>
            {rows.map((_, i) => <Cell key={i} fill={CAT[i % CAT.length]} />)}
            <LabelList dataKey="v" position="right" formatter={axisFmt} style={{ fontSize: 11, fill: "#52514e" }} />
          </Bar>
        </BarChart>
      )}
    </ChartCard>
  );
}

function CompositionChart({ title, rows }: { title: string; rows: { name: string; v: number }[] }) {
  return (
    <ChartCard title={title}>
      {rows.length === 0 ? <Empty text="Nothing to show." /> : (
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" horizontal={false} />
          <XAxis type="number" tickFormatter={axisFmt} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => tip(v as number)} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Bar dataKey="v" name="Amount" radius={[0, 4, 4, 0]} maxBarSize={26}>
            {rows.map((_, i) => <Cell key={i} fill={CAT[i % CAT.length]} />)}
            <LabelList dataKey="v" position="right" formatter={axisFmt} style={{ fontSize: 11, fill: "#52514e" }} />
          </Bar>
        </BarChart>
      )}
    </ChartCard>
  );
}

function AssetsVsLiabChart({ b }: { b: Statements["balance_sheet"] }) {
  return (
    <ChartCard title="Balance Sheet — Assets vs Liabilities & Equity">
      <BarChart data={[
        { name: "Assets", v: b.assets.total },
        { name: "Liab + Equity", v: b.liabilities.total },
      ]} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
        <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} width={44} />
        <Tooltip formatter={(v) => tip(v as number)} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="v" name="Total" radius={[4, 4, 0, 0]} maxBarSize={80}>
          <Cell fill={CAT[0]} /><Cell fill={CAT[1]} />
          <LabelList dataKey="v" position="top" formatter={axisFmt} style={{ fontSize: 11, fill: "#52514e" }} />
        </Bar>
      </BarChart>
    </ChartCard>
  );
}

function CashFlowChart({ c }: { c: Statements["cash_flow"] }) {
  const data = [
    { name: "Operating", v: c.operating },
    { name: "Investing", v: c.investing },
    { name: "Financing", v: c.financing },
    { name: "Net", v: c.net_cash },
  ];
  return (
    <ChartCard title="Cash Flow — by activity">
      <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
        <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} width={44} />
        <Tooltip formatter={(v) => tip(v as number)} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="v" name="Cash" radius={[4, 4, 0, 0]} maxBarSize={64}>
          {data.map((x, i) => <Cell key={i} fill={x.v >= 0 ? GOOD : CRIT} />)}
          <LabelList dataKey="v" position="top" formatter={axisFmt} style={{ fontSize: 11, fill: "#52514e" }} />
        </Bar>
      </BarChart>
    </ChartCard>
  );
}

// ════════════════════════════ TABLES ═══════════════════════════════════════

function PnlTable({ p }: { p: Statements["pnl"] }) {
  return (
    <>
      <h2 className="font-semibold mb-2">Profit &amp; Loss A/C</h2>
      <Row label="Revenue (net of GST)" value={p.revenue} />
      <Row label="Less: Cost of goods sold" value={p.cogs} tone="muted" />
      <Row label="Gross Profit" value={p.gross_profit} bold />
      {p.expense_groups.map((g) => <Row key={g.category} label={g.category} value={g.amount} indent tone="muted" />)}
      <Row label="Total operating expenses" value={p.operating_expenses} />
      <Row label="EBITDA" value={p.ebitda} bold />
      <Row label="Depreciation" value={p.depreciation} tone="muted" />
      <Row label="EBIT" value={p.ebit} />
      <Row label="Interest" value={p.interest} tone="muted" />
      <Row label="Profit before tax (EBT)" value={p.ebt} bold />
      <Row label="Tax" value={p.tax} tone="muted" />
      <Row label="Net Profit" value={p.net_profit} bold tone={p.net_profit >= 0 ? "green" : "red"} />
    </>
  );
}

function BsTable({ b, to }: { b: Statements["balance_sheet"]; to: string }) {
  return (
    <>
      <h2 className="font-semibold mb-2">Balance Sheet <span className="text-xs text-muted-foreground font-normal">as of {to}</span></h2>
      <p className="text-xs font-medium text-muted-foreground uppercase mt-1">Assets</p>
      <Row label="Fixed assets (gross)" value={b.assets.fixed_assets_gross} indent />
      <Row label="Inventory (machines + items)" value={b.assets.inventory} indent />
      <Row label="Receivables" value={b.assets.receivables} indent />
      <Row label="Cash & Bank" value={b.assets.cash_bank} indent />
      <Row label="Total Assets" value={b.assets.total} bold />
      <p className="text-xs font-medium text-muted-foreground uppercase mt-3">Liabilities &amp; Equity</p>
      <Row label="Capital" value={b.liabilities.capital} indent />
      <Row label="Surplus (period profit)" value={b.liabilities.surplus} indent />
      <Row label="Loans" value={b.liabilities.loans} indent />
      <Row label="Creditors (payables)" value={b.liabilities.creditors} indent />
      <Row label="Total Liabilities & Equity" value={b.liabilities.total} bold />
      {Math.abs(b.difference) > 0.5 && <Row label="Unexplained difference" value={b.difference} tone="red" />}
    </>
  );
}

function CfTable({ c }: { c: Statements["cash_flow"] }) {
  return (
    <>
      <h2 className="font-semibold mb-2">Cash Flow</h2>
      <Row label="Net profit" value={c.net_profit} indent tone="muted" />
      <Row label="Add: Depreciation" value={c.depreciation} indent tone="muted" />
      <Row label="Less: Working capital" value={c.working_capital} indent tone="muted" />
      <Row label="Cash from Operations" value={c.operating} bold />
      <Row label="Cash from Investing" value={c.investing} bold />
      <Row label="Cash from Financing" value={c.financing} bold />
      <Row label="Net cash generated" value={c.net_cash} bold tone={c.net_cash >= 0 ? "green" : "red"} />
      <Row label="Opening cash balance" value={c.opening_cash} tone="muted" />
      <Row label="Closing cash balance" value={c.closing_cash} bold />
    </>
  );
}

// ════════════════════════════ PRIMITIVES ═══════════════════════════════════

function DlBar({ label, onExcel, onPdf, allLabel }: { label: string; onExcel: () => void; onPdf: () => void; allLabel?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onExcel}><FileSpreadsheet className="h-4 w-4 mr-1" /> {allLabel ? "Excel (all)" : "Excel"}</Button>
        <Button size="sm" variant="outline" onClick={onPdf}><FileText className="h-4 w-4 mr-1" /> {allLabel ? "PDF (all)" : "PDF"}</Button>
      </div>
    </div>
  );
}

function Row({ label, value, bold, indent, tone }: { label: string; value: number; bold?: boolean; indent?: boolean; tone?: "green" | "red" | "muted" }) {
  const cls = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-600" : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${bold ? "font-semibold border-t pt-1.5" : ""} ${indent ? "pl-4" : ""}`}>
      <span className={cls}>{label}</span>
      <span className={`tabular-nums ${cls}`}>{inr(value)}</span>
    </div>
  );
}

function TypeTag({ t }: { t: Statements["transactions"]["rows"][number]["type"] }) {
  const map: Record<string, string> = {
    Revenue: "bg-green-100 text-green-800",
    Expense: "bg-red-100 text-red-700",
    Asset: "bg-blue-100 text-blue-800",
    Liability: "bg-amber-100 text-amber-800",
  };
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${map[t] ?? "bg-muted"}`}>{t}</span>;
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "good" | "crit" }) {
  const cls = tone === "good" ? "text-green-700" : tone === "crit" ? "text-red-600" : "";
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${cls}`}>{inr(value)}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      <ResponsiveContainer width="100%" height={240}>{children}</ResponsiveContainer>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">{text}</div>;
}
