import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, Wallet, PiggyBank, Receipt, Activity,
  Percent, Scale, Target, Layers, Sparkles, Lightbulb, ShieldAlert, CheckCircle2, RefreshCw, Loader2,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { financeApi, type FinancialRatios } from "@/lib/api/finance";
import { fetchMachines } from "@/lib/api/machines";
import { fetchSpares } from "@/lib/api/spares";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, LineChart, Line, Legend, AreaChart, Area,
} from "recharts";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const k = (n: number) => `₹${(n / 1000).toFixed(0)}k`;

const PIE_COLORS = [
  "hsl(200,70%,52%)", "hsl(210,70%,55%)", "hsl(30,90%,52%)",
  "hsl(280,55%,52%)", "hsl(45,90%,50%)", "hsl(0,72%,51%)",
  "hsl(170,55%,42%)", "hsl(330,60%,55%)",
];

interface RatioMeta {
  key: keyof FinancialRatios;
  label: string;
  hint: string;
  benchmark: string;
  format: "pct" | "x";
  icon: typeof Percent;
  good: (v: number) => boolean;
}

const RATIO_DEFS: RatioMeta[] = [
  { key: "profitMargin", label: "Profit Margin", hint: "Net Profit / Revenue", benchmark: "Healthy: > 15%", format: "pct", icon: Percent, good: (v) => v > 0.15 },
  { key: "expenseRatio", label: "Expense Ratio", hint: "Expenses / Revenue", benchmark: "Target: < 75%", format: "pct", icon: Receipt, good: (v) => v < 0.75 },
  { key: "roi", label: "ROI", hint: "Return on Investment", benchmark: "Healthy: > 20%", format: "pct", icon: Target, good: (v) => v > 0.20 },
  { key: "currentRatio", label: "Current Ratio", hint: "Assets / Liabilities", benchmark: "Healthy: 1.5 – 3.0", format: "x", icon: Scale, good: (v) => v >= 1.5 && v <= 3 },
  { key: "grossMargin", label: "Gross Margin", hint: "Gross Profit / Revenue", benchmark: "Industry: > 25%", format: "pct", icon: Layers, good: (v) => v > 0.25 },
  { key: "operatingMargin", label: "Operating Margin", hint: "Operating Profit / Revenue", benchmark: "Healthy: > 12%", format: "pct", icon: Activity, good: (v) => v > 0.12 },
];

