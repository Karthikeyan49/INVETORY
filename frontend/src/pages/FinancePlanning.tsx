/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Boxes, CheckCircle2, Gauge, LineChart, Plus, RefreshCw, Save, Target, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart as RLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { StatCard } from "@/components/StatCard";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { getInventoryValuation } from "@/lib/api/inventory";

const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const today = () => new Date().toISOString().slice(0, 10);
const minus = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const num = (v: any) => Number(v || 0);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

function DataTable({ columns, rows, empty = "No records found." }: { columns: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <ScrollableX>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground"><tr>{columns.map((c) => <th key={c} className="px-4 py-3 text-left font-medium whitespace-nowrap">{c}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">{empty}</td></tr>}
            {rows.map((row, i) => <tr key={i} className="border-t hover:bg-muted/30">{row.map((cell, j) => <td key={j} className="px-4 py-3 align-top whitespace-nowrap">{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </ScrollableX>
    </div>
  );
}

export default function FinancePlanning() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(minus(90));
  const [to, setTo] = useState(today());
  const [module, setModule] = useState("sales");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<ApiRow | null>(null);
  const [budget, setBudget] = useState<ApiRow>({ name: "", fiscal_year: "2026-2027", period_type: "monthly", category: "Material Purchase", period: today().slice(0, 7), amount: "", notes: "" });
  const [benchmark, setBenchmark] = useState<ApiRow>({ metric: "gross_margin", target_value: "", unit: "%", comparison: "gte", notes: "" });

  const expenseAnalytics = useQuery({ queryKey: ["phase2", "finance-expense", from, to], queryFn: () => phase2Api.financePlanning.expenseAnalytics({ from, to }) });
  const reportsAnalytics = useQuery({ queryKey: ["phase2", "finance-report", module, from, to], queryFn: () => phase2Api.financePlanning.reportsAnalytics({ module, from, to }) });
  const overlay = useQuery({ queryKey: ["phase2", "finance-overlay", from, to], queryFn: () => phase2Api.financePlanning.overlay({ from, to }) });
  const budgets = useQuery({ queryKey: ["phase2", "budgets"], queryFn: () => phase2Api.financePlanning.budgets() });
  const benchmarks = useQuery({ queryKey: ["phase2", "benchmarks"], queryFn: () => phase2Api.financePlanning.benchmarks() });
  const benchmarkStatus = useQuery({ queryKey: ["phase2", "benchmark-status", from, to], queryFn: () => phase2Api.financePlanning.benchmarkStatus({ from, to }) });
  const budgetActual = useQuery({ queryKey: ["phase2", "budget-actual", selectedBudget?.budget_id], queryFn: () => phase2Api.financePlanning.budgetVsActual(selectedBudget?.budget_id), enabled: !!selectedBudget?.budget_id });
  const invValuation = useQuery({ queryKey: ["inventory", "valuation"], queryFn: getInventoryValuation });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["phase2"] });
  const run = useMutation({
    mutationFn: async ({ action, payload }: { action: string; payload: any }) => {
      if (action === "budget") return phase2Api.financePlanning.createBudget(payload);
      if (action === "benchmark") return phase2Api.financePlanning.saveBenchmark(payload);
    },
    onSuccess: () => { toast.success("Finance planning updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const metrics = useMemo(() => {
    const exp = expenseAnalytics.data || {};
    const rep = reportsAnalytics.data || {};
    const ov = overlay.data || {};
    return {
      expenseTotal: num(exp.total ?? exp.total_expenses),
      reportTotal: num(rep.total ?? rep.total_amount),
      revenue: num(ov.revenue ?? ov.total_revenue),
      grossProfit: num(ov.gross_profit ?? ov.profit),
      variance: num((budgetActual.data as any)?.total_variance ?? (budgetActual.data as any)?.variance),
    };
  }, [expenseAnalytics.data, reportsAnalytics.data, overlay.data, budgetActual.data]);

  const expenseChart = (expenseAnalytics.data?.by_category || expenseAnalytics.data?.categories || []).map((r: ApiRow) => ({
    name: r.category || r.name,
    amount: num(r.amount || r.total),
  }));
  const overlayChart = (overlay.data?.series || overlay.data?.monthly || overlay.data?.rows || []).map((r: ApiRow) => ({
    period: r.period || r.month || r.date,
    revenue: num(r.revenue),
    expenses: num(r.expenses || r.cost),
    profit: num(r.profit || r.gross_profit),
  }));

  const createBudget = async () => {
    if (!budget.name?.trim()) return toast.error("Budget name is required");
    await run.mutateAsync({
      action: "budget",
      payload: {
        name: budget.name,
        fiscal_year: budget.fiscal_year,
        period_type: budget.period_type,
        notes: budget.notes,
        is_active: true,
        lines: [{ category: budget.category, period: budget.period, amount: num(budget.amount), notes: budget.notes }],
      },
    });
    setBudgetOpen(false);
  };

  const createBenchmark = async () => {
    if (!benchmark.target_value) return toast.error("Target value is required");
    await run.mutateAsync({ action: "benchmark", payload: { ...benchmark, target_value: num(benchmark.target_value), is_active: true } });
    setBenchmarkOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finance Analytics & Planning</h1>
          <p className="text-muted-foreground">Expense graphics, report analytics, budget vs actual, and benchmark controls.</p>
        </div>
        <Button variant="outline" onClick={() => invalidate()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Report module"><Select value={module} onValueChange={setModule}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["sales", "orders", "payments", "expenses", "production", "forecast"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
        <Button onClick={() => setBudgetOpen(true)}><Plus className="h-4 w-4" /> Budget</Button>
        <Button variant="outline" onClick={() => setBenchmarkOpen(true)}><Target className="h-4 w-4" /> Benchmark</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard title="Expense Total" value={inr(metrics.expenseTotal)} subtitle="selected window" icon={Wallet} />
        <StatCard title="Report Total" value={inr(metrics.reportTotal)} subtitle={`${module} analytics`} icon={BarChart3} />
        <StatCard title="Revenue" value={inr(metrics.revenue)} subtitle="finance overlay" icon={LineChart} />
        <StatCard title="Gross Profit" value={inr(metrics.grossProfit)} subtitle="overlay margin" icon={Gauge} />
        <StatCard title="Budget Variance" value={inr(metrics.variance)} subtitle={selectedBudget ? selectedBudget.name : "select budget"} icon={Target} />
      </div>

      {/* Inventory Valuation */}
      <div className="bg-card rounded-xl border p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-card-foreground">Inventory Valuation</h3>
            <p className="text-xs text-muted-foreground">Smart Inventory stock value snapshot</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <div className="flex items-center gap-3 p-4 rounded-lg border bg-secondary/30">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Boxes className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Inventory Value</p>
              <p className="font-semibold text-card-foreground">
                {invValuation.data ? inr(invValuation.data.total_value) : "—"}
              </p>
            </div>
          </div>
        </div>
        {invValuation.data && invValuation.data.by_zone.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Value by Zone</h4>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Zone</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-right px-3 py-2 font-medium">Quantity</th>
                    <th className="text-right px-3 py-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {invValuation.data.by_zone.map((zone) => (
                    <tr key={zone.zone_id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">{zone.zone_name}</div>
                        <div className="text-xs text-muted-foreground">{zone.zone_code}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{zone.zone_type}</td>
                      <td className="px-3 py-2 text-right">{zone.total_quantity}</td>
                      <td className="px-3 py-2 text-right">{inr(zone.stock_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="analytics" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="budgets">Budget vs Actual</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="font-semibold mb-1">Expense by Category</h3>
              <p className="text-xs text-muted-foreground mb-4">From expense analytics endpoint</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={expenseChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `₹${Number(v) / 1000}k`} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="font-semibold mb-1">Revenue / Expense / Profit Overlay</h3>
              <p className="text-xs text-muted-foreground mb-4">Monthly operational overlay</p>
              <ResponsiveContainer width="100%" height={280}>
                <RLineChart data={overlayChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `₹${Number(v) / 1000}k`} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Line type="monotone" dataKey="revenue" stroke="hsl(200,70%,52%)" strokeWidth={2} />
                  <Line type="monotone" dataKey="expenses" stroke="hsl(0,72%,51%)" strokeWidth={2} />
                  <Line type="monotone" dataKey="profit" stroke="hsl(210,70%,55%)" strokeWidth={2} />
                </RLineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="budgets" className="space-y-4">
          <DataTable
            columns={["Budget", "Fiscal Year", "Type", "Lines", "Active", "Created", "Action"]}
            rows={(budgets.data ?? []).map((b) => [
              <span className="font-medium">{b.name}</span>,
              b.fiscal_year,
              b.period_type,
              b.lines_count ?? b.lines?.length ?? 0,
              b.is_active ? <Badge className="bg-emerald-500">Active</Badge> : <Badge variant="outline">Inactive</Badge>,
              b.created_at?.slice(0, 10) || "—",
              <Button size="sm" variant={selectedBudget?.budget_id === b.budget_id ? "default" : "outline"} onClick={() => setSelectedBudget(b)}>View Actual</Button>,
            ])}
          />
          {selectedBudget && (
            <DataTable
              columns={["Category", "Period", "Budget", "Actual", "Variance", "Status"]}
              rows={((budgetActual.data as any)?.lines || (budgetActual.data as any)?.rows || []).map((r: ApiRow) => [
                r.category,
                r.period,
                inr(r.budget_amount ?? r.amount),
                inr(r.actual_amount ?? r.actual),
                inr(r.variance),
                num(r.variance) >= 0 ? <Badge variant="outline" className="text-emerald-600">Under/OK</Badge> : <Badge variant="outline" className="text-red-600">Over</Badge>,
              ])}
              empty="Select a budget or add budget lines to see variance."
            />
          )}
        </TabsContent>

        <TabsContent value="benchmarks" className="space-y-4">
          <DataTable
            columns={["Metric", "Target", "Comparison", "Unit", "Status", "Notes"]}
            rows={(benchmarks.data ?? []).map((b) => [
              b.metric,
              b.target_value,
              b.comparison,
              b.unit || "—",
              b.is_active ? <Badge className="bg-emerald-500">Active</Badge> : <Badge variant="outline">Inactive</Badge>,
              b.notes || "—",
            ])}
          />
          <DataTable
            columns={["Metric", "Actual", "Target", "Result", "Gap"]}
            rows={((benchmarkStatus.data as any)?.benchmarks || (benchmarkStatus.data as any)?.rows || []).map((b: ApiRow) => [
              b.metric,
              b.actual_value ?? b.actual,
              b.target_value ?? b.target,
              b.passed ? <Badge className="bg-emerald-500"><CheckCircle2 className="h-3 w-3 mr-1" /> Passed</Badge> : <Badge variant="outline" className="text-amber-600">Watch</Badge>,
              b.gap ?? "—",
            ])}
            empty="No benchmark status available for this window."
          />
        </TabsContent>
      </Tabs>

      <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Create Budget</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Budget name"><Input value={budget.name} onChange={(e) => setBudget({ ...budget, name: e.target.value })} /></Field>
            <Field label="Fiscal year"><Input value={budget.fiscal_year} onChange={(e) => setBudget({ ...budget, fiscal_year: e.target.value })} /></Field>
            <Field label="Type"><Select value={budget.period_type} onValueChange={(v) => setBudget({ ...budget, period_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent></Select></Field>
            <Field label="Category"><Input value={budget.category} onChange={(e) => setBudget({ ...budget, category: e.target.value })} /></Field>
            <Field label="Period"><Input value={budget.period} onChange={(e) => setBudget({ ...budget, period: e.target.value })} /></Field>
            <Field label="Amount"><Input type="number" value={budget.amount} onChange={(e) => setBudget({ ...budget, amount: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea value={budget.notes} onChange={(e) => setBudget({ ...budget, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={createBudget}><Save className="h-4 w-4" /> Save Budget</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={benchmarkOpen} onOpenChange={setBenchmarkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Benchmark</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Metric"><Select value={benchmark.metric} onValueChange={(v) => setBenchmark({ ...benchmark, metric: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["gross_margin", "net_margin", "expense_ratio", "collection_days", "inventory_turnover"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Target"><Input type="number" value={benchmark.target_value} onChange={(e) => setBenchmark({ ...benchmark, target_value: e.target.value })} /></Field>
            <Field label="Comparison"><Select value={benchmark.comparison} onValueChange={(v) => setBenchmark({ ...benchmark, comparison: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gte">Greater/equal</SelectItem><SelectItem value="lte">Less/equal</SelectItem></SelectContent></Select></Field>
            <Field label="Unit"><Input value={benchmark.unit} onChange={(e) => setBenchmark({ ...benchmark, unit: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea value={benchmark.notes} onChange={(e) => setBenchmark({ ...benchmark, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={createBenchmark}><Target className="h-4 w-4" /> Save Benchmark</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
