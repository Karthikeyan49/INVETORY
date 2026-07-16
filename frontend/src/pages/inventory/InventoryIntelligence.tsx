import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, AlertTriangle, Clock, PackageX, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fetchSpareForecast, type SpareForecast } from "@/lib/api/spares";

/**
 * Demand Forecast — sourced from Spares consumption (the existing Spares register
 * + its /spares/forecast engine). Forecasts stock-out and suggested reorder from
 * each spare's usage history. (Machines are one-off serial units, so demand
 * forecasting applies to consumable spares, not machines.)
 */
export default function InventoryIntelligence() {
  const forecast = useQuery({ queryKey: ["spares", "forecast", 90], queryFn: () => fetchSpareForecast(90) });
  const rows = forecast.data ?? [];

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (a.days_to_stockout ?? Infinity) - (b.days_to_stockout ?? Infinity)),
    [rows],
  );
  const atRisk = rows.filter((r) => r.days_to_stockout !== null && r.days_to_stockout <= 14);
  const lowStock = rows.filter((r) => r.low_stock);
  const toReorder = rows.filter((r) => r.suggested_reorder > 0);
  const soonest = sorted.find((r) => r.days_to_stockout !== null)?.days_to_stockout ?? null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Brain className="h-6 w-6" /> Demand Forecast</h1>
        <p className="text-sm text-muted-foreground">Spares stock-out &amp; reorder forecast from consumption history (last 90 days).</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={Boxes} label="Spares tracked" value={rows.length} />
        <Stat icon={Clock} label="At risk (≤14 days)" value={atRisk.length} accent={atRisk.length > 0} />
        <Stat icon={PackageX} label="Low stock" value={lowStock.length} accent={lowStock.length > 0} />
        <Stat icon={AlertTriangle} label="Soonest stock-out" value={soonest !== null ? `${soonest} d` : "—"} accent={soonest !== null && soonest <= 14} />
      </div>

      {toReorder.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">{toReorder.length} spare(s) suggested for reorder based on forecast.</span>
        </div>
      )}

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Spare</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-right">In stock</th>
              <th className="px-3 py-2 text-right">Used (90d)</th>
              <th className="px-3 py-2 text-right">Avg/day</th>
              <th className="px-3 py-2 text-right">Days to stock-out</th>
              <th className="px-3 py-2 text-right">Suggested reorder</th>
            </tr>
          </thead>
          <tbody>
            {forecast.isLoading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No forecast yet — record some spare consumption first.</td></tr>
            ) : sorted.map((f: SpareForecast) => {
              const soon = f.days_to_stockout !== null && f.days_to_stockout <= 14;
              return (
                <tr key={f.id} className={cn("border-t", (soon || f.low_stock) && "bg-red-50/40")}>
                  <td className="px-3 py-2 font-medium text-card-foreground">
                    {f.name}
                    {f.low_stock && <Badge className="ml-2 border-transparent bg-red-100 text-red-700">Low</Badge>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{f.category || "—"}</td>
                  <td className="px-3 py-2 text-right">{f.quantity}</td>
                  <td className="px-3 py-2 text-right">{f.consumed_window}</td>
                  <td className="px-3 py-2 text-right">{f.avg_daily_use}</td>
                  <td className="px-3 py-2 text-right">
                    {f.days_to_stockout === null
                      ? <span className="text-muted-foreground">—</span>
                      : <span className={cn("font-medium", soon && "text-red-700")}>{f.days_to_stockout} d</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{f.suggested_reorder > 0 ? <span className="font-semibold">{f.suggested_reorder}</span> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }: { icon: typeof Boxes; label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm flex items-center gap-3">
      <div className={cn("p-2 rounded-lg", accent ? "bg-red-100" : "bg-primary/10")}>
        <Icon className={cn("h-4 w-4", accent ? "text-red-600" : "text-primary")} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-card-foreground">{value}</p>
      </div>
    </div>
  );
}
