/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeIndianRupee, FileBadge, FileCheck2, FileDown, FilePlus2, Landmark, Pencil, Plus, ReceiptText, RefreshCw, Save, Send, Trash2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { gstinError } from "@/lib/gstin";
import { downloadSalesDocumentPdf } from "@/lib/salesDocumentPdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { StatCard } from "@/components/StatCard";
import { MachineAlertsBanner } from "@/components/MachineAlertsBanner";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";

const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const today = () => new Date().toISOString().slice(0, 10);
const month = () => today().slice(0, 7);
const num = (v: any) => Number(v || 0);
const GST_RATES = ["0", "5", "12", "18", "28"];

const blankLine = (): ApiRow => ({ description: "", hsn_code: "", quantity: "1", unit: "Nos", unit_price: "", gst_rate: "18" });
const blankDoc = (): ApiRow => ({
  document_type: "quotation", customer_name: "", customer_phone: "", customer_email: "", customer_gstin: "",
  customer_state: "Tamil Nadu", customer_address: "", seller_state: "Tamil Nadu", ship_to: "",
  document_date: today(), valid_until: today(), due_date: today(), subject: "", delivery_fee: "0", discount: "0", terms: "",
});

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

function StateBadge({ value }: { value: string }) {
  const s = String(value || "draft").toLowerCase();
  const cls = s.includes("paid") || s.includes("posted") || s.includes("accepted") || s.includes("filed") || s.includes("issued")
    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
    : s.includes("void") || s.includes("reject") || s.includes("cancel")
      ? "bg-red-500/10 text-red-600 border-red-500/30"
      : "bg-amber-500/10 text-amber-600 border-amber-500/30";
  return <Badge variant="outline" className={cls}>{value || "draft"}</Badge>;
}

function DataTable({ columns, rows, empty = "No records found." }: { columns: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <ScrollableX>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground"><tr>{columns.map((c) => <th key={c} className="px-4 py-3 text-left font-medium whitespace-nowrap">{c}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">{empty}</td></tr>}
            {rows.map((r, i) => <tr key={i} className="border-t hover:bg-muted/30">{r.map((c, j) => <td key={j} className="px-4 py-3 align-top whitespace-nowrap">{c}</td>)}</tr>)}
          </tbody>
        </table>
      </ScrollableX>
    </div>
  );
}

