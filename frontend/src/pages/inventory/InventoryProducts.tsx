import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Download, Layers, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { exportToExcel } from "@/lib/exporters";
import { inr, num, qty } from "@/lib/inventoryFormat";
import { HealthScoreBadge } from "@/components/inventory/HealthScoreBadge";
import {
  getInventoryProducts, createInventoryProduct, updateInventoryProduct, deleteInventoryProduct,
  getZoneDistribution,
  type InvProduct,
} from "@/lib/api/inventory";

const UOMS = ["Nos", "kg", "L", "MT", "Box", "Roll"];
const PAGE_SIZE = 12;

type SortKey = "sku" | "name" | "category" | "standard_cost" | "reorder_level" | "available_quantity" | "health_score";

interface ProductForm {
  name: string; sku: string; category: string; unit_of_measure: string;
  hsn_code: string; reorder_level: string; reorder_quantity: string;
  cost_price: string; selling_price: string;
}
const emptyForm = (): ProductForm => ({
  name: "", sku: "", category: "", unit_of_measure: "Nos", hsn_code: "",
  reorder_level: "0", reorder_quantity: "0", cost_price: "0", selling_price: "0",
});

export default function InventoryProducts() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<InvProduct | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm());
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<InvProduct | null>(null);
  const [skuError, setSkuError] = useState("");
  const [zonesProduct, setZonesProduct] = useState<InvProduct | null>(null);

  const zoneDistribution = useQuery({
    queryKey: ["inv", "zone-distribution", zonesProduct?.inv_product_id],
    queryFn: () => getZoneDistribution(zonesProduct!.inv_product_id),
    enabled: zonesProduct !== null,
  });

  const products = useQuery({ queryKey: ["inv", "products"], queryFn: () => getInventoryProducts({ limit: 500 }) });

  const categories = useMemo(() => {
    const set = new Set<string>();
    (products.data ?? []).forEach((p) => p.category && set.add(p.category));
    return [...set].sort();
  }, [products.data]);

  const filtered = useMemo(() => {
    let rows = (products.data ?? []).filter((p) => !p.is_deleted);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    if (category !== "all") rows = rows.filter((p) => p.category === category);
    if (status !== "all") rows = rows.filter((p) => (status === "active" ? p.is_active : !p.is_active));

    const dir = sort.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[sort.key as keyof InvProduct];
      const bv = b[sort.key as keyof InvProduct];
      const an = Number(av), bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== null && bv !== null && av !== "" && bv !== "") {
        return (an - bn) * dir;
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
    return rows;
  }, [products.data, search, category, status, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setSkuError(""); setModalOpen(true); };
  const openEdit = (p: InvProduct) => {
    setEditing(p);
    setSkuError("");
    setForm({
      name: p.name, sku: p.sku, category: p.category ?? "", unit_of_measure: p.uom,
      hsn_code: p.hsn_code ?? "", reorder_level: String(p.reorder_level), reorder_quantity: String(p.reorder_quantity),
      cost_price: String(p.standard_cost), selling_price: String(p.selling_price),
    });
    setModalOpen(true);
  };

  const checkSkuDuplicate = (sku: string) => {
    if (!sku.trim()) { setSkuError(""); return; }
    const duplicate = (products.data ?? []).find(
      (p) => !p.is_deleted && p.sku.toLowerCase() === sku.trim().toLowerCase() && p.inv_product_id !== editing?.inv_product_id
    );
    setSkuError(duplicate ? `SKU already exists for "${duplicate.name}"` : "");
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Product name is required");
      if (!form.sku.trim()) throw new Error("SKU is required");
      const payload = {
        name: form.name.trim(), sku: form.sku.trim(), category: form.category.trim() || null,
        unit_of_measure: form.unit_of_measure, hsn_code: form.hsn_code.trim() || null,
        reorder_level: num(form.reorder_level), reorder_quantity: num(form.reorder_quantity),
        cost_price: num(form.cost_price), selling_price: num(form.selling_price),
      };
      return editing
        ? updateInventoryProduct(editing.inv_product_id, payload)
        : createInventoryProduct(payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Product updated" : "Product created");
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ["inv", "products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save product"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteInventoryProduct(id),
    onSuccess: () => { toast.success("Product deleted"); setDeleting(null); qc.invalidateQueries({ queryKey: ["inv", "products"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete product"),
  });

  const exportCsv = () => {
    exportToExcel({
      sheetName: "Inventory Products",
      filename: `inventory-products-${new Date().toISOString().slice(0, 10)}.xlsx`,
      columns: [
        { header: "SKU", key: "sku" },
        { header: "Name", key: "name" },
        { header: "Category", key: (r) => r.category ?? "" },
        { header: "UOM", key: "uom" },
        { header: "Cost Price", key: (r) => num(r.standard_cost) },
        { header: "Reorder Level", key: (r) => num(r.reorder_level) },
        { header: "Current Stock", key: (r) => num(r.available_quantity) },
        { header: "Health Score", key: (r) => num(r.health_score) },
        { header: "Status", key: (r) => (r.is_active ? "Active" : "Inactive") },
      ],
      rows: filtered,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory Products</h1>
          <p className="text-muted-foreground">Master list of raw materials, consumables and finished goods.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={exportCsv}><Download className="h-4 w-4" /> Export</Button>
          <Button className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Add Product</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name or SKU…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <Th label="SKU" k="sku" sort={sort} onSort={toggleSort} />
                <Th label="Name" k="name" sort={sort} onSort={toggleSort} />
                <Th label="Category" k="category" sort={sort} onSort={toggleSort} />
                <th className="px-3 py-2">UOM</th>
                <Th label="Cost Price" k="standard_cost" sort={sort} onSort={toggleSort} align="right" />
                <Th label="Reorder" k="reorder_level" sort={sort} onSort={toggleSort} align="right" />
                <Th label="Stock" k="available_quantity" sort={sort} onSort={toggleSort} align="right" />
                <Th label="Health" k="health_score" sort={sort} onSort={toggleSort} />
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.isLoading ? (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">No products match your filters.</td></tr>
              ) : pageRows.map((p) => (
                <tr key={p.inv_product_id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-3 py-2 font-medium text-card-foreground">{p.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.category ?? "—"}</td>
                  <td className="px-3 py-2">{p.uom}</td>
                  <td className="px-3 py-2 text-right">{inr(p.standard_cost)}</td>
                  <td className="px-3 py-2 text-right">{qty(p.reorder_level)}</td>
                  <td className="px-3 py-2 text-right font-medium">{qty(p.available_quantity ?? 0)}</td>
                  <td className="px-3 py-2"><HealthScoreBadge score={num(p.health_score)} /></td>
                  <td className="px-3 py-2">
                    <Badge className={cn("border-transparent", p.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                      {p.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Zone breakdown" onClick={() => setZonesProduct(p)}><Layers className="h-4 w-4 text-primary" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDeleting(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>{filtered.length} products · page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={(v) => !save.isPending && setModalOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Product" : "Add Product"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *" className="col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div>
              <Label className="text-xs text-muted-foreground">SKU *</Label>
              <div className="mt-1">
                <Input
                  value={form.sku}
                  disabled={!!editing}
                  onChange={(e) => { setForm({ ...form, sku: e.target.value }); checkSkuDuplicate(e.target.value); }}
                  className={skuError ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {skuError && <p className="mt-1 text-xs text-red-600">{skuError}</p>}
              </div>
            </div>
            <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
            <Field label="Unit of Measure">
              <Select value={form.unit_of_measure} onValueChange={(v) => setForm({ ...form, unit_of_measure: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UOMS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="HSN Code"><Input value={form.hsn_code} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })} /></Field>
            <Field label="Reorder Level"><Input type="number" min="0" step="0.001" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} /></Field>
            <Field label="Reorder Quantity"><Input type="number" min="0" step="0.001" value={form.reorder_quantity} onChange={(e) => setForm({ ...form, reorder_quantity: e.target.value })} /></Field>
            <Field label="Cost Price (₹)"><Input type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} /></Field>
            <Field label="Selling Price (₹)"><Input type="number" min="0" step="0.01" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} /></Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={save.isPending}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !!skuError}>{editing ? "Save changes" : "Create product"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Zone breakdown modal */}
      <Dialog open={!!zonesProduct} onOpenChange={(v) => !v && setZonesProduct(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Zone Breakdown — {zonesProduct?.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-3">Current stock of this product across all zones.</p>
          {zoneDistribution.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {(() => {
                const rows = Array.isArray(zoneDistribution.data)
                  ? zoneDistribution.data
                  : (zoneDistribution.data as Record<string, unknown[]> | null)?.rows ?? [];
                if (!rows.length) return (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">No stock in any zone yet.</p>
                );
                return rows.map((z: Record<string, unknown>, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium text-card-foreground">{String(z.zone_name ?? z.name ?? "—")}</p>
                      <p className="text-xs text-muted-foreground">{String(z.zone_code ?? z.code ?? "")}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold">{qty(Number(z.current_quantity ?? z.quantity ?? z.qty ?? 0))}</span>
                      <span className="ml-1 text-xs text-muted-foreground">{zonesProduct?.uom}</span>
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
          <div className="mt-2 text-right">
            <Button variant="outline" onClick={() => setZonesProduct(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Delete product?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This soft-deletes <span className="font-medium text-foreground">{deleting?.name}</span> ({deleting?.sku}). It will no longer appear in inventory lists.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.inv_product_id)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Th({ label, k, sort, onSort, align = "left" }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  return (
    <th className={cn("px-3 py-2", align === "right" && "text-right")}>
      <button className={cn("inline-flex items-center gap-1 hover:text-foreground", align === "right" && "flex-row-reverse")} onClick={() => onSort(k)}>
        {label}
        <ArrowUpDown className={cn("h-3 w-3", sort.key === k ? "text-primary" : "opacity-40")} />
      </button>
    </th>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="text-xs text-muted-foreground">{label}</Label><div className="mt-1">{children}</div></div>;
}
