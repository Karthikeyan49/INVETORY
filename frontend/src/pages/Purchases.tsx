import { useState, useEffect } from "react";
import { Plus, Search, Store, Pencil, Trash2, IndianRupee } from "lucide-react";
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
  fetchPurchases, createPurchase, updatePurchase, deletePurchase, recordPurchasePayment,
  PURCHASE_PAYMENT_MODES, type Purchase, type PurchaseInput, type PurchaseType,
} from "@/lib/api/purchases";

const emptyForm = {
  vendor_name: "", location: "", purchase_type: "cash" as PurchaseType,
  taxable: "", gst_pct: "", extra_amount: "", advance: "", payment_method: "Bank Transfer", utr_no: "",
  purchase_date: "", notes: "",
};
type FormState = typeof emptyForm;

const money = (v: number | string | null | undefined) =>
  v == null || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function toForm(p: Purchase): FormState {
  return {
    vendor_name: p.vendor_name ?? "", location: p.location ?? "", purchase_type: p.purchase_type,
    taxable: p.taxable ? String(p.taxable) : "", gst_pct: p.gst_pct ? String(p.gst_pct) : "",
    extra_amount: p.extra_amount ? String(p.extra_amount) : "", advance: p.advance ? String(p.advance) : "",
    payment_method: p.payment_method ?? "Bank Transfer", utr_no: p.utr_no ?? "",
    purchase_date: p.purchase_date ?? "", notes: p.notes ?? "",
  };
}
function toPayload(f: FormState): PurchaseInput {
  return {
    vendor_name: f.vendor_name.trim(), location: f.location.trim() || undefined,
    purchase_type: f.purchase_type, taxable: Number(f.taxable) || 0, gst_pct: Number(f.gst_pct) || 0,
    extra_amount: Number(f.extra_amount) || 0, advance: Number(f.advance) || 0,
    payment_method: f.payment_method || undefined, utr_no: f.utr_no.trim() || undefined,
    purchase_date: f.purchase_date || undefined,
    notes: f.notes.trim() || undefined,
  };
}