export default function SalesBilling() {
  const qc = useQueryClient();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const [period, setPeriod] = useState(month());
  const [payment, setPayment] = useState<ApiRow>({ direction: "in", payment_mode: "Bank Transfer", amount: "", invoice_id: "", po_id: "", user_id: "", vendor_id: "", paid_on: today(), reference_no: "", notes: "" });
  const [salesDoc, setSalesDoc] = useState<ApiRow>(blankDoc());
  const [lines, setLines] = useState<ApiRow[]>([blankLine()]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);
  const [cert, setCert] = useState<ApiRow>({ batch_number: "", product_name: "", customer_name: "", test_date: today(), valid_until: "", status: "draft", notes: "" });
  const [certFile, setCertFile] = useState<File | null>(null);

  const payments = useQuery({ queryKey: ["phase2", "payments"], queryFn: () => phase2Api.payments.list() });
  const ageing = useQuery({ queryKey: ["phase2", "receivables-ageing"], queryFn: () => phase2Api.payments.ageing() });
  const docs = useQuery({ queryKey: ["phase2", "sales-documents"], queryFn: () => phase2Api.salesDocuments.list() });
  const certs = useQuery({ queryKey: ["phase2", "test-certificates"], queryFn: () => phase2Api.testCertificates.list() });
  const gstRows = useQuery({ queryKey: ["phase2", "gst-compliance"], queryFn: () => phase2Api.gstCompliance.list() });
  const gstCalc = useQuery({ queryKey: ["phase2", "gst-calculate", period], queryFn: () => phase2Api.gstCompliance.calculate(period), enabled: !!period });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["phase2"] });
  const run = useMutation({
    mutationFn: async ({ action, payload }: { action: string; payload?: any }) => {
      if (action === "payment") return phase2Api.payments.create(payload);
      if (action === "void") return phase2Api.payments.void(payload.id, payload.reason);
      if (action === "doc") return phase2Api.salesDocuments.create(payload);
      if (action.startsWith("doc:")) return phase2Api.salesDocuments.transition(payload, action.split(":")[1] as any);
      if (action === "cert") return phase2Api.testCertificates.create(payload);
      if (action === "certFile") return phase2Api.testCertificates.uploadDocument(payload.id, payload.file);
      if (action.startsWith("cert:")) return (phase2Api.testCertificates as any)[action.split(":")[1]](payload);
      if (action.startsWith("gst:")) return (phase2Api.gstCompliance as any)[action.split(":")[1]](payload);
    },
    onSuccess: () => { toast.success("Sales/billing action completed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = useMemo(() => {
    const pay = payments.data ?? [];
    const doc = docs.data ?? [];
    const certList = certs.data ?? [];
    const totalIn = pay.filter((p) => p.direction === "in" && p.status !== "void").reduce((s, p) => s + num(p.amount), 0);
    const totalOut = pay.filter((p) => p.direction === "out" && p.status !== "void").reduce((s, p) => s + num(p.amount), 0);
    return {
      collected: totalIn,
      paidOut: totalOut,
      openDocs: doc.filter((d) => !["accepted", "cancelled", "converted", "rejected"].includes(String(d.status))).length,
      certificates: certList.length,
      overdue: num((ageing.data as any)?.totals?.overdue ?? (ageing.data as any)?.overdue_total),
    };
  }, [payments.data, docs.data, certs.data, ageing.data]);

  const postPayment = async () => {
    if (!payment.amount || num(payment.amount) <= 0) return toast.error("Amount is required");
    const payload = { ...payment, amount: num(payment.amount), invoice_id: num(payment.invoice_id) || undefined, po_id: num(payment.po_id) || undefined, user_id: num(payment.user_id) || undefined, vendor_id: num(payment.vendor_id) || undefined };
    await run.mutateAsync({ action: "payment", payload });
    setPaymentOpen(false);
  };

  // ── Document line-item editor helpers ──────────────────────────────────────
  const setLine = (i: number, patch: ApiRow) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const openCreate = () => { setEditingId(null); setSalesDoc(blankDoc()); setLines([blankLine()]); setDocOpen(true); };
  const openEdit = async (d: ApiRow) => {
    try {
      const full = await phase2Api.salesDocuments.get(d.document_id);
      setEditingId(d.document_id);
      setSalesDoc({
        document_type: full.document_type, customer_name: full.customer_name ?? "", customer_phone: full.customer_phone ?? "",
        customer_email: full.customer_email ?? "", customer_gstin: full.customer_gstin ?? "", customer_state: full.customer_state ?? "Tamil Nadu",
        customer_address: full.customer_address ?? "", seller_state: full.seller_state ?? "Tamil Nadu", ship_to: full.ship_to ?? "",
        document_date: (full.document_date ?? today()).slice(0, 10), valid_until: (full.valid_until ?? today()).slice(0, 10),
        due_date: (full.due_date ?? today()).slice(0, 10), subject: full.subject ?? "",
        delivery_fee: String(full.delivery_fee ?? 0), discount: String(full.discount ?? 0), terms: full.terms ?? "",
      });
      setLines((full.items ?? []).length
        ? full.items.map((it: ApiRow) => ({ description: it.description ?? "", hsn_code: it.hsn_code ?? "", quantity: String(it.quantity ?? 1), unit: it.unit ?? "Nos", unit_price: String(it.unit_price ?? 0), gst_rate: String(it.gst_rate ?? 18) }))
        : [blankLine()]);
      setDocOpen(true);
    } catch (e: any) { toast.error(e.message); }
  };

  const buildItems = () =>
    lines
      .filter((l) => String(l.description ?? "").trim())
      .map((l) => ({ description: l.description, hsn_code: l.hsn_code || undefined, quantity: num(l.quantity), unit: l.unit || "Nos", unit_price: num(l.unit_price), gst_rate: num(l.gst_rate) }));

  const saveDocument = async () => {
    if (!salesDoc.customer_name?.trim()) return toast.error("Customer name is required");
    const items = buildItems();
    if (items.length === 0) return toast.error("Add at least one line item with a description");
    if (items.some((it) => it.quantity <= 0 || it.unit_price < 0)) return toast.error("Each line needs a quantity > 0 and a non-negative price");
    const gerr = gstinError(String(salesDoc.customer_gstin ?? ""));
    if (gerr) return toast.error(gerr);
    const payload: ApiRow = { ...salesDoc, delivery_fee: num(salesDoc.delivery_fee), discount: num(salesDoc.discount), items };
    setSavingDoc(true);
    try {
      if (editingId) await phase2Api.salesDocuments.update(editingId, payload);
      else await phase2Api.salesDocuments.create(payload);
      toast.success(editingId ? "Document updated" : "Document created");
      invalidate();
      setDocOpen(false);
    } catch (e: any) { toast.error(e.message); }
    finally { setSavingDoc(false); }
  };

  const downloadPdf = async (d: ApiRow) => {
    try {
      const full = await phase2Api.salesDocuments.get(d.document_id);
      downloadSalesDocumentPdf(full);
    } catch (e: any) { toast.error(e.message); }
  };

  const createCertificate = async () => {
    if (!cert.batch_number?.trim() && !cert.product_name?.trim()) return toast.error("Batch number or product name is required");
    const created: any = await run.mutateAsync({
      action: "cert",
      payload: {
        batch_no: cert.batch_number,
        certificate_type: "quality",
        sample_date: cert.test_date,
        issue_date: cert.test_date,
        result_summary: cert.notes,
        parameters: {
          product_name: cert.product_name,
          customer_name: cert.customer_name,
          valid_until: cert.valid_until,
        },
      },
    });
    const id = created?.certificate_id || created?.test_certificate_id || created?.id;
    if (id && certFile) await run.mutateAsync({ action: "certFile", payload: { id, file: certFile } });
    setCertFile(null);
    setCertOpen(false);
  };

  const gstAction = async (action: "save" | "review" | "file" | "lock") => {
    if (!period) return toast.error("GST period is required");
    await (phase2Api.gstCompliance as any)[action](period, action === "save" ? gstCalc.data : undefined);
    toast.success(`GST ${action} completed`);
    invalidate();
  };

  return (
    <div className="space-y-6">
      <MachineAlertsBanner />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">GST Compliance</h1>
          <p className="text-muted-foreground">GST output/input tax, net payable, and return filing status.</p>
        </div>
        <Button variant="outline" onClick={() => invalidate()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      <Tabs defaultValue="gst" className="space-y-4">
        {/* Non-GST sections (payments, documents, certificates) hidden — GST Compliance only. */}
        <TabsContent value="payments" className="space-y-4">
          <div className="flex justify-end"><Button onClick={() => setPaymentOpen(true)}><Plus className="h-4 w-4" /> Post Payment</Button></div>
          <DataTable
            columns={["No", "Date", "Direction", "Mode", "Amount", "Target", "Reference", "Status", "Actions"]}
            rows={(payments.data ?? []).map((p) => [
              <span className="font-medium">{p.payment_number}</span>,
              p.paid_on || p.payment_date,
              p.direction,
              p.payment_mode,
              inr(p.amount),
              p.invoice_number || p.po_number || p.customer_name || p.vendor_name || "—",
              p.reference_no || p.reference_number || "—",
              <StateBadge value={p.status} />,
              p.status === "posted" ? <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "void", payload: { id: p.payment_id, reason: "Admin void from dashboard" } })}>Void</Button> : "—",
            ])}
          />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <div className="flex justify-end"><Button onClick={openCreate}><Plus className="h-4 w-4" /> New Document</Button></div>
          <DataTable
            columns={["Document", "Type", "Customer", "Date", "Valid/Due", "Total", "Status", "Actions"]}
            rows={(docs.data ?? []).map((d) => [
              <span className="font-medium">{d.document_number}{d.converted_document_number ? <div className="text-xs text-muted-foreground">→ {d.invoice_number || d.converted_document_number}</div> : null}</span>,
              d.document_type,
              <div>{d.customer_name}<div className="text-xs text-muted-foreground">{d.customer_phone || d.customer_email || ""}</div></div>,
              d.document_date,
              d.valid_until || d.due_date || "—",
              inr(d.total),
              <StateBadge value={d.status} />,
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadPdf(d)}><FileDown className="h-3 w-3" /> PDF</Button>
                {["draft", "sent"].includes(d.status) && <Button size="sm" variant="outline" onClick={() => openEdit(d)}><Pencil className="h-3 w-3" /> Edit</Button>}
                {d.status === "draft" && <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "doc:send", payload: d.document_id })}><Send className="h-3 w-3" /> Send</Button>}
                {["draft", "sent"].includes(d.status) && <Button size="sm" onClick={() => run.mutate({ action: "doc:accept", payload: d.document_id })}>Accept</Button>}
                {["draft", "sent"].includes(d.status) && <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "doc:reject", payload: d.document_id })}><XCircle className="h-3 w-3" /> Reject</Button>}
                {["sent", "accepted"].includes(d.status) && !d.converted_document_id && !d.invoice_id && <Button size="sm" variant="outline" onClick={() => run.mutate({ action: "doc:convert", payload: d.document_id })}>{d.document_type === "quotation" ? "→ Proforma" : "→ Invoice"}</Button>}
                {["draft", "sent", "accepted", "rejected", "expired"].includes(d.status) && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => run.mutate({ action: "doc:cancel", payload: d.document_id })}><X className="h-3 w-3" /> Cancel</Button>}
              </div>,
            ])}
          />
        </TabsContent>

        <TabsContent value="certificates" className="space-y-4">
          <div className="flex justify-end"><Button onClick={() => setCertOpen(true)}><Plus className="h-4 w-4" /> New Certificate</Button></div>
          <DataTable
            columns={["Certificate", "Batch", "Product", "Customer", "Test Date", "Validity", "Status", "Actions"]}
            rows={(certs.data ?? []).map((c) => [
              <span className="font-medium">{c.certificate_number || c.test_certificate_id || c.certificate_id}</span>,
              c.batch_no || c.batch_number || "—",
              c.product_name || c.parameters?.product_name || c.product_id || "—",
              c.customer_name || c.parameters?.customer_name || "—",
              c.sample_date || c.issue_date || "—",
              c.parameters?.valid_until || "—",
              <StateBadge value={c.status} />,
              <div className="flex gap-2">
                {c.status === "draft" && <Button size="sm" onClick={() => run.mutate({ action: "cert:issue", payload: c.test_certificate_id || c.certificate_id })}><FileCheck2 className="h-3 w-3" /> Issue</Button>}
                <Button size="sm" variant="outline" onClick={() => phase2Api.testCertificates.download(c.test_certificate_id || c.certificate_id).catch((e) => toast.error(e.message))}>Download</Button>
              </div>,
            ])}
          />
        </TabsContent>

        <TabsContent value="gst" className="space-y-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <Field label="GST Period"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
            <Button variant="outline" onClick={() => gstCalc.refetch()}>Calculate</Button>
            <Button onClick={() => gstAction("save")}><Save className="h-4 w-4" /> Save</Button>
            <Button variant="outline" onClick={() => gstAction("review")}>Review</Button>
            <Button variant="outline" onClick={() => gstAction("file")}>Mark Filed</Button>
            <Button variant="outline" onClick={() => phase2Api.gstCompliance.export(period).catch((e) => toast.error(e.message))}>Export</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard title="Output GST" value={inr((gstCalc.data as any)?.output_gst)} subtitle="sales tax" icon={ReceiptText} />
            <StatCard title="Input GST" value={inr((gstCalc.data as any)?.input_gst)} subtitle="purchase tax" icon={Landmark} />
            <StatCard title="Net Payable" value={inr((gstCalc.data as any)?.net_payable)} subtitle={period} icon={BadgeIndianRupee} />
            <StatCard title="Exceptions" value={String((gstCalc.data as any)?.exceptions?.length ?? 0)} subtitle="needs review" icon={FileBadge} />
          </div>
          <DataTable
            columns={["Period", "Output", "Input", "Net", "Status", "Reviewed", "Filed"]}
            rows={(Array.isArray(gstRows.data) ? gstRows.data : []).map((g) => [
              g.period,
              inr(g.output_gst),
              inr(g.input_gst),
              inr(g.net_payable),
              <StateBadge value={g.status} />,
              g.reviewed_at || "—",
              g.filed_at || "—",
            ])}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Post Payment</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Direction"><Select value={payment.direction} onValueChange={(v) => setPayment({ ...payment, direction: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in">In</SelectItem><SelectItem value="out">Out</SelectItem></SelectContent></Select></Field>
            <Field label="Mode"><Select value={payment.payment_mode} onValueChange={(v) => setPayment({ ...payment, payment_mode: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Cash", "Bank Transfer", "UPI", "Cheque", "Card"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Amount"><Input type="number" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></Field>
            <Field label="Date"><Input type="date" value={payment.paid_on} onChange={(e) => setPayment({ ...payment, paid_on: e.target.value })} /></Field>
            <Field label="Invoice ID"><Input value={payment.invoice_id} onChange={(e) => setPayment({ ...payment, invoice_id: e.target.value })} /></Field>
            <Field label="PO ID"><Input value={payment.po_id} onChange={(e) => setPayment({ ...payment, po_id: e.target.value })} /></Field>
            <Field label="Customer/User ID"><Input value={payment.user_id} onChange={(e) => setPayment({ ...payment, user_id: e.target.value })} /></Field>
            <Field label="Vendor ID"><Input value={payment.vendor_id} onChange={(e) => setPayment({ ...payment, vendor_id: e.target.value })} /></Field>
          </div>
          <Field label="Reference / Notes"><Input value={payment.reference_no} onChange={(e) => setPayment({ ...payment, reference_no: e.target.value })} placeholder="UTR, cheque no, receipt ref" /></Field>
          <div className="flex justify-end"><Button onClick={postPayment}>Post Payment</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={docOpen} onOpenChange={setDocOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit" : "Create"} Quotation / Proforma</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Type"><Select value={salesDoc.document_type} onValueChange={(v) => setSalesDoc({ ...salesDoc, document_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="quotation">Quotation</SelectItem><SelectItem value="proforma">Proforma</SelectItem></SelectContent></Select></Field>
            <Field label="Customer"><Input value={salesDoc.customer_name} onChange={(e) => setSalesDoc({ ...salesDoc, customer_name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={salesDoc.customer_phone} onChange={(e) => setSalesDoc({ ...salesDoc, customer_phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={salesDoc.customer_email} onChange={(e) => setSalesDoc({ ...salesDoc, customer_email: e.target.value })} /></Field>
            <Field label="GSTIN"><Input value={salesDoc.customer_gstin} onChange={(e) => setSalesDoc({ ...salesDoc, customer_gstin: e.target.value })} /></Field>
            <Field label="State"><Input value={salesDoc.customer_state} onChange={(e) => setSalesDoc({ ...salesDoc, customer_state: e.target.value })} /></Field>
            <Field label="Seller state"><Input value={salesDoc.seller_state} onChange={(e) => setSalesDoc({ ...salesDoc, seller_state: e.target.value })} /></Field>
            <Field label="Subject"><Input value={salesDoc.subject} onChange={(e) => setSalesDoc({ ...salesDoc, subject: e.target.value })} /></Field>
            <Field label="Document date"><Input type="date" value={salesDoc.document_date} onChange={(e) => setSalesDoc({ ...salesDoc, document_date: e.target.value })} /></Field>
            <Field label="Valid until"><Input type="date" value={salesDoc.valid_until} onChange={(e) => setSalesDoc({ ...salesDoc, valid_until: e.target.value })} /></Field>
            <Field label="Due date"><Input type="date" value={salesDoc.due_date} onChange={(e) => setSalesDoc({ ...salesDoc, due_date: e.target.value })} /></Field>
          </div>
          <Field label="Customer address"><Textarea rows={2} value={salesDoc.customer_address} onChange={(e) => setSalesDoc({ ...salesDoc, customer_address: e.target.value })} /></Field>

          {/* Line items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label className="text-xs font-semibold">Line items</Label><Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3 w-3" /> Add line</Button></div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const lineTotal = num(l.quantity) * num(l.unit_price);
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end rounded-lg border p-2">
                    <div className="col-span-12 md:col-span-4"><Label className="text-[10px] text-muted-foreground">Description</Label><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Item / description" /></div>
                    <div className="col-span-4 md:col-span-1"><Label className="text-[10px] text-muted-foreground">HSN</Label><Input value={l.hsn_code} onChange={(e) => setLine(i, { hsn_code: e.target.value })} /></div>
                    <div className="col-span-4 md:col-span-1"><Label className="text-[10px] text-muted-foreground">Qty</Label><Input type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></div>
                    <div className="col-span-4 md:col-span-1"><Label className="text-[10px] text-muted-foreground">Unit</Label><Input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></div>
                    <div className="col-span-4 md:col-span-2"><Label className="text-[10px] text-muted-foreground">Unit price</Label><Input type="number" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></div>
                    <div className="col-span-4 md:col-span-1"><Label className="text-[10px] text-muted-foreground">GST %</Label><Select value={String(l.gst_rate)} onValueChange={(v) => setLine(i, { gst_rate: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{GST_RATES.map((r) => <SelectItem key={r} value={r}>{r}%</SelectItem>)}</SelectContent></Select></div>
                    <div className="col-span-3 md:col-span-1 text-right text-sm font-medium pb-2">{inr(lineTotal)}</div>
                    <div className="col-span-1 flex justify-end pb-1"><Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => removeLine(i)} disabled={lines.length === 1}><Trash2 className="h-4 w-4" /></Button></div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Delivery fee"><Input type="number" value={salesDoc.delivery_fee} onChange={(e) => setSalesDoc({ ...salesDoc, delivery_fee: e.target.value })} /></Field>
            <Field label="Discount"><Input type="number" value={salesDoc.discount} onChange={(e) => setSalesDoc({ ...salesDoc, discount: e.target.value })} /></Field>
            <Field label="Ship to"><Input value={salesDoc.ship_to} onChange={(e) => setSalesDoc({ ...salesDoc, ship_to: e.target.value })} /></Field>
          </div>
          <Field label="Terms"><Textarea value={salesDoc.terms} onChange={(e) => setSalesDoc({ ...salesDoc, terms: e.target.value })} /></Field>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Subtotal: <span className="font-semibold text-foreground">{inr(lines.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0))}</span> <span className="text-xs">(GST &amp; totals finalised on save)</span></span>
            <Button onClick={saveDocument} disabled={savingDoc}><Save className="h-4 w-4" /> {savingDoc ? "Saving…" : editingId ? "Save Changes" : "Create Document"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={certOpen} onOpenChange={setCertOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Create Test Certificate</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Batch number"><Input value={cert.batch_number} onChange={(e) => setCert({ ...cert, batch_number: e.target.value })} /></Field>
            <Field label="Product"><Input value={cert.product_name} onChange={(e) => setCert({ ...cert, product_name: e.target.value })} /></Field>
            <Field label="Customer"><Input value={cert.customer_name} onChange={(e) => setCert({ ...cert, customer_name: e.target.value })} /></Field>
            <Field label="Test date"><Input type="date" value={cert.test_date} onChange={(e) => setCert({ ...cert, test_date: e.target.value })} /></Field>
            <Field label="Valid until"><Input type="date" value={cert.valid_until} onChange={(e) => setCert({ ...cert, valid_until: e.target.value })} /></Field>
            <Field label="Document upload"><Input type="file" accept=".pdf,image/*" onChange={(e) => setCertFile(e.target.files?.[0] ?? null)} /></Field>
          </div>
          <Field label="Notes"><Textarea value={cert.notes} onChange={(e) => setCert({ ...cert, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={createCertificate}>Create Certificate</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
