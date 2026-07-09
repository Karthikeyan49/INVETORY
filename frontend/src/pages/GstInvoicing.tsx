import { useEffect, useMemo, useState } from "react";
import {
  Plus, Search, Pencil, Trash2, FileDown, Receipt, IndianRupee, FileText, Percent, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import {
  GST_RATES, calcInvoiceTotals, invoicesApi,
  type Invoice, type InvoiceLine, type InvoiceStatus,
} from "@/lib/api/invoices";
import {
  downloadInvoiceTemplatePdf,
  placeOfSupplyLabel,
  type InvoiceTemplateDraft,
} from "@/lib/invoiceTemplatePdf";
import { ScrollableX } from "@/components/ui/scrollable-x";

const STATUSES: InvoiceStatus[] = ["Draft", "Sent", "Paid", "Overdue", "Cancelled"];
const STATES = [
  "Tamil Nadu", "Karnataka", "Kerala", "Andhra Pradesh", "Telangana", "Maharashtra",
  "Gujarat", "Delhi", "Uttar Pradesh", "West Bengal", "Punjab", "Rajasthan", "Madhya Pradesh",
];
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const newLine = (): InvoiceLine => ({
  id: crypto.randomUUID(), description: "", hsn: "", qty: 1, unitPrice: 0, gstRate: 18,
});

const emptyForm = (): Omit<Invoice, "id"> => ({
  date: new Date().toISOString().slice(0, 10),
  dueDate: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
  sellerState: "Tamil Nadu",
  customer: { name: "", gstin: "", state: "Tamil Nadu", address: "" },
  lines: [newLine()],
  notes: "",
  status: "Draft",
});

const statusColor = (s: InvoiceStatus) => ({
  Draft: "bg-muted text-muted-foreground",
  Sent: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  Paid: "bg-primary/10 text-primary",
  Overdue: "bg-destructive/10 text-destructive",
  Cancelled: "bg-secondary text-secondary-foreground line-through",
}[s]);

const defaultInvoiceNote = "Thank you for your business.";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toTemplateDraft(inv: Invoice): InvoiceTemplateDraft {
  const totals = calcInvoiceTotals(inv);
  const billTo = [
    inv.customer.name,
    inv.customer.address,
    inv.customer.gstin ? `GSTIN ${inv.customer.gstin}` : "",
  ].filter(Boolean).join("\n");

  return {
    invoiceNumber: inv.id,
    invoiceDate: inv.date,
    dueDate: inv.dueDate,
    terms: "Due on Receipt",
    placeOfSupply: placeOfSupplyLabel(inv.customer.state),
    billTo,
    shipTo: billTo,
    subject: inv.lines.map((line) => line.description).filter(Boolean).slice(0, 2).join(", ") || "INVENTORY MANAGEMENT SYSTEM BIOMASS PELLET",
    notes: inv.notes || defaultInvoiceNote,
    sellerState: inv.sellerState,
    customerState: inv.customer.state,
    deliveryFee: 0,
    balanceDue: inv.status === "Paid" ? 0 : totals.grandTotal,
    lines: inv.lines.map((line) => ({
      description: line.description,
      hsn: line.hsn,
      qty: line.qty,
      unitPrice: line.unitPrice,
      gstRate: line.gstRate,
      discount: 0,
    })),
  };
}

export default function GstInvoicing() {
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [form, setForm] = useState<Omit<Invoice, "id">>(emptyForm());
  const [confirmDelete, setConfirmDelete] = useState<Invoice | null>(null);
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setItems(await invoicesApi.list()); }
    catch (e: unknown) { toast.error(errorMessage(e, "Could not load invoices")); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items.filter((i) => {
    if (statusFilter !== "all" && i.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.id.toLowerCase().includes(q) &&
          !i.customer.name.toLowerCase().includes(q) &&
          !(i.customer.gstin ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [items, search, statusFilter]);

  const summary = useMemo(() => {
    let revenue = 0, tax = 0, outstanding = 0;
    filtered.forEach((i) => {
      const t = calcInvoiceTotals(i);
      revenue += t.grandTotal;
      tax += t.totalTax;
      if (i.status === "Sent" || i.status === "Overdue") outstanding += t.grandTotal;
    });
    return { revenue, tax, outstanding, count: filtered.length };
  }, [filtered]);

  const formTotals = useMemo(() => calcInvoiceTotals(form), [form]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = async (inv: Invoice) => {
    setEditing(inv);
    const { id, ...rest } = inv;
    setForm(rest);   // open immediately with header data
    setDialogOpen(true);
    setEditLoading(true);
    try {
      const full = await invoicesApi.get(inv.id);
      const { id: _, ...fullRest } = full;
      setForm(fullRest); // hydrate line items once loaded
    } catch {
      toast.error("Could not load invoice line items");
    } finally {
      setEditLoading(false);
    }
  };

  const openPreview = async (inv: Invoice) => {
    setPreview(inv);   // open dialog immediately
    setPreviewLoading(true);
    try {
      const full = await invoicesApi.get(inv.id);
      setPreview(full); // hydrate with real line items
    } catch {
      // keep showing what we have
    } finally {
      setPreviewLoading(false);
    }
  };

  const updateLine = (lineId: string, patch: Partial<InvoiceLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => l.id === lineId ? { ...l, ...patch } : l) }));
  const removeLine = (lineId: string) =>
    setForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((l) => l.id !== lineId) : f.lines }));

  const onSubmit = async () => {
    if (!form.customer.name.trim()) { toast.error("Customer name required"); return; }
    if (form.lines.some((l) => !l.description.trim() || l.qty <= 0 || l.unitPrice < 0)) {
      toast.error("Each line needs description, qty > 0 and valid price"); return;
    }
    try {
      if (editing) {
        await invoicesApi.update(editing.id, form);
        toast.success("Invoice updated");
      } else {
        await invoicesApi.create(form);
        toast.success("Invoice created");
      }
      setDialogOpen(false); load();
    } catch (e: unknown) { toast.error(errorMessage(e, "Could not save invoice")); }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await invoicesApi.remove(confirmDelete.id);
      toast.success("Invoice deleted"); setConfirmDelete(null); load();
    } catch (e: unknown) { toast.error(errorMessage(e, "Could not delete invoice")); }
  };

  const downloadPdf = async (inv: Invoice) => {
    try {
      const full = inv.lines.length > 0 ? inv : await invoicesApi.get(inv.id);
      await downloadInvoiceTemplatePdf(toTemplateDraft(full));
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Download failed"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">GST Invoicing</h1>
          <p className="text-muted-foreground">Generate GST-compliant tax invoices with auto CGST/SGST/IGST.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" />New Invoice</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Invoiced" value={inr(summary.revenue)} subtitle={`${summary.count} invoices`} icon={IndianRupee} />
        <StatCard title="Tax Collected" value={inr(summary.tax)} subtitle="CGST+SGST+IGST" icon={Percent} />
        <StatCard title="Outstanding" value={inr(summary.outstanding)} subtitle="Sent + Overdue" icon={Receipt} subtitleColor="muted" />
        <StatCard title="Avg / Invoice" value={summary.count ? inr(summary.revenue / summary.count) : "₹0"} subtitle="filtered" icon={FileText} />
      </div>

      <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search invoice no, customer, GSTIN..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Invoice</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-left px-4 py-3 font-medium">GSTIN / State</th>
                <th className="text-right px-4 py-3 font-medium">Tax</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">No invoices.</td></tr>}
              {!loading && filtered.map((inv) => {
                const t = calcInvoiceTotals(inv);
                return (
                  <tr key={inv.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-semibold text-card-foreground">{inv.id}</td>
                    <td className="px-4 py-3">{inv.date}</td>
                    <td className="px-4 py-3">{inv.customer.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {inv.customer.gstin || "—"}<br/>{inv.customer.state}
                    </td>
                    <td className="px-4 py-3 text-right">{inr(t.totalTax)}<div className="text-xs text-muted-foreground">{t.isInterState ? "IGST" : "CGST+SGST"}</div></td>
                    <td className="px-4 py-3 text-right font-semibold">{inr(t.grandTotal)}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${statusColor(inv.status)}`}>{inv.status}</span></td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openPreview(inv)}><Eye className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => downloadPdf(inv)}><FileDown className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(inv)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(inv)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableX>
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.id}` : "New GST Invoice"}</DialogTitle>
            <DialogDescription>Auto-detects intra/inter-state GST based on customer state.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><Label>Due Date</Label><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as InvoiceStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Seller State</Label>
              <Select value={form.sellerState} onValueChange={(v) => setForm({ ...form, sellerState: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
            <div><Label>Customer Name</Label><Input value={form.customer.name} onChange={(e) => setForm({ ...form, customer: { ...form.customer, name: e.target.value } })} /></div>
            <div><Label>GSTIN (optional)</Label><Input value={form.customer.gstin ?? ""} onChange={(e) => setForm({ ...form, customer: { ...form.customer, gstin: e.target.value } })} /></div>
            <div>
              <Label>Customer State</Label>
              <Select value={form.customer.state} onValueChange={(v) => setForm({ ...form, customer: { ...form.customer, state: v } })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Address</Label><Input value={form.customer.address} onChange={(e) => setForm({ ...form, customer: { ...form.customer, address: e.target.value } })} /></div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <Label>Line Items</Label>
              <div className="flex items-center gap-2">
                {editLoading && <span className="text-xs text-muted-foreground">Loading items…</span>}
                <Button size="sm" variant="outline" disabled={editLoading} onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, newLine()] }))}>
                  <Plus className="h-4 w-4" /> Add line
                </Button>
              </div>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-2">Description</th>
                    <th className="text-left px-2 py-2 w-24">HSN</th>
                    <th className="text-right px-2 py-2 w-16">Qty</th>
                    <th className="text-right px-2 py-2 w-24">Unit ₹</th>
                    <th className="text-right px-2 py-2 w-20">GST%</th>
                    <th className="text-right px-2 py-2 w-24">Total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-2 py-1"><Input value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} /></td>
                      <td className="px-2 py-1"><Input value={l.hsn} onChange={(e) => updateLine(l.id, { hsn: e.target.value })} /></td>
                      <td className="px-2 py-1"><Input type="number" min="1" value={l.qty.toString()} onChange={(e) => updateLine(l.id, { qty: Number(e.target.value.replace(/^0+(?=\d)/, '')) })} className="text-right appearance-none" /></td>
                      <td className="px-2 py-1"><Input type="number" min="0" step="0.01" value={l.unitPrice.toString()} onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value.replace(/^0+(?=\d)/, '')) })} className="text-right appearance-none" /></td>
                      <td className="px-2 py-1">
                        <Select value={String(l.gstRate)} onValueChange={(v) => updateLine(l.id, { gstRate: Number(v) })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1 text-right font-medium">{inr(l.qty * l.unitPrice)}</td>
                      <td className="px-2 py-1 text-right">
                        <Button size="icon" variant="ghost" onClick={() => removeLine(l.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Payment terms, references..." />
            </div>
            <div className="bg-muted/40 rounded-lg p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{inr(formTotals.subtotal)}</span></div>
              {formTotals.isInterState ? (
                <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>{inr(formTotals.igst)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{inr(formTotals.cgst)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{inr(formTotals.sgst)}</span></div>
                </>
              )}
              <div className="flex justify-between font-semibold border-t pt-2 mt-2 text-base">
                <span>Grand Total</span><span>{inr(formTotals.grandTotal)}</span>
              </div>
              <p className="text-xs text-muted-foreground pt-1">{formTotals.isInterState ? "Inter-state supply (IGST)" : "Intra-state supply (CGST+SGST)"}</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={onSubmit} disabled={editLoading}>
              {editLoading ? "Loading items…" : editing ? "Save changes" : "Create invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          {preview && (() => {
            const t = calcInvoiceTotals(preview);
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Tax Invoice {preview.id}</DialogTitle>
                  <DialogDescription>{preview.customer.name} · {preview.date}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <div className="text-muted-foreground">
                    {preview.customer.address} · {preview.customer.state}
                    {preview.customer.gstin && <> · GSTIN {preview.customer.gstin}</>}
                  </div>
                  {previewLoading
                    ? <p className="text-sm text-muted-foreground py-4 text-center">Loading line items…</p>
                    : <table className="w-full">
                        <thead className="bg-muted/50 text-xs text-muted-foreground">
                          <tr>
                            <th className="text-left p-2">Description</th>
                            <th className="text-right p-2">Qty</th>
                            <th className="text-right p-2">Rate</th>
                            <th className="text-right p-2">GST%</th>
                            <th className="text-right p-2">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.lines.map((l) => (
                            <tr key={l.id} className="border-t">
                              <td className="p-2">{l.description}<div className="text-xs text-muted-foreground">HSN {l.hsn}</div></td>
                              <td className="p-2 text-right">{l.qty}</td>
                              <td className="p-2 text-right">{inr(l.unitPrice)}</td>
                              <td className="p-2 text-right">{l.gstRate}%</td>
                              <td className="p-2 text-right">{inr(l.qty * l.unitPrice)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                  }
                  <div className="flex justify-end">
                    <div className="w-64 space-y-1">
                      <div className="flex justify-between"><span>Subtotal</span><span>{inr(t.subtotal)}</span></div>
                      {t.isInterState
                        ? <div className="flex justify-between"><span>IGST</span><span>{inr(t.igst)}</span></div>
                        : <>
                            <div className="flex justify-between"><span>CGST</span><span>{inr(t.cgst)}</span></div>
                            <div className="flex justify-between"><span>SGST</span><span>{inr(t.sgst)}</span></div>
                          </>
                      }
                      <div className="flex justify-between font-bold border-t pt-1"><span>Grand Total</span><span>{inr(t.grandTotal)}</span></div>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPreview(null)}>Close</Button>
                  <Button onClick={() => downloadPdf(preview)}><FileDown className="h-4 w-4" /> Download PDF</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && <>This will permanently remove <strong>{confirmDelete.id}</strong>.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
