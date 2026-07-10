import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Wrench, AlertTriangle, Truck, ArrowRightLeft, Pencil, Receipt, CheckCircle2, History, FileText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  fetchMachines, createMachine, updateMachine, updateMachineStatus, getMachine, addPart, updatePart,
  fetchDispatchRecommendations, transferPart, fetchTaxSummary, fetchCatalog, fetchMachineMovements,
  STATUS_LABELS, type Machine, type MachineStatus, type MachineType, type MachinePart, type TaxSummary, type MachineCatalog,
  type MachineMovement,
} from "@/lib/api/machines";
import { createIssue } from "@/lib/api/machineIssues";

const STATUSES: MachineStatus[] = ["in_stock", "reserved", "on_delivery", "delivered", "maintenance"];
const PART_STATUSES = ["present", "missing", "transferred"] as const;

const statusClass: Record<MachineStatus, string> = {
  in_stock: "bg-blue-100 text-blue-700",
  reserved: "bg-amber-100 text-amber-700",
  on_delivery: "bg-purple-100 text-purple-700",
  delivered: "bg-green-100 text-green-700",
  maintenance: "bg-red-100 text-red-700",
};

const emptyForm = {
  code: "", model: "", category: "", machine_type: "brand" as MachineType, accuracy: "", platform_size: "", capacity: "", hsn: "",
  status: "in_stock" as MachineStatus,
  purchase_date: "", invoice_date: "", stamping_date: "", same_date: false, notes: "",
  buy_price: "", buy_gst_pct: "", sale_price: "", sale_gst_pct: "",
  extra_amount: "", extra_from_vendor: "",
};
type FormState = typeof emptyForm;

function money(v: number | string | null | undefined): string {
  return v == null || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN")}`;
}
const num = (v: string) => (v.trim() === "" ? null : Number(v));

// Prices are entered BEFORE GST. This shows the GST amount + gross total that
// the connected modules (invoice / challan / tax) will auto-calculate & add.
function gstPreview(base: string, pct: string): string | null {
  const b = Number(base), p = Number(pct);
  if (!b || !p) return null;
  const gst = Math.round(b * p) / 100;
  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return `+ GST ${fmt(gst)}  =  ${fmt(b + gst)} incl. GST`;
}

