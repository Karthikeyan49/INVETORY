/**
 * PaymentLedger — reusable installment payment ledger UI (R12 / T3).
 *
 * Drop it into any document detail view (purchase order, stamping, purchase,
 * incentive, invoice). It shows grand total / paid / live outstanding and lets
 * staff add advance + N installments, each with a payment category
 * (Bank Transfer / Cash / UPI) and a UTR number for tracking.
 *
 * The grand total (and therefore outstanding) is computed server-side against
 * the document's tax_view-gated total, so off-books extra is included only for
 * the extended login automatically — no gating needed here.
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import {
  fetchLedger, recordInstallment, deleteInstallment,
  PAYMENT_CATEGORIES, type PaymentCategory, type InstallmentLedger, type InstallmentRefType,
} from "@/lib/api/installments";

const money = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

interface Props {
  refType: InstallmentRefType;
  refId: number;
  /** Called after any change so the parent can refresh its own totals. */
  onChange?: (ledger: InstallmentLedger) => void;
  readOnly?: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function PaymentLedger({ refType, refId, onChange, readOnly }: Props) {
  const [ledger, setLedger] = useState<InstallmentLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<PaymentCategory>("Bank Transfer");
  const [utr, setUtr] = useState("");
  const [paidOn, setPaidOn] = useState(today());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const l = await fetchLedger(refType, refId);
      setLedger(l);
      onChange?.(l);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load payments");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refType, refId]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a payment amount"); return; }
    if (category !== "Cash" && !utr.trim()) {
      toast.error("UTR number is required for bank/UPI payments");
      return;
    }
    setSaving(true);
    try {
      const { ledger: l } = await recordInstallment({
        ref_type: refType, ref_id: refId, amount: amt, category,
        utr_no: utr.trim() || undefined, paid_on: paidOn,
      });
      setLedger(l);
      onChange?.(l);
      setAmount(""); setUtr("");
      toast.success("Payment recorded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record payment");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await deleteInstallment(id);
      toast.success("Payment removed");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove payment");
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading payments…</div>;
  if (!ledger) return null;

  const statusClass =
    ledger.payment_status === "paid" ? "bg-green-100 text-green-700"
      : ledger.payment_status === "partial" ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border p-2">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="font-semibold">{money(ledger.grand_total)}</div>
        </div>
        <div className="rounded-lg border p-2">
          <div className="text-xs text-muted-foreground">Paid</div>
          <div className="font-semibold text-green-700">{money(ledger.paid_total)}</div>
        </div>
        <div className="rounded-lg border p-2">
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className="font-semibold text-red-700">{money(ledger.outstanding)}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className={`inline-block rounded px-2 py-0.5 text-xs capitalize ${statusClass}`}>{ledger.payment_status}</span>
        <span className="text-xs text-muted-foreground">{ledger.installments.length} installment(s)</span>
      </div>

      {ledger.installments.length > 0 && (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Label</th>
                <th className="px-2 py-1.5">Amount</th>
                <th className="px-2 py-1.5">Category</th>
                <th className="px-2 py-1.5">UTR</th>
                <th className="px-2 py-1.5">Date</th>
                {!readOnly && <th className="px-2 py-1.5"></th>}
              </tr>
            </thead>
            <tbody>
              {ledger.installments.map((i, idx) => (
                <tr key={i.id} className="border-t">
                  <td className="px-2 py-1.5">{idx + 1}</td>
                  <td className="px-2 py-1.5">{i.label || "—"}</td>
                  <td className="px-2 py-1.5">{money(i.amount)}</td>
                  <td className="px-2 py-1.5">{i.category}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{i.utr_no || "—"}</td>
                  <td className="px-2 py-1.5">{i.paid_on}</td>
                  {!readOnly && (
                    <td className="px-2 py-1.5">
                      <button className="text-red-500 hover:text-red-700" onClick={() => remove(i.id)} title="Remove">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && ledger.outstanding > 0.005 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end border-t pt-3">
          <div>
            <label className="text-xs text-muted-foreground">Amount</label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Category</label>
            <Select value={category} onValueChange={(v) => setCategory(v as PaymentCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">UTR / Ref{category !== "Cash" ? " *" : ""}</label>
            <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UTR number" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Date</label>
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <Button onClick={add} disabled={saving} className="gap-1">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      )}
    </div>
  );
}
