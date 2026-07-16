import { useState, useEffect } from "react";
import { Plus, Search, BellRing, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import {
  fetchFollowups, createFollowup, updateFollowup, FOLLOWUP_LABELS,
  type Followup, type FollowupStatus,
} from "@/lib/api/followups";

const STATUSES: FollowupStatus[] = ["open", "done", "snoozed"];

const statusClass: Record<FollowupStatus, string> = {
  open: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
  snoozed: "bg-slate-100 text-slate-700",
};

const emptyForm = { title: "", customer_name: "", category: "", note: "", followup_date: "" };

export default function Followups() {
  const [rows, setRows] = useState<Followup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FollowupStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchFollowups({
        search,
        status: statusFilter === "all" ? "" : statusFilter,
        category: categoryFilter === "all" ? "" : categoryFilter,
      });
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load follow-ups");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter, categoryFilter]);
  // Real-time search — debounced so we don't fire a request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const categories = Array.from(new Set(rows.map((r) => r.category).filter(Boolean))) as string[];

  async function handleCreate() {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      await createFollowup(form);
      toast.success("Follow-up created");
      setAddOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create follow-up");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(r: Followup, status: FollowupStatus) {
    try {
      await updateFollowup(r.id, { status });
      toast.success(`${r.title} → ${FOLLOWUP_LABELS[status]}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const overdue = rows.filter((r) => r.status === "open" && r.followup_date && r.followup_date <= today).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BellRing className="h-6 w-6" /> Follow-ups</h1>
          <p className="text-sm text-muted-foreground">Salesperson reminders for customers who rescheduled or need a callback.</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> New Follow-up</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Follow-up</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Title / reason *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <Input placeholder="Customer name" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
              <Combobox options={categories} placeholder="Category (e.g. Sales, Service, Payment)" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
              <div>
                <label className="text-xs text-muted-foreground">Follow-up date</label>
                <Input type="date" value={form.followup_date} onChange={(e) => setForm({ ...form, followup_date: e.target.value })} />
              </div>
              <Textarea placeholder="Notes" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleCreate} disabled={saving}>{saving ? "Saving…" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {overdue > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
          <Clock className="h-4 w-4" />
          <span className="text-sm font-medium">{overdue} follow-up(s) due today or overdue.</span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-64" placeholder="Search title / customer…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FollowupStatus | "all")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{FOLLOWUP_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-3">Title</th><th className="p-3">Customer</th><th className="p-3">Assigned</th>
              <th className="p-3">Due</th><th className="p-3">Status</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={6}>No follow-ups yet.</td></tr>
            ) : rows.map((r) => {
              const isOverdue = r.status === "open" && r.followup_date && r.followup_date <= today;
              return (
                <tr key={r.id} className="border-t">
                  <td className="p-3 font-medium">{r.title}{r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}</td>
                  <td className="p-3">{r.customer_name || "—"}</td>
                  <td className="p-3">{r.assigned_name || "—"}</td>
                  <td className={`p-3 ${isOverdue ? "text-red-600 font-medium" : ""}`}>{r.followup_date || "—"}</td>
                  <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${statusClass[r.status]}`}>{FOLLOWUP_LABELS[r.status]}</span></td>
                  <td className="p-3">
                    {r.status !== "done" && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(r, "done")}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Done
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
