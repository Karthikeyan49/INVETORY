/**
 * Daily Call Report (R13 / T11), form code F-SVS-01. Field-sales visit reports
 * with a header (employee / date / area / KM) and visit lines. Approving a
 * report seeds follow-ups (leads) from prospect lines, connecting field visits
 * → leads. The report can be downloaded as the F-SVS-01 PDF.
 */
import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Plus, Trash2, FileDown, CheckCircle2, ClipboardList, Eye, FileUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  fetchDcrs, fetchDcrAreas, createDcr, approveDcr, deleteDcr, getDcr, extractDcrFromPdf,
  type Dcr, type DcrLine, type DcrInput,
} from "@/lib/api/dcr";
import { downloadDcrPdf } from "@/lib/dcrPdf";
import { employeesApi, type Employee } from "@/lib/api/hr";

const today = () => new Date().toISOString().slice(0, 10);
const blankLine = (): DcrLine => ({
  customer: "", address: "", mobile: "", model: "", cust_status: "new", cust_type: "customer",
  category: "", stamping: "", service: "", payment: "", remarks: "", staff_sign: "",
});

const emptyForm = { employee_id: "", employee_name: "", report_date: today(), area: "", opening_km: "", closing_km: "", notes: "" };
type FormState = typeof emptyForm;

