import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Movement type → coloured badge. Inflows green-ish, outflows amber/red,
 * transfers indigo — matching the procurement statusChip palette.
 */
export const MOVEMENT_TYPE_STYLES: Record<string, { label: string; chip: string }> = {
  STOCK_IN:          { label: "Stock In",          chip: "bg-emerald-100 text-emerald-700" },
  RETURN:            { label: "Return",            chip: "bg-emerald-100 text-emerald-700" },
  STOCK_OUT:         { label: "Stock Out",         chip: "bg-amber-100 text-amber-700" },
  EMPLOYEE_ISSUE:    { label: "Employee Issue",    chip: "bg-blue-100 text-blue-700" },
  DEALER_ALLOCATION: { label: "Dealer Allocation", chip: "bg-orange-100 text-orange-700" },
  PRODUCTION_USE:    { label: "Production Use",     chip: "bg-purple-100 text-purple-700" },
  TRANSFER:          { label: "Transfer",          chip: "bg-indigo-100 text-indigo-700" },
  ADJUSTMENT:        { label: "Adjustment",        chip: "bg-slate-100 text-slate-600" },
  DAMAGE:            { label: "Damage",            chip: "bg-red-100 text-red-700" },
  EMERGENCY_USE:     { label: "Emergency Use",     chip: "bg-red-100 text-red-700" },
};

export function movementTypeStyle(type: string) {
  return MOVEMENT_TYPE_STYLES[type] ?? { label: type, chip: "bg-slate-100 text-slate-600" };
}

export function MovementTypeBadge({ type }: { type: string }) {
  const s = movementTypeStyle(type);
  return <Badge className={cn("border-transparent", s.chip)}>{s.label}</Badge>;
}
