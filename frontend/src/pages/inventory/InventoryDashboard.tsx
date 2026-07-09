import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, Wrench, AlertTriangle, PackageCheck, Truck, ArrowLeftRight, CheckCircle2, Stamp } from "lucide-react";
import {
  fetchMachines, fetchMovementsFeed, STATUS_LABELS,
  type Machine, type MachineStatus, type MachineMovement,
} from "@/lib/api/machines";
import { fetchItems, type InventoryItem } from "@/lib/api/inventoryItems";
import { fetchIssues, type MachineIssue } from "@/lib/api/machineIssues";
import { fetchStampingAlerts, type StampingAlerts } from "@/lib/api/stampings";

const TYPE_LABELS: Record<string, string> = {
  added: "Added", status_change: "Status change", part_out: "Part moved out",
  part_in: "Part received", invoice: "Invoice", challan: "Challan", issue: "Issue",
};

export default function InventoryDashboard() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [issues, setIssues] = useState<MachineIssue[]>([]);
  const [moves, setMoves] = useState<MachineMovement[]>([]);
  const [alerts, setAlerts] = useState<StampingAlerts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [mc, it, is, mv, sa] = await Promise.all([
          fetchMachines({ limit: 500 }),
          fetchItems(),
          fetchIssues({}),
          fetchMovementsFeed(),
          fetchStampingAlerts(),
        ]);
        setMachines(mc.rows); setItems(it.rows); setIssues(is.rows); setMoves(mv); setAlerts(sa);
      } catch { /* non-blocking */ } finally { setLoading(false); }
    })();
  }, []);

  const byStatus = (s: MachineStatus) => machines.filter((m) => m.status === s).length;
  const totalUnits = items.reduce((a, r) => a + (r.quantity || 0), 0);
  const lowStock = items.filter((r) => r.quantity <= 5);
  const openIssues = issues.filter((i) => i.status !== "resolved");
  const missingParts = machines.filter((m) => (m.missing_parts_count ?? 0) > 0).length;
  const stampTotal = alerts ? alerts.counts.overdue + alerts.counts.due_soon + alerts.counts.pending : 0;

  const statusOrder: MachineStatus[] = ["in_stock", "reserved", "on_delivery", "delivered", "maintenance"];
  const statusColor: Record<MachineStatus, string> = {
    in_stock: "bg-blue-500", reserved: "bg-amber-500", on_delivery: "bg-purple-500",
    delivered: "bg-green-500", maintenance: "bg-red-500",
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6" /> Inventory Dashboard</h1>
        <p className="text-sm text-muted-foreground">Live overview of machines, stock items, issues and movements.</p>
      </div>

      {/* Stamping alert banner */}
      {alerts && stampTotal > 0 && (
        <Link
          to="/stamping"
          className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${
            alerts.counts.overdue > 0
              ? "border-red-300 bg-red-50 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:hover:bg-red-950/60"
              : "border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
          }`}
        >
          <AlertTriangle className={`h-5 w-5 mt-0.5 shrink-0 ${alerts.counts.overdue > 0 ? "text-red-600" : "text-amber-600"}`} />
          <div className="text-sm">
            <p className={`font-semibold ${alerts.counts.overdue > 0 ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
              Stamping needs attention
            </p>
            <p className="text-muted-foreground">
              {alerts.counts.overdue > 0 && <>{alerts.counts.overdue} overdue · </>}
              {alerts.counts.due_soon} due within 7 days · {alerts.counts.pending} not stamped yet
            </p>
          </div>
        </Link>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard to="/machines" icon={Boxes} label="Machines" value={machines.length} />
        <StatCard to="/machines" icon={PackageCheck} label="In Stock" value={byStatus("in_stock")} />
        <StatCard to="/machines" icon={Truck} label="On Delivery" value={byStatus("on_delivery")} />
        <StatCard to="/machines" icon={CheckCircle2} label="Delivered" value={byStatus("delivered")} />
        <StatCard to="/machine-issues" icon={AlertTriangle} label="Open Issues" value={openIssues.length} tone={openIssues.length ? "red" : undefined} />
        <StatCard to="/inventory-items" icon={Boxes} label="Stock Units" value={totalUnits} sub={`${items.length} item(s)`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Machines by status */}
        <div className="rounded-xl border bg-card p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Wrench className="h-4 w-4" /> Machines by status</h2>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : machines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No machines yet.</p>
          ) : (
            <div className="space-y-2">
              {statusOrder.map((s) => {
                const n = byStatus(s);
                const pct = machines.length ? Math.round((n / machines.length) * 100) : 0;
                return (
                  <div key={s} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 text-muted-foreground">{STATUS_LABELS[s]}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${statusColor[s]}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-8 text-right font-medium">{n}</span>
                  </div>
                );
              })}
              {missingParts > 0 && (
                <p className="text-xs text-red-600 pt-1 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {missingParts} machine(s) with missing parts</p>
              )}
            </div>
          )}
        </div>

        {/* Stamping alerts */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2"><Stamp className="h-4 w-4" /> Stamping alerts</h2>
            <Link to="/stamping" className="text-xs text-primary hover:underline">Manage</Link>
          </div>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : !alerts || stampTotal === 0 ? (
            <p className="text-sm text-muted-foreground">All machines stamped and up to date.</p>
          ) : (
            <div className="space-y-3">
              {alerts.overdue.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-red-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Overdue ({alerts.counts.overdue})</p>
                  {alerts.overdue.slice(0, 6).map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <div>
                        <span className="font-medium">{s.machine_code ?? `#${s.machine_id}`}</span>
                        {s.machine_model && <span className="text-muted-foreground ml-2">{s.machine_model}</span>}
                      </div>
                      <span className="text-xs text-red-600 whitespace-nowrap">{s.expiry_date ? `expired ${s.expiry_date}` : "overdue"}</span>
                    </div>
                  ))}
                </div>
              )}
              {alerts.due_soon.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Due within 7 days ({alerts.counts.due_soon})</p>
                  {alerts.due_soon.slice(0, 6).map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <div>
                        <span className="font-medium">{s.machine_code ?? `#${s.machine_id}`}</span>
                        {s.machine_model && <span className="text-muted-foreground ml-2">{s.machine_model}</span>}
                      </div>
                      <span className="text-xs text-amber-600 whitespace-nowrap">{s.expiry_date ? `due ${s.expiry_date}` : "due soon"}</span>
                    </div>
                  ))}
                </div>
              )}
              {alerts.pending.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Stamp className="h-3.5 w-3.5" /> Not stamped yet ({alerts.counts.pending})</p>
                  {alerts.pending.slice(0, 6).map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <div>
                        <span className="font-medium">{s.machine_code ?? `#${s.machine_id}`}</span>
                        {s.machine_model && <span className="text-muted-foreground ml-2">{s.machine_model}</span>}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">not stamped yet</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent movements */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Recent movements</h2>
            <Link to="/movements" className="text-xs text-primary hover:underline">View all</Link>
          </div>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : moves.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {moves.slice(0, 12).map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-2 text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div>
                    <span className="font-medium">{m.machine_code ?? `#${m.machine_id}`}</span>
                    <span className="text-xs text-muted-foreground ml-2">{TYPE_LABELS[m.movement_type] ?? m.movement_type}</span>
                    <div className="text-xs text-muted-foreground">{m.description || "—"}</div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{m.created_at?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Open issues */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Open issues</h2>
            <Link to="/machine-issues" className="text-xs text-primary hover:underline">Manage</Link>
          </div>
          {openIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open issues.</p>
          ) : (
            <div className="space-y-2">
              {openIssues.slice(0, 6).map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <div>
                    <span className="font-medium">{i.machine_code ?? `#${i.machine_id}`}</span>
                    <span className="text-muted-foreground ml-2">{i.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{i.process || i.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Low stock */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2"><PackageCheck className="h-4 w-4" /> Low stock items</h2>
            <Link to="/inventory-items" className="text-xs text-primary hover:underline">All items</Link>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet.</p>
          ) : lowStock.length === 0 ? (
            <p className="text-sm text-muted-foreground">All items well stocked.</p>
          ) : (
            <div className="space-y-2">
              {lowStock.slice(0, 6).map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{it.name}{it.category ? <span className="text-muted-foreground"> · {it.category}</span> : null}</span>
                  <span className="font-semibold text-red-600">{it.quantity} {it.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ to, icon: Icon, label, value, sub, tone }: {
  to: string; icon: typeof Boxes; label: string; value: number; sub?: string; tone?: "red";
}) {
  return (
    <Link to={to} className="rounded-xl border bg-card p-4 hover:bg-muted/40 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${tone === "red" ? "text-red-500" : "text-primary"}`} />
      </div>
      <div className={`text-2xl font-bold mt-1 ${tone === "red" && value > 0 ? "text-red-600" : ""}`}>{value.toLocaleString("en-IN")}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Link>
  );
}
