import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, ChevronsUpDown, Download, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { exportToExcel } from "@/lib/exporters";
import { inr, num, qty, formatDateTime } from "@/lib/inventoryFormat";
import { MovementTypeBadge } from "@/components/inventory/MovementTypeBadge";
import { fetchDealers } from "@/lib/api/dealers";
import { employeesApi } from "@/lib/api/hr";
import {
  getMovements, getMovementPendingApprovals, getInventoryProducts, getInventoryZones,
  issueToEmployee, allocateToDealer, recordProductionUse, transferZones, markDamaged, emergencyUse,
  returnToVendor, approveRequest, rejectRequest, type InvMovement,
} from "@/lib/api/inventory";

type Tab = "all" | "issue" | "approvals";
const MOVEMENT_TYPE_FILTERS = ["STOCK_IN", "STOCK_OUT", "TRANSFER", "ADJUSTMENT", "DAMAGE", "RETURN", "PRODUCTION_USE", "DEALER_ALLOCATION", "EMPLOYEE_ISSUE", "EMERGENCY_USE"];

const ISSUE_TYPES = [
  { value: "EMPLOYEE_ISSUE", label: "Employee Issue" },
  { value: "DEALER_ALLOCATION", label: "Dealer Allocation" },
  { value: "PRODUCTION_USE", label: "Production Use" },
  { value: "TRANSFER", label: "Zone Transfer" },
  { value: "DAMAGE", label: "Mark Damaged" },
  { value: "EMERGENCY_USE", label: "Emergency Use" },
  { value: "RETURN", label: "Return to Vendor" },
] as const;

