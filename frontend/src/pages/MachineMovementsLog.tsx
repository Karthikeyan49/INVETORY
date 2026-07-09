import { useEffect, useState } from "react";
import { Search, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fetchMovementsFeed, STATUS_LABELS, type MachineMovement, type MachineStatus } from "@/lib/api/machines";

const TYPE_LABELS: Record<string, string> = {
  added: "Added",
  status_change: "Status change",
  part_out: "Part moved out",
  part_in: "Part received",
  invoice: "Invoice",
  challan: "Challan",
  issue: "Issue",
};

const typeClass: Record<string, string> = {
  added: "bg-blue-100 text-blue-700",
  status_change: "bg-primary/10 text-primary",
  part_out: "bg-amber-100 text-amber-700",
  part_in: "bg-green-100 text-green-700",
};

function statusLabel(s: string | null): string {
  if (!s) return "";
  return STATUS_LABELS[s as MachineStatus] ?? s;
}

export default function MachineMovementsLog() {
  const [rows, setRows] = useState<MachineMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await fetchMovementsFeed(search));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load movements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ArrowLeftRight className="h-6 w-6" /> Movements</h1>
        <p className="text-sm text-muted-foreground">Every machine activity — added, status changes, and parts moved between machines.</p>
      </div>

      <div className="relative w-72">
        <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search machine / activity…" value={search}
          onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2">Machine</th>
              <th className="px-3 py-2">Activity</th>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={5}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={5}>No movements recorded yet.</td></tr>
            ) : rows.map((m) => (
              <tr key={m.id} className="border-t align-top">
                <td className="px-3 py-2 font-medium">
                  {m.machine_code ?? `#${m.machine_id}`}
                  {m.machine_model && <div className="text-xs text-muted-foreground">{m.machine_model}</div>}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${typeClass[m.movement_type] ?? "bg-secondary text-foreground"}`}>
                    {TYPE_LABELS[m.movement_type] ?? m.movement_type}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {m.movement_type === "status_change" && m.from_status
                    ? `${statusLabel(m.from_status)} → ${statusLabel(m.to_status)}`
                    : (m.description || "—")}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{m.by_name || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{m.created_at?.slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
