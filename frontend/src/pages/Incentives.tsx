/**
 * Incentive Payments (R7 / T10) — output-based HR pay (per sale / visit /
 * collection / fixed / % of turnover), kept separate from fixed payroll.
 * Off-books extra is shown/editable only to the extended login. Marking an
 * incentive paid posts an expense (Finance) and enables the incentive payslip.
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, BadgeIndianRupee, FileDown, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  fetchIncentives, createIncentive, updateIncentive, payIncentive, deleteIncentive,
  INCENTIVE_BASES, BASIS_LABELS,
  type Incentive, type IncentiveInput, type IncentiveBasis,
} from "@/lib/api/incentives";
import { PAYMENT_CATEGORIES } from "@/lib/api/installments";
import { downloadIncentivePayslip } from "@/lib/incentivePayslipPdf";
import { employeesApi, type Employee } from "@/lib/api/hr";

const money = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const emptyForm = {
  employee_id: "", person_name: "", basis: "per_sale" as IncentiveBasis,
  rate: "", units: "", base_amount: "", extra_amount: "", period: "", notes: "",
};
type FormState = typeof emptyForm;

export default function Incentives() {
  const { taxView } = useAuth();
  const extended = taxView === "extended";

  const [rows, setRows] = useState<Incentive[]>([]);
  const [summary, setSummary] = useState({ paid: 0, unpaid: 0 });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [payFor, setPayFor] = useState<Incentive | null>(null);
  const [payForm, setPayForm] = useState({ paid_on: new Date().toISOString().slice(0, 10), payment_category: "Bank Transfer", utr_no: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { rows, summary } = await fetchIncentives({ status: statusFilter === "all" ? "" : statusFilter, search });
      setRows(rows);
      setSummary(summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load incentives");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  // statusFilter changes load immediately; search is debounced so we don't
  // fire a request on every keystroke.
  useEffect(() => { load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => { employeesApi.list().then(setEmployees).catch(() => {}); }, []);

  // Live computed amount preview.
  const computeAmount = (f: FormState) => {
    const rate = Number(f.rate) || 0;
    if (f.basis === "percentage") return (Number(f.base_amount) || 0) * rate / 100;
    if (f.basis === "fixed") return rate * (Number(f.units) || 1);
    return rate * (Number(f.units) || 0);
  };

  function openAdd() { setEditingId(null); setForm(emptyForm); setDialogOpen(true); }
  function openEdit(i: Incentive) {
    setEditingId(i.id);
    setForm({
      employee_id: i.employee_id ? String(i.employee_id) : "", person_name: i.person_name, basis: i.basis,
      rate: String(i.rate || ""), units: String(i.units || ""), base_amount: String(i.base_amount || ""),
      extra_amount: i.extra_amount ? String(i.extra_amount) : "", period: i.period ?? "", notes: i.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.person_name.trim()) { toast.error("Payee name is required"); return; }
    setSaving(true);
    const payload: IncentiveInput = {
      employee_id: form.employee_id ? Number(form.employee_id) : null,
      person_name: form.person_name.trim(),
      basis: form.basis,
      rate: Number(form.rate) || 0,
      units: Number(form.units) || 0,
      base_amount: Number(form.base_amount) || 0,
      period: form.period.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    if (extended) payload.extra_amount = Number(form.extra_amount) || 0;
    try {
      if (editingId) { await updateIncentive(editingId, payload); toast.success("Incentive updated"); }
      else { await createIncentive(payload); toast.success("Incentive created"); }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save incentive");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(i: Incentive) {
    if (!confirm(`Delete incentive for ${i.person_name}?`)) return;
    try { await deleteIncentive(i.id); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  function openPay(i: Incentive) {
    setPayFor(i);
    setPayForm({ paid_on: new Date().toISOString().slice(0, 10), payment_category: i.payment_category || "Bank Transfer", utr_no: i.utr_no || "" });
  }
  async function confirmPay() {
    if (!payFor) return;
    try {
      await payIncentive(payFor.id, payForm);
      toast.success("Marked paid — expense posted to Finance");
      setPayFor(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark paid");
    }
  }

  const onEmployee = (v: string) => {
    const emp = employees.find((e) => String(e.employee_id ?? e.id) === v);
    setForm((f) => ({ ...f, employee_id: v, person_name: emp?.name || f.person_name }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BadgeIndianRupee className="h-6 w-6" /> Incentive Payments</h1>
          <p className="text-muted-foreground text-sm mt-1">Output-based pay (per sale / visit / collection / bonus / %), separate from payroll.</p>
        </div>
        <Button onClick={openAdd} className="gap-1"><Plus className="h-4 w-4" /> New Incentive</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Unpaid</div><div className="text-xl font-bold text-amber-700">{money(summary.unpaid)}</div></div>
        <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Paid</div><div className="text-xl font-bold text-green-700">{money(summary.paid)}</div></div>
        <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Records</div><div className="text-xl font-bold">{rows.length}</div></div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Input placeholder="Search payee" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="unpaid">Unpaid</SelectItem><SelectItem value="paid">Paid</SelectItem></SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-2 py-2">Payee</th><th className="px-2 py-2">Basis</th><th className="px-2 py-2">Period</th>
              <th className="px-2 py-2">Amount</th>{extended && <th className="px-2 py-2 text-amber-700">Extra</th>}
              <th className="px-2 py-2">Status</th><th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={extended ? 7 : 6} className="p-4 text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={extended ? 7 : 6} className="p-4 text-muted-foreground">No incentives yet.</td></tr>
            ) : rows.map((i) => (
              <tr key={i.id} className="border-t">
                <td className="px-2 py-2 font-medium">{i.employee_name || i.person_name}{i.employee_designation && <div className="text-xs text-muted-foreground">{i.employee_designation}</div>}</td>
                <td className="px-2 py-2">{BASIS_LABELS[i.basis]}</td>
                <td className="px-2 py-2">{i.period || "—"}</td>
                <td className="px-2 py-2 font-medium">{money(i.amount)}</td>
                {extended && <td className="px-2 py-2 text-amber-700">{money(i.extra_amount)}</td>}
                <td className="px-2 py-2"><span className={`text-xs px-2 py-0.5 rounded ${i.status === "paid" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{i.status}</span></td>
                <td className="px-2 py-2">
                  <div className="flex gap-2 items-center">
                    {i.status === "unpaid" && <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openPay(i)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Pay</Button>}
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => downloadIncentivePayslip(i)} title="Payslip"><FileDown className="h-4 w-4" /></button>
                    {i.status === "unpaid" && <button className="text-muted-foreground hover:text-foreground" onClick={() => openEdit(i)} title="Edit"><Pencil className="h-4 w-4" /></button>}
                    <button className="text-red-500 hover:text-red-700" onClick={() => handleDelete(i)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editingId ? "Edit Incentive" : "New Incentive"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Employee (optional)</label>
                <Select value={form.employee_id} onValueChange={onEmployee}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={String(e.employee_id ?? e.id)} value={String(e.employee_id ?? e.id)}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Payee name *</label>
                <Input value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Basis</label>
                <Select value={form.basis} onValueChange={(v) => setForm({ ...form, basis: v as IncentiveBasis })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INCENTIVE_BASES.map((b) => <SelectItem key={b} value={b}>{BASIS_LABELS[b]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Period</label>
                <Input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="e.g. 2026-07" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{form.basis === "percentage" ? "Rate %" : "Rate / unit"}</label>
                <Input type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
              </div>
              {form.basis === "percentage" ? (
                <div>
                  <label className="text-xs text-muted-foreground">Turnover base</label>
                  <Input type="number" value={form.base_amount} onChange={(e) => setForm({ ...form, base_amount: e.target.value })} />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-muted-foreground">Units</label>
                  <Input type="number" value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} />
                </div>
              )}
              {extended && (
                <div>
                  <label className="text-xs text-muted-foreground">Extra (off-books)</label>
                  <Input type="number" value={form.extra_amount} onChange={(e) => setForm({ ...form, extra_amount: e.target.value })} />
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <p className="text-sm text-muted-foreground">Computed incentive: <span className="font-semibold text-foreground">{money(computeAmount(form))}</span>{extended && Number(form.extra_amount) ? ` + extra ${money(Number(form.extra_amount))}` : ""}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay dialog */}
      <Dialog open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Pay incentive — {payFor?.person_name}</DialogTitle></DialogHeader>
          {payFor && (
            <div className="space-y-3">
              <p className="text-sm">Amount <span className="font-semibold">{money(payFor.amount)}</span>{extended && payFor.extra_amount ? ` + extra ${money(payFor.extra_amount)}` : ""}. This posts an expense to Finance.</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Paid on</label>
                  <Input type="date" value={payForm.paid_on} onChange={(e) => setPayForm({ ...payForm, paid_on: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Category</label>
                  <Select value={payForm.payment_category} onValueChange={(v) => setPayForm({ ...payForm, payment_category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PAYMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">UTR / Ref</label>
                  <Input value={payForm.utr_no} onChange={(e) => setPayForm({ ...payForm, utr_no: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
            <Button onClick={confirmPay}>Mark Paid</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
