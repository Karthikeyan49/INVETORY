import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchMachineAlerts } from "@/lib/api/machines";

/**
 * Warns that one or more machines are missing parts (e.g. a battery transferred
 * to another unit). Drop this at the top of invoice / delivery / billing pages
 * so staff see it *before* generating a document for an incomplete machine.
 * (requirement.txt line 8)
 */
export function MachineAlertsBanner() {
  const { data: alerts } = useQuery({
    queryKey: ["machines", "alerts"],
    queryFn: fetchMachineAlerts,
    staleTime: 30_000,
  });

  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" />
        {alerts.length} machine(s) are missing parts — verify before invoicing / delivery.
      </div>
      <ul className="mt-1 ml-6 list-disc text-sm">
        {alerts.slice(0, 5).map((a) => (
          <li key={a.id}>
            <span className="font-semibold">{a.code}</span>
            {a.model ? ` (${a.model})` : ""} — missing {a.missing_parts}
            <span className="text-red-600"> · {a.status.replace("_", " ")}</span>
          </li>
        ))}
      </ul>
      <Link to="/machines" className="mt-1 inline-block text-sm underline">Review machines →</Link>
    </div>
  );
}
