import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Search, Truck, AlertTriangle, FileDown } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { MachineAlertsBanner } from "@/components/MachineAlertsBanner";
import {
  fetchDeliveries, createDelivery, setDeliveryStatus, DELIVERY_LABELS,
  type DeliveryNote, type DeliveryStatus,
} from "@/lib/api/deliveries";
import { fetchMachines, type Machine } from "@/lib/api/machines";
import { downloadChallanPdf } from "@/lib/deliveryChallanPdf";

const STATUSES: DeliveryStatus[] = ["draft", "issued", "delivered", "cancelled"];

const statusClass: Record<DeliveryStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  issued: "bg-blue-100 text-blue-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

const emptyForm = {
  customer_name: "", machine_id: "", category: "", items: "", delivery_date: "", notes: "",
  amount: "", gst_pct: "18", extra_amount: "", extra_from_vendor: "",
};

function money(v: number | string | null | undefined): string {
  return v == null || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN")}`;
}

export default function Deliveries() {
  const { taxView } = useAuth();
  const extended = taxView === "extended";
  const [rows, setRows] = useState<DeliveryNote[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { rows } = await fetchDeliveries({ search, status: statusFilter === "all" ? "" : statusFilter });
      setRows(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load deliveries");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);
  useEffect(() => { fetchMachines({ limit: 200 }).then((r) => setMachines(r.rows)).catch(() => {}); }, []);

  // Prefill + open the create dialog when arriving from a machine's "Challan" button.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const mc = (location.state as { machineChallan?: Record<string, unknown> } | null)?.machineChallan;
    if (!mc) return;
    setForm({
      ...emptyForm,
      machine_id: mc.machine_id != null ? String(mc.machine_id) : "",
      category: (mc.category as string) ?? "",
      amount: mc.amount != null && mc.amount !== "" ? String(mc.amount) : "",
      gst_pct: mc.gst_pct != null ? String(mc.gst_pct) : "18",
      items: (mc.items as string) ?? "",
      extra_amount: mc.extra_amount != null && mc.extra_amount !== "" ? String(mc.extra_amount) : "",
      extra_from_vendor: mc.extra_from_vendor != null && mc.extra_from_vendor !== "" ? String(mc.extra_from_vendor) : "",
      delivery_date: new Date().toISOString().slice(0, 10),
    });
    setAddOpen(true);
    navigate("/deliveries", { replace: true, state: null }); // clear so a refresh won't reopen
    // eslint-disable-next-line
  }, []);

  // Live warning inside the dialog when the chosen machine is incomplete.
  const selectedMachine = machines.find((m) => String(m.id) === form.machine_id);
  const selectedMissing = selectedMachine?.missing_parts_count ?? 0;

  // Live GST/total preview (GST% auto-calculates the tax amount).
  const challanTax = (() => {
    const amt = form.amount.trim() === "" ? 0 : Number(form.amount);
    const pct = form.gst_pct.trim() === "" ? 0 : Number(form.gst_pct);
    const gst = amt * pct / 100;
    return { gst, total: amt + gst };
  })();

  async function handleCreate() {
    if (!form.customer_name.trim()) { toast.error("Customer name is required"); return; }
    setSaving(true);
    try {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      const amt = num(form.amount), pct = num(form.gst_pct);
      const tax = amt != null && pct != null ? Math.round(amt * pct) / 100 : null;
      const res = await createDelivery({
        customer_name: form.customer_name,
        machine_id: form.machine_id ? Number(form.machine_id) : null,
        category: form.category,
        items: form.items,
        delivery_date: form.delivery_date,
        notes: form.notes,
        amount: amt,
        tax_amount: tax,
        extra_amount: num(form.extra_amount),
        extra_from_vendor: num(form.extra_from_vendor),
      });
      if (res.warning) toast.warning(res.warning);
      else toast.success(`Challan ${res.challan_no} created`);
      setAddOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create challan");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(r: DeliveryNote, status: DeliveryStatus) {
    try {
      await setDeliveryStatus(r.id, status);
      toast.success(`${r.challan_no} → ${DELIVERY_LABELS[status]}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update status");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6" /> Delivery Challans</h1>
          <p className="text-sm text-muted-foreground">Delivery bills linked to machine units — warns if a machine is missing parts.</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> New Challan</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Delivery Challan</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Customer name *</label>
                <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Machine (links to inventory)</label>
                <Select value={form.machine_id} onValueChange={(v) => setForm({ ...form, machine_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select machine" /></SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.code}{m.model ? ` — ${m.model}` : ""}{m.missing_parts_count ? "  ⚠ incomplete" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedMissing > 0 && (
                <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-700 text-xs">
                  <AlertTriangle className="h-4 w-4" /> This machine is missing {selectedMissing} part(s). Delivering it incomplete — resolve first if unintended.
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Category</label>
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Delivery date</label>
                  <Input type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Amount (₹)</label>
                  <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">GST %</label>
                  <Input type="number" value={form.gst_pct} onChange={(e) => setForm({ ...form, gst_pct: e.target.value })} />
                </div>
              </div>
              {extended && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-amber-700">Extra → customer (₹)</label>
                    <Input type="number" value={form.extra_amount} onChange={(e) => setForm({ ...form, extra_amount: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-amber-700">Extra ← vendor (₹)</label>
                    <Input type="number" value={form.extra_from_vendor} onChange={(e) => setForm({ ...form, extra_from_vendor: e.target.value })} />
                  </div>
                </div>
              )}
              <div className="rounded-lg border bg-secondary/30 p-2 text-sm flex justify-between">
                <span className="text-muted-foreground">GST {money(challanTax.gst)}</span>
                <span className="font-bold">Total {money(challanTax.total)}</span>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Items / notes</label>
                <Textarea value={form.items} onChange={(e) => setForm({ ...form, items: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleCreate} disabled={saving}>{saving ? "Saving…" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <MachineAlertsBanner />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-64" placeholder="Search challan / customer…" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DeliveryStatus | "all")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{DELIVERY_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load}>Search</Button>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-3">Challan #</th><th className="p-3">Customer</th><th className="p-3">Machine</th>
              <th className="p-3">Amount</th><th className="p-3">Tax</th>
              {extended && <th className="p-3 text-amber-700">Extra→Cust</th>}
              {extended && <th className="p-3 text-amber-700">Extra←Vend</th>}
              <th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3">Flag</th><th className="p-3">Download</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={extended ? 11 : 9}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={extended ? 11 : 9}>No challans yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.challan_no}</td>
                <td className="p-3">{r.customer_name || "—"}</td>
                <td className="p-3">{r.machine_code || "—"}</td>
                <td className="p-3">{money(r.amount)}</td>
                <td className="p-3">{money(r.tax_amount)}</td>
                {extended && <td className="p-3 text-amber-700 font-medium">{money(r.extra_amount)}</td>}
                {extended && <td className="p-3 text-amber-700 font-medium">{money(r.extra_from_vendor)}</td>}
                <td className="p-3">{r.delivery_date || "—"}</td>
                <td className="p-3">
                  <Select value={r.status} onValueChange={(v) => handleStatus(r, v as DeliveryStatus)}>
                    <SelectTrigger className={`h-7 w-32 border-0 ${statusClass[r.status]}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{DELIVERY_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-3">
                  {(r.missing_parts_count ?? 0) > 0 || r.missing_flag ? (
                    <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" /> incomplete
                    </span>
                  ) : <span className="text-green-600 text-xs">ok</span>}
                </td>
                <td className="p-3">
                  <Button size="sm" variant="outline" onClick={() => downloadChallanPdf(r)}><FileDown className="h-3.5 w-3.5 mr-1" />PDF</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
