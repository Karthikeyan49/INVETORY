/**
 * Purchase Order register (R10 / T4) — marketing gives the record, staff enters
 * it. Vendor, category, line items, taxable + off-books extra (extended login
 * only), default payment category + UTR, location, status. Advance + N
 * installments and the live outstanding come from the shared PaymentLedger.
 * A single-page Total Outstanding widget (across POs / purchases / stamping)
 * with Excel/PDF download sits on top.
 *
 * NOTE: layout is provisional — the reference photo promised for this register
 * has not been supplied; refine when it lands (see REQUIREMENTS_SET3.md §5).
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, FileSpreadsheet, FileDown, Wallet, CheckCircle2, PackageCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import PaymentLedger from "@/components/PaymentLedger";
import { exportToExcel, exportToPdf } from "@/lib/exporters";
import {
  fetchPurchaseOrders, createPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder,
  fetchOutstanding, PO_STATUSES,
  type PurchaseOrder, type PoInput, type PoItem, type PoStatus, type OutstandingSummary,
} from "@/lib/api/poRegister";
import { PAYMENT_CATEGORIES } from "@/lib/api/installments";
import { createMachine } from "@/lib/api/machines";
import { createSpare, moveSpare, fetchSpares, type Spare } from "@/lib/api/spares";

const money = (v: number | string | null | undefined) =>
  v == null || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const emptyItem = (): PoItem => ({ description: "", qty: 1, unit_price: 0 });

const emptyForm = {
  vendor_name: "", category: "", location: "", gst_pct: "", extra_amount: "", other_charges: "",
  payment_category: "Bank Transfer", utr_no: "", advance: "", status: "open" as PoStatus, notes: "",
  payment_mode: "credit",
};
type FormState = typeof emptyForm;

const statusClass: Record<PoStatus, string> = {
  open: "bg-amber-100 text-amber-700",
  confirmed: "bg-sky-100 text-sky-700",
  closed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-200 text-gray-600",
};

// One machine unit to be received from a PO line (serial + dates).
type UnitRow = { serial: string; purchase_date: string; stamping_date: string };
// A PO line item's receive plan: receive as N machines (with serials/dates) or
// as a spare (quantity into stock).
type LinePlan = {
  description: string;
  qty: number;
  unit_price: number;
  kind: "machine" | "spare";
  samePurchase: boolean;   // one purchase date across all units (overridable)
  sharedPurchase: string;
  stampingSame: boolean;   // stamping date = purchase date
  units: UnitRow[];
  spareId: string;         // "" = create a new spare from the description
};

export default function PurchaseOrders() {
  const { taxView } = useAuth();
  const extended = taxView === "extended";

  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [items, setItems] = useState<PoItem[]>([emptyItem()]);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingSummary | null>(null);

  // Convert-to-confirmed goods-receipt popup
  const [confirmFor, setConfirmFor] = useState<PurchaseOrder | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<LinePlan[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [spares, setSpares] = useState<Spare[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { rows, categories } = await fetchPurchaseOrders({ search, category: categoryFilter, status: statusFilter });
      setRows(rows);
      setCategories(categories);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, statusFilter]);

  const loadOutstanding = useCallback(async () => {
    try { setOutstanding(await fetchOutstanding()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadOutstanding(); }, [loadOutstanding]);

  function openAdd() {
    setEditingId(null); setForm(emptyForm); setItems([emptyItem()]); setDialogOpen(true);
  }
  function openEdit(po: PurchaseOrder) {
    setEditingId(po.id);
    setForm({
      vendor_name: po.vendor_name, category: po.category ?? "", location: po.location ?? "",
      gst_pct: po.gst_pct ? String(po.gst_pct) : "", extra_amount: po.extra_amount ? String(po.extra_amount) : "",
      other_charges: po.other_charges ? String(po.other_charges) : "",
      payment_category: po.payment_category ?? "Bank Transfer", utr_no: po.utr_no ?? "",
      advance: "", status: po.status, notes: po.notes ?? "", payment_mode: "credit",
    });
    setItems(po.items && po.items.length ? po.items.map((i) => ({ ...i })) : [emptyItem()]);
    setDialogOpen(true);
  }

  const cleanItems = () => items.filter((i) => i.description.trim() !== "");
  const itemsTaxable = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
  const gst = itemsTaxable * (Number(form.gst_pct) || 0) / 100;
  const grand = itemsTaxable + gst + (Number(form.other_charges) || 0) + (extended ? (Number(form.extra_amount) || 0) : 0);

  async function handleSave() {
    if (!form.vendor_name.trim()) { toast.error("Vendor name is required"); return; }
    setSaving(true);
    const payload: PoInput = {
      vendor_name: form.vendor_name.trim(),
      category: form.category.trim() || undefined,
      location: form.location.trim() || undefined,
      gst_pct: Number(form.gst_pct) || 0,
      other_charges: Number(form.other_charges) || 0,
      payment_category: form.payment_category || undefined,
      utr_no: form.utr_no.trim() || undefined,
      status: form.status,
      notes: form.notes.trim() || undefined,
      items: cleanItems(),
    };
    if (extended) payload.extra_amount = Number(form.extra_amount) || 0;
    if (!editingId) {
      // Cash = paid in full (advance covers the whole total → nothing outstanding);
      // credit = whatever advance was entered.
      if (form.payment_mode === "cash") payload.advance = grand;
      else if (Number(form.advance) > 0) payload.advance = Number(form.advance);
    }
    try {
      if (editingId) { await updatePurchaseOrder(editingId, payload); toast.success("Purchase order updated"); }
      else { await createPurchaseOrder(payload); toast.success("Purchase order created"); }
      setDialogOpen(false);
      load(); loadOutstanding();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save purchase order");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(po: PurchaseOrder) {
    if (!confirm(`Delete purchase order ${po.po_no}? This also removes its payment ledger.`)) return;
    try {
      await deletePurchaseOrder(po.id);
      toast.success("Purchase order deleted");
      load(); loadOutstanding();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  // ---- Convert PO → confirmed (receive into inventory) ----
  function guessKind(category: string | null, description: string): "machine" | "spare" {
    const hay = `${category ?? ""} ${description}`.toLowerCase();
    if (/(spare|part|belt|bearing|filter|oil|coolant|roll|cable|sensor)/.test(hay)) return "spare";
    return "machine";
  }
  function openConfirm(po: PurchaseOrder) {
    setConfirmFor(po);
    fetchSpares({}).then(({ rows }) => setSpares(rows)).catch(() => setSpares([]));
    const plan: LinePlan[] = (po.items ?? []).map((it) => {
      const qty = Math.max(1, Math.round(Number(it.qty) || 1));
      return {
        description: it.description,
        qty,
        unit_price: Number(it.unit_price) || 0,
        kind: guessKind(po.category, it.description),
        samePurchase: true,
        sharedPurchase: "",
        stampingSame: true,
        units: Array.from({ length: qty }, () => ({ serial: "", purchase_date: "", stamping_date: "" })),
        spareId: "",
      };
    });
    setConfirmPlan(plan);
  }
  function setLine(idx: number, patch: Partial<LinePlan>) {
    setConfirmPlan((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function setUnit(lineIdx: number, unitIdx: number, patch: Partial<UnitRow>) {
    setConfirmPlan((prev) => prev.map((l, i) =>
      i === lineIdx ? { ...l, units: l.units.map((u, j) => (j === unitIdx ? { ...u, ...patch } : u)) } : l,
    ));
  }
  async function doConfirm() {
    if (!confirmFor) return;
    // Validate: every machine unit needs a serial code.
    for (const line of confirmPlan) {
      if (line.kind === "machine" && line.units.some((u) => !u.serial.trim())) {
        toast.error(`Enter a serial code for every "${line.description}" unit`);
        return;
      }
    }
    setConfirming(true);
    try {
      for (const line of confirmPlan) {
        if (line.kind === "machine") {
          for (const u of line.units) {
            const pd = (line.samePurchase ? line.sharedPurchase : u.purchase_date) || undefined;
            const sd = (line.stampingSame ? (line.samePurchase ? line.sharedPurchase : u.purchase_date) : u.stamping_date) || undefined;
            await createMachine({
              code: u.serial.trim(),
              model: line.description,
              category: confirmFor.category || undefined,
              purchase_date: pd,
              invoice_date: pd,
              stamping_date: sd,
              buy_price: line.unit_price || undefined,
            });
          }
        } else {
          if (line.spareId) {
            await moveSpare(Number(line.spareId), { qty: line.qty, reason: "receive", note: `PO ${confirmFor.po_no}` });
          } else {
            await createSpare({
              name: line.description,
              category: confirmFor.category || undefined,
              quantity: line.qty,
              unit: "pcs",
              unit_cost: line.unit_price || 0,
              reorder_level: 0,
            });
          }
        }
      }
      await updatePurchaseOrder(confirmFor.id, { status: "confirmed" });
      toast.success(`PO ${confirmFor.po_no} confirmed — stock received`);
      setConfirmFor(null);
      load();
      loadOutstanding();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not confirm purchase order");
    } finally {
      setConfirming(false);
    }
  }

  function exportOutstanding(kind: "excel" | "pdf") {
    if (!outstanding || outstanding.rows.length === 0) { toast.error("Nothing outstanding to export"); return; }
    const columns = [
      { header: "Source", key: "source" as const },
      { header: "Ref No", key: "ref_no" as const },
      { header: "Party", key: "party" as const },
      { header: "Category", key: "category" as const },
      { header: "Total", key: "grand_total" as const },
      { header: "Paid", key: "paid" as const },
      { header: "Outstanding", key: "outstanding" as const },
    ];
    const filename = `total-outstanding-${outstanding.as_of}`;
    if (kind === "excel") {
      exportToExcel({ sheetName: "Outstanding", columns, rows: outstanding.rows, filename });
    } else {
      exportToPdf({
        title: "Total Outstanding",
        subtitle: `As of ${outstanding.as_of} · ${outstanding.tax_view} view · Total ${money(outstanding.total_outstanding)}`,
        columns, rows: outstanding.rows, filename,
      });
    }
  }

  function setItem(idx: number, patch: Partial<PoItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-card-foreground">Purchase Orders</h1>
          <p className="text-muted-foreground text-sm mt-1">Credit-purchase register by category · advance + installments · live outstanding</p>
        </div>
        <Button onClick={openAdd} className="gap-1"><Plus className="h-4 w-4" /> New PO</Button>
      </div>

      {/* Total Outstanding widget */}
      {outstanding && (
        <div className="border rounded-lg p-4 bg-muted/30">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Wallet className="h-8 w-8 text-red-600" />
              <div>
                <div className="text-xs text-muted-foreground">Total Outstanding ({outstanding.tax_view} view)</div>
                <div className="text-2xl font-bold text-red-700">{money(outstanding.total_outstanding)}</div>
              </div>
            </div>
            <div className="flex gap-4 text-sm">
              <div><span className="text-muted-foreground">POs</span> {money(outstanding.by_source.purchase_orders)}</div>
              <div><span className="text-muted-foreground">Purchases</span> {money(outstanding.by_source.purchases)}</div>
              <div><span className="text-muted-foreground">Stamping</span> {money(outstanding.by_source.stamping)}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={() => exportOutstanding("excel")}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => exportOutstanding("pdf")}><FileDown className="h-4 w-4" /> PDF</Button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <Input placeholder="Search vendor / PO no" value={search} onChange={(e) => setSearch(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && load()} className="w-56" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem>{PO_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={load}>Search</Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-2 py-2">PO No</th><th className="px-2 py-2">Vendor</th><th className="px-2 py-2">Category</th>
              <th className="px-2 py-2">Total</th><th className="px-2 py-2">Paid</th><th className="px-2 py-2">Outstanding</th>
              <th className="px-2 py-2">Status</th><th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-4 text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-muted-foreground">No purchase orders yet.</td></tr>
            ) : rows.map((po) => (
              <tr key={po.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setDetail(po)}>
                <td className="px-2 py-2 font-medium">{po.po_no}</td>
                <td className="px-2 py-2">{po.vendor_name}</td>
                <td className="px-2 py-2">{po.category || "—"}</td>
                <td className="px-2 py-2">{money(po.grand_total)}</td>
                <td className="px-2 py-2 text-green-700">{money(po.amount_paid)}</td>
                <td className="px-2 py-2 text-red-700 font-medium">{money(po.outstanding)}</td>
                <td className="px-2 py-2"><span className={`text-xs px-2 py-0.5 rounded capitalize ${statusClass[po.status]}`}>{po.status}</span></td>
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-2">
                    {po.status === "open" && (
                      <button className="text-sky-600 hover:text-sky-800" onClick={() => openConfirm(po)} title="Confirm & receive into inventory"><CheckCircle2 className="h-4 w-4" /></button>
                    )}
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => openEdit(po)} title="Edit"><Pencil className="h-4 w-4" /></button>
                    <button className="text-red-500 hover:text-red-700" onClick={() => handleDelete(po)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit Purchase Order" : "New Purchase Order"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Vendor name *</label>
                <Input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <Input list="po-cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Spares, Machines" />
                <datalist id="po-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </div>

            {/* Items */}
            <div>
              <label className="text-xs text-muted-foreground">Items</label>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <Input className="col-span-6" placeholder="Description" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
                    <Input className="col-span-2" type="number" placeholder="Qty" value={it.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} />
                    <Input className="col-span-3" type="number" placeholder="Unit price" value={it.unit_price} onChange={(e) => setItem(idx, { unit_price: Number(e.target.value) })} />
                    <button className="col-span-1 text-red-500 hover:text-red-700" onClick={() => setItems(items.length > 1 ? items.filter((_, i) => i !== idx) : [emptyItem()])}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="mt-1 gap-1" onClick={() => setItems([...items, emptyItem()])}><Plus className="h-3 w-3" /> Add item</Button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">GST %</label>
                <Input type="number" value={form.gst_pct} onChange={(e) => setForm({ ...form, gst_pct: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Other charges</label>
                <Input type="number" value={form.other_charges} onChange={(e) => setForm({ ...form, other_charges: e.target.value })} />
              </div>
              {extended && (
                <div>
                  <label className="text-xs text-muted-foreground">Extra (off-books)</label>
                  <Input type="number" value={form.extra_amount} onChange={(e) => setForm({ ...form, extra_amount: e.target.value })} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Location</label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Payment category</label>
                <Select value={form.payment_category} onValueChange={(v) => setForm({ ...form, payment_category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">UTR / Ref</label>
                <Input value={form.utr_no} onChange={(e) => setForm({ ...form, utr_no: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {!editingId && (
                <div>
                  <label className="text-xs text-muted-foreground">Purchase type</label>
                  <Select value={form.payment_mode} onValueChange={(v) => setForm({ ...form, payment_mode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash (paid in full)</SelectItem>
                      <SelectItem value="credit">Credit (pay later)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!editingId && form.payment_mode === "credit" && (
                <div>
                  <label className="text-xs text-muted-foreground">Advance paid</label>
                  <Input type="number" value={form.advance} onChange={(e) => setForm({ ...form, advance: e.target.value })} />
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as PoStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PO_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>

            <p className="text-sm text-muted-foreground">
              Taxable {money(itemsTaxable)} + GST {money(gst)}{Number(form.other_charges) ? ` + charges ${money(Number(form.other_charges))}` : ""}
              {extended && Number(form.extra_amount) ? ` + extra ${money(Number(form.extra_amount))}` : ""} = <span className="font-semibold text-foreground">{money(grand)}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail + payment ledger */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) { setDetail(null); load(); loadOutstanding(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader><DialogTitle>{detail.po_no} · {detail.vendor_name}</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">Category:</span> {detail.category || "—"}</div>
                  <div><span className="text-muted-foreground">Location:</span> {detail.location || "—"}</div>
                  <div><span className="text-muted-foreground">Payment category:</span> {detail.payment_category || "—"}</div>
                  <div><span className="text-muted-foreground">UTR:</span> {detail.utr_no || "—"}</div>
                </div>
                {detail.items && detail.items.length > 0 && (
                  <div className="border rounded overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-left"><tr><th className="px-2 py-1">Item</th><th className="px-2 py-1">Qty</th><th className="px-2 py-1">Price</th><th className="px-2 py-1">Amount</th></tr></thead>
                      <tbody>{detail.items.map((it) => (<tr key={it.id} className="border-t"><td className="px-2 py-1">{it.description}</td><td className="px-2 py-1">{it.qty}</td><td className="px-2 py-1">{money(it.unit_price)}</td><td className="px-2 py-1">{money(it.amount)}</td></tr>))}</tbody>
                    </table>
                  </div>
                )}
                <div className="border-t pt-3">
                  <h3 className="font-medium mb-2">Payments</h3>
                  <PaymentLedger refType="po_register" refId={detail.id} />
                </div>
                {detail.status === "open" && (
                  <div className="border-t pt-3">
                    <Button className="gap-1" onClick={() => { const po = detail; setDetail(null); openConfirm(po); }}>
                      <CheckCircle2 className="h-4 w-4" /> Confirm & receive into inventory
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Convert PO → confirmed: receive line items into inventory */}
      <Dialog open={!!confirmFor} onOpenChange={(o) => !o && setConfirmFor(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {confirmFor && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5" /> Confirm {confirmFor.po_no} — receive stock</DialogTitle>
              </DialogHeader>
              {confirmPlan.length === 0 ? (
                <p className="text-sm text-muted-foreground">This purchase order has no line items to receive.</p>
              ) : (
                <div className="space-y-4">
                  {confirmPlan.map((line, li) => (
                    <div key={li} className="border rounded-lg p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="font-medium text-sm">{line.description} <span className="text-muted-foreground">× {line.qty}</span></div>
                        <Select value={line.kind} onValueChange={(v) => setLine(li, { kind: v as "machine" | "spare" })}>
                          <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="machine">Receive as machines</SelectItem>
                            <SelectItem value="spare">Receive as spare</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {line.kind === "machine" ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-4">
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <input type="checkbox" checked={line.samePurchase} onChange={(e) => setLine(li, { samePurchase: e.target.checked })} />
                              Same purchase date for all {line.qty} unit(s)
                            </label>
                            {line.samePurchase && (
                              <Input type="date" className="h-8 w-40" value={line.sharedPurchase} onChange={(e) => setLine(li, { sharedPurchase: e.target.value })} />
                            )}
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <input type="checkbox" checked={line.stampingSame} onChange={(e) => setLine(li, { stampingSame: e.target.checked })} />
                              Stamping date same as purchase date
                            </label>
                          </div>
                          <div className="space-y-2">
                            {line.units.map((u, ui) => (
                              <div key={ui} className="grid grid-cols-12 gap-2 items-center">
                                <span className="col-span-1 text-xs text-muted-foreground">#{ui + 1}</span>
                                <Input className="col-span-5 h-8" placeholder="Serial / code *" value={u.serial} onChange={(e) => setUnit(li, ui, { serial: e.target.value })} />
                                <Input className="col-span-3 h-8" type="date" title="Purchase date" value={line.samePurchase ? line.sharedPurchase : u.purchase_date} disabled={line.samePurchase} onChange={(e) => setUnit(li, ui, { purchase_date: e.target.value })} />
                                <Input className="col-span-3 h-8" type="date" title="Stamping date" value={line.stampingSame ? (line.samePurchase ? line.sharedPurchase : u.purchase_date) : u.stamping_date} disabled={line.stampingSame} onChange={(e) => setUnit(li, ui, { stamping_date: e.target.value })} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-muted-foreground">Add to spare</label>
                            <Select value={line.spareId || "new"} onValueChange={(v) => setLine(li, { spareId: v === "new" ? "" : v })}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="new">➕ Create new: {line.description}</SelectItem>
                                {spares.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}{s.part_no ? ` (${s.part_no})` : ""}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Quantity received</label>
                            <Input type="number" className="h-8" value={line.qty} onChange={(e) => setLine(li, { qty: Math.max(1, Number(e.target.value) || 1) })} />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Confirming creates machines (one per serial) and receives spare quantities into stock, then marks this PO <span className="font-medium">confirmed</span>.</p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmFor(null)}>Cancel</Button>
                <Button onClick={doConfirm} disabled={confirming || confirmPlan.length === 0} className="gap-1">
                  <CheckCircle2 className="h-4 w-4" /> {confirming ? "Receiving…" : "Confirm & receive"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