export default function Machines() {
  const { taxView } = useAuth();
  const extended = taxView === "extended";

  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<MachineStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<MachineType | "all">("all");

  const [catalog, setCatalog] = useState<MachineCatalog>({ models: [], categories: [], accuracies: [], platform_sizes: [], capacities: [], hsns: [], part_names: [] });

  // Add / Edit dialog (shared form)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Parts + transfer dialog
  const [detail, setDetail] = useState<Machine | null>(null);
  const [newPart, setNewPart] = useState({ part_name: "", qty: 1 });
  const [transferFor, setTransferFor] = useState<MachinePart | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [editPart, setEditPart] = useState<{ id: number; part_name: string; qty: number; status: string } | null>(null);

  // Report-issue dialog (reflects on the Machine Issues page)
  const [issueFor, setIssueFor] = useState<Machine | null>(null);
  const [issueForm, setIssueForm] = useState({ title: "", place: "", process: "Reported" });
  const [issueSaving, setIssueSaving] = useState(false);

  // Movement-history dialog
  const [movesFor, setMovesFor] = useState<Machine | null>(null);
  const [moves, setMoves] = useState<MachineMovement[]>([]);
  const [movesLoading, setMovesLoading] = useState(false);

  // Convert (challan / invoice) chooser
  const [convertFor, setConvertFor] = useState<Machine | null>(null);

  // Dispatch recommendations
  const [dispatch, setDispatch] = useState<Machine[]>([]);
  const [showDispatch, setShowDispatch] = useState(false);

  // Tax vs tax+extra summary (extended only)
  const [taxSum, setTaxSum] = useState<TaxSummary | null>(null);
  useEffect(() => { if (extended) fetchTaxSummary().then(setTaxSum).catch(() => {}); }, [extended]);

  const navigate = useNavigate();

  async function loadCatalog() { try { setCatalog(await fetchCatalog()); } catch { /* ignore */ } }

  async function load() {
    setLoading(true);
    try {
      const { rows } = await fetchMachines({
        search,
        status: statusFilter === "all" ? "" : statusFilter,
        category: categoryFilter === "all" ? "" : categoryFilter,
        machine_type: typeFilter === "all" ? "" : typeFilter,
      });
      setMachines(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load machines");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter, categoryFilter, typeFilter]);
  useEffect(() => { loadCatalog(); }, []);

  // Auto-fill category/HSN/prices when a known model name is chosen (requirement).
  function onModelChange(value: string) {
    const hit = catalog.models.find((m) => m.model.toLowerCase() === value.trim().toLowerCase());
    setForm((f) => ({
      ...f,
      model: value,
      ...(hit ? {
        category: hit.category ?? f.category,
        accuracy: hit.accuracy ?? f.accuracy,
        platform_size: hit.platform_size ?? f.platform_size,
        capacity: hit.capacity ?? f.capacity,
        hsn: hit.hsn ?? f.hsn,
        buy_price: hit.buy_price != null ? String(hit.buy_price) : f.buy_price,
        buy_gst_pct: hit.buy_gst_pct != null ? String(hit.buy_gst_pct) : f.buy_gst_pct,
        sale_price: hit.sale_price != null ? String(hit.sale_price) : f.sale_price,
        sale_gst_pct: hit.sale_gst_pct != null ? String(hit.sale_gst_pct) : f.sale_gst_pct,
      } : {}),
    }));
  }

  function openAdd() { setEditingId(null); setForm(emptyForm); setDialogOpen(true); }
  function openEdit(m: Machine) {
    setEditingId(m.id);
    setForm({
      code: m.code, model: m.model ?? "", category: m.category ?? "", machine_type: m.machine_type ?? "brand",
      accuracy: m.accuracy ?? "", platform_size: m.platform_size ?? "", capacity: m.capacity ?? "", hsn: m.hsn ?? "",
      status: m.status, purchase_date: m.purchase_date ?? "",
      invoice_date: m.invoice_date ?? "", stamping_date: m.stamping_date ?? "",
      same_date: !!(m.invoice_date && m.stamping_date && m.invoice_date === m.stamping_date),
      notes: m.notes ?? "",
      buy_price: m.buy_price != null ? String(m.buy_price) : "",
      buy_gst_pct: m.buy_gst_pct != null ? String(m.buy_gst_pct) : "",
      sale_price: m.sale_price != null ? String(m.sale_price) : "",
      sale_gst_pct: m.sale_gst_pct != null ? String(m.sale_gst_pct) : "",
      extra_amount: m.extra_amount != null ? String(m.extra_amount) : "",
      extra_from_vendor: m.extra_from_vendor != null ? String(m.extra_from_vendor) : "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.code.trim()) { toast.error("Machine code is required"); return; }
    setSaving(true);
    // Sale GST amount derived from sale price × sale GST% (keeps the tax ledger accurate).
    const saleBase = num(form.sale_price);
    const salePct = num(form.sale_gst_pct);
    const taxAmount = saleBase != null && salePct != null ? Math.round(saleBase * salePct) / 100 : null;
    const stampingDate = form.same_date ? form.invoice_date : form.stamping_date;
    const payload: Partial<Machine> & Record<string, unknown> = {
      code: form.code, model: form.model, category: form.category, machine_type: form.machine_type,
      accuracy: form.accuracy, platform_size: form.platform_size, capacity: form.capacity, hsn: form.hsn,
      status: form.status, purchase_date: form.purchase_date,
      invoice_date: form.invoice_date, stamping_date: stampingDate, notes: form.notes,
      buy_price: num(form.buy_price), buy_gst_pct: num(form.buy_gst_pct),
      sale_price: saleBase, sale_gst_pct: salePct, tax_amount: taxAmount,
      extra_amount: num(form.extra_amount), extra_from_vendor: num(form.extra_from_vendor),
    };
    try {
      if (editingId) { await updateMachine(editingId, payload); toast.success("Machine updated"); }
      else { await createMachine(payload); toast.success("Machine created"); }
      setDialogOpen(false); setForm(emptyForm); setEditingId(null);
      load(); loadCatalog();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save machine");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(m: Machine, status: MachineStatus) {
    try { await updateMachineStatus(m.id, status); toast.success(`${m.code} → ${STATUS_LABELS[status]}`); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update status"); }
  }

  async function loadDispatch() {
    try { setDispatch(await fetchDispatchRecommendations()); setShowDispatch(true); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not load recommendations"); }
  }

  async function openParts(m: Machine) {
    try { setDetail(await getMachine(m.id)); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load parts"); }
  }
  async function handleAddPart() {
    if (!detail || !newPart.part_name.trim()) { toast.error("Part name required"); return; }
    try {
      const parts = await addPart(detail.id, newPart);
      setDetail({ ...detail, parts }); setNewPart({ part_name: "", qty: 1 }); load(); loadCatalog();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not add part"); }
  }
  async function saveEditPart() {
    if (!detail || !editPart) return;
    try {
      const parts = await updatePart(detail.id, editPart.id, {
        part_name: editPart.part_name, qty: editPart.qty, status: editPart.status as MachinePart["status"],
      });
      setDetail({ ...detail, parts }); setEditPart(null); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update part"); }
  }
  async function handleTransfer() {
    if (!detail || !transferFor || !transferTo) { toast.error("Pick a target machine"); return; }
    try {
      await transferPart(detail.id, transferFor.id, Number(transferTo));
      toast.success(`${transferFor.part_name} moved — ${detail.code} now flagged incomplete`);
      setTransferFor(null); setTransferTo("");
      setDetail(await getMachine(detail.id)); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Transfer failed"); }
  }

  // Mark a missing/transferred part as present again ("fixed").
  async function markPartPresent(p: MachinePart) {
    if (!detail) return;
    try {
      const parts = await updatePart(detail.id, p.id, { status: "present" });
      setDetail({ ...detail, parts }); toast.success(`${p.part_name} marked present`); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update part"); }
  }

  // Report an issue from the Machines page — it shows up on the Machine Issues page.
  function openIssue(m: Machine) { setIssueForm({ title: "", place: "", process: "Reported" }); setIssueFor(m); }
  async function submitIssue() {
    if (!issueFor || !issueForm.title.trim()) { toast.error("Describe the issue"); return; }
    setIssueSaving(true);
    try {
      await createIssue({
        machine_id: issueFor.id, title: issueForm.title.trim(),
        place: issueForm.place.trim() || undefined, process: issueForm.process || undefined,
      });
      toast.success("Issue reported — see the Machine Issues page");
      setIssueFor(null); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not report issue"); }
    finally { setIssueSaving(false); }
  }

  // Show a machine's movement history.
  async function openMoves(m: Machine) {
    setMovesFor(m); setMoves([]); setMovesLoading(true);
    try { setMoves(await fetchMachineMovements(m.id)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not load movements"); }
    finally { setMovesLoading(false); }
  }

  // Go to the Delivery Challans page with the machine details prefilled in its create form.
  function openChallan(m: Machine) {
    navigate("/deliveries", { state: { machineChallan: {
      machine_id: m.id, code: m.code, category: m.category ?? "",
      amount: m.sale_price ?? "", gst_pct: m.sale_gst_pct ?? 18,
      items: `${m.model ?? ""} (${m.code})`.trim(),
      extra_amount: m.extra_amount ?? "", extra_from_vendor: m.extra_from_vendor ?? "",
    } } });
  }
  // Go to the Invoices page with a line item prefilled from the machine.
  function openInvoice(m: Machine) {
    navigate("/invoices", { state: { machineInvoice: {
      description: `${m.model ?? "Machine"} — ${m.code}`, hsn_code: m.hsn ?? "",
      unit_price: m.sale_price ?? 0, gst_rate: m.sale_gst_pct ?? 18,
      // Off-books extra travels with the machine (extended login only sees it).
      extra_amount: m.extra_amount ?? 0,
    } } });
  }

  const categories = Array.from(new Set(machines.map((m) => m.category).filter(Boolean))) as string[];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wrench className="h-6 w-6" /> Machines</h1>
          <p className="text-sm text-muted-foreground">Machines tracked as inventory units — pricing, parts, and one-click billing.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadDispatch}><Truck className="h-4 w-4 mr-1" /> Dispatch order</Button>
          <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Add Machine</Button>
        </div>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Edit Machine" : "New Machine"}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <div>
              <label className="text-xs text-muted-foreground">Code / Serial *</label>
              <Input placeholder="Code / Serial *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Model (type once, then pick from list)</label>
              <Input list="ml-models" placeholder="Model" value={form.model} onChange={(e) => onModelChange(e.target.value)} />
              <datalist id="ml-models">{catalog.models.map((m) => <option key={m.model} value={m.model} />)}</datalist>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <Input list="ml-cats" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                <datalist id="ml-cats">{catalog.categories.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">HSN</label>
                <Input list="ml-hsn" placeholder="HSN" value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} />
                <datalist id="ml-hsn">{catalog.hsns.map((h) => <option key={h} value={h} />)}</datalist>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Machine Type</label>
              <Select value={form.machine_type} onValueChange={(v) => setForm({ ...form, machine_type: v as MachineType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="brand">Brand</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Accuracy</label>
                <Input list="ml-acc" placeholder="e.g. 1g" value={form.accuracy} onChange={(e) => setForm({ ...form, accuracy: e.target.value })} />
                <datalist id="ml-acc">{catalog.accuracies.map((a) => <option key={a} value={a} />)}</datalist>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Platform size</label>
                <Input list="ml-plat" placeholder="e.g. 400x400" value={form.platform_size} onChange={(e) => setForm({ ...form, platform_size: e.target.value })} />
                <datalist id="ml-plat">{catalog.platform_sizes.map((p) => <option key={p} value={p} />)}</datalist>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Capacity</label>
                <Input list="ml-cap" placeholder="e.g. 50kg" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
                <datalist id="ml-cap">{catalog.capacities.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Buy price (before GST) + GST %</label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" placeholder="Buy price (excl. GST)" value={form.buy_price} onChange={(e) => setForm({ ...form, buy_price: e.target.value })} />
                <Input type="number" placeholder="Buy GST %" value={form.buy_gst_pct} onChange={(e) => setForm({ ...form, buy_gst_pct: e.target.value })} />
              </div>
              {gstPreview(form.buy_price, form.buy_gst_pct) && <p className="text-xs text-muted-foreground mt-1">{gstPreview(form.buy_price, form.buy_gst_pct)}</p>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Sale price (before GST) + GST %</label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" placeholder="Sale price (excl. GST)" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} />
                <Input type="number" placeholder="Sale GST %" value={form.sale_gst_pct} onChange={(e) => setForm({ ...form, sale_gst_pct: e.target.value })} />
              </div>
              {gstPreview(form.sale_price, form.sale_gst_pct) && <p className="text-xs text-muted-foreground mt-1">{gstPreview(form.sale_price, form.sale_gst_pct)}</p>}
            </div>
            {extended && (
              <div>
                <label className="text-xs text-muted-foreground">Extra (extended login only)</label>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" placeholder="Extra → customer" value={form.extra_amount} onChange={(e) => setForm({ ...form, extra_amount: e.target.value })} />
                  <Input type="number" placeholder="Extra ← vendor" value={form.extra_from_vendor} onChange={(e) => setForm({ ...form, extra_from_vendor: e.target.value })} />
                </div>
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Purchase date</label>
              <Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Invoice date</label>
                <Input type="date" value={form.invoice_date}
                  onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value, stamping_date: f.same_date ? e.target.value : f.stamping_date }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Stamping date (optional)</label>
                <Input type="date" value={form.same_date ? form.invoice_date : form.stamping_date} disabled={form.same_date}
                  onChange={(e) => setForm({ ...form, stamping_date: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={form.same_date}
                onChange={(e) => setForm((f) => ({ ...f, same_date: e.target.checked, stamping_date: e.target.checked ? f.invoice_date : f.stamping_date }))} />
              Stamping date same as invoice date
            </label>
            {!form.same_date && !form.stamping_date && (
              <p className="text-xs text-amber-600">No stamping date — this machine will show as “stamping pending” on the dashboard.</p>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as MachineStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tax vs Tax+Extra summary — extended login only */}
      {extended && taxSum && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Business tax &amp; extra — machine sales + delivery challans</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border p-4 bg-card"><p className="text-xs text-muted-foreground">Total tax (standard)</p><p className="text-lg font-bold">{money(taxSum.total_tax)}</p></div>
            <div className="rounded-lg border p-4 bg-card"><p className="text-xs text-muted-foreground">Extra → customer</p><p className="text-lg font-bold">{money(taxSum.total_extra_to_customer)}</p></div>
            <div className="rounded-lg border p-4 bg-card"><p className="text-xs text-muted-foreground">Extra ← vendor</p><p className="text-lg font-bold">{money(taxSum.total_extra_from_vendor)}</p></div>
            <div className="rounded-lg border p-4 bg-card"><p className="text-xs text-muted-foreground">Tax + extra (combined)</p><p className="text-lg font-bold">{money(taxSum.total_with_extra)}</p></div>
          </div>
        </div>
      )}

      {/* Dispatch recommendations */}
      {showDispatch && (
        <div className="border rounded-lg p-4 bg-secondary/30">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2"><Truck className="h-4 w-4" /> Recommended dispatch order</h3>
            <Button size="sm" variant="ghost" onClick={() => setShowDispatch(false)}>Hide</Button>
          </div>
          {dispatch.length === 0 ? <p className="text-sm text-muted-foreground">No in-stock machines to dispatch.</p> : (
            <ol className="space-y-2">
              {dispatch.map((m) => (
                <li key={m.id} className="flex items-center gap-3 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">{m.dispatch_rank}</span>
                  <span className="font-medium">{m.code}</span><span className="text-muted-foreground">{m.model || ""}</span>
                  <span className={`ml-auto text-xs ${m.missing_parts_count ? "text-red-600" : "text-green-600"}`}>{m.dispatch_reason}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-64" placeholder="Search code / model…" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as MachineStatus | "all")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as MachineType | "all")}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All types</SelectItem><SelectItem value="brand">Brand</SelectItem><SelectItem value="local">Local</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" onClick={load}>Search</Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-2 py-2">Code</th><th className="px-2 py-2">Model</th><th className="px-2 py-2">Category</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">HSN</th>
              <th className="px-2 py-2">Status</th><th className="px-2 py-2">Parts</th>
              <th className="px-2 py-2">Buy</th><th className="px-2 py-2">Sale</th><th className="px-2 py-2">Tax</th>
              {extended && <th className="px-2 py-2">Extra→Cust</th>}
              {extended && <th className="px-2 py-2">Extra←Vend</th>}
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={extended ? 13 : 11}>Loading…</td></tr>
            ) : machines.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={extended ? 13 : 11}>No machines yet. Add one to get started.</td></tr>
            ) : machines.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="px-2 py-2 font-medium">{m.code}</td>
                <td className="px-2 py-2">{m.model || "—"}</td>
                <td className="px-2 py-2">{m.category || "—"}</td>
                <td className="px-2 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs capitalize ${(m.machine_type ?? "brand") === "local" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{m.machine_type ?? "brand"}</span>
                </td>
                <td className="px-2 py-2">{m.hsn || "—"}</td>
                <td className="px-2 py-2">
                  <Select value={m.status} onValueChange={(v) => handleStatus(m, v as MachineStatus)}>
                    <SelectTrigger className={`h-7 w-[104px] border-0 px-2 text-xs ${statusClass[m.status]}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-2">
                  {m.missing_parts_count ? (
                    <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium"><AlertTriangle className="h-3.5 w-3.5" /> {m.missing_parts_count} missing</span>
                  ) : <span className="text-green-600 text-xs">complete</span>}
                </td>
                <td className="px-2 py-2">{money(m.buy_price)}</td>
                <td className="px-2 py-2">{money(m.sale_price)}</td>
                <td className="px-2 py-2">{money(m.tax_amount)}</td>
                {extended && <td className="px-2 py-2">{money(m.extra_amount)}</td>}
                {extended && <td className="px-2 py-2">{money(m.extra_from_vendor)}</td>}
                <td className="px-2 py-2">
                  <div className="grid grid-cols-2 gap-1 w-16">
                    <Button size="icon" variant="outline" className="h-7 w-7" title="Edit" onClick={() => openEdit(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="outline" className="h-7 w-7" title="Parts" onClick={() => openParts(m)}><Wrench className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="outline" className="h-7 w-7" title="Report issue" onClick={() => openIssue(m)}><AlertTriangle className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="outline" className="h-7 w-7" title="Create challan or invoice" onClick={() => setConvertFor(m)}><FileText className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Parts + transfer dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) { setDetail(null); setTransferFor(null); setEditPart(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Parts — {detail?.code}</DialogTitle></DialogHeader>

          {detail?.missing_parts && detail.missing_parts.length > 0 && (
            <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-700 text-xs">
              <AlertTriangle className="h-4 w-4" /> Incomplete: {detail.missing_parts.map((p) => p.part_name).join(", ")} missing — block invoice/delivery until resolved.
            </div>
          )}

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(detail?.parts ?? []).length === 0 && <p className="text-sm text-muted-foreground">No parts recorded.</p>}
            {(detail?.parts ?? []).map((p: MachinePart) => editPart?.id === p.id ? (
              <div key={p.id} className="flex items-center gap-2 border rounded px-2 py-2 bg-secondary/30">
                <Input list="ml-parts" className="h-8" value={editPart.part_name} onChange={(e) => setEditPart({ ...editPart, part_name: e.target.value })} />
                <Input type="number" className="h-8 w-16" value={editPart.qty} onChange={(e) => setEditPart({ ...editPart, qty: Number(e.target.value) })} />
                <Select value={editPart.status} onValueChange={(v) => setEditPart({ ...editPart, status: v })}>
                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>{PART_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" onClick={saveEditPart}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditPart(null)}>✕</Button>
              </div>
            ) : (
              <div key={p.id} className="flex items-center justify-between border rounded px-3 py-2">
                <span>{p.part_name} <span className="text-muted-foreground">×{p.qty}</span></span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${p.status === "missing" ? "bg-red-100 text-red-700" : p.status === "transferred" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{p.status}</span>
                  {p.status !== "present" && (
                    <Button size="sm" variant="ghost" title="Mark present (fixed)" onClick={() => markPartPresent(p)}><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /></Button>
                  )}
                  <Button size="sm" variant="ghost" title="Edit part" onClick={() => setEditPart({ id: p.id, part_name: p.part_name, qty: Number(p.qty), status: p.status })}><Pencil className="h-3.5 w-3.5" /></Button>
                  {p.status === "present" && (
                    <Button size="sm" variant="ghost" title="Move to another machine" onClick={() => { setTransferFor(p); setTransferTo(""); }}><ArrowRightLeft className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {transferFor && (
            <div className="border rounded-lg p-3 bg-secondary/30 space-y-2">
              <p className="text-sm font-medium">Move “{transferFor.part_name}” to:</p>
              <div className="flex items-center gap-2">
                <Select value={transferTo} onValueChange={setTransferTo}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Target machine" /></SelectTrigger>
                  <SelectContent>{machines.filter((m) => m.id !== detail?.id).map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.code}{m.model ? ` — ${m.model}` : ""}</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={handleTransfer}>Move</Button>
                <Button variant="outline" onClick={() => setTransferFor(null)}>Cancel</Button>
              </div>
              <p className="text-xs text-muted-foreground">The source machine ({detail?.code}) will be flagged as missing this part.</p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Input list="ml-parts" placeholder="Part name" value={newPart.part_name} onChange={(e) => setNewPart({ ...newPart, part_name: e.target.value })} />
            <datalist id="ml-parts">{catalog.part_names.map((p) => <option key={p} value={p} />)}</datalist>
            <Input type="number" className="w-20" value={newPart.qty} onChange={(e) => setNewPart({ ...newPart, qty: Number(e.target.value) })} />
            <Button onClick={handleAddPart}>Add</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Convert chooser — challan or invoice */}
      <Dialog open={!!convertFor} onOpenChange={(o) => !o && setConvertFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Convert {convertFor?.code}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">What would you like to create from this machine?</p>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="outline" className="h-16 flex-col gap-1" onClick={() => { const m = convertFor!; setConvertFor(null); openChallan(m); }}>
              <Truck className="h-5 w-5" /> Delivery Challan
            </Button>
            <Button className="h-16 flex-col gap-1" onClick={() => { const m = convertFor!; setConvertFor(null); openInvoice(m); }}>
              <Receipt className="h-5 w-5" /> Invoice
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Report issue dialog */}
      <Dialog open={!!issueFor} onOpenChange={(o) => !o && setIssueFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Report Issue — {issueFor?.code}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Issue *</label>
              <Input placeholder="e.g. Display not working" value={issueForm.title} onChange={(e) => setIssueForm({ ...issueForm, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Place (where it is)</label>
                <Input placeholder="Workshop / Customer site" value={issueForm.place} onChange={(e) => setIssueForm({ ...issueForm, place: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Process (stage)</label>
                <Select value={issueForm.process} onValueChange={(v) => setIssueForm({ ...issueForm, process: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Reported", "Diagnosing", "Awaiting Parts", "In Repair", "Testing", "Ready"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Reporting an issue moves the machine to Maintenance and lists it on the Machine Issues page.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueFor(null)}>Cancel</Button>
            <Button onClick={submitIssue} disabled={issueSaving}>{issueSaving ? "Saving…" : "Report Issue"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Movement history dialog */}
      <Dialog open={!!movesFor} onOpenChange={(o) => !o && setMovesFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Movements — {movesFor?.code}</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {movesLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : moves.length === 0 ? (
              <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
            ) : moves.map((mv) => (
              <div key={mv.id} className="flex items-start justify-between border rounded px-3 py-2 text-sm">
                <div>
                  <span className="text-xs px-2 py-0.5 rounded bg-secondary capitalize">{mv.movement_type.replace("_", " ")}</span>
                  <div className="mt-1">{mv.description || "—"}</div>
                  {mv.by_name && <div className="text-xs text-muted-foreground">by {mv.by_name}</div>}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{mv.created_at?.slice(0, 16).replace("T", " ")}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
