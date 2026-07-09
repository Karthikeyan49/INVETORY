import { cn } from "@/lib/utils";

/**
 * Stock-level progress bar relative to a reference (capacity or reorder level).
 * Colour reflects how close current is to running out:
 *   below reorder → red · within 25% above → amber · otherwise green.
 */
export function StockLevelIndicator({
  current,
  reference,
  reorderLevel,
  showLabel = true,
  unit = "",
}: {
  current: number;
  reference: number;
  reorderLevel?: number;
  showLabel?: boolean;
  unit?: string;
}) {
  const ref = reference > 0 ? reference : Math.max(current, 1);
  const pct = Math.max(0, Math.min(100, (current / ref) * 100));

  let bar = "bg-emerald-500";
  if (reorderLevel !== undefined && reorderLevel > 0) {
    if (current <= reorderLevel) bar = "bg-red-500";
    else if (current <= reorderLevel * 1.25) bar = "bg-amber-500";
  } else if (pct <= 20) {
    bar = "bg-red-500";
  } else if (pct <= 50) {
    bar = "bg-amber-500";
  }

  return (
    <div className="space-y-1">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && (
        <p className="text-[11px] text-muted-foreground">
          {current.toLocaleString("en-IN")}{unit && ` ${unit}`}
          {reference > 0 && ` / ${reference.toLocaleString("en-IN")}${unit ? ` ${unit}` : ""}`}
          {` · ${Math.round(pct)}%`}
        </p>
      )}
    </div>
  );
}
