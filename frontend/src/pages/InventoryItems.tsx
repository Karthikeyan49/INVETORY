import { useState, useEffect } from "react";
import { Plus, Search, Boxes, Pencil, Trash2 } from "lucide-react";
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

const emptyForm = { name: "", category: "", sku: "", quantity: "0", unit_cost: "", unit: "Nos", location: "", notes: "" };
type FormState = typeof emptyForm;

function toForm(i: InventoryItem): FormState {
  return {
    name: i.name ?? "", category: i.category ?? "", sku: i.sku ?? "",
    quantity: String(i.quantity ?? 0), unit_cost: i.unit_cost ? String(i.unit_cost) : "", unit: i.unit ?? "Nos",
    location: i.location ?? "", notes: i.notes ?? "",
  };
}
function toPayload(f: FormState): ItemInput {
  return {
    name: f.name.trim(), category: f.category.trim() || undefined, sku: f.sku.trim() || undefined,
    quantity: Number(f.quantity) || 0, unit_cost: Number(f.unit_cost) || 0, unit: f.unit.trim() || "Nos",
    location: f.location.trim() || undefined, notes: f.notes.trim() || undefined,
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

  function openAdd() { setForm(emptyForm); setAddOpen(true); }
  function openEdit(i: InventoryItem) { setForm(toForm(i)); setEditItem(i); }

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

  const visibleRows = categoryFilter === "all" ? rows : rows.filter((r) => r.category === categoryFilter);
  const totalUnits = visibleRows.reduce((sum, r) => sum + (r.quantity || 0), 0);

  const formFields = (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground">Item name *</label>
        <Input placeholder="e.g. Load cell 50kg" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Category</label>
          <Input list="item-categories" placeholder="e.g. Spare Part" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <datalist id="item-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">SKU / Code</label>
          <Input placeholder="Optional" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        </div>
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
        <label className="text-xs text-muted-foreground">Unit cost (₹) — for stock value on the Balance Sheet</label>
        <Input type="number" min={0} placeholder="0" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Location</label>
        <Input placeholder="e.g. Rack A2 / Store room" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
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
          <Input className="pl-8 w-64" placeholder="Search item / SKU / location…" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load}>Search</Button>
        <span className="text-sm text-muted-foreground ml-auto">{visibleRows.length} item(s) · {totalUnits} unit(s) in stock</span>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-3">Item</th><th className="p-3">Category</th><th className="p-3">SKU</th>
              <th className="p-3">Quantity</th><th className="p-3">Stock value</th><th className="p-3">Location</th><th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={7}>Loading…</td></tr>
            ) : visibleRows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={7}>No items yet. Use “Add Item” to start your stock register.</td></tr>
            ) : visibleRows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.name}{r.notes && <div className="text-xs text-muted-foreground max-w-[240px]">{r.notes}</div>}</td>
                <td className="p-3">{r.category || "—"}</td>
                <td className="p-3">{r.sku || "—"}</td>
                <td className="p-3">
                  <span className={`font-semibold ${r.quantity <= 5 ? "text-red-600" : ""}`}>{r.quantity}</span>
                  <span className="text-xs text-muted-foreground"> {r.unit}</span>
                </td>
                <td className="p-3">{r.unit_cost ? `₹${(r.quantity * r.unit_cost).toLocaleString("en-IN")}` : "—"}</td>
                <td className="p-3">{r.location || "—"}</td>
                <td className="p-3">
                  <div className="flex items-center justify-end gap-1">
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
    </div>
  );
}