export default function Dcr() {
  const [rows, setRows] = useState<Dcr[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [locations, setLocations] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [lines, setLines] = useState<DcrLine[]>([blankLine()]);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [detail, setDetail] = useState<Dcr | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchDcrs({
        status: statusFilter === "all" ? "" : statusFilter,
        area: locationFilter === "all" ? "" : locationFilter,
        search,
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load DCRs");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, locationFilter, search]);

  // statusFilter / locationFilter changes load immediately; search is debounced
  // so we don't fire a request on every keystroke.
  useEffect(() => { load(); }, [statusFilter, locationFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => { employeesApi.list().then(setEmployees).catch(() => {}); }, []);
  // Load distinct locations for the filter; refresh after a save so newly-used areas appear.
  const loadLocations = useCallback(() => { fetchDcrAreas().then(setLocations).catch(() => {}); }, []);
  useEffect(() => { loadLocations(); }, [loadLocations]);

  function openAdd() {
    setForm(emptyForm);
    setLines([blankLine()]);
    setDialogOpen(true);
  }

  const totalKm = (() => {
    const o = Number(form.opening_km) || 0, c = Number(form.closing_km) || 0;
    return c > o ? (c - o).toFixed(1) : "0.0";
  })();

  function setLine(idx: number, patch: Partial<DcrLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  // Upload a DCR PDF → auto-extract header + visit lines and pre-fill the form.
  // The manual path is untouched: this only populates the same fields the user
  // then reviews / edits and saves via the normal create flow.
  async function handleExtractPdf(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please choose a PDF file");
      return;
    }
    setExtracting(true);
    const tid = toast.loading("Extracting DCR from PDF…");
    try {
      const { header, lines: extLines } = await extractDcrFromPdf(file);
      const empName = header.employee_name?.trim() || "";
      const matched = empName
        ? employees.find((x) => (x.name ?? "").trim().toLowerCase() === empName.toLowerCase())
        : undefined;
      setForm((f) => ({
        ...f,
        employee_name: empName || f.employee_name,
        employee_id: matched ? String(matched.employee_id ?? matched.id) : f.employee_id,
        report_date: header.report_date || f.report_date,
        area: (header.area ?? "").trim() || f.area,
        opening_km: header.opening_km ? String(header.opening_km) : f.opening_km,
        closing_km: header.closing_km ? String(header.closing_km) : f.closing_km,
        notes: (header.notes ?? "").trim() || f.notes,
      }));
      const mapped: DcrLine[] = (extLines ?? [])
        .map((l) => ({
          ...blankLine(),
          customer: (l.customer ?? "").toString(),
          address: (l.address ?? "").toString(),
          mobile: (l.mobile ?? "").toString(),
          model: (l.model ?? "").toString(),
          cust_status: (l.cust_status || "new").toString(),
          cust_type: (l.cust_type || "customer").toString(),
          category: (l.category ?? "").toString(),
          stamping: (l.stamping ?? "").toString(),
          service: (l.service ?? "").toString(),
          payment: (l.payment ?? "").toString(),
          remarks: (l.remarks ?? "").toString(),
          staff_sign: (l.staff_sign ?? "").toString(),
        }))
        .filter((l) => l.customer.trim() || (l.mobile ?? "").trim());
      setLines(mapped.length ? mapped : [blankLine()]);
      toast.success(`Imported ${mapped.length} visit line(s) — review and Save`, { id: tid });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not extract PDF", { id: tid });
    } finally {
      setExtracting(false);
    }
  }

  async function handleSave() {
    if (!form.employee_name.trim()) { toast.error("Employee name is required"); return; }
    const clean = lines.filter((l) => l.customer.trim() || (l.mobile ?? "").trim());
    if (!clean.length) { toast.error("Add at least one visit line"); return; }
    setSaving(true);
    const payload: DcrInput = {
      employee_id: form.employee_id ? Number(form.employee_id) : null,
      employee_name: form.employee_name.trim(),
      report_date: form.report_date,
      area: form.area.trim() || undefined,
      opening_km: Number(form.opening_km) || 0,
      closing_km: Number(form.closing_km) || 0,
      notes: form.notes.trim() || undefined,
      lines: clean,
    };
    try {
      await createDcr(payload);
      toast.success("Daily Call Report saved");
      setDialogOpen(false);
      load();
      loadLocations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save report");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(d: Dcr) {
    try {
      const res = await approveDcr(d.id);
      toast.success(res.leads_seeded > 0 ? `Approved — ${res.leads_seeded} lead(s) created` : "Approved");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve");
    }
  }

  async function handleDelete(d: Dcr) {
    if (!confirm(`Delete ${d.dcr_no}?`)) return;
    try { await deleteDcr(d.id); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  async function openDetail(d: Dcr) {
    try { setDetail(await getDcr(d.id)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not open"); }
  }

  const onEmployee = (v: string) => {
    const emp = employees.find((e) => String(e.employee_id ?? e.id) === v);
    setForm((f) => ({ ...f, employee_id: v, employee_name: emp?.name || f.employee_name }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" /> Daily Call Report</h1>
          <p className="text-muted-foreground text-sm mt-1">Field-visit reports (F-SVS-01). Approving seeds leads from prospect visits.</p>
        </div>
        <Button onClick={openAdd} className="gap-1"><Plus className="h-4 w-4" /> New DCR</Button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Input placeholder="Search employee / area / no" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="submitted">Submitted</SelectItem><SelectItem value="approved">Approved</SelectItem></SelectContent>
        </Select>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Location" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((loc) => <SelectItem key={loc} value={loc}>{loc}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-2 py-2">DCR No</th><th className="px-2 py-2">Employee</th><th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Area</th><th className="px-2 py-2">Total KM</th><th className="px-2 py-2">Visits</th>
              <th className="px-2 py-2">Status</th><th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-4 text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-muted-foreground">No reports yet.</td></tr>
            ) : rows.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="px-2 py-2 font-medium">{d.dcr_no}</td>
                <td className="px-2 py-2">{d.employee_name}</td>
                <td className="px-2 py-2">{d.report_date}</td>
                <td className="px-2 py-2">{d.area || "—"}</td>
                <td className="px-2 py-2">{d.total_km}</td>
                <td className="px-2 py-2">{d.line_count ?? d.lines?.length ?? 0}</td>
                <td className="px-2 py-2"><span className={`text-xs px-2 py-0.5 rounded ${d.status === "approved" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{d.status}</span></td>
                <td className="px-2 py-2">
                  <div className="flex gap-2 items-center">
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => openDetail(d)} title="View"><Eye className="h-4 w-4" /></button>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => getDcr(d.id).then(downloadDcrPdf)} title="PDF"><FileDown className="h-4 w-4" /></button>
                    {d.status === "submitted" && <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleApprove(d)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve</Button>}
                    <button className="text-red-500 hover:text-red-700" onClick={() => handleDelete(d)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[96vw] max-w-7xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Daily Call Report</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Have the printed DCR? Upload the PDF to auto-fill the header and visit lines — then review and Save.
            </p>
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={handleExtractPdf}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1 shrink-0"
              disabled={extracting}
              onClick={() => pdfInputRef.current?.click()}
            >
              <FileUp className="h-4 w-4" /> {extracting ? "Extracting…" : "Upload DCR PDF"}
            </Button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Employee</label>
                <Select value={form.employee_id} onValueChange={onEmployee}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={String(e.employee_id ?? e.id)} value={String(e.employee_id ?? e.id)}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Employee name *</label>
                <Input value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Date</label>
                <Input type="date" value={form.report_date} onChange={(e) => setForm({ ...form, report_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Area</label>
                <Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Opening KM</label>
                <Input type="number" value={form.opening_km} onChange={(e) => setForm({ ...form, opening_km: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Closing KM</label>
                <Input type="number" value={form.closing_km} onChange={(e) => setForm({ ...form, closing_km: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Total KM</label>
                <Input value={totalKm} disabled />
              </div>
            </div>

            {/* Visit lines */}
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-1.5">Customer</th><th className="p-1.5">Address</th><th className="p-1.5">Mobile</th>
                    <th className="p-1.5">Model</th><th className="p-1.5">Status</th><th className="p-1.5">Type</th>
                    <th className="p-1.5">Category</th><th className="p-1.5">Stamping</th><th className="p-1.5">Service</th>
                    <th className="p-1.5">Payment</th><th className="p-1.5">Remarks</th><th className="p-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-1"><Input className="h-8 min-w-28" value={l.customer} onChange={(e) => setLine(idx, { customer: e.target.value })} /></td>
                      <td className="p-1"><Input className="h-8 min-w-28" value={l.address ?? ""} onChange={(e) => setLine(idx, { address: e.target.value })} /></td>
                      <td className="p-1"><Input className="h-8 min-w-24" value={l.mobile ?? ""} onChange={(e) => setLine(idx, { mobile: e.target.value })} /></td>
                      <td className="p-1"><Input className="h-8 min-w-20" value={l.model ?? ""} onChange={(e) => setLine(idx, { model: e.target.value })} /></td>
                      <td className="p-1">
                        <select className="h-8 rounded border border-input bg-background px-1" value={l.cust_status ?? "new"} onChange={(e) => setLine(idx, { cust_status: e.target.value })}>
                          <option value="new">new</option><option value="existing">existing</option>
                        </select>
                      </td>
                      <td className="p-1">
                        <select className="h-8 rounded border border-input bg-background px-1" value={l.cust_type ?? "customer"} onChange={(e) => setLine(idx, { cust_type: e.target.value })}>
                          <option value="customer">customer</option><option value="prospect">prospect</option>
                        </select>
                      </td>
                      <td className="p-1"><Input className="h-8 min-w-20" value={l.category ?? ""} onChange={(e) => setLine(idx, { category: e.target.value })} /></td>
                      <td className="p-1"><Input className="h-8 min-w-16" value={l.stamping ?? ""} onChange={(e) => setLine(idx, { stamping: e.target.value })} /></td>
                      <td className="p-1"><Input className="h-8 min-w-16" value={l.service ?? ""} onChange={(e) => setLine(idx, { service: e.target.value })} /></td>
                      <td className="p-1"><Input className="h-8 min-w-16" value={l.payment ?? ""} onChange={(e) => setLine(idx, { payment: e.target.value })} /></td>
                      <td className="p-1"><Input className="h-8 min-w-24" value={l.remarks ?? ""} onChange={(e) => setLine(idx, { remarks: e.target.value })} /></td>
                      <td className="p-1"><button className="text-red-500 hover:text-red-700" onClick={() => setLines(lines.length > 1 ? lines.filter((_, i) => i !== idx) : [blankLine()])}><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setLines([...lines, blankLine()])}><Plus className="h-3 w-3" /> Add visit</Button>
            <p className="text-xs text-muted-foreground">Prospect visits become leads (follow-ups) when the report is approved.</p>

            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader><DialogTitle>{detail.dcr_no} · {detail.employee_name}</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div><span className="text-muted-foreground">Date:</span> {detail.report_date}</div>
                  <div><span className="text-muted-foreground">Area:</span> {detail.area || "—"}</div>
                  <div><span className="text-muted-foreground">Total KM:</span> {detail.total_km}</div>
                  <div><span className="text-muted-foreground">Status:</span> {detail.status}</div>
                </div>
                <div className="border rounded overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-left"><tr>
                      <th className="p-1.5">#</th><th className="p-1.5">Customer</th><th className="p-1.5">Mobile</th><th className="p-1.5">Model</th>
                      <th className="p-1.5">Type</th><th className="p-1.5">Category</th><th className="p-1.5">Remarks</th><th className="p-1.5">Lead</th>
                    </tr></thead>
                    <tbody>
                      {(detail.lines ?? []).map((l, i) => (
                        <tr key={l.id ?? i} className="border-t">
                          <td className="p-1.5">{i + 1}</td>
                          <td className="p-1.5">{l.customer}</td>
                          <td className="p-1.5">{l.mobile || "—"}</td>
                          <td className="p-1.5">{l.model || "—"}</td>
                          <td className="p-1.5">{l.cust_type || "—"}</td>
                          <td className="p-1.5">{l.category || "—"}</td>
                          <td className="p-1.5">{l.remarks || "—"}</td>
                          <td className="p-1.5">{l.followup_id ? <span className="text-green-700">✓</span> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => downloadDcrPdf(detail)}><FileDown className="h-4 w-4" /> Download PDF</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