export default function Finance() {
  const { data: pnl, isLoading: pnlLoading, error: pnlErr } = useQuery({ queryKey: ["finance", "pnl"], queryFn: () => financeApi.pnl() });
  const { data: ratios, isLoading: ratiosLoading, error: ratiosErr } = useQuery({ queryKey: ["finance", "ratios"], queryFn: () => financeApi.ratios() });
  // Inventory value is sourced from the pages we keep: in-stock Machines (buy price) + Spares (unit cost × qty).
  const { data: machinesData } = useQuery({ queryKey: ["finance", "machines-value"], queryFn: () => fetchMachines({ limit: 1000 }) });
  const { data: sparesData } = useQuery({ queryKey: ["finance", "spares-value"], queryFn: () => fetchSpares() });
  const inStockMachines = (machinesData?.rows ?? []).filter((m) => m.status !== "delivered");
  const machinesValue = inStockMachines.reduce((s, m) => s + (Number(m.buy_price) || 0), 0);
  const spareRows = sparesData?.rows ?? [];
  const sparesValue = spareRows.reduce((s, sp) => s + (Number(sp.unit_cost) || 0) * (Number(sp.quantity) || 0), 0);
  const inventoryTotalValue = machinesValue + sparesValue;

  useEffect(() => {
    const e = pnlErr || ratiosErr;
    if (e instanceof Error) toast.error(e.message);
  }, [pnlErr, ratiosErr]);

  if (pnlLoading || ratiosLoading || !pnl || !ratios) {
    return <div className="text-center py-20 text-muted-foreground">Loading financial dashboard…</div>;
  }

  const profitable = pnl.netProfit >= 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Profit & Loss</h1>
        <p className="text-muted-foreground">
          Period: {pnl.periodFrom} → {pnl.periodTo} · Real-time financial overview & key ratios.
        </p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Revenue" value={inr(pnl.revenue)} subtitle="↑ 12.4% vs last period" icon={Wallet} />
        <StatCard title="Total Expenses" value={inr(pnl.expenses)} subtitle="↑ 5.1% vs last period" icon={Receipt} subtitleColor="muted" />
        <StatCard title="Gross Profit" value={inr(pnl.grossProfit)} subtitle={`Tax: ${inr(pnl.taxes)}`} icon={TrendingUp} />
        <StatCard
          title={profitable ? "Net Profit" : "Net Loss"}
          value={inr(Math.abs(pnl.netProfit))}
          subtitle={profitable ? "after taxes" : "deficit"}
          icon={profitable ? PiggyBank : TrendingDown}
        />
      </div>

      {/* Inventory Valuation — Machines + Spares */}
      <div className="bg-card rounded-xl border p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-card-foreground">Inventory Valuation</h3>
            <p className="text-xs text-muted-foreground">Stock value from machines &amp; spares</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-3 p-4 rounded-lg border bg-secondary/30">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Boxes className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Machines ({inStockMachines.length} in stock)</p>
              <p className="font-semibold text-card-foreground">{inr(machinesValue)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-lg border bg-secondary/30">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Layers className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Spares ({spareRows.length} items)</p>
              <p className="font-semibold text-card-foreground">{inr(sparesValue)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-lg border bg-primary/5">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Wallet className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Inventory Value</p>
              <p className="font-semibold text-card-foreground">{inr(inventoryTotalValue)}</p>
            </div>
          </div>
        </div>
      </div>
      {/* Revenue vs Expenses area + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card rounded-xl border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-card-foreground">Revenue vs Expenses</h3>
              <p className="text-xs text-muted-foreground">Monthly performance trend</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={pnl.monthly}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(200,70%,52%)" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="hsl(200,70%,52%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(0,72%,51%)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="hsl(0,72%,51%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickFormatter={k} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip formatter={(v: number) => inr(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend />
              <Area type="monotone" dataKey="revenue" stroke="hsl(200,70%,52%)" fill="url(#rev)" strokeWidth={2} />
              <Area type="monotone" dataKey="expenses" stroke="hsl(0,72%,51%)" fill="url(#exp)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h3 className="font-semibold text-card-foreground mb-1">Expense Breakdown</h3>
          <p className="text-xs text-muted-foreground mb-4">Share by category</p>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={pnl.expenseBreakdown} dataKey="amount" nameKey="category" outerRadius={90} innerRadius={50}>
                {pnl.expenseBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => inr(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Profit trend line + Revenue sources bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h3 className="font-semibold text-card-foreground mb-1">Net Profit Trend</h3>
          <p className="text-xs text-muted-foreground mb-4">Profit by month</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={pnl.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickFormatter={k} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip formatter={(v: number) => inr(v)} />
              <Line type="monotone" dataKey="profit" stroke="hsl(210,70%,55%)" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h3 className="font-semibold text-card-foreground mb-1">Revenue by Source</h3>
          <p className="text-xs text-muted-foreground mb-4">Sales channel contribution</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={pnl.revenueBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="source" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickFormatter={k} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip formatter={(v: number) => inr(v)} />
              <Bar dataKey="amount" fill="hsl(200,70%,52%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Financial Ratios */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">Financial Ratios</h2>
            <p className="text-sm text-muted-foreground">Key health indicators auto-computed from current data</p>
          </div>
          <div className="text-xs text-muted-foreground">
            Investment base: {inr(ratios.investment)}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {RATIO_DEFS.map((def) => {
            const val = ratios[def.key] as number;
            const display = def.format === "pct" ? pct(val) : `${val.toFixed(2)}x`;
            const ok = def.good(val);
            const Icon = def.icon;
            return (
              <div key={def.key} className="bg-card rounded-xl border p-5 shadow-sm">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-card-foreground">{def.label}</p>
                      <p className="text-xs text-muted-foreground">{def.hint}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                    {ok ? "Healthy" : "Watch"}
                  </span>
                </div>
                <div className="text-2xl font-bold text-foreground">{display}</div>
                <p className="text-xs text-muted-foreground mt-1">{def.benchmark}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
