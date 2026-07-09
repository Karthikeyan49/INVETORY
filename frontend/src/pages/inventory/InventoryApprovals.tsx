import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Clock, Eye, ThumbsDown, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { inr0, num, qty, formatDateTime } from "@/lib/inventoryFormat";
import {
  getPendingApprovals, getApprovalStats, getApprovalHistory, approveRequest, rejectRequest,
  type InvApproval,
} from "@/lib/api/inventory";

const APPROVAL_TYPES = ["HIGH_VALUE", "DAMAGE_THRESHOLD", "MANUAL_ADJUSTMENT", "TRANSFER", "EMERGENCY_USE"];

const typeChip: Record<string, string> = {
  HIGH_VALUE: "bg-red-100 text-red-700",
  DAMAGE_THRESHOLD: "bg-orange-100 text-orange-700",
  MANUAL_ADJUSTMENT: "bg-indigo-100 text-indigo-700",
  TRANSFER: "bg-blue-100 text-blue-700",
  EMERGENCY_USE: "bg-amber-100 text-amber-700",
};

export default function InventoryApprovals() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [detail, setDetail] = useState<InvApproval | null>(null);
  const [decision, setDecision] = useState<{ approval: InvApproval; kind: "approve" | "reject" } | null>(null);
  const [remarks, setRemarks] = useState("");

  const stats = useQuery({ queryKey: ["inv", "approvals", "stats"], queryFn: getApprovalStats });
  const pending = useQuery({ queryKey: ["inv", "approvals", "pending"], queryFn: getPendingApprovals });

  const [histType, setHistType] = useState("all");
  const [histStatus, setHistStatus] = useState("all");
  const history = useQuery({
    queryKey: ["inv", "approvals", "history", { histType, histStatus }],
    queryFn: () => getApprovalHistory({
      approval_type: histType === "all" ? undefined : histType,
      status: histStatus === "all" ? undefined : histStatus,
    }),
    enabled: tab === "history",
  });

  const act = useMutation({
    mutationFn: async () => {
      if (!decision) throw new Error("No decision");
      if (decision.kind === "reject" && remarks.trim().length < 10) throw new Error("Rejection remarks must be at least 10 characters");
      return decision.kind === "approve"
        ? approveRequest(decision.approval.approval_id, remarks.trim())
        : rejectRequest(decision.approval.approval_id, remarks.trim());
    },
    onSuccess: () => {
      toast.success(decision?.kind === "approve" ? "Approval granted" : "Approval rejected");
      setDecision(null); setRemarks("");
      qc.invalidateQueries({ queryKey: ["inv", "approvals"] });
      qc.invalidateQueries({ queryKey: ["inv", "movements"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });

  const s = stats.data;
  const pendingRows = pending.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory Approvals</h1>
          <p className="text-muted-foreground">Review, approve and audit high-value, damage, adjustment and transfer requests.</p>
        </div>
        <div className="flex rounded-lg border bg-muted/40 p-0.5 text-sm">
          {([["pending", "Pending"], ["history", "History"]] as ["pending" | "history", string][]).map(([v, label]) => (
            <button key={v} onClick={() => setTab(v)}
              className={cn("rounded-md px-3 py-1.5", tab === v ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending" value={String(num(s?.total_pending))} icon={ClipboardCheck} tone={num(s?.total_pending) ? "amber" : "muted"} />
        <StatCard label="Approved Today" value={String(num(s?.total_approved_today))} icon={CheckCircle2} tone="emerald" />
        <StatCard label="Rejected Today" value={String(num(s?.total_rejected_today))} icon={ThumbsDown} tone="muted" />
        <StatCard label="Overdue" value={String(num(s?.overdue_approvals))} icon={Clock} tone={num(s?.overdue_approvals) ? "red" : "muted"} />
      </div>
      {s && <p className="text-xs text-muted-foreground">Average approval time: {num(s.avg_approval_time_hours)} h</p>}

      {tab === "pending" ? (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Type</th><th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2">Requested By</th><th className="px-3 py-2 text-right">Hours</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.isLoading ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>
                ) : pendingRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">Nothing waiting for approval.</td></tr>
                ) : pendingRows.map((a) => (
                  <tr key={a.approval_id} className="border-t">
                    <td className="px-3 py-2"><Badge className={cn("border-transparent", typeChip[a.approval_type] ?? "bg-slate-100 text-slate-600")}>{a.approval_type.replace(/_/g, " ")}</Badge></td>
                    <td className="px-3 py-2">{a.product ?? `Movement #${a.movement_id}`}</td>
                    <td className="px-3 py-2 text-right">{qty(a.quantity ?? 0)}</td>
                    <td className="px-3 py-2 text-right">{inr0(a.total_value ?? 0)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.requested_by ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span>{num(a.hours_pending)}h</span>
                        {a.is_overdue && <Badge className="border-transparent bg-red-100 text-red-700">Overdue</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDetail(a)}><Eye className="h-4 w-4" /></Button>
                        <Button size="sm" className="h-7 gap-1" onClick={() => { setDecision({ approval: a, kind: "approve" }); setRemarks(""); }}><CheckCircle2 className="h-4 w-4" /> Approve</Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-destructive" onClick={() => { setDecision({ approval: a, kind: "reject" }); setRemarks(""); }}><X className="h-4 w-4" /> Reject</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={histType} onValueChange={setHistType}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {APPROVAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={histStatus} onValueChange={setHistStatus}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Type</th><th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2">Outcome</th>
                    <th className="px-3 py-2">Requested</th><th className="px-3 py-2">Actioned</th>
                  </tr>
                </thead>
                <tbody>
                  {history.isLoading ? (
                    <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>
                  ) : (history.data ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">No approval history.</td></tr>
                  ) : (history.data ?? []).map((a) => {
                    const r = a as unknown as Record<string, unknown>;
                    return (
                      <tr key={a.approval_id} className="border-t">
                        <td className="px-3 py-2"><Badge className={cn("border-transparent", typeChip[a.approval_type] ?? "bg-slate-100 text-slate-600")}>{a.approval_type.replace(/_/g, " ")}</Badge></td>
                        <td className="px-3 py-2">{String(r.product ?? `#${r.movement_id}`)}</td>
                        <td className="px-3 py-2 text-right">{qty(r.quantity ?? 0)}</td>
                        <td className="px-3 py-2"><OutcomeBadge status={String(r.approval_status ?? "")} /></td>
                        <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.created_at)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.actioned_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-md">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge className={cn("border-transparent", typeChip[detail.approval_type] ?? "bg-slate-100 text-slate-600")}>{detail.approval_type.replace(/_/g, " ")}</Badge>
                  Approval #{detail.approval_id}
                </DialogTitle>
              </DialogHeader>
              <div className="rounded-lg border">
                <Row label="Product" value={detail.product ?? `Movement #${detail.movement_id}`} />
                <Row label="Movement type" value={detail.movement_type ?? "—"} />
                <Row label="Quantity" value={qty(detail.quantity ?? 0)} />
                <Row label="Value" value={inr0(detail.total_value ?? 0)} />
                <Row label="Requested by" value={detail.requested_by ?? "—"} />
                <Row label="Requested at" value={formatDateTime(detail.requested_at)} />
                <Row label="Hours pending" value={`${num(detail.hours_pending)}h${detail.is_overdue ? " · overdue" : ""}`} />
                {detail.remarks && <Row label="Remarks" value={detail.remarks} />}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="gap-1 text-destructive" onClick={() => { setDecision({ approval: detail, kind: "reject" }); setRemarks(""); setDetail(null); }}><X className="h-4 w-4" /> Reject</Button>
                <Button className="gap-1" onClick={() => { setDecision({ approval: detail, kind: "approve" }); setRemarks(""); setDetail(null); }}><CheckCircle2 className="h-4 w-4" /> Approve</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Decision modal */}
      <Dialog open={!!decision} onOpenChange={(v) => !v && setDecision(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{decision?.kind === "approve" ? "Approve" : "Reject"} approval #{decision?.approval.approval_id}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{decision?.approval.product ?? `Movement #${decision?.approval.movement_id}`}</p>
          <Field label={decision?.kind === "reject" ? "Reason (required, min 10 chars)" : "Remarks (optional)"}>
            <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button variant={decision?.kind === "reject" ? "destructive" : "default"} disabled={act.isPending} onClick={() => act.mutate()}>
              {decision?.kind === "approve" ? "Confirm approval" : "Confirm rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone }: {
  label: string; value: string; icon: typeof Clock; tone: "amber" | "red" | "emerald" | "muted";
}) {
  const valueTone = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-card-foreground";
  return (
    <div className="flex items-start justify-between rounded-xl border bg-card p-5 shadow-sm">
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-bold", valueTone)}>{value}</p>
      </div>
      <div className="rounded-xl bg-secondary p-3"><Icon className="h-6 w-6 text-primary" /></div>
    </div>
  );
}

function OutcomeBadge({ status }: { status: string }) {
  const up = status.toUpperCase();
  return (
    <Badge className={cn("border-transparent",
      up === "APPROVED" ? "bg-emerald-100 text-emerald-700"
        : up === "REJECTED" ? "bg-red-100 text-red-700"
        : "bg-amber-100 text-amber-700")}>
      {up || "—"}
    </Badge>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs text-muted-foreground">{label}</Label><div className="mt-1">{children}</div></div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-card-foreground">{value}</span>
    </div>
  );
}