export default function InventoryMovements() {
  const [tab, setTab] = useState<Tab>("all");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory Movements</h1>
          <p className="text-muted-foreground">Track, issue and approve every stock movement in one place.</p>
        </div>
        <div className="flex rounded-lg border bg-muted/40 p-0.5 text-sm">
          {([["all", "All Movements"], ["issue", "Issue Stock"], ["approvals", "Pending Approvals"]] as [Tab, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setTab(v)}
              className={cn("rounded-md px-3 py-1.5", tab === v ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "all" && <AllMovements />}
      {tab === "issue" && <IssueStock />}
      {tab === "approvals" && <PendingApprovals />}
    </div>
  );
}

// ── Tab 1: All Movements ──────────────────────────────────────────────────────

function AllMovements() {
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState<InvMovement | null>(null);

  const movements = useQuery({
    queryKey: ["inv", "movements", { type, status, from, to }],
    queryFn: () => getMovements({
      movement_type: type === "all" ? undefined : type,
      approval_status: status === "all" ? undefined : status,
      date_from: from || undefined, date_to: to || undefined, limit: 200,
    }),
  });

  const rows = movements.data ?? [];

  const exportRows = () => exportToExcel({
    sheetName: "Movements",
    filename: `inventory-movements-${new Date().toISOString().slice(0, 10)}.xlsx`,
    columns: [
      { header: "Type", key: "movement_type" },
      { header: "Product", key: (r) => r.product_name ?? "" },
      { header: "Qty", key: (r) => num(r.quantity) },
      { header: "Value", key: (r) => num(r.total_value) },
      { header: "Status", key: "approval_status" },
      { header: "When", key: (r) => formatDateTime(r.created_at) },
    ],
    rows,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {MOVEMENT_TYPE_FILTERS.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="w-[160px]" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-[160px]" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="outline" className="ml-auto gap-2" onClick={exportRows}><Download className="h-4 w-4" /> Export</Button>
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Type</th><th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2">User</th><th className="px-3 py-2">When</th><th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {movements.isLoading ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No movements match.</td></tr>
              ) : rows.map((m) => (
                <tr key={m.movement_id} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => setDetail(m)}>
                  <td className="px-3 py-2"><MovementTypeBadge type={m.movement_type} /></td>
                  <td className="px-3 py-2">{m.product_name ?? `#${m.inv_product_id}`}</td>
                  <td className="px-3 py-2 text-right font-medium">{qty(m.quantity)}</td>
                  <td className="px-3 py-2 text-right">{inr(m.total_value)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.moved_by_name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDateTime(m.created_at)}</td>
                  <td className="px-3 py-2"><StatusBadge status={m.approval_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          {detail && (
            <>
              <DialogHeader><DialogTitle className="flex items-center gap-2"><MovementTypeBadge type={detail.movement_type} /> Movement #{detail.movement_id}</DialogTitle></DialogHeader>
              <div className="rounded-lg border">
                <Row label="Product" value={detail.product_name ?? `#${detail.inv_product_id}`} />
                <Row label="SKU" value={detail.sku ?? "—"} />
                <Row label="Zone" value={detail.zone_name ?? `#${detail.zone_id}`} />
                <Row label="Quantity" value={qty(detail.quantity)} />
                <Row label="Unit cost" value={inr(detail.unit_cost)} />
                <Row label="Total value" value={inr(detail.total_value)} />
                <Row label="Status" value={detail.approval_status} />
                <Row label="User" value={detail.moved_by_name ?? "—"} />
                <Row label="When" value={formatDateTime(detail.created_at)} />
                {detail.remarks && <Row label="Remarks" value={detail.remarks} />}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab 2: Issue Stock ────────────────────────────────────────────────────────

function IssueStock() {
  const qc = useQueryClient();
  const [type, setType] = useState<(typeof ISSUE_TYPES)[number]["value"]>("EMPLOYEE_ISSUE");
  const [f, setF] = useState<Record<string, string>>({});

  const products = useQuery({ queryKey: ["inv", "products"], queryFn: () => getInventoryProducts({ limit: 500 }) });
  const zones = useQuery({ queryKey: ["inv", "zones"], queryFn: getInventoryZones });
  const dealers = useQuery({ queryKey: ["dealers"], queryFn: fetchDealers });
  const employees = useQuery({ queryKey: ["hr", "employees"], queryFn: () => employeesApi.list() });
  const [employeePopOpen, setEmployeePopOpen] = useState(false);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const reset = () => setF({});

  const submit = useMutation({
    mutationFn: async () => {
      const productId = num(f.product_id);
      const zoneId = num(f.zone_id);
      const quantity = num(f.quantity);
      if (!productId) throw new Error("Select a product");
      if (quantity <= 0) throw new Error("Quantity must be greater than zero");
      switch (type) {
        case "EMPLOYEE_ISSUE":
          if (!num(f.employee_id)) throw new Error("Employee ID is required");
          if ((f.remarks ?? "").trim().length < 5) throw new Error("Remarks must be at least 5 characters");
          return issueToEmployee({ product_id: productId, employee_id: num(f.employee_id), quantity, remarks: f.remarks, zone_id: zoneId });
        case "DEALER_ALLOCATION":
          if (!num(f.dealer_id)) throw new Error("Select a dealer");
          return allocateToDealer({ product_id: productId, dealer_id: num(f.dealer_id), quantity, remarks: f.remarks ?? "", zone_id: zoneId });
        case "PRODUCTION_USE":
          if (!(f.batch_reference ?? "").trim()) throw new Error("Batch reference is required");
          return recordProductionUse({ product_id: productId, quantity, batch_reference: f.batch_reference, remarks: f.remarks ?? "", zone_id: zoneId });
        case "TRANSFER":
          if (!num(f.to_zone_id)) throw new Error("Select a destination zone");
          if ((f.reason ?? "").trim().length < 10) throw new Error("Reason must be at least 10 characters");
          return transferZones({ product_id: productId, from_zone_id: zoneId, to_zone_id: num(f.to_zone_id), quantity, reason: f.reason });
        case "DAMAGE":
          if ((f.reason ?? "").trim().length < 10) throw new Error("Reason must be at least 10 characters");
          return markDamaged({ product_id: productId, zone_id: zoneId, quantity, reason: f.reason });
        case "EMERGENCY_USE":
          if ((f.reason ?? "").trim().length < 10) throw new Error("Reason must be at least 10 characters");
          if (!num(f.authorized_by)) throw new Error("Authorized-by user ID is required");
          return emergencyUse({ product_id: productId, quantity, reason: f.reason, authorized_by: num(f.authorized_by), zone_id: zoneId });
        case "RETURN":
          if (!(f.supplier_name ?? "").trim()) throw new Error("Supplier name is required for Return to Vendor");
          if ((f.reason ?? "").trim().length < 10) throw new Error("Reason must be at least 10 characters");
          return returnToVendor({
            product_id: productId, zone_id: zoneId, quantity,
            supplier_name: f.supplier_name, reason: f.reason,
          });
      }
    },
    onSuccess: () => {
      toast.success("Movement recorded");
      reset();
      qc.invalidateQueries({ queryKey: ["inv", "movements"] });
      qc.invalidateQueries({ queryKey: ["inv", "movements", "pending"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record movement"),
  });

  return (
    <div className="max-w-2xl rounded-xl border bg-card p-5 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Movement type" className="col-span-2">
          <Select value={type} onValueChange={(v) => { setType(v as typeof type); reset(); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{ISSUE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>

        <Field label="Product" className="col-span-2">
          <Select value={f.product_id ?? ""} onValueChange={(v) => set("product_id", v)}>
            <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
            <SelectContent>{(products.data ?? []).filter((p) => !p.is_deleted).map((p) => <SelectItem key={p.inv_product_id} value={String(p.inv_product_id)}>{p.name} ({p.sku})</SelectItem>)}</SelectContent>
          </Select>
        </Field>

        <Field label={type === "TRANSFER" ? "From zone" : "Zone"}>
          <Select value={f.zone_id ?? ""} onValueChange={(v) => set("zone_id", v)}>
            <SelectTrigger><SelectValue placeholder="Select zone" /></SelectTrigger>
            <SelectContent>{(zones.data ?? []).map((z) => <SelectItem key={z.zone_id} value={String(z.zone_id)}>{z.zone_name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>

        <Field label="Quantity"><Input type="number" min="0" step="0.001" value={f.quantity ?? ""} onChange={(e) => set("quantity", e.target.value)} /></Field>

        {type === "EMPLOYEE_ISSUE" && (
          <Field label="Employee">
            <Popover open={employeePopOpen} onOpenChange={setEmployeePopOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  role="combobox"
                  aria-expanded={employeePopOpen}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className={cn("truncate", !f.employee_label && "text-muted-foreground")}>
                    {f.employee_label || "Select employee"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[320px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search employee…" />
                  <CommandList>
                    <CommandEmpty>No employee found.</CommandEmpty>
                    <CommandGroup>
                      {(employees.data ?? []).map((emp) => {
                        const label = `${emp.name} (${emp.id})`;
                        return (
                          <CommandItem
                            key={emp.id}
                            value={label}
                            onSelect={() => {
                              set("employee_id", String(emp.employee_id ?? ""));
                              set("employee_label", label);
                              setEmployeePopOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", f.employee_label === label ? "opacity-100" : "opacity-0")} />
                            {label}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </Field>
        )}
        {type === "DEALER_ALLOCATION" && (
          <Field label="Dealer">
            <Select value={f.dealer_id ?? ""} onValueChange={(v) => set("dealer_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select dealer" /></SelectTrigger>
              <SelectContent>{(dealers.data ?? []).map((d) => <SelectItem key={d.user_id} value={String(d.user_id)}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        )}
        {type === "PRODUCTION_USE" && (
          <Field label="Batch reference"><Input value={f.batch_reference ?? ""} onChange={(e) => set("batch_reference", e.target.value)} /></Field>
        )}
        {type === "TRANSFER" && (
          <Field label="To zone">
            <Select value={f.to_zone_id ?? ""} onValueChange={(v) => set("to_zone_id", v)}>
              <SelectTrigger><SelectValue placeholder="Destination zone" /></SelectTrigger>
              <SelectContent>{(zones.data ?? []).map((z) => <SelectItem key={z.zone_id} value={String(z.zone_id)}>{z.zone_name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        )}
        {type === "EMERGENCY_USE" && (
          <Field label="Authorized by (user ID)"><Input type="number" min="0" value={f.authorized_by ?? ""} onChange={(e) => set("authorized_by", e.target.value)} /></Field>
        )}
        {type === "RETURN" && (
          <Field label="Supplier / Vendor Name" className="col-span-2">
            <Input placeholder="e.g. ABC Wood Suppliers Pvt Ltd" value={f.supplier_name ?? ""} onChange={(e) => set("supplier_name", e.target.value)} />
          </Field>
        )}

        {(type === "TRANSFER" || type === "DAMAGE" || type === "EMERGENCY_USE" || type === "RETURN") ? (
          <Field label="Reason" className="col-span-2"><Textarea rows={2} placeholder="At least 10 characters" value={f.reason ?? ""} onChange={(e) => set("reason", e.target.value)} /></Field>
        ) : (
          <Field label="Remarks" className="col-span-2"><Textarea rows={2} value={f.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} /></Field>
        )}
      </div>

      {type === "EMERGENCY_USE" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Emergency use is recorded as <span className="font-medium">pending approval</span> until an admin approves it.
        </div>
      )}
      {type === "RETURN" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Stock will be reduced from the selected zone and recorded as a <span className="font-medium">Return to Vendor</span> movement.
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button className="gap-2" disabled={submit.isPending} onClick={() => submit.mutate()}><Send className="h-4 w-4" /> {submit.isPending ? "Recording…" : "Record movement"}</Button>
      </div>
    </div>
  );
}

// ── Tab 3: Pending Approvals ──────────────────────────────────────────────────

function PendingApprovals() {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<{ movement: InvMovement; kind: "approve" | "reject" } | null>(null);
  const [remarks, setRemarks] = useState("");

  const pending = useQuery({ queryKey: ["inv", "movements", "pending"], queryFn: getMovementPendingApprovals });

  const act = useMutation({
    mutationFn: async () => {
      if (!decision) throw new Error("No decision");
      // The backend approve/reject endpoints key on the approval record's id,
      // not the movement id — these are different sequences.
      const id = decision.movement.approval_id;
      if (!id) throw new Error("Missing approval id for this movement");
      if (decision.kind === "reject" && remarks.trim().length < 10) throw new Error("Rejection remarks must be at least 10 characters");
      return decision.kind === "approve" ? approveRequest(id, remarks.trim()) : rejectRequest(id, remarks.trim());
    },
    onSuccess: () => {
      toast.success(decision?.kind === "approve" ? "Movement approved" : "Movement rejected");
      setDecision(null); setRemarks("");
      qc.invalidateQueries({ queryKey: ["inv", "movements", "pending"] });
      qc.invalidateQueries({ queryKey: ["inv", "movements"] });
      qc.invalidateQueries({ queryKey: ["inv", "approvals", "pending"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });

  const rows = pending.data ?? [];

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Type</th><th className="px-3 py-2">Product</th>
              <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2">When</th><th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.isLoading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">No movements awaiting approval.</td></tr>
            ) : rows.map((m) => (
              <tr key={m.movement_id} className="border-t">
                <td className="px-3 py-2"><MovementTypeBadge type={m.movement_type} /></td>
                <td className="px-3 py-2">{m.product_name ?? `#${m.inv_product_id}`}</td>
                <td className="px-3 py-2 text-right font-medium">{qty(m.quantity)}</td>
                <td className="px-3 py-2 text-right">{inr(m.total_value)}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatDateTime(m.created_at)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" className="h-7 gap-1" onClick={() => { setDecision({ movement: m, kind: "approve" }); setRemarks(""); }}><CheckCircle2 className="h-4 w-4" /> Approve</Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-destructive" onClick={() => { setDecision({ movement: m, kind: "reject" }); setRemarks(""); }}><X className="h-4 w-4" /> Reject</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!decision} onOpenChange={(v) => !v && setDecision(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{decision?.kind === "approve" ? "Approve" : "Reject"} movement #{decision?.movement.movement_id}</DialogTitle></DialogHeader>
          <Field label={decision?.kind === "reject" ? "Reason (required, min 10 chars)" : "Remarks (optional)"}>
            <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button variant={decision?.kind === "reject" ? "destructive" : "default"} disabled={act.isPending} onClick={() => act.mutate()}>
              {decision?.kind === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── shared ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={cn("border-transparent",
      status === "APPROVED" ? "bg-emerald-100 text-emerald-700"
        : status === "PENDING" ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700")}>
      {status}
    </Badge>
  );
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="text-xs text-muted-foreground">{label}</Label><div className="mt-1">{children}</div></div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-card-foreground">{value}</span>
    </div>
  );
}