export default function Purchases() {
  const { taxView } = useAuth();
  const extended = taxView === "extended";

  const [rows, setRows] = useState<Purchase[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<Purchase | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { rows, locations } = await fetchPurchases({ search, type: typeFilter, location: locationFilter });
      setRows(rows);
      setLocations(locations);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [typeFilter, locationFilter]);

  function openAdd() { setForm(emptyForm); setAddOpen(true); }
  function openEdit(p: Purchase) { setForm(toForm(p)); setEditItem(p); }

  async function handleSave() {
    if (!form.vendor_name.trim()) { toast.error("Vendor name is required"); return; }
    if (!form.taxable) { toast.error("Enter the taxable (pay) amount"); return; }
    setSaving(true);
    try {
      if (editItem) {
        await updatePurchase(editItem.id, toPayload(form));
        toast.success("Purchase updated");
        setEditItem(null);
      } else {
        await createPurchase(toPayload(form));
        toast.success("Purchase recorded — added to Expenses / P&L");
        setAddOpen(false);
      }
      setForm(emptyForm);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save purchase");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: Purchase) {
    if (!confirm(`Delete purchase ${p.purchase_no ?? ""} from ${p.vendor_name}?`)) return;
    try {
      await deletePurchase(p.id);
      toast.success("Purchase deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function handlePayment(p: Purchase) {
    const raw = prompt(`Record payment for ${p.vendor_name}. Outstanding: ${money(p.outstanding)}`, String(p.outstanding));
    if (raw == null) return;
    const amt = Number(raw);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    try {
      await recordPurchasePayment(p.id, amt);
      toast.success("Payment recorded");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record payment");
    }
  }

  // Live GST + total + outstanding preview for the form.
  const t = Number(form.taxable) || 0;
  const g = Math.round(t * (Number(form.gst_pct) || 0)) / 100;
  const total = t + g;
  const paid = form.purchase_type === "cash" ? total : (Number(form.advance) || 0);
  const outstanding = Math.max(0, total - paid);

  const totalOutstanding = rows.reduce((s, r) => s + (r.outstanding || 0), 0);

  const formFields = (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground">Vendor *</label>
        <Input placeholder="Vendor / supplier name" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Location / Area</label>
          <Input list="pur-locs" placeholder="e.g. Coimbatore" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <datalist id="pur-locs">{locations.map((l) => <option key={l} value={l} />)}</datalist>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Type</label>
          <Select value={form.purchase_type} onValueChange={(v) => setForm({ ...form, purchase_type: v as PurchaseType })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash (paid in full)</SelectItem>
              <SelectItem value="credit">Credit (track outstanding)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Taxable (pay) amount before GST + GST %</label>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" placeholder="Taxable (excl. GST)" value={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.value })} />
          <Input type="number" placeholder="GST %" value={form.gst_pct} onChange={(e) => setForm({ ...form, gst_pct: e.target.value })} />
        </div>
        {t > 0 && <p className="text-xs text-muted-foreground mt-1">+ GST {money(g)} = {money(total)} total{form.purchase_type === "credit" ? ` · outstanding ${money(outstanding)}` : ""}</p>}
      </div>
      {extended && (
        <div>
          <label className="text-xs text-muted-foreground">Extra amount (extended login only)</label>
          <Input type="number" placeholder="Off-books extra" value={form.extra_amount} onChange={(e) => setForm({ ...form, extra_amount: e.target.value })} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {form.purchase_type === "credit" ? (
          <div>
            <label className="text-xs text-muted-foreground">Advance paid</label>
            <Input type="number" placeholder="Advance" value={form.advance} onChange={(e) => setForm({ ...form, advance: e.target.value })} />
          </div>
        ) : (
          <div>
            <label className="text-xs text-muted-foreground">Payment method</label>
            <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PURCHASE_PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground">Purchase date</label>
          <Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {form.purchase_type === "credit" && (
          <div>
            <label className="text-xs text-muted-foreground">Payment method</label>
            <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PURCHASE_PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground">UTR / Ref number</label>
          <Input placeholder="Transaction / UTR reference" value={form.utr_no} onChange={(e) => setForm({ ...form, utr_no: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Notes</label>
        <Textarea placeholder="Optional" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Store className="h-6 w-6" /> Purchases</h1>
          <p className="text-sm text-muted-foreground">Vendor purchases (cash / credit). Each purchase posts to Expenses and the Profit &amp; Loss report.</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Add Purchase</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Purchase</DialogTitle></DialogHeader>
            {formFields}
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-64" placeholder="Search vendor / PO no…" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="credit">Credit</SelectItem>
          </SelectContent>
        </Select>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Location" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load}>Search</Button>
        {totalOutstanding > 0 && (
          <span className="text-sm text-red-600 ml-auto flex items-center gap-1"><IndianRupee className="h-3.5 w-3.5" />{money(totalOutstanding)} outstanding</span>
        )}
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-2 py-2">PO No</th><th className="px-2 py-2">Vendor</th><th className="px-2 py-2">Location</th>
              <th className="px-2 py-2">Type</th><th className="px-2 py-2">Taxable</th><th className="px-2 py-2">GST</th>
              <th className="px-2 py-2">Total</th><th className="px-2 py-2">Paid</th><th className="px-2 py-2">Outstanding</th>
              <th className="px-2 py-2">Date</th><th className="px-2 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={11}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={11}>No purchases yet. Use “Add Purchase”.</td></tr>
            ) : rows.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-2 py-2 font-medium">{p.purchase_no || "—"}</td>
                <td className="px-2 py-2">{p.vendor_name}</td>
                <td className="px-2 py-2">{p.location || "—"}</td>
                <td className="px-2 py-2"><span className={`text-xs px-2 py-0.5 rounded ${p.purchase_type === "credit" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{p.purchase_type}</span></td>
                <td className="px-2 py-2">{money(p.taxable)}</td>
                <td className="px-2 py-2">{money(p.gst_amount)}</td>
                <td className="px-2 py-2 font-medium">{money(p.total)}</td>
                <td className="px-2 py-2">{money(p.amount_paid)}</td>
                <td className="px-2 py-2">{p.outstanding > 0 ? <span className="text-red-600 font-medium">{money(p.outstanding)}</span> : "—"}</td>
                <td className="px-2 py-2 text-muted-foreground">{p.purchase_date || "—"}</td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-end gap-1">
                    {p.outstanding > 0 && <Button size="sm" variant="outline" className="h-7" onClick={() => handlePayment(p)}>Pay</Button>}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => handleDelete(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Purchase {editItem?.purchase_no}</DialogTitle></DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
