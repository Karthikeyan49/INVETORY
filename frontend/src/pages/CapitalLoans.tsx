import { useEffect, useState } from "react";
import { Plus, Trash2, Landmark } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import {
  fetchFunding, createFunding, deleteFunding, FUNDING_LABELS,
  type FundingEntry, type FundingType, type FundingSummary,
} from "@/lib/api/funding";

const inr = (v: number) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const emptyForm = { entry_type: "capital" as FundingType, amount: "", entry_date: "", party: "", notes: "" };

export default function CapitalLoans() {
  const [rows, setRows] = useState<FundingEntry[]>([]);
  const [summary, setSummary] = useState<FundingSummary>({ capital: 0, loan_in: 0, loan_repaid: 0, loan_outstanding: 0 });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { rows, summary } = await fetchFunding();
      setRows(rows); setSummary(summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleSave() {
    if (!form.amount || Number(form.amount) <= 0) { toast.error("Enter an amount"); return; }
    setSaving(true);
    try {
      await createFunding({
        entry_type: form.entry_type, amount: Number(form.amount),
        entry_date: form.entry_date || undefined, party: form.party.trim() || undefined, notes: form.notes.trim() || undefined,
      });
      toast.success("Entry recorded");
      setOpen(false); setForm(emptyForm); load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r: FundingEntry) {
    if (!confirm(`Delete this ${FUNDING_LABELS[r.entry_type]} entry?`)) return;
    try { await deleteFunding(r.id); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" /> Capital &amp; Loans</h1>
          <p className="text-sm text-muted-foreground">Equity brought in and loans received/repaid — feeds the Balance Sheet &amp; Cash Flow.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Add Entry</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Capital / Loan entry</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Type</label>
                <Select value={form.entry_type} onValueChange={(v) => setForm({ ...form, entry_type: v as FundingType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="capital">Capital brought in</SelectItem>
                    <SelectItem value="loan_in">Loan received</SelectItem>
                    <SelectItem value="loan_repaid">Loan repaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Amount (₹) *</label>
                  <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Date</label>
                  <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Party (investor / lender)</label>
                <Input value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Notes</label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Capital</p><p className="text-lg font-bold">{inr(summary.capital)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Loans received</p><p className="text-lg font-bold">{inr(summary.loan_in)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Loans repaid</p><p className="text-lg font-bold">{inr(summary.loan_repaid)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Loan outstanding</p><p className="text-lg font-bold text-red-600">{inr(summary.loan_outstanding)}</p></div>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2">Type</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Party</th><th className="px-3 py-2">Notes</th><th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={6}>No entries yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 font-medium">{FUNDING_LABELS[r.entry_type]}</td>
                <td className="px-3 py-2">{inr(r.amount)}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.entry_date || "—"}</td>
                <td className="px-3 py-2">{r.party || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.notes || "—"}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => handleDelete(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
