/**
 * Spares (R6 / T6) — spare-parts stock register modelled like Machines: full
 * CRUD, stock movements (receive / consume / issue), a low-stock notification
 * banner + list badge (quantity ≤ reorder level), and a consumption-based
 * stock-out forecast with reorder suggestions. Consuming a spare can reference
 * the machine it was fitted to (logs a machine movement).
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Minus, Search, Pencil, Trash2, AlertTriangle, ArrowDownUp, PackageSearch, Boxes } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import {
  fetchSpares, createSpare, updateSpare, deleteSpare, moveSpare, fetchSpareForecast,
  type Spare, type SpareInput, type SpareReason, type SpareForecast,
} from "@/lib/api/spares";
import { fetchMachines, type Machine } from "@/lib/api/machines";

const money = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const UNIT_OPTIONS = ["pcs", "Nos", "Set", "Kg", "Box", "Pair", "Roll", "Metre"];

const emptyForm: SpareInput = {
  name: "", part_no: "", category: "", quantity: 0, unit: "pcs", unit_cost: 0, reorder_level: 0, location: "", notes: "",
};

type SortKey = "name_asc" | "name_desc" | "qty_desc" | "qty_asc" | "low_stock_first";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "qty_desc", label: "Quantity high–low" },
  { value: "qty_asc", label: "Quantity low–high" },
  { value: "low_stock_first", label: "Low stock first" },
];
function sortSpares(rows: Spare[], sortBy: SortKey): Spare[] {
  const sorted = [...rows];
  switch (sortBy) {
    case "name_desc": return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case "qty_desc": return sorted.sort((a, b) => b.quantity - a.quantity);
    case "qty_asc": return sorted.sort((a, b) => a.quantity - b.quantity);
    case "low_stock_first": return sorted.sort((a, b) => Number(b.low_stock) - Number(a.low_stock));
    default: return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export default function Spares() {
  const [rows, setRows] = useState<Spare[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("name_asc");
  const [tab, setTab] = useState<"stock" | "forecast">("stock");
  const [forecast, setForecast] = useState<SpareForecast[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SpareInput>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [moveFor, setMoveFor] = useState<Spare | null>(null);
  const [stockDir, setStockDir] = useState<"add" | "reduce">("add");
  const [moveForm, setMoveForm] = useState<{ qty: string; reason: SpareReason; machine_id: string; note: string }>({
    qty: "", reason: "receive", machine_id: "", note: "",
  });

  // Row-click detail popup
  const [infoFor, setInfoFor] = useState<Spare | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { rows, categories } = await fetchSpares({ search, category: categoryFilter, low_stock: lowOnly });
      setRows(rows);
      setCategories(categories);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load spares");
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, lowOnly]);

  // categoryFilter/lowOnly changes load immediately; search is debounced so we
  // don't fire a request on every keystroke.
  useEffect(() => { load(); }, [categoryFilter, lowOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => { fetchMachines({ limit: 200 }).then((r) => setMachines(r.rows)).catch(() => {}); }, []);
  useEffect(() => { if (tab === "forecast") fetchSpareForecast(90).then(setForecast).catch(() => {}); }, [tab]);

  const lowCount = rows.filter((r) => r.low_stock).length;
  const sortedRows = sortSpares(rows, sortBy);

  function openAdd() { setEditingId(null); setForm(emptyForm); setDialogOpen(true); }
  function openEdit(s: Spare) {
    setEditingId(s.id);
    setForm({
      name: s.name, part_no: s.part_no ?? "", category: s.category ?? "", quantity: s.quantity, unit: s.unit ?? "pcs",
      unit_cost: s.unit_cost, reorder_level: s.reorder_level, location: s.location ?? "", notes: s.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!String(form.name).trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editingId) { await updateSpare(editingId, form); toast.success("Spare updated"); }
      else { await createSpare(form); toast.success("Spare added"); }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save spare");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(s: Spare) {
    if (!confirm(`Delete spare "${s.name}"?`)) return;
    try { await deleteSpare(s.id); toast.success("Spare deleted"); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  // "+" — add stock (receive).
  function openReceive(s: Spare) {
    setStockDir("add");
    setMoveFor(s);
    setMoveForm({ qty: "", reason: "receive", machine_id: "", note: "" });
  }
  // "−" — reduce stock (consume by default; can switch to issue).
  function openReduce(s: Spare) {
    setStockDir("reduce");
    setMoveFor(s);
    setMoveForm({ qty: "", reason: "consume", machine_id: "", note: "" });
  }
  async function confirmMove() {
    if (!moveFor) return;
    const qty = Number(moveForm.qty);
    if (!qty || qty <= 0) { toast.error("Enter a quantity"); return; }
    if (stockDir === "reduce" && qty > moveFor.quantity) {
      toast.error(`Only ${moveFor.quantity} ${moveFor.unit ?? ""} in stock`); return;
    }
    try {
      await moveSpare(moveFor.id, {
        qty, reason: moveForm.reason,
        machine_id: moveForm.machine_id ? Number(moveForm.machine_id) : undefined,
        note: moveForm.note.trim() || undefined,
      });
      toast.success("Stock updated");
      setMoveFor(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update stock");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6" /> Spares</h1>
          <p className="text-muted-foreground text-sm mt-1">Spare-parts stock with reorder alerts and consumption forecasting.</p>
        </div>
        <Button onClick={openAdd} className="gap-1"><Plus className="h-4 w-4" /> New Spare</Button>
      </div>

      {lowCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">{lowCount} spare(s) at or below reorder level.</span>
          <button className="text-sm underline ml-2" onClick={() => setLowOnly(true)}>Show</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <Button variant={tab === "stock" ? "default" : "outline"} size="sm" className="gap-1" onClick={() => setTab("stock")}><PackageSearch className="h-4 w-4" /> Stock</Button>
        <Button variant={tab === "forecast" ? "default" : "outline"} size="sm" className="gap-1" onClick={() => setTab("forecast")}><ArrowDownUp className="h-4 w-4" /> Forecast</Button>
      </div>

      {tab === "stock" ? (
        <>
          {/* Filters */}
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-8 w-56" placeholder="Search name / part no" value={search}
                     onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Sort by" /></SelectTrigger>
              <SelectContent>{SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant={lowOnly ? "default" : "outline"} size="sm" onClick={() => setLowOnly(!lowOnly)}>Low stock only</Button>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-2 py-2">Name</th><th className="px-2 py-2">Part No</th><th className="px-2 py-2">Category</th>
                  <th className="px-2 py-2">Qty</th><th className="px-2 py-2">Reorder</th><th className="px-2 py-2">Unit Cost</th>
                  <th className="px-2 py-2">Location</th><th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="p-4 text-muted-foreground">Loading…</td></tr>
                ) : sortedRows.length === 0 ? (
                  <tr><td colSpan={8} className="p-4 text-muted-foreground">No spares yet. Add one to get started.</td></tr>
                ) : sortedRows.map((s) => (
                  <tr key={s.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setInfoFor(s)}>
                    <td className="px-2 py-2 font-medium">{s.name}</td>
                    <td className="px-2 py-2">{s.part_no || "—"}</td>
                    <td className="px-2 py-2">{s.category || "—"}</td>
                    <td className="px-2 py-2">
                      <span className={s.low_stock ? "text-red-700 font-semibold" : ""}>{s.quantity}</span> <span className="text-xs text-muted-foreground">{s.unit}</span>
                      {s.low_stock && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">Low</span>}
                    </td>
                    <td className="px-2 py-2">{s.reorder_level}</td>
                    <td className="px-2 py-2">{money(s.unit_cost)}</td>
                    <td className="px-2 py-2">{s.location || "—"}</td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Button size="icon" variant="outline" className="h-7 w-7 text-green-600" onClick={() => openReceive(s)} title="Add quantity"><Plus className="h-4 w-4" /></Button>
                        <Button size="icon" variant="outline" className="h-7 w-7 text-amber-600" disabled={s.quantity <= 0} onClick={() => openReduce(s)} title="Reduce quantity"><Minus className="h-4 w-4" /></Button>
                        <button className="text-muted-foreground hover:text-foreground" onClick={() => openEdit(s)} title="Edit"><Pencil className="h-4 w-4" /></button>
                        <button className="text-red-500 hover:text-red-700" onClick={() => handleDelete(s)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-2 py-2">Name</th><th className="px-2 py-2">Qty</th><th className="px-2 py-2">Used (90d)</th>
                <th className="px-2 py-2">Avg/day</th><th className="px-2 py-2">Days to stock-out</th><th className="px-2 py-2">Suggested reorder</th>
              </tr>
            </thead>
            <tbody>
              {forecast.length === 0 ? (
                <tr><td colSpan={6} className="p-4 text-muted-foreground">No forecast data yet — record some consumption first.</td></tr>
              ) : forecast.map((f) => (
                <tr key={f.id} className={`border-t ${f.low_stock ? "bg-red-50" : ""}`}>
                  <td className="px-2 py-2 font-medium">{f.name}</td>
                  <td className="px-2 py-2">{f.quantity}</td>
                  <td className="px-2 py-2">{f.consumed_window}</td>
                  <td className="px-2 py-2">{f.avg_daily_use}</td>
                  <td className="px-2 py-2">{f.days_to_stockout == null ? "—" : <span className={f.days_to_stockout <= 14 ? "text-red-700 font-semibold" : ""}>{f.days_to_stockout} d</span>}</td>
                  <td className="px-2 py-2">{f.suggested_reorder > 0 ? <span className="font-semibold">{f.suggested_reorder}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editingId ? "Edit Spare" : "New Spare"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Name *</label>
                <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Part No</label>
                <Input value={form.part_no ?? ""} onChange={(e) => setForm({ ...form, part_no: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <Combobox options={categories} placeholder="e.g. Electronics" value={form.category ?? ""} onChange={(v) => setForm({ ...form, category: v })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Location</label>
                <Input value={form.location ?? ""} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Quantity</label>
                <Input type="number" value={form.quantity ?? 0} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} disabled={!!editingId} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit</label>
                <Combobox options={UNIT_OPTIONS} placeholder="pcs" value={form.unit ?? ""} onChange={(v) => setForm({ ...form, unit: v })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit cost</label>
                <Input type="number" value={form.unit_cost ?? 0} onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Reorder level</label>
                <Input type="number" value={form.reorder_level ?? 0} onChange={(e) => setForm({ ...form, reorder_level: Number(e.target.value) })} />
              </div>
            </div>
            {editingId && <p className="text-xs text-muted-foreground">Use the “+” / “−” buttons on the row to add or reduce stock — it keeps the consumption history for forecasting.</p>}
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / reduce stock dialog */}
      <Dialog open={!!moveFor} onOpenChange={(o) => !o && setMoveFor(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {stockDir === "add"
                ? <><Plus className="h-4 w-4 text-green-600" /> Add stock — {moveFor?.name}</>
                : <><Minus className="h-4 w-4 text-amber-600" /> Reduce stock — {moveFor?.name}</>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Quantity to {stockDir === "add" ? "add" : "reduce"} *</label>
                <Input type="number" min="1" autoFocus value={moveForm.qty}
                       onChange={(e) => setMoveForm({ ...moveForm, qty: e.target.value })} />
              </div>
              {stockDir === "reduce" && (
                <div>
                  <label className="text-xs text-muted-foreground">Reason</label>
                  <Select value={moveForm.reason} onValueChange={(v) => setMoveForm({ ...moveForm, reason: v as SpareReason })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="consume" className="capitalize">consume</SelectItem>
                      <SelectItem value="issue" className="capitalize">issue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {stockDir === "reduce" && (
              <div>
                <label className="text-xs text-muted-foreground">Fitted to machine (optional)</label>
                <Select value={moveForm.machine_id} onValueChange={(v) => setMoveForm({ ...moveForm, machine_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select machine" /></SelectTrigger>
                  <SelectContent>{machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.code}{m.model ? ` — ${m.model}` : ""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Note</label>
              <Input value={moveForm.note} onChange={(e) => setMoveForm({ ...moveForm, note: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              {stockDir === "add" ? "Adds to" : "Removes from"} stock — current {moveFor?.quantity} {moveFor?.unit}
              {moveForm.qty && Number(moveForm.qty) > 0 && (
                <> → new {stockDir === "add"
                  ? (moveFor?.quantity ?? 0) + Number(moveForm.qty)
                  : (moveFor?.quantity ?? 0) - Number(moveForm.qty)} {moveFor?.unit}</>
              )}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveFor(null)}>Cancel</Button>
            <Button onClick={confirmMove}>{stockDir === "add" ? "Add" : "Reduce"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Row-click detail popup — all details about a spare */}
      <Dialog open={!!infoFor} onOpenChange={(o) => !o && setInfoFor(null)}>
        <DialogContent className="max-w-xl">
          {infoFor && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {infoFor.name}
                  {infoFor.low_stock && <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Low stock</span>}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">Part No</span><div>{infoFor.part_no || "—"}</div></div>
                <div><span className="text-muted-foreground">Category</span><div>{infoFor.category || "—"}</div></div>
                <div><span className="text-muted-foreground">In stock</span><div className={`font-medium ${infoFor.low_stock ? "text-red-700" : ""}`}>{infoFor.quantity} {infoFor.unit}</div></div>
                <div><span className="text-muted-foreground">Reorder level</span><div>{infoFor.reorder_level}</div></div>
                <div><span className="text-muted-foreground">Unit cost</span><div>{money(infoFor.unit_cost)}</div></div>
                <div><span className="text-muted-foreground">Stock value</span><div className="font-medium">{money((infoFor.unit_cost || 0) * (infoFor.quantity || 0))}</div></div>
                <div><span className="text-muted-foreground">Location</span><div>{infoFor.location || "—"}</div></div>
              </div>
              {infoFor.notes && <div className="border-t pt-3 text-sm"><span className="text-muted-foreground">Notes</span><div>{infoFor.notes}</div></div>}
              <DialogFooter>
                <Button variant="outline" onClick={() => { const s = infoFor; setInfoFor(null); openReceive(s); }} className="gap-1"><Plus className="h-4 w-4" /> Add quantity</Button>
                <Button variant="outline" disabled={infoFor.quantity <= 0} onClick={() => { const s = infoFor; setInfoFor(null); openReduce(s); }} className="gap-1"><Minus className="h-4 w-4" /> Reduce quantity</Button>
                <Button variant="outline" onClick={() => { const s = infoFor; setInfoFor(null); openEdit(s); }}>Edit</Button>
                <Button onClick={() => setInfoFor(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
