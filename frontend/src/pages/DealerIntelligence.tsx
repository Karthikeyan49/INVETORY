/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, GitMerge, RefreshCw, Save, Search, Store, Target, Users } from "lucide-react";
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

const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
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

export default function DealerIntelligence() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceList, setPriceList] = useState<ApiRow>({ dealer_id: "", name: "", is_default: true, notes: "", product_id: "", unit_price: "", item_notes: "" });
  const [resolveOpen, setResolveOpen] = useState<ApiRow | null>(null);
  const [resolveForm, setResolveForm] = useState<ApiRow>({ action: "link", customer_id: "", merge_source_id: "", merge_target_id: "", notes: "" });
  const [simulation, setSimulation] = useState<ApiRow>({ dealer_id: "", product_id: "", customer_id: "" });
  const [simulationResult, setSimulationResult] = useState<ApiRow | null>(null);

  const dealers = useQuery({ queryKey: ["phase2", "dealer-network", search], queryFn: () => phase2Api.dealerNetwork.dealers({ search }) });
  const priceLists = useQuery({ queryKey: ["phase2", "dealer-price-lists"], queryFn: () => phase2Api.dealerNetwork.priceLists() });
  const dealerCustomers = useQuery({ queryKey: ["phase2", "dealer-customers"], queryFn: () => phase2Api.dealerNetwork.dealerCustomers() });
  const conflicts = useQuery({ queryKey: ["phase2", "dealer-conflicts"], queryFn: () => phase2Api.dealerNetwork.conflicts() });
  const analytics = useQuery({ queryKey: ["phase2", "customer-analytics-summary"], queryFn: () => phase2Api.dealerNetwork.analyticsSummary({ churn_days: 90, limit: 10 }) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["phase2"] });
  const run = useMutation({
    mutationFn: async ({ action, payload }: { action: string; payload?: any }) => {
      if (action === "priceList") return phase2Api.dealerNetwork.createPriceList(payload);
      if (action === "resolve") return phase2Api.dealerNetwork.resolveCustomer(payload.id, payload.body);
      if (action === "merge") return phase2Api.dealerNetwork.mergeCustomers(payload.source_id, payload.target_id);
      if (action === "recompute") return phase2Api.dealerNetwork.recomputeMetrics(payload);
      if (action === "simulate") return phase2Api.dealerNetwork.priceSimulation(payload);
    },
    onSuccess: (result, vars) => {
      if (vars.action === "simulate") setSimulationResult(result as ApiRow);
      else { toast.success("Dealer intelligence updated"); invalidate(); }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = useMemo(() => {
    const summary: any = analytics.data || {};
    return {
      dealers: dealers.data?.length ?? 0,
      priceLists: priceLists.data?.length ?? 0,
      linked: (dealerCustomers.data ?? []).filter((c) => c.link_status === "linked").length,
      conflicts: conflicts.data?.length ?? 0,
      churnRisk: summary.churn_risk_count ?? summary.churn_risk?.length ?? 0,
    };
  }, [dealers.data, priceLists.data, dealerCustomers.data, conflicts.data, analytics.data]);

  const createPriceList = async () => {
    if (!priceList.dealer_id || !priceList.name?.trim() || !priceList.product_id || !priceList.unit_price) {
      return toast.error("Dealer, name, product ID and price are required");
    }
    await run.mutateAsync({
      action: "priceList",
      payload: {
        dealer_id: num(priceList.dealer_id),
        name: priceList.name,
        is_default: !!priceList.is_default,
        notes: priceList.notes,
        items: [{ product_id: num(priceList.product_id), unit_price: num(priceList.unit_price), notes: priceList.item_notes }],
      },
    });
    setPriceOpen(false);
  };

  const resolveCustomer = async () => {
    if (!resolveOpen) return;
    if (resolveForm.action === "merge") {
      if (!resolveForm.merge_source_id || !resolveForm.merge_target_id) return toast.error("Source and target customer IDs are required for merge");
      await run.mutateAsync({ action: "merge", payload: { source_id: num(resolveForm.merge_source_id), target_id: num(resolveForm.merge_target_id) } });
    } else {
      await run.mutateAsync({
        action: "resolve",
        payload: {
          id: resolveOpen.dealer_customer_id,
          body: { action: resolveForm.action, customer_id: num(resolveForm.customer_id) || undefined, notes: resolveForm.notes },
        },
      });
    }
    setResolveOpen(null);
  };

  const simulate = async () => {
    const payload = Object.fromEntries(Object.entries(simulation).filter(([, v]) => v !== "").map(([k, v]) => [k, num(v)]));
    if (!payload.dealer_id && !(payload.customer_id && payload.product_id)) {
      return toast.error("Provide dealer ID, or customer ID + product ID");
    }
    await run.mutateAsync({ action: "simulate", payload });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dealer Network Intelligence</h1>
          <p className="text-muted-foreground">Dealer mapping, price lists, customer dedupe, analytics, and price simulation.</p>
        </div>
        <Button variant="outline" onClick={() => invalidate()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard title="Dealers" value={String(stats.dealers)} subtitle="channel accounts" icon={Store} />
        <StatCard title="Price Lists" value={String(stats.priceLists)} subtitle="active mappings" icon={BadgePercent} />
        <StatCard title="Linked Customers" value={String(stats.linked)} subtitle="dealer-customer map" icon={Users} />
        <StatCard title="Conflicts" value={String(stats.conflicts)} subtitle="dedupe needed" icon={GitMerge} />
        <StatCard title="Churn Risk" value={String(stats.churnRisk)} subtitle="analytics window" icon={Target} />
      </div>

      <Tabs defaultValue="dealers" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="dealers">Dealers</TabsTrigger>
          <TabsTrigger value="pricing">Price Mapping</TabsTrigger>
          <TabsTrigger value="customers">Customer Links</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="dealers" className="space-y-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm flex gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search dealer..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <DataTable
            columns={["Dealer", "Phone", "Company", "Orders", "Revenue", "Active"]}
            rows={(dealers.data ?? []).map((d) => [
              <div><div className="font-medium">{d.name}</div><div className="text-xs text-muted-foreground">#{d.user_id}</div></div>,
              d.phone || "—",
              d.company_name || "—",
              d.total_orders ?? 0,
              inr(d.total_spent),
              d.is_active ? <Badge className="bg-emerald-500">Active</Badge> : <Badge variant="outline">Inactive</Badge>,
            ])}
          />
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <div className="flex justify-between gap-3 flex-wrap">
            <div className="rounded-xl border bg-card p-4 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-3 flex-1">
              <Field label="Dealer ID"><Input value={simulation.dealer_id} onChange={(e) => setSimulation({ ...simulation, dealer_id: e.target.value })} /></Field>
              <Field label="Customer ID"><Input value={simulation.customer_id} onChange={(e) => setSimulation({ ...simulation, customer_id: e.target.value })} /></Field>
              <Field label="Product ID"><Input value={simulation.product_id} onChange={(e) => setSimulation({ ...simulation, product_id: e.target.value })} /></Field>
              <Button className="self-end" variant="outline" onClick={simulate}>Simulate Price</Button>
            </div>
            <Button onClick={() => setPriceOpen(true)}><BadgePercent className="h-4 w-4" /> New Price List</Button>
          </div>
          {simulationResult && (
            <div className="rounded-xl border bg-card p-4 text-sm">
              <span className="font-medium">Simulation result:</span> <span className="text-muted-foreground">{JSON.stringify(simulationResult)}</span>
            </div>
          )}
          <DataTable
            columns={["List", "Dealer", "Default", "Active", "Items", "Updated"]}
            rows={(priceLists.data ?? []).map((p) => [
              <span className="font-medium">{p.name}</span>,
              p.dealer_name || p.dealer_id,
              p.is_default ? "Yes" : "No",
              p.is_active ? <Badge className="bg-emerald-500">Active</Badge> : <Badge variant="outline">Inactive</Badge>,
              p.items_count ?? p.items?.length ?? 0,
              p.updated_at?.slice(0, 10) || "—",
            ])}
          />
        </TabsContent>

        <TabsContent value="customers" className="space-y-4">
          <DataTable
            columns={["Dealer", "Customer", "Phone", "Linked User", "Status", "Notes", "Action"]}
            rows={(dealerCustomers.data ?? []).map((c) => [
              c.dealer_name || c.dealer_id,
              <div><div className="font-medium">{c.customer_name}</div><div className="text-xs text-muted-foreground">#{c.dealer_customer_id}</div></div>,
              c.phone || "—",
              c.linked_user_name || c.customer_id || "—",
              <Badge variant="outline" className={c.link_status === "conflict" ? "text-red-600" : "text-emerald-600"}>{c.link_status}</Badge>,
              c.notes || "—",
              <Button size="sm" variant="outline" onClick={() => setResolveOpen(c)}><GitMerge className="h-3 w-3" /> Resolve</Button>,
            ])}
          />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="flex justify-end"><Button variant="outline" onClick={() => run.mutate({ action: "recompute", payload: undefined })}><RefreshCw className="h-4 w-4" /> Recompute Metrics</Button></div>
          <DataTable
            columns={["Customer", "Orders", "Revenue", "Payment Speed", "Last Purchase", "Risk"]}
            rows={((analytics.data as any)?.top_customers || (analytics.data as any)?.customers || []).map((c: ApiRow) => [
              <div><div className="font-medium">{c.name || c.customer_name}</div><div className="text-xs text-muted-foreground">#{c.user_id || c.customer_id}</div></div>,
              c.order_count ?? c.orders ?? 0,
              inr(c.total_revenue ?? c.revenue ?? c.total_spent),
              c.avg_payment_days ? `${c.avg_payment_days} days` : "—",
              c.last_purchase_date || "—",
              c.churn_risk || c.risk || "normal",
            ])}
            empty="No customer analytics available. Recompute metrics after orders/payments exist."
          />
        </TabsContent>
      </Tabs>

      <Dialog open={priceOpen} onOpenChange={setPriceOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Create Dealer Price List</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Dealer"><Select value={String(priceList.dealer_id)} onValueChange={(v) => setPriceList({ ...priceList, dealer_id: v })}><SelectTrigger><SelectValue placeholder="Dealer" /></SelectTrigger><SelectContent>{(dealers.data ?? []).map((d) => <SelectItem key={d.user_id} value={String(d.user_id)}>{d.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="List name"><Input value={priceList.name} onChange={(e) => setPriceList({ ...priceList, name: e.target.value })} /></Field>
            <Field label="Product ID"><Input value={priceList.product_id} onChange={(e) => setPriceList({ ...priceList, product_id: e.target.value })} /></Field>
            <Field label="Unit price"><Input type="number" value={priceList.unit_price} onChange={(e) => setPriceList({ ...priceList, unit_price: e.target.value })} /></Field>
            <Field label="Notes"><Input value={priceList.item_notes} onChange={(e) => setPriceList({ ...priceList, item_notes: e.target.value })} /></Field>
          </div>
          <Field label="List notes"><Textarea value={priceList.notes} onChange={(e) => setPriceList({ ...priceList, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={createPriceList}><Save className="h-4 w-4" /> Save Price List</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolveOpen} onOpenChange={(open) => !open && setResolveOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resolve Dealer Customer</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">{resolveOpen?.customer_name} from dealer {resolveOpen?.dealer_name || resolveOpen?.dealer_id}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Action"><Select value={resolveForm.action} onValueChange={(v) => setResolveForm({ ...resolveForm, action: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="link">Link Existing</SelectItem><SelectItem value="separate">Keep Separate</SelectItem><SelectItem value="merge">Merge Customers</SelectItem></SelectContent></Select></Field>
            <Field label="Existing customer ID"><Input value={resolveForm.customer_id} onChange={(e) => setResolveForm({ ...resolveForm, customer_id: e.target.value })} /></Field>
            {resolveForm.action === "merge" && (
              <>
                <Field label="Merge source ID"><Input value={resolveForm.merge_source_id} onChange={(e) => setResolveForm({ ...resolveForm, merge_source_id: e.target.value })} /></Field>
                <Field label="Merge target ID"><Input value={resolveForm.merge_target_id} onChange={(e) => setResolveForm({ ...resolveForm, merge_target_id: e.target.value })} /></Field>
              </>
            )}
          </div>
          <Field label="Notes"><Textarea value={resolveForm.notes} onChange={(e) => setResolveForm({ ...resolveForm, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={resolveCustomer}>Resolve</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
