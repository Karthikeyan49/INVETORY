/**
 * Cash Bills — Sri Vari Cash Bill (F/SVS/34) register. A cash-sale receipt that
 * can be created from a machine (via the Machines "Cash Bill" action) and
 * downloaded as the exact letterhead PDF, like delivery challans / invoices.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Search, FileDown, Trash2, ReceiptText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fetchCashBills, createCashBill, deleteCashBill, type CashBill } from "@/lib/api/cashBills";
import { downloadCashBillPdf } from "@/lib/cashBillPdf";

const money = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

interface FormState {
  customer_name: string; cell_no: string; machine_id: string;
  description: string; qty: string; amount: string; bill_date: string; notes: string;
}
const emptyForm: FormState = {
  customer_name: "", cell_no: "", machine_id: "",
  description: "", qty: "1NO", amount: "", bill_date: new Date().toISOString().slice(0, 10), notes: "",
};

export default function CashBills() {
  const [rows, setRows] = useState<CashBill[]>([]);
  const [nextBill, setNextBill] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const { rows, nextBill } = await fetchCashBills({ search });
      setRows(rows);
      setNextBill(nextBill);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load cash bills");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Prefill from the Machines "Cash Bill" action.
  useEffect(() => {
    const mc = (location.state as { machineCashBill?: Record<string, unknown> } | null)?.machineCashBill;
    if (!mc) return;
    setForm({
      ...emptyForm,
      customer_name: (mc.customer_name as string) ?? "",
      cell_no: (mc.cell_no as string) ?? "",
      machine_id: mc.machine_id != null ? String(mc.machine_id) : "",
      description: (mc.description as string) ?? "",
      amount: mc.amount != null && mc.amount !== "" ? String(mc.amount) : "",
      bill_date: new Date().toISOString().slice(0, 10),
    });
    setAddOpen(true);
    navigate("/cash-bills", { replace: true, state: null }); // clear so a refresh won't reopen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAdd() { setForm(emptyForm); setAddOpen(true); }

  async function handleCreate() {
    if (!form.customer_name.trim()) { toast.error("Customer name is required"); return; }
    setSaving(true);
    try {
      const amt = form.amount.trim() === "" ? null : Number(form.amount);
      const created = await createCashBill({
        customer_name: form.customer_name.trim(),
        cell_no: form.cell_no.trim() || undefined,
        machine_id: form.machine_id ? Number(form.machine_id) : undefined,
        description: form.description.trim() || undefined,
        qty: form.qty.trim() || undefined,
        amount: amt ?? undefined,
        total: amt ?? undefined,
        bill_date: form.bill_date || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success(`Cash bill ${created.bill_no} created`);
      setAddOpen(false);
      load();
      // Offer the PDF straight away.
      downloadCashBillPdf(created).catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create cash bill");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: CashBill) {
    if (!confirm(`Delete cash bill "${c.bill_no}"?`)) return;
    try { await deleteCashBill(c.id); toast.success("Cash bill deleted"); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ReceiptText className="h-6 w-6" /> Cash Bills</h1>
          <p className="text-sm text-muted-foreground">Sri Vari Cash Bill (F/SVS/34) — cash-sale receipts, downloadable as PDF.</p>
        </div>
        <Button onClick={openAdd} className="gap-1"><Plus className="h-4 w-4" /> New Cash Bill</Button>
      </div>

      <div className="relative w-72">
        <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search bill no / customer…" value={search}
          onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Bill No</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-4 text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-muted-foreground">No cash bills yet. Create one to get started.</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="px-3 py-2 font-medium">{c.bill_no}</td>
                <td className="px-3 py-2 whitespace-nowrap">{c.bill_date?.slice(0, 10) || "—"}</td>
                <td className="px-3 py-2">{c.customer_name || "—"}
                  {c.cell_no && <div className="text-xs text-muted-foreground">{c.cell_no}</div>}
                </td>
                <td className="px-3 py-2 max-w-xs truncate" title={c.description || ""}>{c.description || (c.machine_model ? `${c.machine_model}${c.machine_code ? ` (${c.machine_code})` : ""}` : "—")}</td>
                <td className="px-3 py-2 font-medium">{money(c.total ?? c.amount)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7" onClick={() => downloadCashBillPdf(c)}><FileDown className="h-3.5 w-3.5 mr-1" />PDF</Button>
                    <button className="text-red-500 hover:text-red-700" onClick={() => handleDelete(c)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>New Cash Bill{nextBill ? ` — ${nextBill}` : ""}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Customer name *</label>
                <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Cell no</label>
                <Input value={form.cell_no} onChange={(e) => setForm({ ...form, cell_no: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Description</label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="ELECTRONIC WEIGHING SCALE — Model / Machine No…" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Qty</label>
                <Input value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Amount</label>
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Date</label>
                <Input type="date" value={form.bill_date} onChange={(e) => setForm({ ...form, bill_date: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">Saving creates the cash bill and downloads the PDF. You can re-download it any time from the list.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving} className="gap-1">
              <FileDown className="h-4 w-4" /> {saving ? "Saving…" : "Create & Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
