import { useState, useEffect } from "react";
import { Plus, Search, Stamp, AlertTriangle, RefreshCw, Wallet, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import PaymentLedger from "@/components/PaymentLedger";
import { PAYMENT_CATEGORIES } from "@/lib/api/installments";
import {
  fetchStampings, createStamping, renewStamping, updateStamping, updateStampingFee, STAMP_LABELS,
  type Stamping as StampingRow, type StampingStatus,
} from "@/lib/api/stampings";
import { fetchMachines, type Machine } from "@/lib/api/machines";

const money = (v: number | string | null | undefined) =>
  v == null || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const STATUSES: StampingStatus[] = ["pending", "stamped", "due", "expired", "renewed"];

const statusClass: Record<StampingStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  stamped: "bg-green-100 text-green-700",
  due: "bg-amber-100 text-amber-700",
  expired: "bg-red-100 text-red-700",
  renewed: "bg-blue-100 text-blue-700",
};

const emptyForm = {
  machine_id: "", certificate_no: "", stamp_date: "", notes: "",
  total_amount: "", extra_amount: "", advance: "", payment_category: "Cash", utr_no: "",
};

const emptyRenewForm = {
  payment_type: "cash" as "cash" | "credit",
  certificate_no: "",
  total_amount: "", amount_paid: "", extra_amount: "", payment_category: "Cash", utr_no: "",
};

const emptyEditForm = {
  certificate_no: "", stamp_date: "", notes: "", total_amount: "", extra_amount: "",
};

