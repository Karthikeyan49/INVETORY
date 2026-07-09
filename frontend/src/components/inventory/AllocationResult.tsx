import { CheckCircle2, PackageOpen } from "lucide-react";
import { ZoneTypeBadge } from "./ZoneTypeBadge";
import type { AllocationResultData } from "@/lib/api/inventory";

const num = (n: unknown) => Number(n ?? 0);

/**
 * Renders the outcome of a Smart Allocation run — which zones received how much.
 * Tolerant of the allocation payload shape (allocations | zones array).
 */
export function AllocationResult({ result }: { result: AllocationResultData | null }) {
  if (!result) return null;

  const raw =
    (result.allocations as Record<string, unknown>[] | undefined) ??
    (result.zones as Record<string, unknown>[] | undefined) ??
    [];

  const rows = Array.isArray(raw) ? raw : [];

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-6 text-muted-foreground">
        <PackageOpen className="h-6 w-6 opacity-40" />
        <p className="text-sm">No zone allocation was returned for this receipt.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> Stock allocated across {rows.length} zone{rows.length === 1 ? "" : "s"}
      </div>
      <div className="divide-y rounded-lg border">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              {r.zone_type ? <ZoneTypeBadge type={String(r.zone_type)} /> : null}
              <span className="text-card-foreground">{String(r.zone_name ?? r.zone_code ?? "Zone")}</span>
            </div>
            <span className="font-semibold">{num(r.quantity ?? r.allocated_quantity).toLocaleString("en-IN")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
