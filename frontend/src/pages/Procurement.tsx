/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock, IndianRupee,
  Copy, FileText, GitCompare, Inbox, Layers, Mail, Minus, PackageCheck, PackageOpen,
  Plus, Printer, RefreshCw, Send, ShoppingCart, Trash2, TrendingDown, Truck, WalletCards, X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { cn } from "@/lib/utils";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { fetchProducts } from "@/lib/api/products";

const today = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const num = (n: unknown) => Number(n || 0);

const PRIORITY = ["low", "normal", "high", "urgent"] as const;
const priorityChip: Record<string, string> = {
  urgent: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  normal: "bg-slate-100 text-slate-700", low: "bg-slate-100 text-slate-500",
};
const statusChip: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600", submitted: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700",
  converted: "bg-indigo-100 text-indigo-700", closed: "bg-slate-100 text-slate-500",
  issued: "bg-blue-100 text-blue-700", partially_received: "bg-amber-100 text-amber-700",
  received: "bg-emerald-100 text-emerald-700", short_closed: "bg-slate-100 text-slate-600",
  billed: "bg-indigo-100 text-indigo-700", paid: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-600",
};

type ReqLine = {
  product_id: string; description: string; quantity: string; unit: string;
  est_unit_price: string; insight?: ApiRow; loading?: boolean;
};
const emptyLine = (): ReqLine => ({ product_id: "", description: "", quantity: "1", unit: "Nos", est_unit_price: "" });

