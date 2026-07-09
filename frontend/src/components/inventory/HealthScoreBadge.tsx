import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Health score → coloured badge.
 *   80-100 green "Healthy" · 60-79 yellow "Warning" · 40-59 orange "At Risk" · 0-39 red "Critical"
 */
export function healthTier(score: number): { label: string; className: string } {
  if (score >= 80) return { label: "Healthy", className: "bg-emerald-100 text-emerald-700" };
  if (score >= 60) return { label: "Warning", className: "bg-amber-100 text-amber-700" };
  if (score >= 40) return { label: "At Risk", className: "bg-orange-100 text-orange-700" };
  return { label: "Critical", className: "bg-red-100 text-red-700" };
}

export function HealthScoreBadge({ score, showValue = true }: { score: number; showValue?: boolean }) {
  const tier = healthTier(score);
  return (
    <Badge className={cn("border-transparent", tier.className)}>
      {tier.label}
      {showValue && <span className="ml-1 font-normal opacity-80">{Math.round(score)}</span>}
    </Badge>
  );
}
