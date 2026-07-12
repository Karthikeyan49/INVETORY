import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { num, qty } from "@/lib/inventoryFormat";
import { ZoneTypeBadge, zoneTypeStyle, ZONE_TYPE_STYLES } from "@/components/inventory/ZoneTypeBadge";
import { StockLevelIndicator } from "@/components/inventory/StockLevelIndicator";
import {
  getInventoryZones, createInventoryZone, updateInventoryZone, type InvZone,
} from "@/lib/api/inventory";

const ZONE_TYPES = Object.keys(ZONE_TYPE_STYLES);

interface ZoneForm {
  zone_name: string; zone_code: string; zone_type: string; warehouse_location: string;
  capacity: string; min_quantity: string; max_quantity: string;
}
const emptyForm = (): ZoneForm => ({
  zone_name: "", zone_code: "", zone_type: "READY_STOCK", warehouse_location: "",
  capacity: "0", min_quantity: "0", max_quantity: "0",
});

export default function InventoryZones() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<InvZone | null>(null);
  const [form, setForm] = useState<ZoneForm>(emptyForm());
  const [modalOpen, setModalOpen] = useState(false);

  const zones = useQuery({ queryKey: ["inv", "zones"], queryFn: getInventoryZones });

  const rows = zones.data ?? [];
  const totalStock = useMemo(() => rows.reduce((a, z) => a + num(z.current_quantity), 0), [rows]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setModalOpen(true); };
  const openEdit = (z: InvZone) => {
    setEditing(z);
    setForm({
      zone_name: z.zone_name, zone_code: z.zone_code, zone_type: z.zone_type,
      warehouse_location: z.warehouse_location ?? "", capacity: String(z.capacity),
      min_quantity: String((z as Record<string, unknown>).min_quantity ?? 0),
      max_quantity: String((z as Record<string, unknown>).max_quantity ?? 0),
    });
    setModalOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.zone_name.trim()) throw new Error("Zone name is required");
      if (!form.zone_code.trim()) throw new Error("Zone code is required");
      const payload = {
        zone_name: form.zone_name.trim(), zone_code: form.zone_code.trim(), zone_type: form.zone_type,
        warehouse_location: form.warehouse_location.trim() || null, capacity: num(form.capacity),
        min_quantity: num(form.min_quantity), max_quantity: num(form.max_quantity),
      };
      return editing ? updateInventoryZone(editing.zone_id, payload) : createInventoryZone(payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Zone updated" : "Zone created");
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ["inv", "zones"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save zone"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory Zones</h1>
          <p className="text-muted-foreground">Logical storage areas and how much stock each holds.</p>
        </div>
        <Button className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Add Zone</Button>
      </div>

      {/* Zone cards grid */}
      {zones.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-xl border bg-muted/40" />)}
        </div>
      ) : rows.length === 0 ? (
        <Empty text="No zones yet. Add your first storage zone." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((z) => {
            const s = zoneTypeStyle(z.zone_type);
            const current = num(z.current_quantity);
            const cap = num(z.capacity);
            return (
              <div key={z.zone_id} className={cn("rounded-xl border-l-4 border bg-card p-4 shadow-sm", s.accent)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-card-foreground">{z.zone_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{z.zone_code}</p>
                  </div>
                  <ZoneTypeBadge type={z.zone_type} />
                </div>
                <div className="mt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-bold text-card-foreground">{qty(current)}</span>
                    <span className="text-xs text-muted-foreground">{cap > 0 ? `cap ${qty(cap)}` : "untracked cap"}</span>
                  </div>
                  <div className="mt-2">
                    <StockLevelIndicator current={current} reference={cap} showLabel={cap > 0} />
                  </div>
                </div>
                {z.warehouse_location && <p className="mt-2 text-xs text-muted-foreground">{z.warehouse_location}</p>}
                {/* Zone health indicator based on min/max */}
                {(() => {
                  const minQ = num((z as Record<string, unknown>).min_quantity);
                  const maxQ = num((z as Record<string, unknown>).max_quantity);
                  if (minQ > 0 && current < minQ) return (
                    <p className="mt-1 text-xs font-medium text-red-600">⚠ Below minimum ({qty(minQ)})</p>
                  );
                  if (maxQ > 0 && current > maxQ) return (
                    <p className="mt-1 text-xs font-medium text-amber-600">⚠ Above maximum ({qty(maxQ)})</p>
                  );
                  if (minQ > 0 || maxQ > 0) return (
                    <p className="mt-1 text-xs text-emerald-600">✓ Within limits</p>
                  );
                  return null;
                })()}
                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => openEdit(z)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Management table */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-semibold text-card-foreground"><Layers className="h-4 w-4 text-primary" /> Stock distribution per zone</div>
          <span className="text-xs text-muted-foreground">Total on hand: {qty(totalStock)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Zone</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Location</th><th className="px-3 py-2 text-right">Current Stock</th>
                <th className="px-3 py-2 w-48">Capacity</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No zones.</td></tr>
              ) : rows.map((z) => (
                <tr key={z.zone_id} className="border-t">
                  <td className="px-3 py-2 font-medium text-card-foreground">{z.zone_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{z.zone_code}</td>
                  <td className="px-3 py-2"><ZoneTypeBadge type={z.zone_type} /></td>
                  <td className="px-3 py-2 text-muted-foreground">{z.warehouse_location ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{qty(z.current_quantity)}</td>
                  <td className="px-3 py-2">
                    <StockLevelIndicator current={num(z.current_quantity)} reference={num(z.capacity)} showLabel={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={(v) => !save.isPending && setModalOpen(v)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Warehouse className="h-5 w-5" /> {editing ? "Edit Zone" : "Add Zone"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Zone Name *" className="col-span-2"><Input value={form.zone_name} onChange={(e) => setForm({ ...form, zone_name: e.target.value })} /></Field>
            <Field label="Zone Code *"><Input value={form.zone_code} onChange={(e) => setForm({ ...form, zone_code: e.target.value })} disabled={!!editing} /></Field>
            <Field label="Zone Type">
              <Select value={form.zone_type} onValueChange={(v) => setForm({ ...form, zone_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ZONE_TYPES.map((t) => <SelectItem key={t} value={t}>{zoneTypeStyle(t).label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Warehouse Location" className="col-span-2"><Input value={form.warehouse_location} onChange={(e) => setForm({ ...form, warehouse_location: e.target.value })} /></Field>
            <Field label="Capacity (0 = untracked)"><Input type="number" min="0" step="0.001" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
            <Field label="Min Stock (0 = no limit)"><Input type="number" min="0" step="0.001" value={form.min_quantity} onChange={(e) => setForm({ ...form, min_quantity: e.target.value })} /></Field>
            <Field label="Max Stock (0 = no limit)"><Input type="number" min="0" step="0.001" value={form.max_quantity} onChange={(e) => setForm({ ...form, max_quantity: e.target.value })} /></Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={save.isPending}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{editing ? "Save changes" : "Create zone"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="text-xs text-muted-foreground">{label}</Label><div className="mt-1">{children}</div></div>;
}
function Empty({ text }: { text: string }) {
  return <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-muted-foreground"><Warehouse className="h-7 w-7 opacity-30" /><p className="text-sm">{text}</p></div>;
}
