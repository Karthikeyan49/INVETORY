import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Pencil, Trash2, Upload, Wallet, Receipt, TrendingUp, Layers, Camera, ImageIcon, Sparkles, Loader2, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import {
  EXPENSE_CATEGORIES, expensesApi, type Expense, type ExpensePagination, type ExpenseSummary,
} from "@/lib/api/expenses";
import { extractBillData } from "@/lib/api/billExtract";
import { apiFetch } from "@/lib/api/client";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { ScrollableX } from "@/components/ui/scrollable-x";

const PAYMENT_MODES: Expense["paymentMode"][] = ["Cash", "Bank Transfer", "UPI", "Cheque", "Card"];
const OTHER = "Other" as const;
const PAGE_SIZE = 200;

const expenseSchema = z.object({
  date: z.string().min(1, "Date is required"),
  category: z.string().trim().min(2, "Category required").max(60),
  vendor: z.string().trim().min(2, "Vendor required").max(120),
  description: z.string().trim().max(300).optional().default(""),
  amount: z.number().positive("Amount must be > 0").max(10_000_000),
  paymentMode: z.enum(["Cash", "Bank Transfer", "UPI", "Cheque", "Card"]),
  billUrl: z.string().optional(),
});

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const CHART_COLORS = [
  "hsl(200,70%,52%)", "hsl(210,70%,55%)", "hsl(30,90%,52%)", "hsl(280,55%,52%)",
  "hsl(45,90%,50%)", "hsl(0,72%,51%)", "hsl(240,60%,55%)", "hsl(170,55%,42%)",
  "hsl(330,60%,55%)", "hsl(190,65%,45%)", "hsl(120,40%,45%)",
];

interface FormState {
  date: string;
  category: string;          // any string (preset OR custom from "Other")
  categoryChoice: string;    // dropdown value: a preset OR "Other"
  vendor: string;
  description: string;
  amount: string;
  paymentMode: Expense["paymentMode"];
  billUrl?: string;
}

const emptyForm = (): FormState => ({
  date: new Date().toISOString().slice(0, 10),
  category: "Office Stationery",
  categoryChoice: "Office Stationery",
  vendor: "",
  description: "",
  amount: "",
  paymentMode: "Bank Transfer",
  billUrl: undefined,
});

