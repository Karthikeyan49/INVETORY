import { useState, useEffect, Fragment } from "react";
import { Plus, Search, Wrench, AlertTriangle, CheckCircle2, RotateCcw, Pencil, Trash2, MapPin, Check } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  fetchIssues, createIssue, updateIssue, resolveIssue, reopenIssue, deleteIssue,
  ISSUE_STATUS_LABELS, type MachineIssue, type IssueStatus,
} from "@/lib/api/machineIssues";
import { fetchMachines, type Machine } from "@/lib/api/machines";

const DEFAULT_STAGES = ["Reported", "Diagnosing", "Awaiting Parts", "In Repair", "Testing", "Ready"];

const statusClass: Record<IssueStatus, string> = {
  open: "bg-red-100 text-red-700",
  in_progress: "bg-amber-100 text-amber-700",
  resolved: "bg-green-100 text-green-700",
};

type ViewFilter = "active" | "open" | "in_progress" | "resolved" | "all";

const emptyForm = { machine_id: "", title: "", description: "", place: "", process: "Reported" };

export default function MachineIssues() {
  const [rows, setRows] = useState<MachineIssue[]>([]);
  const [stages, setStages] = useState<string[]>(DEFAULT_STAGES);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewFilter>("active");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editRow, setEditRow] = useState<MachineIssue | null>(null);
  const [confirmStep, setConfirmStep] = useState<{ issue: MachineIssue; stage: string; isLast: boolean } | null>(null);
  const [stepSaving, setStepSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { rows, stages } = await fetchIssues({ search });
      setRows(rows);
      if (stages.length) setStages(stages);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { fetchMachines({ limit: 200 }).then((r) => setMachines(r.rows)).catch(() => {}); }, []);

  async function handleCreate() {
    if (!form.machine_id) { toast.error("Select a machine"); return; }
    if (!form.title.trim()) { toast.error("Describe the issue (title)"); return; }
    setSaving(true);
    try {
      await createIssue({
        machine_id: Number(form.machine_id),
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        place: form.place.trim() || undefined,
        process: form.process || undefined,
      });
      toast.success("Issue reported — machine moved to Maintenance");
      setAddOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not report issue");
    } finally {
      setSaving(false);
    }
  }

  async function quickUpdate(r: MachineIssue, patch: Partial<Pick<MachineIssue, "process" | "status">>) {
    try {
      await updateIssue(r.id, patch);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function applyStep() {
    if (!confirmStep) return;
    const { issue, stage, isLast } = confirmStep;
    setStepSaving(true);
    try {
      if (isLast) {
        await resolveIssue(issue.id);
        toast.success("Issue completed — machine ready");
      } else {
        await updateIssue(issue.id, { process: stage, status: "in_progress" });
        toast.success(`Moved to “${stage}”`);
      }
      setConfirmStep(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update stage");
    } finally {
      setStepSaving(false);
    }
  }

  async function handleResolve(r: MachineIssue) {
    try {
      await resolveIssue(r.id);
      toast.success(`Resolved — ${r.machine_code ?? "machine"} returned to stock`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resolve");
    }
  }

  async function handleReopen(r: MachineIssue) {
    try {
      await reopenIssue(r.id);
      toast.success("Issue reopened");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reopen");
    }
  }

  async function handleDelete(r: MachineIssue) {
    if (!confirm(`Delete this issue for ${r.machine_code ?? "machine"}?`)) return;
    try {
      await deleteIssue(r.id);
      toast.success("Issue deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  const matchesView = (r: MachineIssue) =>
    view === "all" ? true
      : view === "active" ? r.status !== "resolved"
        : r.status === view;
  const visibleRows = rows.filter(matchesView);
  const activeCount = rows.filter((r) => r.status !== "resolved").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wrench className="h-6 w-6" /> Machine Issues</h1>
          <p className="text-sm text-muted-foreground">Track faulty machines — where they are and what stage the repair is at. Resolving sends the machine back to the Machines page.</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Report Issue</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Report a Machine Issue</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Machine *</label>
                <Select value={form.machine_id} onValueChange={(v) => setForm({ ...form, machine_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select machine" /></SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.code}{m.model ? ` — ${m.model}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Issue *</label>
                <Input placeholder="e.g. Display panel not working" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Place (where it is)</label>
                  <Input placeholder="e.g. Workshop / Customer site" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Process (stage)</label>
                  <Select value={form.process} onValueChange={(v) => setForm({ ...form, process: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {stages.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Details</label>
                <Textarea placeholder="Notes about the fault…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleCreate} disabled={saving}>{saving ? "Saving…" : "Report Issue"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {activeCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">{activeCount} machine(s) currently under maintenance / awaiting repair.</span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-64" placeholder="Search machine / issue / place…" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        </div>
        <Select value={view} onValueChange={(v) => setView(v as ViewFilter)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load}>Search</Button>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-3">Machine</th><th className="p-3">Issue</th><th className="p-3">Place</th>
              <th className="p-3">Process</th><th className="p-3">Status</th><th className="p-3">Reported</th><th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={7}>Loading…</td></tr>
            ) : visibleRows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={7}>No issues here. Use “Report Issue” to log a machine fault.</td></tr>
            ) : visibleRows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t align-top">
                  <td className="p-3 font-medium">{r.machine_code ?? `#${r.machine_id}`}<div className="text-xs text-muted-foreground">{r.machine_model}</div></td>
                  <td className="p-3">{r.title}{r.description && <div className="text-xs text-muted-foreground max-w-[220px]">{r.description}</div>}</td>
                  <td className="p-3"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{r.place || "—"}</span></td>
                  <td className="p-3"><span className="text-xs font-medium">{r.process || "—"}</span></td>
                  <td className="p-3">
                    {r.status === "resolved" ? (
                      <span className={`text-xs px-2 py-0.5 rounded ${statusClass[r.status]}`}>{ISSUE_STATUS_LABELS[r.status]}</span>
                    ) : (
                      <Select value={r.status} onValueChange={(v) => quickUpdate(r, { status: v as IssueStatus })}>
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{r.created_at?.slice(0, 10)}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      {r.status === "resolved" ? (
                        <Button size="sm" variant="outline" onClick={() => handleReopen(r)}><RotateCcw className="h-3.5 w-3.5 mr-1" /> Reopen</Button>
                      ) : (
                        <Button size="sm" onClick={() => handleResolve(r)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Resolve</Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditRow(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => handleDelete(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
                <tr className="bg-muted/10">
                  <td colSpan={7} className="px-4 pb-4 pt-1">
                    <IssueStepper
                      issue={r}
                      stages={stages}
                      onPick={(stage, isLast) => setConfirmStep({ issue: r, stage, isLast })}
                    />
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <EditIssueDialog row={editRow} stages={stages} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); load(); }} />

      <Dialog open={!!confirmStep} onOpenChange={(o) => !o && setConfirmStep(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmStep?.isLast ? "Complete repair?" : `Move to “${confirmStep?.stage}”?`}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmStep?.isLast
              ? `This marks the repair finished and returns ${confirmStep?.issue.machine_code ?? "the machine"} to the Machines page.`
              : `Update the repair stage for ${confirmStep?.issue.machine_code ?? "this machine"} to “${confirmStep?.stage}”.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStep(null)}>Cancel</Button>
            <Button onClick={applyStep} disabled={stepSaving}>{stepSaving ? "Saving…" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Horizontal stage tracker — click a stage to advance the repair (last stage completes it). */
function IssueStepper({ issue, stages, onPick }: {
  issue: MachineIssue; stages: string[]; onPick: (stage: string, isLast: boolean) => void;
}) {
  const done = issue.status === "resolved";
  const currentIndex = done ? stages.length - 1 : Math.max(0, stages.indexOf(issue.process ?? ""));

  return (
    <div className="flex items-center gap-1 flex-wrap pt-1">
      {stages.map((s, i) => {
        const isLast = i === stages.length - 1;
        const reached = i <= currentIndex;
        const isCurrent = !done && i === currentIndex;
        return (
          <Fragment key={s}>
            {i > 0 && <span className={`h-px w-4 ${reached ? "bg-primary/60" : "bg-muted-foreground/25"}`} />}
            <button
              type="button"
              disabled={done}
              onClick={() => onPick(s, isLast)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition disabled:cursor-default
                ${isCurrent ? "border-primary bg-primary text-primary-foreground"
                  : reached ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-muted-foreground/25 text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}
            >
              {reached && !isCurrent && <Check className="h-3 w-3" />}
              {s}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function EditIssueDialog({ row, stages, onClose, onSaved }: {
  row: MachineIssue | null; stages: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ title: "", description: "", place: "", process: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (row) setForm({ title: row.title, description: row.description ?? "", place: row.place ?? "", process: row.process ?? "" });
  }, [row]);

  async function save() {
    if (!row) return;
    if (!form.title.trim()) { toast.error("Issue title is required"); return; }
    setSaving(true);
    try {
      await updateIssue(row.id, {
        title: form.title.trim(),
        description: form.description.trim(),
        place: form.place.trim(),
        process: form.process,
      });
      toast.success("Issue updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Issue — {row?.machine_code}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Issue *</label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Place (where it is)</label>
              <Input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Process (stage)</label>
              <Select value={form.process} onValueChange={(v) => setForm({ ...form, process: v })}>
                <SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger>
                <SelectContent>{stages.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Details</label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
