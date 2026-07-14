import { useState, useEffect } from "react";
import { Plus, PlusCircle, Search, Boxes, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  fetchItems, createItem, updateItem, deleteItem, type InventoryItem, type ItemInput,
} from "@/lib/api/inventoryItems";
import { createMachine, fetchMachines, type Machine } from "@/lib/api/machines";

const emptyForm = { name: "", category: "", quantity: "0", unit_cost: "", unit: "Nos", notes: "" };
type FormState = typeof emptyForm;

const emptyQuickForm = { code: "", invoice_date: "", stamping_date: "", same_date: false, extra_from_vendor: "" };
type QuickFormState = typeof emptyQuickForm;

type SortKey = "name_asc" | "name_desc" | "qty_desc" | "qty_asc" | "stock_value_desc" | "low_stock_first";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "qty_desc", label: "Quantity high–low" },
  { value: "qty_asc", label: "Quantity low–high" },
  { value: "stock_value_desc", label: "Stock value high–low" },
  { value: "low_stock_first", label: "Low stock first" },
];
function sortItems(rows: InventoryItem[], sortBy: SortKey): InventoryItem[] {
  const sorted = [...rows];
  switch (sortBy) {
    case "name_desc": return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case "qty_desc": return sorted.sort((a, b) => b.quantity - a.quantity);
    case "qty_asc": return sorted.sort((a, b) => a.quantity - b.quantity);
    case "stock_value_desc": return sorted.sort((a, b) => (b.stock_value ?? 0) - (a.stock_value ?? 0));
    case "low_stock_first": return sorted.sort((a, b) => a.quantity - b.quantity);
    default: return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function toForm(i: InventoryItem): FormState {
  return {
    name: i.name ?? "", category: i.category ?? "",
    quantity: String(i.quantity ?? 0), unit_cost: i.unit_cost ? String(i.unit_cost) : "", unit: i.unit ?? "Nos",
    notes: i.notes ?? "",
  };
}
function toPayload(f: FormState): ItemInput {
  return {
    name: f.name.trim(), category: f.category.trim() || undefined,
    quantity: Number(f.quantity) || 0, unit_cost: Number(f.unit_cost) || 0, unit: f.unit.trim() || "Nos",
    notes: f.notes.trim() || undefined,
  };
}

export default function InventoryItems() {
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("name_asc");

  // Quick-add-a-unit popup — creates a real Machine (same model/category as this
  // row), which bumps this item's quantity via the existing Machines↔Items sync.
  const [quickAddFor, setQuickAddFor] = useState<InventoryItem | null>(null);
  const [quickForm, setQuickForm] = useState<QuickFormState>(emptyQuickForm);
  const [quickSaving, setQuickSaving] = useState(false);
  // Existing machines — used to auto-fill the new unit's spec from a chosen
  // template (pick one in the dropdown → its fields are copied).
  const [machines, setMachines] = useState<Machine[]>([]);
  const [quickTemplateId, setQuickTemplateId] = useState<string>("");

  // Row-click detail popup
  const [infoFor, setInfoFor] = useState<InventoryItem | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { rows, categories } = await fetchItems({ search });
      setRows(rows);
      setCategories(categories);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { fetchMachines({ limit: 200 }).then((r) => setMachines(r.rows)).catch(() => {}); }, []);
  // Real-time search — debounced so we don't fire a request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function openAdd() { setForm(emptyForm); setAddOpen(true); }
  function openEdit(i: InventoryItem) { setForm(toForm(i)); setEditItem(i); }

  function openQuickAdd(i: InventoryItem) {
    setQuickForm(emptyQuickForm);
    // Default the template to an existing machine of the same model, if any.
    const match = machines.find((m) => (m.model ?? "").toLowerCase() === i.name.toLowerCase());
    setQuickTemplateId(match ? String(match.id) : "");
    setQuickAddFor(i);
  }
  // Machines to offer as a spec template: same model first, else all machines.
  const quickTemplates = quickAddFor
    ? (() => {
        const same = machines.filter((m) => (m.model ?? "").toLowerCase() === quickAddFor.name.toLowerCase());
        return same.length ? same : machines;
      })()
    : [];
  const quickTemplate = machines.find((m) => String(m.id) === quickTemplateId);
  async function handleQuickAdd() {
    if (!quickAddFor) return;
    if (!quickForm.code.trim()) { toast.error("Serial / code is required"); return; }
    setQuickSaving(true);
    try {
      const stampingDate = quickForm.same_date ? quickForm.invoice_date : quickForm.stamping_date;
      const tpl = quickTemplate;
      await createMachine({
        code: quickForm.code.trim(),
        model: quickAddFor.name,
        category: tpl?.category ?? quickAddFor.category ?? undefined,
        machine_type: tpl?.machine_type,
        brand_name: tpl?.brand_name ?? undefined,
        accuracy: tpl?.accuracy ?? undefined,
        platform_size: tpl?.platform_size ?? undefined,
        capacity: tpl?.capacity ?? undefined,
        hsn: tpl?.hsn ?? undefined,
        buy_price: tpl?.buy_price ?? undefined,
        buy_gst_pct: tpl?.buy_gst_pct ?? undefined,
        sale_price: tpl?.sale_price ?? undefined,
        sale_gst_pct: tpl?.sale_gst_pct ?? undefined,
        invoice_date: quickForm.invoice_date || undefined,
        stamping_date: stampingDate || undefined,
        extra_from_vendor: quickForm.extra_from_vendor ? Number(quickForm.extra_from_vendor) : undefined,
      });
      toast.success(`Added another "${quickAddFor.name}" unit`);
      setQuickAddFor(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add unit");
    } finally {
      setQuickSaving(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Item name is required"); return; }
    setSaving(true);
    try {
      if (editItem) {
        await updateItem(editItem.id, toPayload(form));
        toast.success("Item updated");
        setEditItem(null);
      } else {
        await createItem(toPayload(form));
        toast.success("Item added");
        setAddOpen(false);
      }
      setForm(emptyForm);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save item");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(i: InventoryItem) {
    if (!confirm(`Delete "${i.name}"?`)) return;
    try {
      await deleteItem(i.id);
      toast.success("Item deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  const filteredRows = categoryFilter === "all" ? rows : rows.filter((r) => r.category === categoryFilter);
  const visibleRows = sortItems(filteredRows, sortBy);
  const totalUnits = visibleRows.reduce((sum, r) => sum + (r.quantity || 0), 0);

  const formFields = (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground">Item name *</label>
        <Input placeholder="e.g. Load cell 50kg" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Category</label>
        <Input list="item-categories" placeholder="e.g. Spare Part" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <datalist id="item-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Quantity (how many) *</label>
          <Input type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Unit</label>
          <Input placeholder="Nos / Kg / Box" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Unit cost (₹) — for stock value on the Balance Sheet. Overridden automatically if this item's name matches a Machine model (uses that machine's buy price instead).</label>
        <Input type="number" min={0} placeholder="0" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
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
          <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6" /> Inventory Items</h1>
          <p className="text-sm text-muted-foreground">Stock register — add an item and how many are in stock.</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Add Item</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
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
          <Input className="pl-8 w-64" placeholder="Search item…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Sort by" /></SelectTrigger>
          <SelectContent>{SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-auto">{visibleRows.length} item(s) · {totalUnits} unit(s) in stock</span>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-3">Item</th><th className="p-3">Category</th>
              <th className="p-3">Quantity</th><th className="p-3">Stock value</th><th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={5}>Loading…</td></tr>
            ) : visibleRows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={5}>No items yet. Use “Add Item” to start your stock register.</td></tr>
            ) : visibleRows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setInfoFor(r)}>
                <td className="p-3 font-medium">{r.name}{r.notes && <div className="text-xs text-muted-foreground max-w-[240px]">{r.notes}</div>}</td>
                <td className="p-3">{r.category || "—"}</td>
                <td className="p-3">
                  <span className={`font-semibold ${r.quantity <= 5 ? "text-red-600" : ""}`}>{r.quantity}</span>
                  <span className="text-xs text-muted-foreground"> {r.unit}</span>
                </td>
                <td className="p-3">{r.stock_value ? `₹${r.stock_value.toLocaleString("en-IN")}` : "—"}</td>
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" title="Add another unit (as a machine)" onClick={() => openQuickAdd(r)}><PlusCircle className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => handleDelete(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Item</DialogTitle></DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-add-a-unit popup — creates a real Machine for this item's model,
          which bumps this row's quantity via the existing Machines↔Items sync. */}
      <Dialog open={!!quickAddFor} onOpenChange={(o) => !o && setQuickAddFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add unit — {quickAddFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {quickTemplates.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground">Fill details from</label>
                <Select value={quickTemplateId} onValueChange={setQuickTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Choose an existing machine to copy its specs" /></SelectTrigger>
                  <SelectContent>
                    {quickTemplates.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.code}{m.model ? ` — ${m.model}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {quickTemplate && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Inherits: {[
                      quickTemplate.category,
                      quickTemplate.machine_type,
                      quickTemplate.hsn && `HSN ${quickTemplate.hsn}`,
                      quickTemplate.accuracy,
                      quickTemplate.platform_size,
                      quickTemplate.capacity,
                    ].filter(Boolean).join(" · ") || "—"}
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Serial / Code *</label>
              <Input placeholder="Serial / Code" value={quickForm.code} onChange={(e) => setQuickForm({ ...quickForm, code: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Invoice date</label>
                <Input type="date" value={quickForm.invoice_date}
                  onChange={(e) => setQuickForm((f) => ({ ...f, invoice_date: e.target.value, stamping_date: f.same_date ? e.target.value : f.stamping_date }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Stamping date (optional)</label>
                <Input type="date" value={quickForm.same_date ? quickForm.invoice_date : quickForm.stamping_date} disabled={quickForm.same_date}
                  onChange={(e) => setQuickForm({ ...quickForm, stamping_date: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={quickForm.same_date}
                onChange={(e) => setQuickForm((f) => ({ ...f, same_date: e.target.checked, stamping_date: e.target.checked ? f.invoice_date : f.stamping_date }))} />
              Stamping date same as invoice date
            </label>
            <div>
              <label className="text-xs text-muted-foreground">Extra amount from vendor</label>
              <Input type="number" placeholder="0" value={quickForm.extra_from_vendor} onChange={(e) => setQuickForm({ ...quickForm, extra_from_vendor: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">Creates a Machine ({quickAddFor?.name}{quickAddFor?.category ? ` · ${quickAddFor.category}` : ""}) and bumps this item's quantity.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickAddFor(null)}>Cancel</Button>
            <Button onClick={handleQuickAdd} disabled={quickSaving}>{quickSaving ? "Saving…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Row-click detail popup — all details about an item + linked machine units */}
      <Dialog open={!!infoFor} onOpenChange={(o) => !o && setInfoFor(null)}>
        <DialogContent>
          {infoFor && (() => {
            const linked = machines.filter((m) => (m.model ?? "").toLowerCase() === infoFor.name.toLowerCase());
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {infoFor.name}
                    {infoFor.quantity <= 5 && <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Low stock</span>}
                  </DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><span className="text-muted-foreground">Category</span><div>{infoFor.category || "—"}</div></div>
                  <div><span className="text-muted-foreground">In stock</span><div className="font-medium">{infoFor.quantity} {infoFor.unit}</div></div>
                  <div><span className="text-muted-foreground">Unit cost</span><div>{infoFor.unit_cost ? `₹${infoFor.unit_cost.toLocaleString("en-IN")}` : "—"}</div></div>
                  <div><span className="text-muted-foreground">Effective cost</span><div>{infoFor.effective_unit_cost ? `₹${infoFor.effective_unit_cost.toLocaleString("en-IN")}` : "—"}</div></div>
                  <div><span className="text-muted-foreground">Stock value</span><div className="font-medium">{infoFor.stock_value ? `₹${infoFor.stock_value.toLocaleString("en-IN")}` : "—"}</div></div>
                  <div><span className="text-muted-foreground">Location</span><div>{infoFor.location || "—"}</div></div>
                </div>
                {infoFor.notes && <div className="border-t pt-3 text-sm"><span className="text-muted-foreground">Notes</span><div>{infoFor.notes}</div></div>}
                <div className="border-t pt-3">
                  <h3 className="font-medium text-sm mb-2">Machine units of this model ({linked.length})</h3>
                  {linked.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No machine units linked to this model.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {linked.map((m) => (
                        <span key={m.id} className="text-xs px-2 py-0.5 rounded bg-secondary">{m.code}{m.status ? ` · ${m.status.replace("_", " ")}` : ""}</span>
                      ))}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { const i = infoFor; setInfoFor(null); openQuickAdd(i); }} className="gap-1"><PlusCircle className="h-4 w-4" /> Add unit</Button>
                  <Button variant="outline" onClick={() => { const i = infoFor; setInfoFor(null); openEdit(i); }}>Edit</Button>
                  <Button onClick={() => setInfoFor(null)}>Close</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
