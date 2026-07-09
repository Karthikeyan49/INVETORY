import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { num, qty, inr } from "@/lib/inventoryFormat";
import { getInventoryProducts, cycleCountAdjust, type InvProduct } from "@/lib/api/inventory";

/**
 * Cycle Count — physical stock count vs system stock count.
 *
 * How it works:
 *  1. Shows every product with its current system qty.
 *  2. You type in the actual physical count you measured on the floor.
 *  3. Variance bar updates in real time (green = match, red = gap, amber = surplus).
 *  4. Submit creates ADJUSTMENT movements for all products with a variance.
 */

interface CountRow {
  product: InvProduct;
  physicalCount: string;
}

export default function CycleCount() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const products = useQuery({
    queryKey: ["inv", "products"],
    queryFn: () => getInventoryProducts({ limit: 500 }),
  });

  const rows: CountRow[] = useMemo(() => {
    const allRows = (products.data ?? []).filter((p) => !p.is_deleted && p.is_active);
    const q = search.trim().toLowerCase();
    return (q ? allRows.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) : allRows)
      .map((product) => ({ product, physicalCount: counts[product.inv_product_id] ?? "" }));
  }, [products.data, search, counts]);

  const variances = useMemo(() => rows.filter((r) => {
    const phys = parseFloat(r.physicalCount);
    if (isNaN(phys)) return false;
    return phys !== num(r.product.available_quantity);
  }), [rows]);

  const totalVarianceValue = useMemo(() => variances.reduce((sum, r) => {
    const phys = parseFloat(r.physicalCount);
    const sys = num(r.product.available_quantity);
    const diff = phys - sys;
    return sum + diff * num(r.product.standard_cost);
  }, 0), [variances]);

  const submit = useMutation({
    mutationFn: async () => {
      if (variances.length === 0) throw new Error("No variances to submit");
      // For each variance create an ADJUSTMENT movement via transferZones (ADJUSTMENT type)
      const promises = variances.map((r) => {
        const phys = parseFloat(r.physicalCount);
        const sys = num(r.product.available_quantity);
        const diff = phys - sys;
        return cycleCountAdjust({
          product_id: r.product.inv_product_id,
          physical_quantity: phys,
          approved_by: 1,
          reason: `Cycle count adjustment: system ${qty(sys)}, physical ${qty(phys)}, variance ${diff > 0 ? "+" : ""}${qty(diff)} ${r.product.uom}`,
        });
      });
      await Promise.all(promises);
    },
    onSuccess: () => {
      toast.success(`${variances.length} adjustment${variances.length > 1 ? "s" : ""} submitted for approval`);
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ["inv", "products"] });
      qc.invalidateQueries({ queryKey: ["inv", "movements"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not submit adjustments"),
  });

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500" />
        <h2 className="text-xl font-semibold text-card-foreground">Cycle Count Submitted</h2>
        <p className="text-muted-foreground">
          {variances.length} adjustment{variances.length !== 1 ? "s" : ""} submitted and awaiting approval. Stock updates once approved in <span className="font-medium text-foreground">Approvals</span>.
        </p>
        <Button onClick={() => { setCounts({}); setSubmitted(false); setSearch(""); }}>
          <RefreshCw className="mr-2 h-4 w-4" /> Start New Count
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-foreground">Cycle Count</h1>
          <p className="text-muted-foreground">Enter the physical count for each product. Variances are highlighted and submitted as ADJUSTMENT movements.</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {variances.length > 0 && (
            <Badge className="whitespace-nowrap border-transparent bg-amber-100 text-amber-700">
              {variances.length} variance{variances.length > 1 ? "s" : ""} · {totalVarianceValue >= 0 ? "+" : ""}
              {inr(Math.abs(totalVarianceValue))} impact
            </Badge>
          )}
          <Button className="shrink-0 gap-2" disabled={variances.length === 0 || submit.isPending} onClick={() => submit.mutate()}>
            <ClipboardList className="h-4 w-4" />
            {submit.isPending ? "Submitting…" : `Submit ${variances.length} Adjustment${variances.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search product…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2 text-right">System Qty</th>
              <th className="px-3 py-2 w-40">Physical Count</th>
              <th className="px-3 py-2">Variance</th>
              <th className="px-3 py-2 w-52">Match</th>
            </tr>
          </thead>
          <tbody>
            {products.isLoading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">No products.</td></tr>
            ) : rows.map(({ product, physicalCount }) => {
              const sysQty = num(product.available_quantity);
              const phys = parseFloat(physicalCount);
              const hasCount = !isNaN(phys) && physicalCount !== "";
              const variance = hasCount ? phys - sysQty : 0;
              const match = hasCount ? (variance === 0 ? 1 : Math.min(1, 1 - Math.abs(variance) / Math.max(sysQty, phys, 1))) : null;
              const varClass = !hasCount ? "" : variance === 0 ? "text-emerald-600" : variance < 0 ? "text-red-600" : "text-amber-600";

              return (
                <tr key={product.inv_product_id} className={cn("border-t", hasCount && variance !== 0 && "bg-amber-50/40")}>
                  <td className="px-3 py-2 font-medium text-card-foreground">{product.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{product.sku}</td>
                  <td className="px-3 py-2 text-right">{qty(sysQty)} {product.uom}</td>
                  <td className="px-3 py-2">
                    <Input
                      type="number" min="0" step="0.001"
                      placeholder={String(sysQty)}
                      value={physicalCount}
                      onChange={(e) => setCounts((prev) => ({ ...prev, [product.inv_product_id]: e.target.value }))}
                      className={cn("h-8 text-sm", hasCount && variance !== 0 ? "border-amber-400 focus-visible:ring-amber-400" : "")}
                    />
                  </td>
                  <td className={cn("px-3 py-2 font-semibold tabular-nums", varClass)}>
                    {hasCount ? (variance === 0 ? "✓ Match" : `${variance > 0 ? "+" : ""}${qty(variance)} ${product.uom}`) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {match !== null && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all", variance === 0 ? "bg-emerald-500" : variance < 0 ? "bg-red-400" : "bg-amber-400")}
                            style={{ width: `${Math.max(2, (match ?? 0) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{variance === 0 ? "100%" : `${Math.round((match ?? 0) * 100)}%`}</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {variances.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>{variances.length} product{variances.length > 1 ? "s" : ""} have a variance.</strong>{" "}
          Submitting will create ADJUSTMENT movements in Inventory Movements. These will be visible in the audit trail.
          Total value impact: <strong>{totalVarianceValue >= 0 ? "+" : ""}{inr(Math.abs(totalVarianceValue))}</strong>
          {totalVarianceValue < 0 ? " (stock loss)" : totalVarianceValue > 0 ? " (surplus)" : ""}.
        </div>
      )}
    </div>
  );
}