export default function Procurement() {
  const qc = useQueryClient();
  const [view, setView] = useState<"cockpit" | "requests" | "orders">("cockpit");
  const [reqOpen, setReqOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [rejecting, setRejecting] = useState<ApiRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [header, setHeader] = useState<ApiRow>({ department: "Production", need_by_date: today(), priority: "normal", notes: "" });
  const [lines, setLines] = useState<ReqLine[]>([emptyLine()]);

  const cockpit = useQuery({ queryKey: ["proc", "cockpit"], queryFn: () => phase2Api.procurement.cockpit() });
  const products = useQuery({ queryKey: ["products"], queryFn: () => fetchProducts() });
  const prs = useQuery({ queryKey: ["phase2", "purchase-requests"], queryFn: () => phase2Api.purchaseRequests.list() });
  const pos = useQuery({ queryKey: ["phase2", "purchase-orders"], queryFn: () => phase2Api.purchaseOrders.list() });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["proc", "cockpit"] });
    qc.invalidateQueries({ queryKey: ["phase2", "purchase-requests"] });
    qc.invalidateQueries({ queryKey: ["phase2", "purchase-orders"] });
  };

  const c = (cockpit.data ?? {}) as ApiRow;
  const queues = (c.queues ?? {}) as ApiRow;
  const reorder = (c.reorder ?? []) as ApiRow[];
  const kpis = (c.kpis ?? {}) as ApiRow;
  const recent = (c.recent ?? []) as ApiRow[];
  const approvals = (queues.approvals ?? { count: 0, value: 0, items: [] }) as ApiRow;

  const openRequisition = (seed?: ReqLine[]) => {
    setHeader({ department: "Production", need_by_date: today(), priority: "normal", notes: "" });
    setLines(seed && seed.length ? seed : [emptyLine()]);
    setReqOpen(true);
  };

  const setLine = (idx: number, patch: Partial<ReqLine>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const pickProduct = async (idx: number, productId: string) => {
    const prod = (products.data ?? []).find((p) => String(p.id) === productId);
    setLine(idx, { product_id: productId, description: prod?.product ?? "", loading: true });
    try {
      const ins = await phase2Api.procurement.productInsight(Number(productId));
      setLine(idx, {
        insight: ins, loading: false,
        unit: ins.unit || "Nos",
        quantity: num(ins.suggested_qty) > 0 ? String(ins.suggested_qty) : "1",
        est_unit_price: ins.last_unit_price != null ? String(ins.last_unit_price) : "",
      });
    } catch {
      setLine(idx, { loading: false });
    }
  };

  const reorderToLine = (r: ApiRow): ReqLine => ({
    product_id: String(r.product_id), description: r.product_name,
    quantity: String(num(r.suggested_qty) || num(r.shortfall) || 1),
    unit: r.base_unit || "Nos", est_unit_price: r.last_unit_price != null ? String(r.last_unit_price) : "", insight: r,
  });

  const estTotal = useMemo(() => lines.reduce((s, l) => s + num(l.quantity) * num(l.est_unit_price), 0), [lines]);

  const createPr = useMutation({
    mutationFn: async (submitNow: boolean) => {
      const items = lines
        .filter((l) => l.description.trim() && num(l.quantity) > 0)
        .map((l) => ({
          description: l.description.trim(),
          product_id: l.product_id ? Number(l.product_id) : null,
          quantity: num(l.quantity), unit: l.unit.trim() || "Nos",
          est_unit_price: l.est_unit_price !== "" ? num(l.est_unit_price) : null,
        }));
      if (!items.length) throw new Error("Add at least one item with a quantity");
      const created = await phase2Api.purchaseRequests.create({ ...header, items });
      if (submitNow && created?.pr_id) await phase2Api.purchaseRequests.submit(Number(created.pr_id));
      return created;
    },
    onSuccess: (_d, submitNow) => {
      toast.success(submitNow ? "Requisition submitted for approval" : "Requisition saved as draft");
      setReqOpen(false); refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save requisition"),
  });

  const act = useMutation({
    mutationFn: async (p: { kind: "submit" | "approve" | "reject" | "delete"; id: number; reason?: string }) => {
      if (p.kind === "submit") return phase2Api.purchaseRequests.submit(p.id);
      if (p.kind === "approve") return phase2Api.purchaseRequests.approve(p.id);
      if (p.kind === "reject") return phase2Api.purchaseRequests.reject(p.id, p.reason || "Rejected");
      return phase2Api.purchaseRequests.remove(p.id);
    },
    onSuccess: (_d, p) => { toast.success(`Request ${p.kind === "delete" ? "deleted" : p.kind + "d"}`); setRejecting(null); setRejectReason(""); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Procurement</h1>
          <p className="text-muted-foreground">Requests, orders, receiving and stock — what needs you, first.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-muted/40 p-0.5 text-sm">
            {(["cockpit", "requests", "orders"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={cn("px-3 py-1.5 rounded-md capitalize", view === v ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
                {v}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={refresh} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={() => openRequisition()} className="gap-2"><Plus className="h-4 w-4" /> Raise Request</Button>
        </div>
      </div>

      {view === "cockpit" && (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2 font-semibold text-card-foreground"><Inbox className="h-4 w-4 text-primary" /> Needs you</div>
                {num(approvals.count) > 0 && <Button size="sm" variant="ghost" className="h-7 gap-1 text-primary" onClick={() => setInboxOpen(true)}>Open inbox <ArrowRight className="h-3.5 w-3.5" /></Button>}
              </div>
              <div className="divide-y">
                <QueueRow icon={ClipboardList} label="Purchase requests to approve"
                  value={num(approvals.count) ? `${approvals.count} · ${inr(num(approvals.value))}` : "All clear"}
                  tone={num(approvals.count) ? "amber" : "muted"} onClick={() => num(approvals.count) && setInboxOpen(true)} />
                <QueueRow icon={PackageCheck} label="Purchase orders to receive"
                  value={num(queues.to_receive?.count) ? `${queues.to_receive.count}${num(queues.to_receive?.overdue) ? ` · ${queues.to_receive.overdue} overdue` : ""}` : "Nothing inbound"}
                  tone={num(queues.to_receive?.overdue) ? "red" : num(queues.to_receive?.count) ? "blue" : "muted"} onClick={() => setView("orders")} />
                <QueueRow icon={IndianRupee} label="Received orders to bill"
                  value={num(queues.to_bill?.count) ? `${queues.to_bill.count} ready` : "Nothing to bill"}
                  tone={num(queues.to_bill?.count) ? "indigo" : "muted"} onClick={() => setView("orders")} />
              </div>
            </div>

            <div className="rounded-xl border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2 font-semibold text-card-foreground"><TrendingDown className="h-4 w-4 text-red-500" /> Reorder now</div>
                {reorder.length > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-primary"
                    onClick={() => openRequisition(reorder.map(reorderToLine))}>Requisition all <ArrowRight className="h-3.5 w-3.5" /></Button>
                )}
              </div>
              {cockpit.isLoading ? <Skeleton /> : reorder.length === 0 ? (
                <Empty icon={CheckCircle2} text="Every item is above its reorder level." />
              ) : (
                <div className="divide-y">
                  {reorder.map((r) => (
                    <div key={r.product_id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-card-foreground">{r.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          On hand <span className="font-medium text-red-600">{num(r.on_hand)}</span> · reorder {num(r.reorder_level)} {r.base_unit || ""}
                          {r.suggested_vendor_name ? ` · ${r.suggested_vendor_name}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground">suggest</p>
                        <p className="text-sm font-semibold">{num(r.suggested_qty)} {r.base_unit || ""}</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => openRequisition([reorderToLine(r)])}>
                        PR <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={ShoppingCart} label="Open POs" value={String(num(kpis.open_po))} />
            <Kpi icon={IndianRupee} label="Spend this month" value={inr(num(kpis.month_spend))} />
            <Kpi icon={Clock} label="Avg PO cycle" value={kpis.avg_cycle_days != null ? `${kpis.avg_cycle_days} d` : "—"} />
            <Kpi icon={AlertTriangle} label="Low-stock items" value={String(num(kpis.low_stock_count))} tone={num(kpis.low_stock_count) ? "red" : undefined} />
          </div>

          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b px-4 py-3 font-semibold text-card-foreground"><Layers className="h-4 w-4 text-muted-foreground" /> Recent activity</div>
            {recent.length === 0 ? <Empty icon={ClipboardList} text="No procurement activity yet." /> : (
              <div className="divide-y">
                {recent.map((r) => (
                  <div key={`${r.doc}-${r.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Badge variant="outline" className="font-mono">{r.doc}</Badge>
                    <span className="font-medium text-card-foreground">{r.number}</span>
                    {r.vendor_name && <span className="truncate text-muted-foreground">{r.vendor_name}</span>}
                    <span className="ml-auto">{r.total != null ? inr(num(r.total)) : ""}</span>
                    <Badge className={cn("capitalize", statusChip[String(r.status).toLowerCase()] ?? "bg-slate-100 text-slate-600")}>{String(r.status).replace("_", " ")}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {view === "requests" && (
        <RequestsTable rows={prs.data ?? []} loading={prs.isLoading}
          onSubmit={(id) => act.mutate({ kind: "submit", id })}
          onApprove={(id) => act.mutate({ kind: "approve", id })}
          onReject={(row) => setRejecting(row)}
          onDelete={(id) => act.mutate({ kind: "delete", id })} />
      )}

      {view === "orders" && <OrdersTable rows={pos.data ?? []} loading={pos.isLoading} />}

      {/* ── Smart Requisition ── */}
      <Dialog open={reqOpen} onOpenChange={(v) => !createPr.isPending && setReqOpen(v)}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> Raise Purchase Request</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Department"><Input value={header.department} onChange={(e) => setHeader({ ...header, department: e.target.value })} /></Field>
            <Field label="Need by"><Input type="date" value={header.need_by_date} onChange={(e) => setHeader({ ...header, need_by_date: e.target.value })} /></Field>
            <Field label="Priority">
              <Select value={header.priority} onValueChange={(v) => setHeader({ ...header, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITY.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="flex items-end"><div className="w-full rounded-lg bg-muted/50 px-3 py-2 text-right"><p className="text-[11px] text-muted-foreground">Est. value</p><p className="font-semibold">{inr(estTotal)}</p></div></div>
          </div>

          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase text-muted-foreground">Items</Label>
              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setLines((l) => [...l, emptyLine()])}><Plus className="h-3.5 w-3.5" /> Add line</Button>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="rounded-lg border p-3">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-12 sm:col-span-5">
                    <Select value={line.product_id} onValueChange={(v) => pickProduct(idx, v)}>
                      <SelectTrigger><SelectValue placeholder="Pick a product…" /></SelectTrigger>
                      <SelectContent>{(products.data ?? []).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.product}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="mt-1.5" placeholder="or type a description (services, misc.)" value={line.description}
                      onChange={(e) => setLine(idx, { description: e.target.value })} />
                  </div>
                  <div className="col-span-4 sm:col-span-2"><Input type="number" min="0" step="0.001" placeholder="Qty" value={line.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} /></div>
                  <div className="col-span-4 sm:col-span-2"><Input placeholder="Unit" value={line.unit} onChange={(e) => setLine(idx, { unit: e.target.value })} /></div>
                  <div className="col-span-3 sm:col-span-2"><Input type="number" min="0" step="0.01" placeholder="Est. ₹" value={line.est_unit_price} onChange={(e) => setLine(idx, { est_unit_price: e.target.value })} /></div>
                  <div className="col-span-1 flex items-center justify-end">
                    {lines.length > 1 && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setLines((l) => l.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </div>
                </div>
                {line.loading && <p className="mt-2 text-xs text-muted-foreground">Checking stock…</p>}
                {line.insight && !line.loading && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <InsightChip tone={line.insight.below_reorder ? "red" : "muted"}>On hand {num(line.insight.on_hand)} {line.insight.unit || ""}</InsightChip>
                    <InsightChip>Reorder @ {num(line.insight.reorder_level)}</InsightChip>
                    {num(line.insight.monthly_usage) > 0 && <InsightChip>Uses ~{num(line.insight.monthly_usage)}/mo</InsightChip>}
                    {line.insight.last_unit_price != null && <InsightChip>Last ₹{num(line.insight.last_unit_price)}</InsightChip>}
                    {line.insight.suggested_vendor_name && <InsightChip tone="blue">{line.insight.suggested_vendor_name}</InsightChip>}
                    {num(line.insight.suggested_qty) > 0 && (
                      <button className="rounded-full bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/20"
                        onClick={() => setLine(idx, { quantity: String(line.insight!.suggested_qty) })}>
                        Use suggested {num(line.insight.suggested_qty)}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <Field label="Notes (optional)"><Textarea rows={2} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} /></Field>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => createPr.mutate(false)} disabled={createPr.isPending} className="gap-2"><ClipboardList className="h-4 w-4" /> Save draft</Button>
            <Button onClick={() => createPr.mutate(true)} disabled={createPr.isPending} className="gap-2"><Send className="h-4 w-4" /> Submit for approval</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Approval Inbox ── */}
      <Dialog open={inboxOpen} onOpenChange={setInboxOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Inbox className="h-5 w-5" /> Approval inbox <Badge className="bg-amber-100 text-amber-700">{num(approvals.count)}</Badge></DialogTitle></DialogHeader>
          {((approvals.items as ApiRow[]) ?? []).length === 0 ? <Empty icon={CheckCircle2} text="Nothing waiting for approval." /> : (
            <div className="space-y-2">
              {(approvals.items as ApiRow[]).map((pr) => (
                <div key={pr.pr_id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{pr.pr_number}</span>
                    <Badge className={cn("capitalize", priorityChip[pr.priority] ?? "")}>{pr.priority}</Badge>
                    <span className="ml-auto font-semibold">{inr(num(pr.est_value))}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {num(pr.item_count)} item{num(pr.item_count) === 1 ? "" : "s"} · {pr.department || "—"}
                    {pr.requested_by_name ? ` · by ${pr.requested_by_name}` : ""}{pr.need_by_date ? ` · need by ${pr.need_by_date}` : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" className="h-8 flex-1 gap-1" disabled={act.isPending} onClick={() => act.mutate({ kind: "approve", id: Number(pr.pr_id) })}><CheckCircle2 className="h-4 w-4" /> Approve</Button>
                    <Button size="sm" variant="outline" className="h-8 flex-1 gap-1 text-destructive" disabled={act.isPending} onClick={() => setRejecting(pr)}><X className="h-4 w-4" /> Reject</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Reject reason ── */}
      <Dialog open={!!rejecting} onOpenChange={(v) => !v && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reject {rejecting?.pr_number}</DialogTitle></DialogHeader>
          <Field label="Reason"><Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this being rejected?" /></Field>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!rejectReason.trim() || act.isPending}
              onClick={() => act.mutate({ kind: "reject", id: Number(rejecting!.pr_id), reason: rejectReason.trim() })}>Reject request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mt-2"><Label className="text-xs text-muted-foreground">{label}</Label><div className="mt-1">{children}</div></div>;
}

function QueueRow({ icon: Icon, label, value, tone, onClick }: { icon: any; label: string; value: string; tone: string; onClick?: () => void }) {
  const toneCls: Record<string, string> = { amber: "text-amber-700", red: "text-red-600", blue: "text-blue-700", indigo: "text-indigo-700", muted: "text-muted-foreground" };
  return (
    <button onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 disabled:cursor-default">
      <Icon className={cn("h-4 w-4", toneCls[tone])} />
      <span className="text-sm text-card-foreground">{label}</span>
      <span className={cn("ml-auto text-sm font-semibold", toneCls[tone])}>{value}</span>
      {onClick && tone !== "muted" && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
    </button>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={cn("h-4 w-4", tone === "red" ? "text-red-500" : "text-primary")} /> {label}</div>
      <p className={cn("mt-1 text-2xl font-bold", tone === "red" ? "text-red-600" : "text-foreground")}>{value}</p>
    </div>
  );
}

function InsightChip({ children, tone = "muted" }: { children: React.ReactNode; tone?: string }) {
  const cls: Record<string, string> = { muted: "bg-muted text-muted-foreground", red: "bg-red-100 text-red-700", blue: "bg-blue-100 text-blue-700" };
  return <span className={cn("rounded-full px-2 py-0.5", cls[tone])}>{children}</span>;
}

function Empty({ icon: Icon, text }: { icon: any; text: string }) {
  return <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground"><Icon className="h-7 w-7 opacity-40" /><p className="text-sm">{text}</p></div>;
}
function Skeleton() { return <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>; }

function RequestsTable({ rows, loading, onSubmit, onApprove, onReject, onDelete }: {
  rows: ApiRow[]; loading: boolean;
  onSubmit: (id: number) => void; onApprove: (id: number) => void; onReject: (row: ApiRow) => void; onDelete: (id: number) => void;
}) {
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <ScrollableX>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">PR #</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Need by</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No requests yet.</td></tr>
              : rows.map((r) => (
                <tr key={r.pr_id} className="border-t">
                  <td className="px-3 py-2 font-mono">{r.pr_number}</td>
                  <td className="px-3 py-2">{r.department || "—"}</td>
                  <td className="px-3 py-2"><Badge className={cn("capitalize", priorityChip[r.priority] ?? "")}>{r.priority}</Badge></td>
                  <td className="px-3 py-2">{r.need_by_date || "—"}</td>
                  <td className="px-3 py-2"><Badge className={cn("capitalize", statusChip[String(r.status).toLowerCase()] ?? "")}>{String(r.status).replace("_", " ")}</Badge></td>
                  <td className="px-3 py-2"><div className="flex justify-end gap-1">
                    {r.status === "draft" && <Button size="sm" variant="outline" className="h-7" onClick={() => onSubmit(Number(r.pr_id))}>Submit</Button>}
                    {r.status === "submitted" && <><Button size="sm" className="h-7" onClick={() => onApprove(Number(r.pr_id))}>Approve</Button><Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => onReject(r)}>Reject</Button></>}
                    {r.status === "draft" && <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onDelete(Number(r.pr_id))}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </div></td>
                </tr>
              ))}
          </tbody>
        </table>
      </ScrollableX>
    </div>
  );
}

type PoLine = {
  product_id: string; description: string; hsn_code: string; quantity: string; unit: string;
  unit_price: string; gst_rate: string; received_qty?: number; item_id?: number; product_name?: string;
};
type PoForm = ApiRow & { items: PoLine[] };
const PO_STATUSES = ["all", "draft", "issued", "partially_received", "received", "short_closed", "billed", "paid", "cancelled"] as const;
const emptyPoLine = (): PoLine => ({ product_id: "", description: "", hsn_code: "", quantity: "1", unit: "Nos", unit_price: "", gst_rate: "18" });
const emptyPoForm = (): PoForm => ({
  po_number: "", vendor_id: "", pr_id: "", order_date: today(), expected_date: "", reference_number: "",
  shipment_preference: "Road transport", deliver_to_type: "organization", deliver_to_name: "Inventory Management System",
  deliver_to_address: "", payment_terms: "Due on receipt", seller_state: "Tamil Nadu", vendor_state: "Tamil Nadu",
  vendor_gstin: "", gst_treatment: "registered_business", reverse_charge: false, other_charges: "0",
  notes: "", terms_conditions: "Material must match the accepted PO specification. Short or damaged supply may be rejected at receiving.",
  items: [emptyPoLine()],
});

function OrdersTable({ rows, loading }: { rows: ApiRow[]; loading: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof PO_STATUSES)[number]>("all");
  const [builder, setBuilder] = useState<PoForm | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const vendors = useQuery({ queryKey: ["phase2", "vendors"], queryFn: () => phase2Api.vendors.list() });
  const products = useQuery({ queryKey: ["products"], queryFn: () => fetchProducts() });
  const approvedPrs = useQuery({
    queryKey: ["phase2", "purchase-requests", "approved"],
    queryFn: () => phase2Api.purchaseRequests.list({ status: "approved" }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["proc", "cockpit"] });
    qc.invalidateQueries({ queryKey: ["phase2", "purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["phase2", "purchase-requests"] });
  };
  const visible = rows.filter((r) => status === "all" || r.status === status);
  const totalOpen = rows.filter((r) => !["paid", "cancelled", "short_closed"].includes(String(r.status))).length;
  const receiveReady = rows.filter((r) => ["issued", "partially_received"].includes(String(r.status))).length;
  const billReady = rows.filter((r) => ["received", "short_closed"].includes(String(r.status)) && !r.billed_expense_id).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Kpi icon={ShoppingCart} label="Active purchase orders" value={String(totalOpen)} />
        <Kpi icon={Truck} label="Receiving queue" value={String(receiveReady)} tone={receiveReady ? "red" : undefined} />
        <Kpi icon={WalletCards} label="Ready to bill" value={String(billReady)} />
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="font-semibold text-card-foreground">Purchase Order Cockpit</h2>
            <p className="text-xs text-muted-foreground">Build, issue, receive, match and pay without leaving the PO.</p>
          </div>
          <Button className="gap-2" onClick={() => setBuilder(emptyPoForm())}><Plus className="h-4 w-4" /> New PO</Button>
        </div>
        <ScrollableX>
          <div className="flex min-w-max gap-2 border-b px-4 py-2">
            {PO_STATUSES.map((s) => (
              <button key={s} onClick={() => setStatus(s)}
                className={cn("rounded-full border px-3 py-1 text-xs capitalize", status === s ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted")}>
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </ScrollableX>

        {loading ? <Skeleton /> : visible.length === 0 ? <Empty icon={PackageOpen} text="No purchase orders match this view." /> : (
          <div className="divide-y">
            {visible.map((po) => {
              const pct = receiptPct(po);
              const overdue = po.expected_date && new Date(po.expected_date) < new Date(today()) && !["received", "billed", "paid", "cancelled", "short_closed"].includes(String(po.status));
              return (
                <button key={po.po_id} className="block w-full px-4 py-3 text-left hover:bg-muted/30" onClick={() => setDetailId(Number(po.po_id))}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-card-foreground">{po.po_number}</span>
                    <Badge className={cn("capitalize", statusChip[String(po.status).toLowerCase()] ?? "bg-slate-100 text-slate-600")}>{String(po.status).replace("_", " ")}</Badge>
                    {overdue && <Badge className="bg-red-100 text-red-700">overdue</Badge>}
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{po.vendor_name || "Vendor not set"}</span>
                    <span className="font-semibold text-card-foreground">{inr(num(po.total))}</span>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-[1fr_auto] md:items-center">
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                    <span>{pct}% received · expected {po.expected_date || "not set"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <PoBuilderDialog open={!!builder} form={builder} vendors={vendors.data ?? []} products={products.data ?? []} approvedPrs={approvedPrs.data ?? []}
        onChange={setBuilder} onClose={() => setBuilder(null)} onSaved={refresh} />
      <PoDetailDialog id={detailId} onClose={() => setDetailId(null)} onEdit={(po) => setBuilder(poToForm(po))}
        onClone={(po) => setBuilder({ ...poToForm(po), po_id: undefined, po_number: "", status: "draft", received_qty: 0, pr_id: "" })}
        onChanged={refresh} products={products.data ?? []} />
    </div>
  );
}

function PoBuilderDialog({ open, form, vendors, products, approvedPrs, onChange, onClose, onSaved }: {
  open: boolean; form: PoForm | null; vendors: ApiRow[]; products: any[]; approvedPrs: ApiRow[];
  onChange: (form: PoForm | null) => void; onClose: () => void; onSaved: () => void;
}) {
  const save = useMutation({
    mutationFn: async (issue: boolean) => {
      if (!form) throw new Error("PO is not ready");
      const payload = poPayload(form);
      const saved = form.po_id
        ? await phase2Api.purchaseOrders.update(Number(form.po_id), payload)
        : await phase2Api.purchaseOrders.create(payload);
      if (issue && saved?.po_id && saved.status === "draft") return phase2Api.purchaseOrders.issue(Number(saved.po_id));
      return saved;
    },
    onSuccess: (_d, issue) => { toast.success(issue ? "Purchase order issued" : "Purchase order saved"); onClose(); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save purchase order"),
  });
  const convert = useMutation({
    mutationFn: (id: number) => phase2Api.purchaseRequests.get(id),
    onSuccess: (pr) => {
      if (!form) return;
      onChange({
        ...form,
        pr_id: String(pr.pr_id),
        notes: form.notes || `Converted from ${pr.pr_number}`,
        items: ((pr.items ?? []) as ApiRow[]).map((it, idx) => ({
          product_id: it.product_id ? String(it.product_id) : "",
          description: it.description || it.product_name || "",
          hsn_code: it.hsn_code || "",
          quantity: String(num(it.quantity) || 1),
          unit: it.unit || "Nos",
          unit_price: it.est_unit_price != null ? String(it.est_unit_price) : "",
          gst_rate: "18",
          item_id: undefined,
          received_qty: 0,
          product_name: it.product_name,
        })),
      });
      toast.success(`Loaded ${pr.pr_number} into the PO builder`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not load purchase request"),
  });
  if (!form) return null;
  const set = (patch: Partial<PoForm>) => onChange({ ...form, ...patch });
  const setLine = (idx: number, patch: Partial<PoLine>) => set({ items: form.items.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  const selectedVendor = vendors.find((v) => String(v.vendor_id ?? v.id) === String(form.vendor_id));
  const totals = poTotals(form);
  return (
    <Dialog open={open} onOpenChange={(v) => !save.isPending && !v && onClose()}>
      <DialogContent className="max-w-7xl max-h-[94vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Live Purchase Order Builder</DialogTitle></DialogHeader>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Field label="Convert approved PR">
                <Select value={form.pr_id ? String(form.pr_id) : "none"} onValueChange={(v) => v !== "none" && convert.mutate(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Choose PR" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No PR</SelectItem>{approvedPrs.map((pr) => <SelectItem key={pr.pr_id} value={String(pr.pr_id)}>{pr.pr_number} · {inr(num(pr.est_value))}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Vendor">
                <Select value={form.vendor_id ? String(form.vendor_id) : "none"} onValueChange={(v) => {
                  const vendor = vendors.find((x) => String(x.vendor_id ?? x.id) === v);
                  set({ vendor_id: v === "none" ? "" : v, vendor_state: vendor?.state || form.vendor_state, vendor_gstin: vendor?.gst_number || vendor?.gstin || form.vendor_gstin });
                }}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Select vendor</SelectItem>{vendors.map((v) => <SelectItem key={v.vendor_id ?? v.id} value={String(v.vendor_id ?? v.id)}>{v.name || v.vendor_name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="PO #"><Input value={form.po_number || ""} placeholder="Auto on save" onChange={(e) => set({ po_number: e.target.value })} /></Field>
              <Field label="Reference #"><Input value={form.reference_number || ""} onChange={(e) => set({ reference_number: e.target.value })} /></Field>
              <Field label="Date"><Input type="date" value={form.order_date || today()} onChange={(e) => set({ order_date: e.target.value })} /></Field>
              <Field label="Expected delivery"><Input type="date" value={form.expected_date || ""} onChange={(e) => set({ expected_date: e.target.value })} /></Field>
              <Field label="Shipment"><Input value={form.shipment_preference || ""} onChange={(e) => set({ shipment_preference: e.target.value })} /></Field>
              <Field label="Payment terms"><Input value={form.payment_terms || ""} onChange={(e) => set({ payment_terms: e.target.value })} /></Field>
              <Field label="Seller state"><Input value={form.seller_state || ""} onChange={(e) => set({ seller_state: e.target.value })} /></Field>
              <Field label="Vendor state"><Input value={form.vendor_state || ""} onChange={(e) => set({ vendor_state: e.target.value })} /></Field>
              <Field label="Vendor GSTIN"><Input value={form.vendor_gstin || ""} onChange={(e) => set({ vendor_gstin: e.target.value })} /></Field>
              <Field label="GST treatment"><Input value={form.gst_treatment || ""} onChange={(e) => set({ gst_treatment: e.target.value })} /></Field>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Deliver-to type">
                <Select value={form.deliver_to_type || "organization"} onValueChange={(v) => set({ deliver_to_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="organization">Organization</SelectItem><SelectItem value="customer">Customer / drop-ship</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Deliver-to name"><Input value={form.deliver_to_name || ""} onChange={(e) => set({ deliver_to_name: e.target.value })} /></Field>
              <Field label="Other charges"><Input type="number" min="0" step="0.01" value={form.other_charges ?? "0"} onChange={(e) => set({ other_charges: e.target.value })} /></Field>
              <div className="md:col-span-3"><Field label="Delivery address override"><Textarea rows={2} value={form.deliver_to_address || ""} onChange={(e) => set({ deliver_to_address: e.target.value })} /></Field></div>
            </div>
            <PoLinesEditor form={form} products={products} setLine={setLine} set={set} />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Notes"><Textarea rows={2} value={form.notes || ""} onChange={(e) => set({ notes: e.target.value })} /></Field>
              <Field label="Terms & conditions"><Textarea rows={2} value={form.terms_conditions || ""} onChange={(e) => set({ terms_conditions: e.target.value })} /></Field>
            </div>
          </div>
          <PoPreview form={{ ...form, vendor_name: selectedVendor?.name || selectedVendor?.vendor_name || form.vendor_name }} totals={totals} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => generatePoPdf({ ...form, vendor_name: selectedVendor?.name || form.vendor_name })} className="gap-2"><Printer className="h-4 w-4" /> PDF / Print</Button>
          <Button variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending} className="gap-2"><FileText className="h-4 w-4" /> Save draft</Button>
          <Button onClick={() => save.mutate(true)} disabled={save.isPending} className="gap-2"><Send className="h-4 w-4" /> Issue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PoLinesEditor({ form, products, setLine, set }: { form: PoForm; products: any[]; setLine: (idx: number, patch: Partial<PoLine>) => void; set: (patch: Partial<PoForm>) => void }) {
  const pickProduct = (idx: number, id: string) => {
    if (id === "none") return setLine(idx, { product_id: "", product_name: "", description: "", unit_price: "" });
    const product = products.find((p) => String(p.id) === id);
    setLine(idx, {
      product_id: id,
      product_name: product?.product,
      description: product?.description || product?.product || "",
      unit: product?._raw?.unit || "Nos",
      unit_price: String(product?._raw?.base_price || firstProductPrice(product) || ""),
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase text-muted-foreground">PO lines</Label>
        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => set({ items: [...form.items, emptyPoLine()] })}><Plus className="h-3.5 w-3.5" /> Add line</Button>
      </div>
      {form.items.map((line, idx) => (
        <div key={idx} className="rounded-lg border p-3">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-12 lg:col-span-4">
              <Select value={line.product_id || "none"} onValueChange={(v) => pickProduct(idx, v)}>
                <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Custom / service line</SelectItem>{products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.product}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="mt-1.5" placeholder="Description" value={line.description} onChange={(e) => setLine(idx, { description: e.target.value })} />
            </div>
            <div className="col-span-4 lg:col-span-1"><Input placeholder="HSN" value={line.hsn_code} onChange={(e) => setLine(idx, { hsn_code: e.target.value })} /></div>
            <div className="col-span-4 lg:col-span-1"><Input type="number" min="0" step="0.001" placeholder="Qty" value={line.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} /></div>
            <div className="col-span-4 lg:col-span-1"><Input placeholder="Unit" value={line.unit} onChange={(e) => setLine(idx, { unit: e.target.value })} /></div>
            <div className="col-span-5 lg:col-span-2"><Input type="number" min="0" step="0.01" placeholder="Rate" value={line.unit_price} onChange={(e) => setLine(idx, { unit_price: e.target.value })} /></div>
            <div className="col-span-4 lg:col-span-1"><Input type="number" min="0" step="0.01" placeholder="GST %" value={line.gst_rate} onChange={(e) => setLine(idx, { gst_rate: e.target.value })} /></div>
            <div className="col-span-2 lg:col-span-1 flex items-center justify-end text-sm font-semibold">{inr(lineTotal(line))}</div>
            <div className="col-span-1 flex items-center justify-end">
              {form.items.length > 1 && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => set({ items: form.items.filter((_, i) => i !== idx) })}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PoDetailDialog({ id, onClose, onEdit, onClone, onChanged, products }: {
  id: number | null; onClose: () => void; onEdit: (po: ApiRow) => void; onClone: (po: ApiRow) => void; onChanged: () => void; products: any[];
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const detail = useQuery({ queryKey: ["phase2", "purchase-orders", id], queryFn: () => phase2Api.purchaseOrders.get(Number(id)), enabled: !!id });
  const po = detail.data;
  const action = useMutation({
    mutationFn: async (kind: "issue" | "cancel" | "shortClose" | "bill") => {
      if (!po?.po_id) return null;
      if (kind === "issue") return phase2Api.purchaseOrders.issue(Number(po.po_id));
      if (kind === "cancel") return phase2Api.purchaseOrders.cancel(Number(po.po_id));
      if (kind === "shortClose") return phase2Api.purchaseOrders.shortClose(Number(po.po_id));
      return phase2Api.purchaseOrders.bill(Number(po.po_id));
    },
    onSuccess: (_d, kind) => {
      toast.success(`PO ${kind === "shortClose" ? "short-closed" : kind + "d"}`);
      qc.invalidateQueries({ queryKey: ["phase2", "purchase-orders"] }); onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "PO action failed"),
  });
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-7xl max-h-[94vh] overflow-y-auto">
        {!po ? <Skeleton /> : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{po.po_number}</span>
                <Badge className={cn("capitalize", statusChip[String(po.status).toLowerCase()] ?? "")}>{String(po.status).replace("_", " ")}</Badge>
                <span className="text-base font-normal text-muted-foreground">{po.vendor_name}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              {["overview", "receiving", "payments", "match", "activity"].map((t) => (
                <button key={t} className={cn("rounded-full border px-3 py-1 text-xs capitalize", tab === t ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted")}
                  onClick={() => setTab(t)}>{t === "match" ? "Three-way match" : t}</button>
              ))}
              <div className="ml-auto flex flex-wrap gap-2">
                {po.status === "draft" && <Button size="sm" variant="outline" onClick={() => onEdit(po)}>Edit</Button>}
                <Button size="sm" variant="outline" className="gap-1" onClick={() => onClone(po)}><Copy className="h-3.5 w-3.5" /> Clone</Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => generatePoPdf(poToForm(po))}><Printer className="h-3.5 w-3.5" /> PDF</Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => toast.info("Email handoff is ready for SMTP integration; PDF can be shared now.")}><Mail className="h-3.5 w-3.5" /> Email</Button>
                {po.status === "draft" && <Button size="sm" onClick={() => action.mutate("issue")} disabled={action.isPending}>Issue</Button>}
                {["issued", "partially_received"].includes(String(po.status)) && <Button size="sm" variant="outline" onClick={() => action.mutate("shortClose")} disabled={action.isPending}>Short close</Button>}
                {["draft", "issued"].includes(String(po.status)) && <Button size="sm" variant="outline" className="text-destructive" onClick={() => action.mutate("cancel")} disabled={action.isPending}>Cancel</Button>}
              </div>
            </div>
            {tab === "overview" && <PoPreview form={poToForm(po)} totals={poTotals(poToForm(po))} />}
            {tab === "receiving" && <ReceivingStation po={po} onChanged={() => { detail.refetch(); onChanged(); }} />}
            {tab === "payments" && <PaymentsPanel po={po} onChanged={() => { detail.refetch(); onChanged(); }} />}
            {tab === "match" && <MatchPanel po={po} onBill={() => action.mutate("bill")} billing={action.isPending} />}
            {tab === "activity" && <ActivityPanel po={po} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PoPreview({ form, totals }: { form: PoForm; totals: ApiRow }) {
  const inter = normState(form.seller_state) !== "" && normState(form.seller_state) !== normState(form.vendor_state);
  return (
    <div className="rounded-xl border bg-white p-5 text-slate-950 shadow-sm">
      <div className="flex flex-wrap justify-between gap-4 border-b pb-4">
        <div><p className="text-xs uppercase tracking-wide text-slate-500">Purchase Order</p><h3 className="text-2xl font-bold">{form.po_number || "Auto PO #"}</h3><p className="mt-1 text-sm text-slate-500">Date {form.order_date || today()} · Expected {form.expected_date || "—"}</p></div>
        <div className="text-right text-sm"><p className="font-bold">Inventory Management System</p><p className="text-slate-500 whitespace-pre-line">{form.deliver_to_name || "Inventory Management System"}{form.deliver_to_address ? `\n${form.deliver_to_address}` : ""}</p></div>
      </div>
      <div className="grid gap-4 py-4 text-sm md:grid-cols-3">
        <div><p className="text-xs uppercase text-slate-500">Vendor</p><p className="font-semibold">{form.vendor_name || "Select vendor"}</p><p className="text-slate-500">{form.vendor_gstin || "GSTIN not set"}</p></div>
        <div><p className="text-xs uppercase text-slate-500">Reference / shipment</p><p>{form.reference_number || "—"}</p><p className="text-slate-500">{form.shipment_preference || "—"}</p></div>
        <div><p className="text-xs uppercase text-slate-500">Tax treatment</p><p>{inter ? "Inter-state IGST" : "Intra-state CGST + SGST"}</p><p className="text-slate-500">{form.reverse_charge ? "Reverse charge applies" : form.gst_treatment || "Regular GST"}</p></div>
      </div>
      <ScrollableX>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-y bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Item</th><th className="p-2">HSN</th><th className="p-2 text-right">Qty</th><th className="p-2">Unit</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">GST</th><th className="p-2 text-right">Amount</th></tr></thead>
          <tbody>{form.items.map((l, i) => <tr key={i} className="border-b"><td className="p-2">{l.description || "Item description"}</td><td className="p-2">{l.hsn_code || "—"}</td><td className="p-2 text-right">{num(l.quantity)}</td><td className="p-2">{l.unit}</td><td className="p-2 text-right">{inr(num(l.unit_price))}</td><td className="p-2 text-right">{num(l.gst_rate)}%</td><td className="p-2 text-right font-medium">{inr(lineTotal(l))}</td></tr>)}</tbody>
        </table>
      </ScrollableX>
      <div className="ml-auto mt-4 max-w-sm space-y-1 text-sm">
        <MoneyRow label="Subtotal" value={totals.subtotal} />
        {inter ? <MoneyRow label="IGST" value={totals.tax_amount} /> : <><MoneyRow label="CGST" value={num(totals.tax_amount) / 2} /><MoneyRow label="SGST" value={num(totals.tax_amount) / 2} /></>}
        <MoneyRow label="Other charges" value={totals.other_charges} />
        <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Grand total</span><span>{inr(num(totals.total))}</span></div>
      </div>
      {(form.notes || form.terms_conditions) && <div className="mt-4 grid gap-3 text-xs text-slate-500 md:grid-cols-2"><p><b>Notes:</b> {form.notes || "—"}</p><p><b>T&C:</b> {form.terms_conditions || "—"}</p></div>}
    </div>
  );
}

function ReceivingStation({ po, onChanged }: { po: ApiRow; onChanged: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const items = (po.items ?? []) as ApiRow[];
  const complete = items.filter((i) => num(i.outstanding_qty) <= 0).length;
  const setAll = () => setQty(Object.fromEntries(items.filter((i) => num(i.outstanding_qty) > 0).map((i) => [String(i.item_id), String(i.outstanding_qty)])));
  const receive = useMutation({
    mutationFn: () => {
      const lines = Object.entries(qty).filter(([, v]) => num(v) > 0).map(([id, v]) => ({ po_item_id: Number(id), quantity: num(v) }));
      if (!lines.length) throw new Error("Enter at least one received quantity");
      return phase2Api.purchaseOrders.receiveWithPhoto(Number(po.po_id), { received_on: today(), notes, items: lines }, file);
    },
    onSuccess: () => { toast.success("Goods receipt posted"); setQty({}); setNotes(""); setFile(undefined); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not receive goods"),
  });
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-emerald-50 p-4 text-emerald-900">
        <div className="flex flex-wrap items-center gap-3"><Truck className="h-5 w-5" /><b>Receiving Station</b><span>{complete} of {items.length} lines complete</span><Button size="sm" variant="outline" className="ml-auto bg-white" onClick={setAll}>Receive everything outstanding</Button></div>
      </div>
      <div className="grid gap-3">
        {items.map((it) => {
          const outstanding = num(it.outstanding_qty);
          return (
            <div key={it.item_id} className={cn("rounded-xl border p-4", outstanding <= 0 ? "bg-muted/40" : "bg-card")}>
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                <div><p className="font-semibold">{it.description}</p><p className="text-sm text-muted-foreground">Ordered {num(it.quantity)} · Received {num(it.received_qty)} · Outstanding <b>{outstanding}</b> {it.unit}</p></div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" disabled={outstanding <= 0} onClick={() => setQty({ ...qty, [it.item_id]: String(Math.max(0, num(qty[it.item_id]) - 1)) })}><Minus className="h-4 w-4" /></Button>
                  <Input className="h-12 w-28 text-center text-lg font-semibold" type="number" min="0" max={outstanding} step="0.001" value={qty[it.item_id] ?? ""} onChange={(e) => setQty({ ...qty, [it.item_id]: e.target.value })} />
                  <Button size="icon" variant="outline" disabled={outstanding <= 0} onClick={() => setQty({ ...qty, [it.item_id]: String(Math.min(outstanding, num(qty[it.item_id]) + 1 || outstanding)) })}><Plus className="h-4 w-4" /></Button>
                </div>
                <Button variant="outline" disabled={outstanding <= 0} onClick={() => setQty({ ...qty, [it.item_id]: String(outstanding) })}>Receive remaining</Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_260px_auto] md:items-end">
        <Field label="Shortage / delivery notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Delivery photo"><Input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0])} /></Field>
        <Button className="h-10 gap-2" disabled={receive.isPending || !["issued", "partially_received"].includes(String(po.status))} onClick={() => receive.mutate()}><PackageCheck className="h-4 w-4" /> Post GRN</Button>
      </div>
    </div>
  );
}

function PaymentsPanel({ po, onChanged }: { po: ApiRow; onChanged: () => void }) {
  const payments = useQuery({ queryKey: ["phase2", "po-payments", po.po_id], queryFn: () => phase2Api.purchaseOrders.payments(Number(po.po_id)) });
  const paidAmount = num(payments.data?.purchase_order?.amount_paid);
  const balanceDue = payments.data?.purchase_order?.balance_due != null ? num(payments.data.purchase_order.balance_due) : Math.max(0, num(po.total) - paidAmount);
  const [amount, setAmount] = useState(String(balanceDue || num(po.total)));
  const [mode, setMode] = useState("Bank Transfer");
  const bill = useMutation({ mutationFn: () => phase2Api.purchaseOrders.bill(Number(po.po_id)), onSuccess: () => { toast.success("PO billed to expenses"); onChanged(); }, onError: (e) => toast.error(e instanceof Error ? e.message : "Could not bill PO") });
  const pay = useMutation({
    mutationFn: () => phase2Api.purchaseOrders.pay(Number(po.po_id), { direction: "out", amount: num(amount), payment_mode: mode, paid_on: today(), reference_no: `PO-${po.po_number}` }),
    onSuccess: () => { toast.success("Vendor payment recorded"); payments.refetch(); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record payment"),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3 font-semibold">Payment ledger</div>
        <div className="divide-y">
          {((payments.data?.payments ?? []) as ApiRow[]).length === 0 ? <Empty icon={WalletCards} text="No vendor payments recorded yet." /> : (payments.data?.payments ?? []).map((p: ApiRow) => (
            <div key={p.payment_id} className="flex items-center gap-3 px-4 py-3 text-sm"><span>{p.paid_on}</span><span className="text-muted-foreground">{p.payment_mode}</span><span className="ml-auto font-semibold">{inr(num(p.amount))}</span></div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <Badge className={cn("capitalize", statusChip[String(po.payment_status).toLowerCase()] ?? "bg-slate-100 text-slate-600")}>{String(po.payment_status || "unpaid")}</Badge>
        <div className="mt-3 space-y-1 text-sm"><MoneyRow label="PO total" value={po.total} /><MoneyRow label="Paid" value={paidAmount} /><MoneyRow label="Balance" value={balanceDue} /></div>
        {!po.billed_expense_id && ["received", "short_closed"].includes(String(po.status)) && <Button className="mt-4 w-full" onClick={() => bill.mutate()} disabled={bill.isPending}>Create bill</Button>}
        <Field label="Payment amount"><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Mode">
          <Select value={mode} onValueChange={setMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Cash", "Bank Transfer", "UPI", "Cheque", "Card"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
        </Field>
        <Button className="mt-3 w-full" onClick={() => pay.mutate()} disabled={pay.isPending || num(amount) <= 0 || !po.billed_expense_id}>Record vendor payment</Button>
      </div>
    </div>
  );
}

function MatchPanel({ po, onBill, billing }: { po: ApiRow; onBill: () => void; billing: boolean }) {
  const items = (po.items ?? []) as ApiRow[];
  const qtyMatched = items.every((i) => num(i.received_qty) + 0.0005 >= num(i.quantity));
  const billed = po.billed_expense_id ? num(po.total) : 0;
  const valueVariance = Math.abs(num(po.total) - billed);
  return (
    <div className="space-y-4">
      <div className={cn("rounded-xl border p-4", qtyMatched && valueVariance <= 1 ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900")}>
        <div className="flex flex-wrap items-center gap-2"><GitCompare className="h-5 w-5" /><b>Three-way match</b><span>PO ordered vs GRN received vs bill value</span>
          {!po.billed_expense_id && qtyMatched && ["received", "short_closed"].includes(String(po.status)) && <Button className="ml-auto" size="sm" onClick={onBill} disabled={billing}>Create bill</Button>}
        </div>
      </div>
      <ScrollableX>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-2">Line</th><th className="p-2 text-right">Ordered</th><th className="p-2 text-right">Received</th><th className="p-2 text-right">Outstanding</th><th className="p-2">Match</th></tr></thead>
          <tbody>{items.map((i) => { const ok = num(i.outstanding_qty) <= 0.0005; return <tr key={i.item_id} className="border-t"><td className="p-2">{i.description}</td><td className="p-2 text-right">{num(i.quantity)}</td><td className="p-2 text-right">{num(i.received_qty)}</td><td className="p-2 text-right">{num(i.outstanding_qty)}</td><td className="p-2"><Badge className={ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{ok ? "Matched" : "Variance"}</Badge></td></tr>; })}</tbody>
        </table>
      </ScrollableX>
      <div className="grid gap-3 md:grid-cols-3">
        <Kpi icon={FileText} label="PO value" value={inr(num(po.total))} />
        <Kpi icon={WalletCards} label="Billed value" value={inr(billed)} tone={!po.billed_expense_id ? "red" : undefined} />
        <Kpi icon={AlertTriangle} label="Value variance" value={inr(valueVariance)} tone={valueVariance > 1 ? "red" : undefined} />
      </div>
    </div>
  );
}

function ActivityPanel({ po }: { po: ApiRow }) {
  const receipts = (po.receipts ?? []) as ApiRow[];
  return receipts.length === 0 ? <Empty icon={Clock} text="No receiving activity yet." /> : (
    <div className="space-y-2">{receipts.map((r) => <div key={r.grn_id} className="rounded-xl border bg-card p-3 text-sm"><div className="flex gap-2"><span className="font-mono font-semibold">{r.grn_number}</span><Badge variant="outline">{r.status}</Badge><span className="ml-auto">{r.received_on}</span></div><p className="mt-1 text-muted-foreground">{r.notes || "No notes"}</p></div>)}</div>
  );
}

function MoneyRow({ label, value }: { label: string; value: unknown }) {
  return <div className="flex justify-between gap-4"><span>{label}</span><span className="font-medium">{inr(num(value))}</span></div>;
}
function normState(v: unknown) { return String(v || "").trim().toLowerCase(); }
function lineTotal(line: PoLine | ApiRow) { return Math.round(num(line.quantity) * num(line.unit_price) * 100) / 100; }
function poTotals(form: PoForm): ApiRow {
  const subtotal = form.items.reduce((s, l) => s + lineTotal(l), 0);
  const tax = form.items.reduce((s, l) => s + lineTotal(l) * (num(l.gst_rate) / 100), 0);
  const other = num(form.other_charges);
  return { subtotal, tax_amount: tax, other_charges: other, total: Math.round(subtotal + tax + other) };
}
function firstProductPrice(product: any) {
  const raw = String(product?.sizes?.[0]?.price || "").replace(/[^\d.]/g, "");
  return raw ? Number(raw) : 0;
}
function receiptPct(po: ApiRow) {
  if (po.receipt_percent != null) return Math.round(num(po.receipt_percent));
  const items = (po.items ?? []) as ApiRow[];
  if (!items.length) return ["received", "billed", "paid"].includes(String(po.status)) ? 100 : po.status === "partially_received" ? 50 : 0;
  const ordered = items.reduce((s, i) => s + num(i.quantity), 0);
  const received = items.reduce((s, i) => s + num(i.received_qty), 0);
  return ordered ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
}
function poPayload(form: PoForm): ApiRow {
  const items = form.items.filter((l) => l.description.trim() && num(l.quantity) > 0).map((l, idx) => ({
    product_id: l.product_id ? Number(l.product_id) : null,
    description: l.description.trim(),
    hsn_code: l.hsn_code.trim(),
    quantity: num(l.quantity),
    unit: l.unit.trim() || "Nos",
    unit_price: num(l.unit_price),
    gst_rate: num(l.gst_rate),
    sort_order: idx,
  }));
  if (!items.length) throw new Error("Add at least one PO line");
  if (!form.vendor_id) throw new Error("Select a vendor");
  return {
    po_number: form.po_number || undefined,
    vendor_id: Number(form.vendor_id),
    pr_id: form.pr_id ? Number(form.pr_id) : null,
    order_date: form.order_date || today(),
    expected_date: form.expected_date || "",
    reference_number: form.reference_number || "",
    shipment_preference: form.shipment_preference || "",
    deliver_to_type: form.deliver_to_type || "organization",
    deliver_to_name: form.deliver_to_name || "",
    deliver_to_address: form.deliver_to_address || "",
    payment_terms: form.payment_terms || "",
    seller_state: form.seller_state || "",
    vendor_state: form.vendor_state || "",
    vendor_gstin: form.vendor_gstin || "",
    gst_treatment: form.gst_treatment || "",
    reverse_charge: !!form.reverse_charge,
    other_charges: num(form.other_charges),
    notes: form.notes || "",
    terms_conditions: form.terms_conditions || "",
    items,
  };
}
function poToForm(po: ApiRow): PoForm {
  return {
    ...emptyPoForm(),
    ...po,
    po_id: po.po_id,
    po_number: po.po_number || "",
    vendor_id: po.vendor_id ? String(po.vendor_id) : "",
    pr_id: po.pr_id ? String(po.pr_id) : "",
    other_charges: String(po.other_charges ?? 0),
    items: ((po.items ?? []) as ApiRow[]).map((it) => ({
      product_id: it.product_id ? String(it.product_id) : "",
      description: it.description || it.product_name || "",
      hsn_code: it.hsn_code || "",
      quantity: String(it.quantity ?? 1),
      unit: it.unit || "Nos",
      unit_price: String(it.unit_price ?? ""),
      gst_rate: String(it.gst_rate ?? 18),
      received_qty: num(it.received_qty),
      item_id: it.item_id ? Number(it.item_id) : undefined,
      product_name: it.product_name,
    })),
  };
}
async function generatePoPdf(form: PoForm) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as any;
  const doc = new jsPDF();
  const totals = poTotals(form);
  doc.setFontSize(18); doc.text("Purchase Order", 14, 18);
  doc.setFontSize(10);
  doc.text(`PO: ${form.po_number || "Draft"}`, 14, 28);
  doc.text(`Vendor: ${form.vendor_name || form.vendor_id || "-"}`, 14, 34);
  doc.text(`Date: ${form.order_date || today()}  Expected: ${form.expected_date || "-"}`, 14, 40);
  autoTable(doc, {
    startY: 48,
    head: [["Item", "HSN", "Qty", "Unit", "Rate", "GST", "Amount"]],
    body: form.items.map((l) => [l.description, l.hsn_code || "-", num(l.quantity), l.unit, inr(num(l.unit_price)), `${num(l.gst_rate)}%`, inr(lineTotal(l))]),
  });
  const y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : 120;
  doc.text(`Subtotal: ${inr(num(totals.subtotal))}`, 140, y);
  doc.text(`GST: ${inr(num(totals.tax_amount))}`, 140, y + 6);
  doc.text(`Other charges: ${inr(num(totals.other_charges))}`, 140, y + 12);
  doc.setFontSize(12); doc.text(`Grand total: ${inr(num(totals.total))}`, 140, y + 22);
  doc.save(`${form.po_number || "purchase-order"}.pdf`);
}
