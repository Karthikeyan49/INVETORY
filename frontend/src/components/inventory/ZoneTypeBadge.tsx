import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Zone type → coloured badge.
 *   RAW_MATERIAL blue · PRODUCTION purple · READY_STOCK green
 *   DEALER_RESERVED orange · DAMAGED red · EMERGENCY_BUFFER yellow
 */
export const ZONE_TYPE_STYLES: Record<string, { label: string; chip: string; accent: string }> = {
  RAW_MATERIAL:     { label: "Raw Material",     chip: "bg-blue-100 text-blue-700",     accent: "border-blue-400" },
  PRODUCTION:       { label: "Production",        chip: "bg-purple-100 text-purple-700", accent: "border-purple-400" },
  READY_STOCK:      { label: "Ready Stock",       chip: "bg-emerald-100 text-emerald-700", accent: "border-emerald-400" },
  DEALER_RESERVED:  { label: "Dealer Reserved",   chip: "bg-orange-100 text-orange-700", accent: "border-orange-400" },
  DAMAGED:          { label: "Damaged",           chip: "bg-red-100 text-red-700",       accent: "border-red-400" },
  EMERGENCY_BUFFER: { label: "Emergency Buffer",  chip: "bg-amber-100 text-amber-700",   accent: "border-amber-400" },
};

export function zoneTypeStyle(type: string) {
  return ZONE_TYPE_STYLES[type] ?? { label: type, chip: "bg-slate-100 text-slate-600", accent: "border-slate-300" };
}

export function ZoneTypeBadge({ type }: { type: string }) {
  const s = zoneTypeStyle(type);
  return <Badge className={cn("border-transparent", s.chip)}>{s.label}</Badge>;
}