export default function Stamping() {
  const { taxView, staffRole } = useAuth();
  const extended = taxView === "extended";
  // Fee is money — only owner/accountant may edit it (matches the API's role gate).
  const canEditFee = staffRole === "owner" || staffRole === "accountant";
  const [rows, setRows] = useState<StampingRow[]>([]);
  const [payFor, setPayFor] = useState<StampingRow | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StampingStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [quarterFilter, setQuarterFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [renewFor, setRenewFor] = useState<StampingRow | null>(null);
  const [renewDate, setRenewDate] = useState("");
  const [renewForm, setRenewForm] = useState(emptyRenewForm);
  const [editFor, setEditFor] = useState<StampingRow | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editSaving, setEditSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchStampings({
        search,
        status: statusFilter === "all" ? "" : statusFilter,
      });
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load stampings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);
  // Real-time search — debounced so we don't fire a request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => { fetchMachines({ limit: 200 }).then((r) => setMachines(r.rows)).catch(() => {}); }, []);

  async function handleCreate() {
    if (!form.machine_id) { toast.error("Select a machine"); return; }
    setSaving(true);
    try {
      await createStamping({
        machine_id: Number(form.machine_id),
        certificate_no: form.certificate_no || undefined,
        stamp_date: form.stamp_date || undefined,
        notes: form.notes || undefined,
        total_amount: Number(form.total_amount) || 0,
        ...(extended ? { extra_amount: Number(form.extra_amount) || 0 } : {}),
        advance: Number(form.advance) || 0,
        payment_category: form.payment_category,
        utr_no: form.utr_no || undefined,
      } as Partial<StampingRow> & Record<string, unknown>);
      toast.success("Stamping recorded");
      setAddOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record stamping");
    } finally {
      setSaving(false);
    }
  }

  function openRenew(r: StampingRow) {
    setRenewFor(r);
    setRenewDate(new Date().toISOString().slice(0, 10)); // default: today
    setRenewForm({
      ...emptyRenewForm,
      // Renewal fees are usually the same each year — prefill from the last period.
      total_amount: r.total_amount ? String(r.total_amount) : "",
    });
  }
  async function confirmRenew() {
    if (!renewFor) return;
    if (!renewDate) { toast.error("Enter the date stamping was done"); return; }
    const total = Number(renewForm.total_amount) || 0;
    const paid = renewForm.payment_type === "cash" ? total : Number(renewForm.amount_paid) || 0;
    try {
      await renewStamping(renewFor.id, {
        stamp_date: renewDate,
        certificate_no: renewForm.certificate_no || undefined,
        total_amount: total,
        advance: paid,
        payment_category: renewForm.payment_category,
        utr_no: renewForm.utr_no || undefined,
        ...(extended ? { extra_amount: Number(renewForm.extra_amount) || 0 } : {}),
      });
      toast.success(`${renewFor.machine_code ?? "Machine"} renewed — next renewal set 1 year from ${renewDate}`);
      setRenewFor(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not renew");
    }
  }

  function openEdit(r: StampingRow) {
    setEditFor(r);
    setEditForm({
      certificate_no: r.certificate_no ?? "",
      stamp_date: r.stamp_date ?? "",
      notes: r.notes ?? "",
      total_amount: r.total_amount != null ? String(r.total_amount) : "",
      extra_amount: r.extra_amount != null ? String(r.extra_amount) : "",
    });
  }
  async function confirmEdit() {
    if (!editFor) return;
    setEditSaving(true);
    try {
      // Non-money fields (any admin).
      await updateStamping(editFor.id, {
        certificate_no: editForm.certificate_no.trim(),
        stamp_date: editForm.stamp_date || undefined,
        notes: editForm.notes.trim(),
      });
      // Money fields — only if the caller may edit fees and something changed.
      if (canEditFee) {
        const newTotal = Number(editForm.total_amount) || 0;
        const newExtra = Number(editForm.extra_amount) || 0;
        const totalChanged = newTotal !== Number(editFor.total_amount ?? 0);
        const extraChanged = extended && newExtra !== Number(editFor.extra_amount ?? 0);
        if (totalChanged || extraChanged) {
          await updateStampingFee(editFor.id, {
            total_amount: newTotal,
            ...(extended ? { extra_amount: newExtra } : {}),
          });
        }
      }
      toast.success("Stamping updated");
      setEditFor(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update stamping");
    } finally {
      setEditSaving(false);
    }
  }

  const dueCount = rows.filter((r) => r.status === "due" || r.status === "expired").length;
  const categories = Array.from(new Set(rows.map((r) => r.machine_category).filter(Boolean))) as string[];
  const quarters = Array.from(new Set(rows.map((r) => r.quarter).filter(Boolean))) as string[];
  quarters.sort().reverse();
  const visibleRows = rows.filter((r) =>
    (categoryFilter === "all" || r.machine_category === categoryFilter) &&
    (quarterFilter === "all" || r.quarter === quarterFilter));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Stamp className="h-6 w-6" /> Stamping &amp; Renewals</h1>
          <p className="text-sm text-muted-foreground">Legal-metrology stamping per machine with yearly renewal tracking.</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Record Stamping</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Stamping</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Select value={form.machine_id} onValueChange={(v) => setForm({ ...form, machine_id: v })}>
                <SelectTrigger><SelectValue placeholder="Machine *" /></SelectTrigger>
                <SelectContent>
                  {machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.code}{m.model ? ` — ${m.model}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Certificate No." value={form.certificate_no} onChange={(e) => setForm({ ...form, certificate_no: e.target.value })} />
              <div>
                <label className="text-xs text-muted-foreground">Stamp date (renewal = +1 year)</label>
                <Input type="date" value={form.stamp_date} onChange={(e) => setForm({ ...form, stamp_date: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Stamping fee</label>
                  <Input type="number" min="0" placeholder="0.00" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
                </div>
                {extended && (
                  <div>
                    <label className="text-xs text-muted-foreground">Extra (off-books)</label>
                    <Input type="number" min="0" placeholder="0.00" value={form.extra_amount} onChange={(e) => setForm({ ...form, extra_amount: e.target.value })} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Advance paid</label>
                  <Input type="number" min="0" placeholder="0.00" value={form.advance} onChange={(e) => setForm({ ...form, advance: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Category</label>
                  <Select value={form.payment_category} onValueChange={(v) => setForm({ ...form, payment_category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PAYMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">UTR / Ref</label>
                  <Input value={form.utr_no} onChange={(e) => setForm({ ...form, utr_no: e.target.value })} />
                </div>
              </div>
              <Textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleCreate} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {dueCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">{dueCount} machine(s) need stamping renewal now.</span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-64" placeholder="Search machine / certificate…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StampingStatus | "all")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{STAMP_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={quarterFilter} onValueChange={setQuarterFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Quarter" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All quarters</SelectItem>
            {quarters.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-3">Machine</th><th className="p-3">Certificate</th><th className="p-3">Stamped</th>
              <th className="p-3">Renewal Due</th><th className="p-3">Fee</th><th className="p-3">Outstanding</th>
              <th className="p-3">Status</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={8}>Loading…</td></tr>
            ) : visibleRows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={8}>No stampings yet. Selling/delivering a machine auto-creates one.</td></tr>
            ) : visibleRows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.machine_code ?? `#${r.machine_id}`}<div className="text-xs text-muted-foreground">{r.machine_model}</div></td>
                <td className="p-3">{r.certificate_no || "—"}</td>
                <td className="p-3">{r.stamp_date || "—"}</td>
                <td className="p-3">{r.expiry_date || "—"}</td>
                <td className="p-3">{money(r.grand_total ?? r.total_amount)}</td>
                <td className="p-3">
                  {(r.outstanding ?? 0) > 0.005
                    ? <span className="text-red-700 font-medium">{money(r.outstanding)}</span>
                    : <span className="text-green-700">Paid</span>}
                </td>
                <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${statusClass[r.status]}`}>{STAMP_LABELS[r.status]}</span></td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPayFor(r)}>
                      <Wallet className="h-3.5 w-3.5 mr-1" /> Payments
                    </Button>
                    {(r.status === "due" || r.status === "expired" || r.status === "stamped") && (
                      <Button size="sm" variant="outline" onClick={() => openRenew(r)}>
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Renew
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Renew dialog — ask the date stamping was done; next renewal = +1 year from it */}
      <Dialog open={!!renewFor} onOpenChange={(o) => !o && setRenewFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Renew stamping — {renewFor?.machine_code}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter the date the stamping was done. The next renewal is set to one year from this date.</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Stamping done on</label>
                <Input type="date" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">New certificate no.</label>
                <Input placeholder="Certificate for this renewal" value={renewForm.certificate_no}
                  onChange={(e) => setRenewForm({ ...renewForm, certificate_no: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Payment type</label>
                <Select value={renewForm.payment_type} onValueChange={(v) => setRenewForm({ ...renewForm, payment_type: v as "cash" | "credit" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash (paid in full)</SelectItem>
                    <SelectItem value="credit">Credit (partial payment)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Total amount</label>
                <Input type="number" min="0" placeholder="0.00" value={renewForm.total_amount} onChange={(e) => setRenewForm({ ...renewForm, total_amount: e.target.value })} />
              </div>
            </div>
            {renewForm.payment_type === "credit" && (
              <div>
                <label className="text-xs text-muted-foreground">Amount paid now</label>
                <Input type="number" min="0" placeholder="0.00" value={renewForm.amount_paid} onChange={(e) => setRenewForm({ ...renewForm, amount_paid: e.target.value })} />
                {(() => {
                  const outstanding = (Number(renewForm.total_amount) || 0) - (Number(renewForm.amount_paid) || 0);
                  return outstanding > 0 ? (
                    <p className="text-xs text-amber-600 mt-1">Outstanding after this renewal: {money(outstanding)}</p>
                  ) : null;
                })()}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Payment category</label>
                <Select value={renewForm.payment_category} onValueChange={(v) => setRenewForm({ ...renewForm, payment_category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">UTR / Ref</label>
                <Input value={renewForm.utr_no} onChange={(e) => setRenewForm({ ...renewForm, utr_no: e.target.value })} />
              </div>
            </div>
            {extended && (
              <div>
                <label className="text-xs text-muted-foreground">Extra (off-books)</label>
                <Input type="number" min="0" placeholder="0.00" value={renewForm.extra_amount} onChange={(e) => setRenewForm({ ...renewForm, extra_amount: e.target.value })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewFor(null)}>Cancel</Button>
            <Button onClick={confirmRenew}>Confirm renewal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog — certificate no / stamp date / notes (+ fee for owner/accountant) */}
      <Dialog open={!!editFor} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit stamping — {editFor?.machine_code ?? `#${editFor?.machine_id}`}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Certificate No.</label>
              <Input value={editForm.certificate_no} onChange={(e) => setEditForm({ ...editForm, certificate_no: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Stamp date (renewal = +1 year)</label>
              <Input type="date" value={editForm.stamp_date} onChange={(e) => setEditForm({ ...editForm, stamp_date: e.target.value })} />
            </div>
            {canEditFee && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Stamping fee</label>
                  <Input type="number" min="0" value={editForm.total_amount} onChange={(e) => setEditForm({ ...editForm, total_amount: e.target.value })} />
                </div>
                {extended && (
                  <div>
                    <label className="text-xs text-muted-foreground">Extra (off-books)</label>
                    <Input type="number" min="0" value={editForm.extra_amount} onChange={(e) => setEditForm({ ...editForm, extra_amount: e.target.value })} />
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
            {!canEditFee && <p className="text-xs text-muted-foreground">Fee can be changed by an owner or accountant.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFor(null)}>Cancel</Button>
            <Button onClick={confirmEdit} disabled={editSaving}>{editSaving ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment ledger — stamping advance + installments → outstanding */}
      <Dialog open={!!payFor} onOpenChange={(o) => { if (!o) { setPayFor(null); load(); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Stamping payments — {payFor?.machine_code ?? `#${payFor?.machine_id}`}</DialogTitle></DialogHeader>
          {payFor && <PaymentLedger refType="stamping" refId={payFor.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
