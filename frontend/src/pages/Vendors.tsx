import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Building2, Pencil, Ban, Wallet, IndianRupee } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollableX } from "@/components/ui/scrollable-x";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  fetchVendors, createVendor, updateVendor, deactivateVendor, fetchVendorAnalytics,
  type Vendor, type VendorAnalytics,
} from "@/lib/api/vendors";

function money(v: number | string | null | undefined): string {
  return "₹" + Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

const emptyForm = {
  vendor_code: "", name: "", gstin: "", contact_name: "", phone: "", email: "",
  address: "", city: "", state: "", pincode: "", payment_terms: "", notes: "",
};
type FormState = typeof emptyForm;

export default function Vendors() {
  const [rows, setRows] = useState<Vendor[]>([]);
  const [analytics, setAnalytics] = useState<VendorAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchVendors({}),
      fetchVendorAnalytics().catch(() => null),
    ])
      .then(([v, a]) => { setRows(v); setAnalytics(a); })
      .catch(() => toast.error("Failed to load vendors"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((v) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return v.name.toLowerCase().includes(q)
      || (v.vendor_code || "").toLowerCase().includes(q)
      || (v.gstin || "").toLowerCase().includes(q)
      || (v.phone || "").includes(search.trim());
  });

  function openAdd() { setEditingId(null); setForm(emptyForm); setDialogOpen(true); }
  function openEdit(v: Vendor) {
    setEditingId(v.vendor_id);
    setForm({
      vendor_code: v.vendor_code || "", name: v.name, gstin: v.gstin || "",
      contact_name: v.contact_name || "", phone: v.phone || "", email: v.email || "",
      address: v.address || "", city: v.city || "", state: v.state || "",
      pincode: v.pincode || "", payment_terms: v.payment_terms || "", notes: v.notes || "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Vendor name is required"); return; }
    setSaving(true);
    try {
      if (editingId) { await updateVendor(editingId, form); toast.success("Vendor updated"); }
      else { await createVendor(form); toast.success("Vendor created"); }
      setDialogOpen(false);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not save vendor");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(v: Vendor) {
    try { await deactivateVendor(v.vendor_id); toast.success(`${v.name} deactivated`); load(); }
    catch { toast.error("Could not deactivate vendor"); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">Vendors</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAdd} className="gap-2"><Plus className="h-4 w-4" /> Add Vendor</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Vendor" : "Add Vendor"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Vendor name *</label>
                  <Input placeholder="Vendor / supplier name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Vendor code</label>
                  <Input placeholder="Auto (VND-0001) if blank" value={form.vendor_code} onChange={(e) => setForm({ ...form, vendor_code: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Contact person</label>
                  <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Phone</label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Email</label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">GSTIN</label>
                  <Input placeholder="22AAAAA0000A1Z5" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Address</label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">City</label>
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">State</label>
                  <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Pincode</label>
                  <Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Payment terms</label>
                  <Input placeholder="e.g. Net 30" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Notes</label>
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editingId ? "Update" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Three analytics fields */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border p-4 bg-card flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><Building2 className="h-5 w-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Total Vendors</p>
            <p className="text-2xl font-bold text-card-foreground">{analytics ? analytics.total_vendors : "—"}</p>
          </div>
        </div>
        <div className="rounded-lg border p-4 bg-card flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><IndianRupee className="h-5 w-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Total Purchase Cost</p>
            <p className="text-2xl font-bold text-primary">{analytics ? money(analytics.total_purchase_cost) : "—"}</p>
          </div>
        </div>
        <div className="rounded-lg border p-4 bg-card flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600"><Wallet className="h-5 w-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Outstanding Payable</p>
            <p className="text-2xl font-bold text-amber-600">{analytics ? money(analytics.outstanding_payable) : "—"}</p>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-4 border-b">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search vendors..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollableX>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Code</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Contact</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">GSTIN</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Purchases</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Purchase Cost</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Outstanding</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.vendor_id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4 text-sm text-muted-foreground">{v.vendor_code || "—"}</td>
                  <td className="px-6 py-4 text-sm font-medium text-card-foreground">
                    {v.name}
                    {(v.city || v.phone) && (
                      <span className="block text-xs text-muted-foreground">{[v.phone, v.city].filter(Boolean).join(" · ")}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{v.contact_name || "—"}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{v.gstin || "—"}</td>
                  <td className="px-6 py-4 text-sm text-right text-card-foreground">{v.purchase_count}</td>
                  <td className="px-6 py-4 text-sm text-right font-medium text-primary">{money(v.purchase_total)}</td>
                  <td className="px-6 py-4 text-sm text-right font-medium text-amber-600">{v.purchase_outstanding > 0 ? money(v.purchase_outstanding) : "—"}</td>
                  <td className="px-6 py-4 text-sm">
                    {v.is_active
                      ? <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Active</Badge>
                      : <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Inactive</Badge>}
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(v)} className="p-1.5 hover:bg-muted rounded-lg" title="Edit"><Pencil className="h-4 w-4 text-muted-foreground" /></button>
                    {v.is_active && (
                      <button onClick={() => handleDeactivate(v)} className="p-1.5 hover:bg-muted rounded-lg" title="Deactivate"><Ban className="h-4 w-4 text-destructive" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">Loading vendors...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">No vendors found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
      </div>
    </div>
  );
}