export default function Expenses() {
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [pagination, setPagination] = useState<ExpensePagination | null>(null);
  const [dbSummary, setDbSummary] = useState<ExpenseSummary | null>(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);

  const mergeById = (current: Expense[], next: Expense[]) => {
    const map = new Map(current.map((expense) => [expense.id, expense]));
    next.forEach((expense) => map.set(expense.id, expense));
    return Array.from(map.values());
  };

  const listParams = (page: number) => ({
    page,
    limit: PAGE_SIZE,
    search: search.trim() || undefined,
    category: filterCategory !== "all" ? filterCategory : undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    minAmount: minAmt ? Number(minAmt) : undefined,
    maxAmount: maxAmt ? Number(maxAmt) : undefined,
  });

  const load = async (page = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = listParams(page);
      const [result, summaryResult] = append
        ? [await expensesApi.list(params), null]
        : await Promise.all([expensesApi.list(params), expensesApi.summary(params)]);
      setItems((prev) => append ? mergeById(prev, result.items) : result.items);
      setPagination(result.pagination);
      if (summaryResult) setDbSummary(summaryResult);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  };
  useEffect(() => { load(); }, [search, filterCategory, fromDate, toDate, minAmt, maxAmt]);

  const hasMore = pagination ? pagination.page < pagination.total_pages : false;
  const loadedCount = items.length;

  const loadMore = () => {
    if (!pagination || loadingMore || loadingAll || !hasMore) return;
    load(pagination.page + 1, true);
  };

  const loadAll = async () => {
    if (!pagination || loadingMore || loadingAll || !hasMore) return;
    setLoadingAll(true);
    try {
      let all = items;
      let latest = pagination;
      for (let page = pagination.page + 1; page <= pagination.total_pages; page += 1) {
        const result = await expensesApi.list(listParams(page));
        all = mergeById(all, result.items);
        latest = result.pagination;
      }
      setItems(all);
      setPagination(latest);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingAll(false);
    }
  };

  const availableCategories = useMemo(() => {
    return Array.from(new Set<string>([
      ...EXPENSE_CATEGORIES,
      ...items.map((expense) => expense.category).filter(Boolean),
    ])).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((e) => {
      if (filterCategory !== "all" && e.category !== filterCategory) return false;
      if (fromDate && e.date < fromDate) return false;
      if (toDate && e.date > toDate) return false;
      if (minAmt && e.amount < Number(minAmt)) return false;
      if (maxAmt && e.amount > Number(maxAmt)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.vendor.toLowerCase().includes(q) &&
            !e.description.toLowerCase().includes(q) &&
            !e.id.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, filterCategory, fromDate, toDate, minAmt, maxAmt, search]);

  const summary = useMemo(() => {
    const total = filtered.reduce((s, e) => s + e.amount, 0);
    const byCat = new Map<string, number>();
    filtered.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount));
    const pieData = Array.from(byCat, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const byMonth = new Map<string, number>();
    filtered.forEach((e) => {
      const m = e.date.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + e.amount);
    });
    const barData = Array.from(byMonth, ([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const top = pieData[0];
    return { total, count: filtered.length, pieData, barData, topCategory: top };
  }, [filtered]);

  const topSummary = useMemo(() => {
    if (!dbSummary) {
      return {
        total: summary.total,
        count: summary.count,
        categoryCount: new Set(filtered.map((e) => e.category)).size,
        topCategory: summary.topCategory,
        average: summary.count ? summary.total / summary.count : 0,
      };
    }

    return {
      total: dbSummary.total,
      count: dbSummary.count,
      categoryCount: dbSummary.category_count,
      topCategory: dbSummary.top_category
        ? { name: dbSummary.top_category.name, value: dbSummary.top_category.value }
        : undefined,
      average: dbSummary.average,
    };
  }, [dbSummary, filtered, summary]);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (e: Expense) => {
    setEditing(e);
    const isPreset = (EXPENSE_CATEGORIES as readonly string[]).includes(e.category);
    setForm({
      date: e.date,
      category: e.category,
      categoryChoice: isPreset ? e.category : OTHER,
      vendor: e.vendor,
      description: e.description,
      amount: String(e.amount),
      paymentMode: e.paymentMode,
      billUrl: e.billUrl,
    });
    setDialogOpen(true);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.error("File must be under 5MB"); return; }
    if (!/^(image\/|application\/pdf)/.test(f.type)) { toast.error("Only images or PDF allowed"); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((prev) => ({ ...prev, billUrl: reader.result as string }));
    reader.readAsDataURL(f);
  };

  const autoFillFromBill = async () => {
    if (!form.billUrl) { toast.error("Upload a bill first"); return; }
    setExtracting(true);
    try {
      const extracted = await extractBillData(form.billUrl);

      // If AI category matches a preset → select it directly
      // If not → select "Other" and fill custom text box with AI's suggestion
      const isPreset = (EXPENSE_CATEGORIES as readonly string[]).includes(extracted.category);
      const categoryChoice = isPreset ? extracted.category : OTHER;
      const category       = isPreset ? extracted.category : (extracted.category || "");

      setForm((prev) => ({
        ...prev,
        date:           extracted.date        || prev.date,
        vendor:         extracted.vendor      || prev.vendor,
        amount:         extracted.amount > 0  ? String(extracted.amount) : prev.amount,
        description:    extracted.description || prev.description,
        category,
        categoryChoice,
      }));

      toast.success("Bill scanned — please review and correct any fields.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not extract bill");
    } finally {
      setExtracting(false);
    }
  };

  const onSubmit = async () => {
    const parsed = expenseSchema.safeParse({ ...form, amount: Number(form.amount) });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Invalid input"); return; }
    try {
      if (editing) {
        await expensesApi.update(editing.id, parsed.data as Partial<Expense>);
        toast.success("Expense updated");
      } else {
        await expensesApi.create(parsed.data as Omit<Expense, "id" | "createdBy">);
        toast.success("Expense added");
      }
      setDialogOpen(false);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await expensesApi.remove(confirmDelete.id);
      toast.success("Expense deleted");
      setConfirmDelete(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Expense Management</h1>
          <p className="text-muted-foreground">Track, categorize and analyse business expenses.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" />Add Expense</Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Expenses" value={inr(topSummary.total)} subtitle={`${topSummary.count} entries`} icon={Wallet} />
        <StatCard title="Categories" value={String(topSummary.categoryCount)} subtitle="active" icon={Layers} />
        <StatCard title="Top Category" value={topSummary.topCategory ? topSummary.topCategory.name.split(" - ")[0] : "—"} subtitle={topSummary.topCategory ? inr(topSummary.topCategory.value) : ""} icon={TrendingUp} />
        <StatCard title="Avg / Entry" value={topSummary.count ? inr(Math.round(topSummary.average)) : "₹0"} subtitle="filtered DB set" icon={Receipt} />
      </div>

      {/* Income from paid invoices (extra amount included only for the extended/tax login) */}
      <PaidInvoicesIncome />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h3 className="font-semibold text-card-foreground mb-1">Expense Breakdown</h3>
          <p className="text-xs text-muted-foreground mb-4">Share by category</p>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={summary.pieData} dataKey="value" nameKey="name" outerRadius={90} innerRadius={50}>
                {summary.pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => inr(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h3 className="font-semibold text-card-foreground mb-1">Monthly Spend</h3>
          <p className="text-xs text-muted-foreground mb-4">Aggregated by month (filtered)</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={summary.barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `₹${v / 1000}k`} />
              <Tooltip formatter={(v: number) => inr(v)} />
              <Bar dataKey="amount" fill="hsl(200,70%,52%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4 shadow-sm grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search vendor, description, ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {availableCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} placeholder="From" />
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="To" />
        <div className="flex gap-2">
          <Input type="number" placeholder="Min ₹" value={minAmt} onChange={(e) => setMinAmt(e.target.value.replace(/^0+(?=\d)/, ''))} />
          <Input type="number" placeholder="Max ₹" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value.replace(/^0+(?=\d)/, ''))} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Vendor</th>
                <th className="text-left px-4 py-3 font-medium">Description</th>
                <th className="text-left px-4 py-3 font-medium">Mode</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">No expenses match the filters.</td></tr>
              )}
              {!loading && filtered.map((e) => (
                <tr key={e.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-card-foreground">{e.id}</td>
                  <td className="px-4 py-3">{e.date}</td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-1 rounded-full bg-secondary text-secondary-foreground">{e.category}</span></td>
                  <td className="px-4 py-3">{e.vendor}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{e.description}</td>
                  <td className="px-4 py-3">{e.paymentMode}</td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(e.amount)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(e)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(e)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {filtered.length} filtered rows from {loadedCount} loaded{pagination ? ` of ${pagination.total} total` : ""}.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!hasMore || loadingMore || loadingAll} onClick={loadMore}>
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Load more
            </Button>
            <Button variant="outline" size="sm" disabled={!hasMore || loadingMore || loadingAll} onClick={loadAll}>
              {loadingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Load all
            </Button>
          </div>
        </div>
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Expense" : "Add Expense"}</DialogTitle>
            <DialogDescription>Snap a photo of the bill — we'll auto-fill the details. You can edit before saving.</DialogDescription>
          </DialogHeader>

          {/* === Bill / Receipt — TOP === */}
          <div
            className={`rounded-xl border-2 border-dashed bg-muted/30 p-4 space-y-3 transition-colors ${dragOver ? "border-primary bg-primary/5" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Bill / Receipt</Label>
              <span className="text-xs text-muted-foreground">Image or PDF · max 5MB</span>
            </div>

            {/* Hidden inputs driven by the two buttons */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />

            {!form.billUrl && (
              <>
                {dragOver ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2 pointer-events-none">
                    <Upload className="h-8 w-8 text-primary animate-bounce" />
                    <span className="text-sm font-medium text-primary">Drop file here</span>
                  </div>
                ) : (
                  <>
                    <div
                      className="flex flex-col items-center justify-center py-4 gap-1 cursor-pointer rounded-lg hover:bg-muted/50 transition-colors"
                      onClick={() => galleryRef.current?.click()}
                    >
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Drag & drop a file here, or click to browse</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()}>
                        <Camera className="h-4 w-4" /> Take Photo
                      </Button>
                      <Button type="button" variant="outline" onClick={() => galleryRef.current?.click()}>
                        <ImageIcon className="h-4 w-4" /> Upload from Gallery
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}

            {form.billUrl && (
              <div className="space-y-2">
                <div className="relative bg-background rounded-lg border overflow-hidden">
                  {form.billUrl.startsWith("data:image") ? (
                    <img src={form.billUrl} alt="Bill preview" className="w-full max-h-48 object-contain bg-muted/40" />
                  ) : (
                    <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                      <Upload className="h-4 w-4" /> PDF attached
                    </div>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => setForm({ ...form, billUrl: undefined })}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => galleryRef.current?.click()}>
                    Replace
                  </Button>
                  <Button type="button" size="sm" className="flex-1" disabled={extracting} onClick={autoFillFromBill}>
                    {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Auto-fill from photo
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* === Form fields === */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-1">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="col-span-1">
              <Label>Amount (₹)</Label>
              <Input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/^0+(?=\d)/, '') })} />
            </div>

            <div className="col-span-2">
              <Label>Category</Label>
              <Select
                value={form.categoryChoice}
                onValueChange={(v) => setForm({
                  ...form,
                  categoryChoice: v,
                  category: v === OTHER ? "" : v,
                })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>

              {form.categoryChoice === OTHER && (
                <div className="mt-2">
                  <Input
                    autoFocus
                    placeholder="Enter custom category name"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="col-span-2">
              <Label>Vendor / Payee</Label>
              <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Sri Lakshmi Traders" />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Notes / reference" />
            </div>
            <div className="col-span-2">
              <Label>Payment Mode</Label>
              <Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v as Expense["paymentMode"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={onSubmit}>{editing ? "Save changes" : "Add expense"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && <>This will permanently remove <strong>{confirmDelete.id}</strong> ({inr(confirmDelete.amount)}). This cannot be undone.</>}
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

// ── Income from paid invoices ────────────────────────────────────────────────
// Lists every PAID invoice as an income entry. The off-books extra is already
// gated server-side (0 for the standard login, real value for the extended/tax
// login), so income = total + extra_amount reads correctly for whoever is on.
interface PaidInvoiceRow {
  invoice_id: number;
  invoice_number: string;
  customer_name: string | null;
  total: number;
  extra_amount?: number;
  payment_status?: string | null;
  status?: string;
  created_at: string;
}

function PaidInvoicesIncome() {
  const [rows, setRows] = useState<PaidInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<{ data: PaidInvoiceRow[] }>("/admin/invoices?limit=200");
        const paid = (res.data ?? []).filter(
          (r) => (r.payment_status ?? "").toLowerCase() === "paid" || r.status === "Paid",
        );
        setRows(paid);
      } catch {
        /* non-blocking */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fmt = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const totalIncome = rows.reduce((s, r) => s + (Number(r.total) || 0) + (Number(r.extra_amount) || 0), 0);
  const totalExtra = rows.reduce((s, r) => s + (Number(r.extra_amount) || 0), 0);

  if (loading || rows.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 border-b">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Income — Paid Invoices</h2>
          <p className="text-xs text-muted-foreground">Money received from paid invoices{totalExtra > 0 ? " (extra amount included)" : ""}.</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-primary">{fmt(totalIncome)}</div>
          <div className="text-xs text-muted-foreground">{rows.length} paid invoice(s)</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-3">Invoice</th><th className="p-3">Customer</th><th className="p-3">Date</th>
              <th className="p-3 text-right">Invoice Amount</th>
              {totalExtra > 0 && <th className="p-3 text-right">Extra</th>}
              <th className="p-3 text-right">Income</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const extra = Number(r.extra_amount) || 0;
              return (
                <tr key={r.invoice_id} className="border-t">
                  <td className="p-3 font-medium">{r.invoice_number}</td>
                  <td className="p-3">{r.customer_name || "—"}</td>
                  <td className="p-3 text-muted-foreground">{r.created_at?.slice(0, 10)}</td>
                  <td className="p-3 text-right">{fmt(Number(r.total) || 0)}</td>
                  {totalExtra > 0 && <td className="p-3 text-right text-amber-700">{extra ? fmt(extra) : "—"}</td>}
                  <td className="p-3 text-right font-semibold text-green-700">{fmt((Number(r.total) || 0) + extra)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
