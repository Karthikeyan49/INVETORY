import { Search, Download, Eye, Plus, FileText, ChevronsUpDown, Check, Loader2, Pencil, Trash2, CreditCard, IndianRupee } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { MachineAlertsBanner } from "@/components/MachineAlertsBanner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api/client";
import { GST_RATES } from "@/lib/api/invoices";
import { fetchGstinDetails, gstinCompanyName } from "@/lib/api/gstinLookup";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  downloadInvoiceTemplatePdf,
  placeOfSupplyLabel,
  TERMS_AND_CONDITIONS,
  type InvoiceTemplateDraft,
} from "@/lib/invoiceTemplatePdf";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { stateFromGstin } from "@/lib/gstState";
import { downloadCashBill } from "@/lib/srivariScalesPdf";
import { settingsApi } from "@/lib/api/settings";

interface InvoiceItem {
  product: string;
  size: string;
  qty: number;
  unit: string;
  hsn: string;
  gstRate: number;
  unitPrice: string;
  unitPriceValue: number;
  lineTotal: string;
  lineTotalValue: number;
  discount: number;
}

interface Invoice {
  id: string;
  orderId: string;
  customer: string;
  gst: string;
  customerState: string;
  customerAddress: string;
  shipToAddress: string;
  sellerState: string;
  items: InvoiceItem[];
  subtotal: string;
  subtotalValue: number;
  gstAmount: string;
  gstAmountValue: number;
  cgstAmountValue: number;
  sgstAmountValue: number;
  igstAmountValue: number;
  deliveryFee: string;
  deliveryFeeValue: number;
  discountValue: number;
  total: string;
  totalValue: number;
  date: string;
  dueDate: string;
  invoiceDate: string;
  paymentTerms: string;
  placeOfSupplyText: string;
  shipToText: string;
  subjectText: string;
  notes: string;
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  amountPaidValue: number;
  balanceDueValue: number;
  trackingNumber: string;
  _invoiceId?: number;
}

interface ApiInvoiceRow {
  invoice_id: number;
  invoice_number: string;
  order_id: number | null;
  order_number: string | null;
  customer_name: string | null;
  customer_email?: string | null;
  customer_gstin?: string | null;
  customer_state?: string | null;
  customer_address?: string | null;
  customer_city?: string | null;
  customer_pincode?: string | null;
  customer_country?: string | null;
  seller_state?: string | null;
  due_date?: string | null;
  invoice_date?: string | null;
  payment_terms?: string | null;
  place_of_supply?: string | null;
  ship_to?: string | null;
  subject?: string | null;
  order_customer_name?: string | null;
  order_company_name?: string | null;
  order_customer_gstin?: string | null;
  order_customer_address?: string | null;
  order_customer_city?: string | null;
  order_customer_state?: string | null;
  order_customer_pincode?: string | null;
  delivery_address?: string | null;
  delivery_city?: string | null;
  delivery_state?: string | null;
  delivery_pincode?: string | null;
  order_status?: string | null;
  payment_status?: string | null;
  amount_paid?: number | null;
  balance_due?: number | null;
  subtotal: number;
  gst_rate?: number;
  gst_amount: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  delivery_fee: number;
  discount?: number | null;
  total: number;
  status: string;
  payment_method: string | null;
  notes?: string | null;
  created_at: string;
  item_count?: number;
  items?: Array<{
    description: string;
    hsn_code: string | null;
    quantity: number;
    unit?: string | null;
    unit_price: number;
    gst_rate?: number;
    line_total: number;
  }>;
}

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const defaultInvoiceNote = "Thank you for your business.";

function addressLines(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function firstLine(value: string): string {
  return value.split("\n").find(Boolean) ?? "";
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeOrderStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (s === "delivered") return "Delivered";
  if (s === "shipped") return "Shipped";
  if (s === "pending") return "Pending";
  if (s === "confirmed") return "Confirmed";
  if (s === "cancelled") return "Cancelled";
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "—";
}

function normalizePaymentStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (s === "paid") return "Paid";
  if (s === "partial" || s === "partially_paid") return "Partial";
  if (s === "pending") return "Pending";
  if (s === "unpaid") return "Unpaid";
  if (s === "refunded") return "Refunded";
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "—";
}

function normalizePayment(raw: string | null): string {
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "—";
}

function rowToInvoice(row: ApiInvoiceRow): Invoice {
  const items: InvoiceItem[] = (row.items ?? []).map((i) => {
    const parts = i.description.split(" - ");
    const unitPriceValue = toNumber(i.unit_price);
    const lineTotalValue = toNumber(i.line_total);
    return {
      product: parts[0] || i.description,
      size: parts[1] || "",
      qty: Number(i.quantity) || 0,
      unit: i.unit || "Nos",
      hsn: i.hsn_code || "",
      gstRate: toNumber(i.gst_rate ?? row.gst_rate ?? 18),
      unitPrice: inr(unitPriceValue),
      unitPriceValue,
      lineTotal: inr(lineTotalValue),
      lineTotalValue,
      discount: 0,
    };
  });
  const displayItemCount = items.length > 0 ? items.length : (row.item_count ?? 0);
  const customer = row.customer_name ?? row.order_company_name ?? row.order_customer_name ?? "—";
  const customerState = row.customer_state || row.delivery_state || row.order_customer_state || "Tamil Nadu";
  const deliveryAddress = addressLines(row.delivery_address, row.delivery_city, row.delivery_state, row.delivery_pincode);
  const registeredAddress = addressLines(row.order_customer_address, row.order_customer_city, row.order_customer_state, row.order_customer_pincode);
  // Bill To = the invoice's own billing address (the Address Line / City / Pincode / Country
  // edited in the dialog). Falls back to the order's delivery address, then the registered one.
  const billingAddress = addressLines(row.customer_address, row.customer_city, row.customer_pincode, row.customer_country);
  const customerAddress = billingAddress || deliveryAddress || registeredAddress;
  // Ship To = the delivery address (where goods go), falling back to the billing address.
  const shipToAddress = deliveryAddress || customerAddress;
  const subtotalValue = toNumber(row.subtotal);
  const gstAmountValue = toNumber(row.gst_amount);
  const deliveryFeeValue = toNumber(row.delivery_fee);
  const discountValue    = toNumber(row.discount);
  const totalValue = toNumber(row.total);
  return {
    id: row.invoice_number,
    orderId: row.order_number ?? "—",
    customer,
    gst: row.customer_gstin ?? row.order_customer_gstin ?? "",
    customerState,
    customerAddress,
    shipToAddress,
    sellerState: row.seller_state || "Tamil Nadu",
    items: items.length > 0 ? items : Array(displayItemCount).fill(null).map((_, i) => ({
      product: `Item ${i + 1}`, size: "", qty: 0, unit: "Nos", hsn: "", gstRate: toNumber(row.gst_rate ?? 18),
      unitPrice: "—", unitPriceValue: 0, lineTotal: "—", lineTotalValue: 0, discount: 0,
    })),
    subtotal: inr(subtotalValue),
    subtotalValue,
    gstAmount: inr(gstAmountValue),
    gstAmountValue,
    cgstAmountValue: toNumber(row.cgst_amount),
    sgstAmountValue: toNumber(row.sgst_amount),
    igstAmountValue: toNumber(row.igst_amount),
    deliveryFee: inr(deliveryFeeValue),
    deliveryFeeValue,
    discountValue,
    total: inr(totalValue),
    totalValue,
    date: (row.created_at || "").slice(0, 10),
    dueDate: (row.due_date || row.created_at || "").slice(0, 10),
    invoiceDate: (row.invoice_date || "").slice(0, 10),
    paymentTerms: row.payment_terms || "",
    placeOfSupplyText: row.place_of_supply || "",
    shipToText: row.ship_to || "",
    subjectText: row.subject || "",
    notes: row.notes || defaultInvoiceNote,
    orderStatus: normalizeOrderStatus(row.order_status),
    paymentStatus: normalizePaymentStatus(row.payment_status),
    paymentMethod: normalizePayment(row.payment_method),
    amountPaidValue: toNumber(row.amount_paid),
    balanceDueValue: row.balance_due === null || row.balance_due === undefined
      ? Math.max(0, totalValue - toNumber(row.amount_paid))
      : toNumber(row.balance_due),
    trackingNumber: "",
    _invoiceId: row.invoice_id,
  };
}

const orderStatusColors: Record<string, string> = {
  Delivered: "bg-primary/10 text-primary",
  Shipped: "bg-blue-50 text-blue-600",
  Confirmed: "bg-purple-50 text-purple-600",
  Pending: "bg-yellow-50 text-status-processing",
  Cancelled: "bg-red-100 text-red-700",
};

const paymentStatusColors: Record<string, string> = {
  Paid: "bg-primary/10 text-primary",
  Pending: "bg-yellow-50 text-status-processing",
  Partial: "bg-blue-50 text-blue-600",
  Unpaid: "bg-red-50 text-red-600",
  Refunded: "bg-purple-50 text-purple-600",
};

function invoiceToTemplateDraft(inv: Invoice): InvoiceTemplateDraft {
  const billTo = [
    inv.customer,
    inv.customerAddress,
    inv.gst ? `GSTIN ${inv.gst}` : "",
  ].filter(Boolean).join("\n");
  const shipTo = [
    firstLine(inv.shipToAddress) ? inv.shipToAddress : inv.customerAddress,
    inv.gst ? `GSTIN ${inv.gst}` : "",
  ].filter(Boolean).join("\n");
  const autoSubject = inv.items
    .filter((item) => item.product && !item.product.startsWith("Item "))
    .map((item) => item.product)
    .slice(0, 2)
    .join(", ") || "INVENTORY MANAGEMENT SYSTEM BIOMASS PELLET";

  return {
    invoiceNumber: inv.id,
    invoiceDate: inv.invoiceDate || inv.date,
    dueDate: inv.dueDate || inv.date,
    terms: inv.paymentTerms || "Due on Receipt",
    placeOfSupply: inv.placeOfSupplyText || placeOfSupplyLabel(inv.customerState),
    billTo,
    shipTo: inv.shipToText || shipTo,
    subject: inv.subjectText || autoSubject,
    notes: inv.notes || defaultInvoiceNote,
    termsAndConditions: resolveInvoiceTerms(),
    sellerState: inv.sellerState,
    customerState: inv.customerState,
    deliveryFee: inv.deliveryFeeValue,
    discount: inv.discountValue,
    balanceDue: inv.balanceDueValue,
    lines: inv.items.map((item) => ({
      description: [item.product, item.size].filter(Boolean).join(" - "),
      hsn: item.hsn,
      qty: item.qty,
      unit: item.unit,
      unitPrice: item.unitPriceValue,
      gstRate: item.gstRate,
      discount: item.discount,
    })),
  };
}

interface CompanySuggestion {
  label: string;
  gstin: string;
  state: string;
  address: string;
}

interface ProductSuggestion {
  id: number;
  name: string;
  hsn_code: string;
  price: number;
  gst_rate: number;
  unit: string;
}

interface NewInvoiceLine {
  description: string;
  hsn_code: string;
  quantity: number;
  unit: string;
  unit_price: number;
  gst_rate: number;
}

interface NewInvoiceForm {
  customer_name: string;
  customer_gstin: string;
  customer_state: string;
  address_line: string;
  city: string;
  pincode: string;
  country: string;
  seller_state: string;
  due_date: string;
  delivery_fee: string;
  discount: string;
  payment_method: string;
  payment_status: string;
  status: string;
  notes: string;
  terms_and_conditions: string;
  // PDF detail fields (blank = auto-generated on the invoice)
  invoice_number: string;
  invoice_date: string;
  payment_terms: string;
  place_of_supply: string;
  ship_to: string;
  subject: string;
  extra_amount: string;   // off-books extra carried from a machine (extended login only)
  sale_type: string;      // cash | credit
  advance: string;        // advance received on a credit sale
  location: string;       // customer area/location
  lines: NewInvoiceLine[];
}

/** Combine split address fields into a single address string for the API */
const buildAddress = (f: Pick<NewInvoiceForm, "address_line" | "city" | "pincode" | "country">) =>
  [f.address_line, f.city, f.pincode, f.country].map(s => s.trim()).filter(Boolean).join(", ");


const emptyLine = (): NewInvoiceLine => ({
  description: "", hsn_code: "", quantity: 1, unit: "Nos", unit_price: 0, gst_rate: 18,
});

// Unit-of-measure options. "-" = None (printed as "-" on the invoice).
const UNIT_OPTIONS = ["-", "Nos", "Kg", "Gram", "Ton", "Quintal", "Bags", "Litre", "ml", "Metre", "Feet", "Box", "Piece", "Set", "Pair", "Dozen", "Roll", "Sheet"];

/** Unit picker — dropdown of common units plus a "None ( - )" option. Keeps any
 *  custom unit already saved on the line even if it's not in the preset list. */
function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = value || "Nos";
  const opts = UNIT_OPTIONS.includes(current) ? UNIT_OPTIONS : [current, ...UNIT_OPTIONS];
  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {opts.map(u => <SelectItem key={u} value={u}>{u === "-" ? "None ( - )" : u}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const defaultTerms = TERMS_AND_CONDITIONS.join("\n");

// Org-wide invoice Terms & Conditions from Settings (populated on mount below).
// Falls back to a per-browser override, then the built-in template.
let orgInvoiceTerms = "";
const resolveInvoiceTerms = (): string => {
  if (orgInvoiceTerms.trim()) return orgInvoiceTerms;
  try { return localStorage.getItem("eco_inv_terms") || defaultTerms; } catch { return defaultTerms; }
};

const emptyNewForm = (): NewInvoiceForm => ({
  customer_name: "", customer_gstin: "", customer_state: "Tamil Nadu",
  address_line: "", city: "", pincode: "", country: "India",
  seller_state: "Tamil Nadu",
  due_date: "", delivery_fee: "", discount: "", payment_method: "", payment_status: "unpaid",
  status: "Draft", notes: defaultInvoiceNote,
  terms_and_conditions: resolveInvoiceTerms(),
  invoice_number: "", invoice_date: "", payment_terms: "", place_of_supply: "", ship_to: "", subject: "",
  extra_amount: "",
  sale_type: "cash", advance: "", location: "",
  lines: [emptyLine()],
});

export default function Invoices() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [open, setOpen] = useState(false);
  const [invoicePayments, setInvoicePayments] = useState<ApiRow[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_mode: "Bank Transfer",
    paid_on: new Date().toISOString().slice(0, 10),
    reference_no: "",
    notes: "",
  });
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  // "current" = live order/GST invoices; "past" = historical invoices imported via Data Upload
  const [view, setView] = useState<"current" | "past">("current");
  const [historical, setHistorical] = useState<Invoice[]>([]);
  const [historicalLoaded, setHistoricalLoaded] = useState(false);
  const [historicalCount, setHistoricalCount] = useState(0);   // total rows in DB (all pages)
  const [historicalSum, setHistoricalSum] = useState(0);       // sum of all past invoice totals
  const [historicalPage, setHistoricalPage] = useState(1);
  const [historicalLoadingMore, setHistoricalLoadingMore] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState<NewInvoiceForm>(emptyNewForm());
  const [newSaving, setNewSaving] = useState(false);
  const [companies, setCompanies] = useState<CompanySuggestion[]>([]);
  const [companyPopOpen, setCompanyPopOpen] = useState(false);
  const [gstFetching, setGstFetching] = useState(false);
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  const [linePopOpen, setLinePopOpen] = useState<number | null>(null);
  const [customDescs, setCustomDescs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("eco_inv_descs") || "[]"); }
    catch { return []; }
  });
  // HSN map: description → hsn_code, persisted in localStorage
  const [hsnMap, setHsnMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("eco_inv_hsns") || "{}"); }
    catch { return {}; }
  });
  // Edit invoice state
  const [editOpen, setEditOpen] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<NewInvoiceForm>(emptyNewForm());
  const [editSaving, setEditSaving] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editLinePopOpen, setEditLinePopOpen] = useState<number | null>(null);
  const [editCompanyPopOpen, setEditCompanyPopOpen] = useState(false);

  const loadInvoices = async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: ApiInvoiceRow[] }>("/admin/invoices?limit=200");
      setInvoices((res.data ?? []).map(rowToInvoice));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load invoices");
    }
  };

  // Load current invoices and (for the summary totals) past invoices on mount.
  useEffect(() => { loadInvoices(); loadHistorical(); }, []);

  // Prefill + open the New Invoice dialog when arriving from a machine's "Invoice" button.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const mi = (location.state as { machineInvoice?: Record<string, unknown> } | null)?.machineInvoice;
    if (!mi) return;
    setNewForm({
      ...emptyNewForm(),
      extra_amount: Number(mi.extra_amount) ? String(mi.extra_amount) : "",
      lines: [{
        description: (mi.description as string) ?? "",
        hsn_code: (mi.hsn_code as string) ?? "",
        quantity: 1, unit: "Nos",
        unit_price: Number(mi.unit_price) || 0,
        gst_rate: Number(mi.gst_rate) || 18,
      }],
    });
    setNewOpen(true);
    navigate("/invoices", { replace: true, state: null }); // clear so a refresh won't reopen
    // eslint-disable-next-line
  }, []);
  // Load org-wide invoice terms from Settings so new invoices default to them.
  useEffect(() => { settingsApi.get().then((s) => { orgInvoiceTerms = (s.invoice_terms || "").trim(); }).catch(() => { /* optional */ }); }, []);

  const PAST_PAGE_SIZE = 200;

  // Load a page of past invoices. page 1 replaces the list; later pages append ("Load more").
  // The DB-wide count + sum come back in `pagination` so the summary cards stay accurate
  // no matter how many pages are currently loaded.
  const loadHistorical = async (page = 1) => {
    if (page === 1) { /* fresh load */ } else { setHistoricalLoadingMore(true); }
    try {
      const res = await apiFetch<{
        data: ApiInvoiceRow[];
        pagination?: { total?: number; total_amount?: number };
      }>(`/admin/historical-invoices?limit=${PAST_PAGE_SIZE}&page=${page}`, { skipCache: true });
      const mapped = (res.data ?? []).map(rowToInvoice);
      setHistorical(prev => (page === 1 ? mapped : [...prev, ...mapped]));
      setHistoricalCount(res.pagination?.total ?? mapped.length);
      setHistoricalSum(res.pagination?.total_amount ?? 0);
      setHistoricalPage(page);
      setHistoricalLoaded(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load past invoices");
    } finally {
      setHistoricalLoadingMore(false);
    }
  };

  // Build the PDF for a historical invoice straight from the row (no /admin/invoices fetch —
  // past invoices live in a separate table and have no live invoice record).
  const downloadHistorical = async (inv: Invoice) => {
    try {
      setDownloadBusy(true);
      await downloadInvoiceTemplatePdf(invoiceToTemplateDraft(inv));
      toast.success(`Downloaded ${inv.id}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadBusy(false);
    }
  };

  const createInvoice = async () => {
    if (!newForm.customer_name.trim()) { toast.error("Customer name is required"); return; }
    if (!newForm.customer_state.trim()) { toast.error("Customer state is required"); return; }
    if (newForm.lines.some(l => !l.description.trim())) { toast.error("All line items need a description"); return; }
    if (newForm.lines.some(l => l.quantity <= 0)) { toast.error("Quantity must be greater than 0"); return; }

    setNewSaving(true);
    try {
      await apiFetch("/admin/invoices/gst", {
        method: "POST",
        body: JSON.stringify({
          customer_name:    newForm.customer_name.trim(),
          customer_gstin:   newForm.customer_gstin.trim() || null,
          customer_state:   newForm.customer_state.trim(),
          customer_address: newForm.address_line.trim() || null,
          customer_city:    newForm.city.trim()         || null,
          customer_pincode: newForm.pincode.trim()      || null,
          customer_country: newForm.country.trim()      || null,
          seller_state:     newForm.seller_state.trim(),
          due_date:         newForm.due_date || null,
          delivery_fee:     parseFloat(newForm.delivery_fee) || 0,
          discount:         parseFloat(newForm.discount) || 0,
          payment_method:   newForm.payment_method || null,
          payment_status:   newForm.payment_status || "unpaid",
          status:           newForm.status,
          notes:            newForm.notes.trim() || null,
          extra_amount:     parseFloat(newForm.extra_amount) || 0,
          sale_type:        newForm.sale_type || "cash",
          advance:          parseFloat(newForm.advance) || 0,
          location:         newForm.location.trim() || null,
          items: newForm.lines.map(l => ({
            description: l.description.trim(),
            hsn_code:    l.hsn_code.trim() || null,
            quantity:    l.quantity,
            unit:        l.unit.trim() || "Nos",
            unit_price:  l.unit_price,
            gst_rate:    l.gst_rate,
          })),
        }),
      });
      // Save/update each line item to the invoice product catalog
      const knownNames = new Set(products.map(p => p.name.toLowerCase()));
      for (const l of newForm.lines) {
        const name = l.description.trim();
        if (!name) continue;
        apiFetch("/admin/invoice-products", {
          method: "POST",
          body: JSON.stringify({ name, hsn_code: l.hsn_code.trim() || null, unit_price: l.unit_price, gst_rate: l.gst_rate }),
        }).then(res => {
          // Refresh catalog if a new product was added
          if (!knownNames.has(name.toLowerCase())) {
            apiFetch<{ data: Array<{ id: number; name: string; hsn_code: string | null; unit_price: number; gst_rate: number; unit: string | null }> }>("/admin/invoice-products")
              .then(r => setProducts((r.data ?? []).map(p => ({ id: p.id, name: p.name, hsn_code: p.hsn_code ?? "", price: p.unit_price, gst_rate: p.gst_rate, unit: p.unit ?? "" }))))
              .catch(() => {});
          }
        }).catch(() => {});
      }
      // Save manual descriptions to localStorage for future suggestions
      const newDescs = newForm.lines
        .map(l => l.description.trim())
        .filter(d => d && !products.some(p => p.name === d));
      if (newDescs.length) {
        setCustomDescs(prev => {
          const merged = [...new Set([...newDescs, ...prev])].slice(0, 60);
          localStorage.setItem("eco_inv_descs", JSON.stringify(merged));
          return merged;
        });
      }
      toast.success("Invoice created successfully");
      setNewOpen(false);
      setNewForm(emptyNewForm());
      await loadInvoices();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setNewSaving(false);
    }
  };

  const setLine = (idx: number, patch: Partial<NewInvoiceLine>) =>
    setNewForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));

  const setEditLine = (idx: number, patch: Partial<NewInvoiceLine>) =>
    setEditForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));

  const openEditInvoice = async (inv: Invoice) => {
    if (!inv._invoiceId) return;
    setEditLoading(true);
    setEditOpen(true);
    try {
      const res = await apiFetch<{ success: boolean; data: ApiInvoiceRow }>(`/admin/invoices/${inv._invoiceId}`);
      const full = rowToInvoice(res.data);
      // Resolved PDF values (stored value, or the auto/default fallback) so the
      // form shows what will actually print instead of leaving fields blank.
      const draft = invoiceToTemplateDraft(full);
      setEditInvoiceId(inv._invoiceId);
      setEditForm({
        customer_name:    full.customer === "—" ? "" : full.customer,
        customer_gstin:   full.gst,
        customer_state:   full.customerState,
        address_line: res.data.customer_address ?? "",
        city:         res.data.customer_city    ?? "",
        pincode:      res.data.customer_pincode ?? "",
        country:      res.data.customer_country ?? "India",
        seller_state:     full.sellerState,
        due_date:         full.dueDate,
        delivery_fee:     String(full.deliveryFeeValue || 0),
        discount:         String(full.discountValue || 0),
        payment_method:   full.paymentMethod === "—" ? "" : full.paymentMethod,
        payment_status:   full.paymentStatus === "—" ? "unpaid" : full.paymentStatus.toLowerCase(),
        status:           full.orderStatus === "—" ? "Draft" : full.orderStatus,
        notes:            draft.notes,
        terms_and_conditions: draft.termsAndConditions ?? resolveInvoiceTerms(),
        invoice_number:   draft.invoiceNumber,
        invoice_date:     draft.invoiceDate,
        payment_terms:    draft.terms,
        place_of_supply:  draft.placeOfSupply,
        ship_to:          draft.shipTo,
        subject:          draft.subject,
        lines:            full.items.length
          ? full.items.map(item => ({
              description: item.product + (item.size ? ` - ${item.size}` : ""),
              hsn_code:    item.hsn,
              quantity:    item.qty,
              unit:        item.unit || "Nos",
              unit_price:  item.unitPriceValue,
              gst_rate:    item.gstRate,
            }))
          : [emptyLine()],
      });
    } catch {
      toast.error("Failed to load invoice");
      setEditOpen(false);
    } finally {
      setEditLoading(false);
    }
  };

  const saveEdit = async () => {
    if (!editInvoiceId) return;
    if (!editForm.customer_name.trim()) { toast.error("Customer name is required"); return; }
    if (editForm.lines.some(l => !l.description.trim() || l.quantity <= 0)) {
      toast.error("All line items need a description and quantity > 0"); return;
    }
    setEditSaving(true);
    try {
      // Save/update each line item to the invoice product catalog
      for (const l of editForm.lines) {
        const name = l.description.trim();
        if (!name) continue;
        apiFetch("/admin/invoice-products", {
          method: "POST",
          body: JSON.stringify({ name, hsn_code: l.hsn_code.trim() || null, unit_price: l.unit_price, gst_rate: l.gst_rate }),
        }).catch(() => {});
      }
      await apiFetch(`/admin/invoices/${editInvoiceId}`, {
        method: "PUT",
        body: JSON.stringify({
          customer_name:    editForm.customer_name.trim(),
          customer_gstin:   editForm.customer_gstin.trim() || null,
          customer_state:   editForm.customer_state.trim() || "Tamil Nadu",
          customer_address: editForm.address_line.trim() || null,
          customer_city:    editForm.city.trim()         || null,
          customer_pincode: editForm.pincode.trim()      || null,
          customer_country: editForm.country.trim()      || null,
          seller_state:     editForm.seller_state.trim()    || "Tamil Nadu",
          due_date:         editForm.due_date || null,
          delivery_fee:     parseFloat(editForm.delivery_fee) || 0,
          discount:         parseFloat(editForm.discount) || 0,
          payment_method:   editForm.payment_method || null,
          payment_status:   editForm.payment_status || "unpaid",
          status:           editForm.status || "Draft",
          notes:            editForm.notes.trim() || null,
          invoice_number:   editForm.invoice_number.trim() || null,
          invoice_date:     editForm.invoice_date || "",
          payment_terms:    editForm.payment_terms.trim(),
          place_of_supply:  editForm.place_of_supply.trim(),
          ship_to:          editForm.ship_to.trim(),
          subject:          editForm.subject.trim(),
          items: editForm.lines.filter(l => l.description.trim()).map(l => ({
            description: l.description.trim(),
            hsn_code:    l.hsn_code.trim() || null,
            quantity:    l.quantity,
            unit:        l.unit.trim() || "Nos",
            unit_price:  l.unit_price,
            gst_rate:    l.gst_rate,
          })),
        }),
      });
      toast.success("Invoice updated");
      setEditOpen(false);
      await loadInvoices();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update invoice");
    } finally {
      setEditSaving(false);
    }
  };

  // Load invoice product catalog (shared between new + edit dialogs, reload each time)
  useEffect(() => {
    if (!newOpen && !editOpen) return;
    apiFetch<{ data: Array<{ id: number; name: string; hsn_code: string | null; unit_price: number; gst_rate: number; unit: string | null }> }>("/admin/invoice-products")
      .then(res => {
        setProducts((res.data ?? []).map(p => ({
          id:       p.id,
          name:     p.name,
          hsn_code: p.hsn_code  ?? "",
          price:    p.unit_price,
          gst_rate: p.gst_rate,
          unit:     p.unit      ?? "",
        })));
      })
      .catch(() => {});
  }, [newOpen, editOpen]);

  // Reload customers from existing invoices every time new-invoice dialog opens
  useEffect(() => {
    if (!newOpen) return;
    // Customers: deduplicated from past invoices (freshest data each open)
    apiFetch<{ data: Array<{ customer_name: string | null; customer_gstin: string | null; customer_state: string | null; customer_address: string | null }> }>("/admin/invoices?limit=500")
      .then(res => {
        const seen = new Set<string>();
        const list: CompanySuggestion[] = [];
        for (const inv of res.data ?? []) {
          const label = inv.customer_name?.trim();
          if (!label || seen.has(label.toLowerCase())) continue;
          seen.add(label.toLowerCase());
          list.push({
            label,
            gstin:   inv.customer_gstin   ?? "",
            state:   inv.customer_state   ?? "Tamil Nadu",
            address: inv.customer_address ?? "",
          });
        }
        setCompanies(list.sort((a, b) => a.label.localeCompare(b.label)));
      })
      .catch(() => {});
    // Products
  }, [newOpen]);

  const applyCompany = (c: CompanySuggestion) => {
    setNewForm(f => ({
      ...f,
      customer_name:    c.label,
      customer_gstin:   c.gstin   || f.customer_gstin,
      customer_state:   c.state   || f.customer_state,
      address_line: c.address || f.address_line,
    }));
    setCompanyPopOpen(false);
  };

  const fetchGstDetails = async () => {
    const gstin = newForm.customer_gstin.trim().toUpperCase();
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
      toast.error("Enter a valid 15-character GSTIN first");
      return;
    }
    setGstFetching(true);
    try {
      const d = await fetchGstinDetails(gstin, newForm.seller_state);
      const name = gstinCompanyName(d);
      const addr = (d.address_line || d.address || "").trim();
      setNewForm(f => ({
        ...f,
        customer_gstin:   gstin,
        customer_state:   d.state || f.customer_state,
        ...(addr  ? { address_line: addr } : {}),
        ...(d.city ? { city: d.city } : {}),
        ...(d.pincode ? { pincode: d.pincode } : {}),
        ...(name  ? { customer_name:    name } : {}),
      }));
      const businessFilled: string[] = [];
      if (name)  businessFilled.push(`name: ${name}`);
      if (addr)  businessFilled.push("address");
      if (d.city) businessFilled.push(`city: ${d.city}`);
      if (d.pincode) businessFilled.push(`pincode: ${d.pincode}`);
      if (d.status && d.status !== "Unknown") businessFilled.push(`status: ${d.status}`);
      const fallbackFilled = [d.state ? `state: ${d.state}` : "", d.tax_type ? `tax: ${d.tax_type}` : ""].filter(Boolean);
      if (businessFilled.length) {
        toast.success(`Filled — ${[...businessFilled, ...fallbackFilled].join(", ")}`);
      } else if (d.lookup_status === "fallback") {
        toast.info(`${d.lookup_error || "GST portal details unavailable"}. Filled ${fallbackFilled.join(", ") || "GSTIN fallback fields"}.`);
      } else {
        toast.info("GSTIN valid. Business details unavailable from gov portal — fill manually.");
      }
    } catch (e) {
      // Fallback: at least fill state from GSTIN code
      const state = stateFromGstin(gstin);
      if (state) {
        setNewForm(f => ({ ...f, customer_gstin: gstin, customer_state: state }));
        toast.info(`State filled from GSTIN: ${state}`);
      } else {
        toast.error(e instanceof Error ? e.message : "GST lookup failed");
      }
    } finally {
      setGstFetching(false);
    }
  };

  const source = view === "past" ? historical : invoices;
  const filtered = source.filter(inv =>
    inv.id.toLowerCase().includes(search.toLowerCase()) ||
    inv.customer.toLowerCase().includes(search.toLowerCase()) ||
    inv.orderId.toLowerCase().includes(search.toLowerCase())
  );

  // Total sales = sum of invoice totals across the active view (current or past),
  // and the combined total of both, for the summary cards above the table.
  const currentTotal = invoices.reduce((s, inv) => s + inv.totalValue, 0);
  const pastTotal = historicalSum; // DB-wide sum (all pages), not just the loaded rows

const viewInvoice = async (inv: Invoice) => {
    try {
      const numId = inv._invoiceId;
      if (!numId) { toast.error("Invoice ID missing"); return; }
      const full = await apiFetch<{ success: boolean; data: ApiInvoiceRow }>(`/admin/invoices/${numId}`);
      const next = rowToInvoice(full.data);
      setSelected(next);
      try {
        const paymentData = await phase2Api.payments.invoicePayments(numId);
        setInvoicePayments(paymentData.payments ?? []);
      } catch {
        setInvoicePayments([]);
      }
      setOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load invoice");
    }
  };

  const openRecordPayment = () => {
    if (!selected?._invoiceId) return;
    setPaymentForm({
      amount: String(selected.balanceDueValue || selected.totalValue),
      payment_mode: selected.paymentMethod !== "—" ? selected.paymentMethod : "Bank Transfer",
      paid_on: new Date().toISOString().slice(0, 10),
      reference_no: "",
      notes: "",
    });
    setPaymentOpen(true);
  };

  const recordPayment = async () => {
    if (!selected?._invoiceId) return;
    const amount = toNumber(paymentForm.amount);
    if (amount <= 0) { toast.error("Payment amount must be greater than zero"); return; }
    setPaymentSaving(true);
    try {
      await phase2Api.payments.payInvoice(selected._invoiceId, {
        direction: "in",
        amount,
        payment_mode: paymentForm.payment_mode,
        paid_on: paymentForm.paid_on,
        reference_no: paymentForm.reference_no,
        notes: paymentForm.notes,
      });
      toast.success("Payment recorded");
      setPaymentOpen(false);
      await loadInvoices();
      await viewInvoice(selected);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record payment");
    } finally {
      setPaymentSaving(false);
    }
  };

  // Fetch the saved invoice and download its PDF straight away (no intermediate popup —
  // every field is editable in the Edit dialog and stored on the invoice).
  const downloadInvoice = async (inv: Invoice) => {
    const numId = inv._invoiceId;
    if (!numId) { toast.error("Invoice ID missing"); return; }
    try {
      setDownloadBusy(true);
      const full = await apiFetch<{ success: boolean; data: ApiInvoiceRow }>(`/admin/invoices/${numId}`);
      const draft = invoiceToTemplateDraft(rowToInvoice(full.data));
      await downloadInvoiceTemplatePdf(draft);
      toast.success(`Downloaded ${draft.invoiceNumber}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadBusy(false);
    }
  };

  // Cash Bill (R5) — the Sri Vari cash-bill document for cash/service sales.
  // Wired here so a cash-category invoice can produce its cash bill directly.
  const downloadCashBillForInvoice = async (inv: Invoice) => {
    const numId = inv._invoiceId;
    if (!numId) { toast.error("Invoice ID missing"); return; }
    try {
      setDownloadBusy(true);
      const full = await apiFetch<{ success: boolean; data: ApiInvoiceRow }>(`/admin/invoices/${numId}`);
      const d = full.data;
      const items = d.items ?? [];
      const description = items.length
        ? items.map((it) => it.description).filter(Boolean).join(", ")
        : "ELECTRONIC WEIGHING SCALE SERVICE";
      const qtyTotal = items.reduce((s, it) => s + Number(it.quantity || 0), 0);
      const to = [d.customer_name, d.customer_address, d.customer_city].filter(Boolean).join(", ");
      const cell = addressLines(d.customer_email); // reuse: often blank; kept minimal
      downloadCashBill({
        refNo: d.invoice_number,
        date: (d.invoice_date || d.created_at || "").slice(0, 10).split("-").reverse().join("."),
        to,
        cellNo: cell.replace(/\n/g, " ").trim() || undefined,
        description,
        qty: qtyTotal ? `${qtyTotal}NO` : "1NO",
        amount: Number(d.subtotal ?? d.total ?? 0),
        total: Number(d.total ?? d.subtotal ?? 0),
      });
      toast.success(`Cash bill ${d.invoice_number}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cash bill failed");
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <MachineAlertsBanner />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoice Management</h1>
          <p className="text-muted-foreground">Auto-generated invoices with GST calculation</p>
        </div>
        <Button onClick={() => { setNewForm(emptyNewForm()); setNewOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" /> New Invoice
        </Button>
      </div>

      {/* ── New Invoice Dialog ─────────────────────────────────────────────── */}
      <Dialog open={newOpen} onOpenChange={(v) => { if (!newSaving) setNewOpen(v); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Create Manual Invoice</DialogTitle>
            <DialogDescription>Create a standalone GST invoice not linked to any order.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 text-sm">
            {/* Customer Details */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Customer Details</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Customer / Company Name <span className="text-destructive">*</span></Label>
                  <Popover open={companyPopOpen} onOpenChange={setCompanyPopOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        role="combobox"
                        aria-expanded={companyPopOpen}
                        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className={cn("truncate", !newForm.customer_name && "text-muted-foreground")}>
                          {newForm.customer_name || "Search or type a new name…"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[340px] p-0" align="start">
                      <Command>
                        <CommandInput
                          placeholder="Search company or type new…"
                          value={newForm.customer_name}
                          onValueChange={v => setNewForm(f => ({ ...f, customer_name: v }))}
                        />
                        <CommandList>
                          <CommandEmpty>
                            <div className="px-4 py-3 text-sm text-muted-foreground">
                              No match — <span className="font-medium text-foreground">"{newForm.customer_name}"</span> will be used as a new company.
                            </div>
                          </CommandEmpty>
                          <CommandGroup heading="Existing customers">
                            {companies.map(c => (
                              <CommandItem
                                key={c.label}
                                value={c.label}
                                onSelect={() => applyCompany(c)}
                                className="flex items-center gap-2"
                              >
                                <Check className={cn("h-4 w-4 shrink-0", newForm.customer_name === c.label ? "opacity-100" : "opacity-0")} />
                                <div className="min-w-0">
                                  <p className="truncate font-medium">{c.label}</p>
                                  {c.gstin && <p className="text-xs text-muted-foreground font-mono truncate">{c.gstin}</p>}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label>GSTIN</Label>
                  <div className="flex gap-2">
                    <Input
                      value={newForm.customer_gstin}
                      onChange={e => {
                        const v = e.target.value.toUpperCase();
                        const state = stateFromGstin(v);
                        setNewForm(f => ({ ...f, customer_gstin: v, ...(state ? { customer_state: state } : {}) }));
                      }}
                      placeholder="e.g. 33AABCI1234A1Z5"
                      className="font-mono flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={fetchGstDetails}
                      disabled={gstFetching}
                      className="shrink-0"
                    >
                      {gstFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Customer State <span className="text-destructive">*</span></Label>
                  <Input value={newForm.customer_state} onChange={e => setNewForm(f => ({ ...f, customer_state: e.target.value }))} placeholder="e.g. Tamil Nadu" />
                </div>
                <div>
                  <Label>Seller State</Label>
                  <Input value={newForm.seller_state} onChange={e => setNewForm(f => ({ ...f, seller_state: e.target.value }))} placeholder="e.g. Tamil Nadu" />
                </div>
                <div className="md:col-span-2">
                  <Label>Address Line</Label>
                  <Input value={newForm.address_line} onChange={e => setNewForm(f => ({ ...f, address_line: e.target.value }))} placeholder="Street / Area / Building" />
                </div>
                <div>
                  <Label>City</Label>
                  <Input value={newForm.city} onChange={e => setNewForm(f => ({ ...f, city: e.target.value }))} placeholder="e.g. Chennai" />
                </div>
                <div>
                  <Label>Pincode</Label>
                  <Input value={newForm.pincode} onChange={e => setNewForm(f => ({ ...f, pincode: e.target.value }))} placeholder="e.g. 600001" maxLength={10} />
                </div>
                <div>
                  <Label>Country</Label>
                  <Input value={newForm.country} onChange={e => setNewForm(f => ({ ...f, country: e.target.value }))} placeholder="e.g. India" />
                </div>
              </div>
            </div>

            {/* Invoice Details */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Invoice Details</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" value={newForm.due_date} onChange={e => setNewForm(f => ({ ...f, due_date: e.target.value }))} />
                </div>
                <div>
                  <Label>Delivery Fee (₹)</Label>
                  <Input type="number" min="0" step="0.01" value={newForm.delivery_fee} onChange={e => setNewForm(f => ({ ...f, delivery_fee: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <Label>Discount (₹)</Label>
                  <Input type="number" min="0" step="0.01" value={newForm.discount} onChange={e => setNewForm(f => ({ ...f, discount: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <Label>Payment Method</Label>
                  <Select value={newForm.payment_method} onValueChange={v => setNewForm(f => ({ ...f, payment_method: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cod">COD</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="online">Online</SelectItem>
                      <SelectItem value="net_banking">Net Banking</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Sale Type</Label>
                  <Select value={newForm.sale_type} onValueChange={v => setNewForm(f => ({ ...f, sale_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash (paid in full)</SelectItem>
                      <SelectItem value="credit">Credit (outstanding)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newForm.sale_type === "credit" && (
                  <div>
                    <Label>Advance (₹)</Label>
                    <Input type="number" min="0" step="0.01" value={newForm.advance} onChange={e => setNewForm(f => ({ ...f, advance: e.target.value }))} placeholder="0" />
                  </div>
                )}
                <div>
                  <Label>Location / Area</Label>
                  <Input value={newForm.location} onChange={e => setNewForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Coimbatore" />
                </div>
                <div>
                  <Label>Payment Status</Label>
                  <Select value={newForm.payment_status} onValueChange={v => setNewForm(f => ({ ...f, payment_status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="refunded">Refunded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={newForm.status} onValueChange={v => setNewForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Draft">Draft</SelectItem>
                      <SelectItem value="Sent">Sent</SelectItem>
                      <SelectItem value="Paid">Paid</SelectItem>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 md:col-span-4">
                  <Label>Notes</Label>
                  <Input value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <div className="col-span-2 md:col-span-4">
                  <Label>Terms &amp; Conditions</Label>
                  <Textarea
                    rows={6}
                    className="font-mono text-xs"
                    value={newForm.terms_and_conditions}
                    onChange={e => {
                      const v = e.target.value;
                      setNewForm(f => ({ ...f, terms_and_conditions: v }));
                      try { localStorage.setItem("eco_inv_terms", v); } catch { /* localStorage can be unavailable in private mode */ }
                    }}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Each line = one term. Saved as default for future invoices.</p>
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Line Items <span className="text-destructive">*</span></p>
                <Button size="sm" variant="outline" onClick={() => setNewForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))}>
                  <Plus className="h-4 w-4" /> Add line
                </Button>
              </div>
              <ScrollableX className="border rounded-lg">
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-2 py-2 min-w-52">Product / Description</th>
                      <th className="text-left px-2 py-2 w-28">HSN/SAC</th>
                      <th className="text-right px-2 py-2 w-24">Qty</th>
                      <th className="text-left px-2 py-2 w-24">Unit</th>
                      <th className="text-right px-2 py-2 w-32">Rate (₹)</th>
                      <th className="text-right px-2 py-2 w-28">GST</th>
                      <th className="text-right px-2 py-2 w-28">Line Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newForm.lines.map((line, idx) => {
                      const lineTotal = line.quantity * line.unit_price;
                      return (
                        <tr key={idx} className="border-t">
                          <td className="px-2 py-1 min-w-[240px]">
                            <Popover open={linePopOpen === idx} onOpenChange={open => setLinePopOpen(open ? idx : null)}>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className="w-full justify-between h-9 font-normal text-sm truncate"
                                >
                                  <span className={cn("truncate", !line.description && "text-muted-foreground")}>
                                    {line.description || "Type or pick a product…"}
                                  </span>
                                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-72 p-0" align="start">
                                <Command>
                                  <CommandInput
                                    placeholder="Search or type description…"
                                    value={line.description}
                                    onValueChange={v => setLine(idx, { description: v })}
                                  />
                                  <CommandList>
                                    <CommandEmpty>
                                      <span className="text-xs text-muted-foreground">
                                        No match — will use typed text as description
                                      </span>
                                    </CommandEmpty>
                                    {products.length > 0 && (
                                      <CommandGroup heading="Products">
                                        {products.map(p => (
                                          <CommandItem
                                            key={`prod-${p.id}`}
                                            value={p.name}
                                            onSelect={() => {
                                              setLine(idx, { description: p.name, unit_price: p.price, hsn_code: p.hsn_code || hsnMap[p.name] || "", gst_rate: p.gst_rate, unit: p.unit || "Nos" });
                                              setLinePopOpen(null);
                                            }}
                                          >
                                            <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", line.description === p.name ? "opacity-100" : "opacity-0")} />
                                            <span className="flex-1">{p.name}</span>
                                            <span className="text-xs text-muted-foreground ml-2">₹{p.price.toLocaleString("en-IN")} · {p.gst_rate}% GST{p.unit ? ` · ${p.unit}` : ""}</span>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    )}
                                    {customDescs.length > 0 && (
                                      <CommandGroup heading="Previously used">
                                        {customDescs.map(d => (
                                          <CommandItem
                                            key={`custom-${d}`}
                                            value={d}
                                            onSelect={() => {
                                              setLine(idx, { description: d, hsn_code: hsnMap[d] || "" });
                                              setLinePopOpen(null);
                                            }}
                                          >
                                            <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", line.description === d ? "opacity-100" : "opacity-0")} />
                                            {d}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    )}
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </td>
                          <td className="px-2 py-1 w-28">
                            <Input value={line.hsn_code} onChange={e => setLine(idx, { hsn_code: e.target.value })} placeholder="44013" className="w-full" />
                          </td>
                          <td className="px-2 py-1 w-24">
                            <Input type="number" min="0.01" step="0.01" value={String(line.quantity)} onChange={e => setLine(idx, { quantity: toNumber(e.target.value) })} className="text-right w-full" />
                          </td>
                          <td className="px-2 py-1 w-24">
                            <UnitSelect value={line.unit} onChange={v => setLine(idx, { unit: v })} />
                          </td>
                          <td className="px-2 py-1 w-32">
                            <Input type="number" min="0" step="0.01" value={String(line.unit_price)} onChange={e => setLine(idx, { unit_price: toNumber(e.target.value) })} className="text-right w-full" />
                          </td>
                          <td className="px-2 py-1 w-28">
                            <Select value={String(line.gst_rate)} onValueChange={v => setLine(idx, { gst_rate: toNumber(v) })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>{GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-2 text-right font-medium text-card-foreground">{inr(lineTotal)}</td>
                          <td className="px-2 py-1 text-center">
                            <Button size="icon" variant="ghost" disabled={newForm.lines.length === 1} onClick={() => setNewForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollableX>

              {/* Live totals preview */}
              {(() => {
                const subtotal    = newForm.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
                const rawGst     = newForm.lines.reduce((s, l) => s + l.quantity * l.unit_price * l.gst_rate / 100, 0);
                const delivery   = parseFloat(newForm.delivery_fee) || 0;
                const discount   = parseFloat(newForm.discount) || 0;
                const taxable    = Math.max(0, subtotal - discount);
                const gstTotal   = subtotal > 0 ? rawGst * (taxable / subtotal) : 0;
                const rawTotal   = taxable + gstTotal + delivery;
                const total      = Math.round(rawTotal);
                const roundOff   = total - rawTotal;
                const interState = newForm.customer_state.trim().toLowerCase() !== newForm.seller_state.trim().toLowerCase();
                return (
                  <div className="mt-3 flex justify-end">
                    <div className="w-64 space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{inr(subtotal)}</span></div>
                      {interState
                        ? <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>{inr(gstTotal)}</span></div>
                        : <>
                            <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{inr(gstTotal / 2)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{inr(gstTotal / 2)}</span></div>
                          </>
                      }
                      {delivery > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span>{inr(delivery)}</span></div>}
                      {discount > 0 && <div className="flex justify-between text-destructive"><span>Discount</span><span>− {inr(discount)}</span></div>}
                      {Math.abs(roundOff) >= 0.005 && <div className="flex justify-between"><span className="text-muted-foreground">Round Off</span><span>{roundOff >= 0 ? "+" : "−"} ₹{Math.abs(roundOff).toFixed(2)}</span></div>}
                      <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span className="text-primary">{inr(total)}</span></div>
                    </div>
                  </div>
                );
              })()}
              <p className="text-xs text-muted-foreground mt-1">CGST+SGST when states match; IGST otherwise.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={newSaving}>Cancel</Button>
            <Button onClick={createInvoice} disabled={newSaving} className="gap-2">
              {newSaving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <FileText className="h-4 w-4" />}
              Create Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Invoice Dialog ─────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={(v) => { if (!editSaving) setEditOpen(v); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Invoice</DialogTitle>
            <DialogDescription>Update invoice details and line items. Totals are recalculated on save.</DialogDescription>
          </DialogHeader>
          {editLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-6 py-2">
              {/* Customer Details */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">Customer Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Company / Customer Name <span className="text-destructive">*</span></Label>
                    <Popover open={editCompanyPopOpen} onOpenChange={setEditCompanyPopOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="w-full justify-between font-normal mt-1">
                          <span className={cn("truncate", !editForm.customer_name && "text-muted-foreground")}>
                            {editForm.customer_name || "Search or type a name…"}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search company…" value={editForm.customer_name} onValueChange={v => setEditForm(f => ({ ...f, customer_name: v }))} />
                          <CommandList>
                            <CommandEmpty><span className="text-xs text-muted-foreground">No match — typed name will be used.</span></CommandEmpty>
                            <CommandGroup>
                              {companies.map(c => (
                                <CommandItem key={c.label} value={c.label} onSelect={() => {
                                  setEditForm(f => ({ ...f, customer_name: c.label, customer_gstin: c.gstin || f.customer_gstin, customer_state: c.state || f.customer_state, address_line: c.address || f.address_line }));
                                  setEditCompanyPopOpen(false);
                                }}>
                                  <Check className={cn("mr-2 h-4 w-4 shrink-0", editForm.customer_name === c.label ? "opacity-100" : "opacity-0")} />
                                  {c.label}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <Label>GSTIN</Label>
                    <div className="flex gap-2 mt-1">
                      <Input value={editForm.customer_gstin} onChange={e => { const v = e.target.value.toUpperCase(); const st = stateFromGstin(v); setEditForm(f => ({ ...f, customer_gstin: v, ...(st ? { customer_state: st } : {}) })); }} placeholder="e.g. 33AABCI1234A1Z5" className="font-mono flex-1" />
                      <Button type="button" variant="outline" size="sm" disabled={gstFetching} className="shrink-0"
                        onClick={async () => {
                          const gstin = editForm.customer_gstin.trim().toUpperCase();
                          if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) { toast.error("Enter a valid GSTIN first"); return; }
                          setGstFetching(true);
                          try {
                            const d = await fetchGstinDetails(gstin, editForm.seller_state);
                            const name = gstinCompanyName(d);
                            const addr = (d.address_line || d.address || "").trim();
                            setEditForm(f => ({
                              ...f,
                              customer_gstin: gstin,
                              customer_state: d.state || f.customer_state,
                              ...(addr ? { address_line: addr } : {}),
                              ...(d.city ? { city: d.city } : {}),
                              ...(d.pincode ? { pincode: d.pincode } : {}),
                              ...(name ? { customer_name: name } : {}),
                            }));
                            if (name || addr || d.city || d.pincode || (d.status && d.status !== "Unknown")) {
                              toast.success(name ? `Filled: ${name}` : "GST details filled");
                            } else if (d.lookup_status === "fallback") {
                              toast.info(`${d.lookup_error || "GST portal details unavailable"}. State/tax filled from GSTIN.`);
                            } else {
                              toast.info(`GSTIN valid: ${d.tax_type}`);
                            }
                          } catch { const st = stateFromGstin(gstin); if (st) { setEditForm(f => ({ ...f, customer_state: st })); toast.info(`State: ${st}`); } }
                          finally { setGstFetching(false); }
                        }}>
                        {gstFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label>Customer State <span className="text-destructive">*</span></Label>
                    <Input className="mt-1" value={editForm.customer_state} onChange={e => setEditForm(f => ({ ...f, customer_state: e.target.value }))} placeholder="e.g. Tamil Nadu" />
                  </div>
                  <div>
                    <Label>Seller State</Label>
                    <Input className="mt-1" value={editForm.seller_state} onChange={e => setEditForm(f => ({ ...f, seller_state: e.target.value }))} placeholder="e.g. Tamil Nadu" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Address Line</Label>
                    <Input className="mt-1" value={editForm.address_line} onChange={e => setEditForm(f => ({ ...f, address_line: e.target.value }))} placeholder="Street / Area / Building" />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Input className="mt-1" value={editForm.city} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} placeholder="e.g. Chennai" />
                  </div>
                  <div>
                    <Label>Pincode</Label>
                    <Input className="mt-1" value={editForm.pincode} onChange={e => setEditForm(f => ({ ...f, pincode: e.target.value }))} placeholder="e.g. 600001" maxLength={10} />
                  </div>
                  <div>
                    <Label>Country</Label>
                    <Input className="mt-1" value={editForm.country} onChange={e => setEditForm(f => ({ ...f, country: e.target.value }))} placeholder="e.g. India" />
                  </div>
                </div>
              </div>
              {/* Invoice Details */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">Invoice Details</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <Label>Invoice No.</Label>
                    <Input className="mt-1" value={editForm.invoice_number} onChange={e => setEditForm(f => ({ ...f, invoice_number: e.target.value }))} placeholder="INV-2026-0001" />
                  </div>
                  <div>
                    <Label>Invoice Date</Label>
                    <Input className="mt-1" type="date" value={editForm.invoice_date} onChange={e => setEditForm(f => ({ ...f, invoice_date: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Due Date</Label>
                    <Input className="mt-1" type="date" value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Draft","Sent","Paid","Overdue","Cancelled"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Payment Method</Label>
                    <Select value={editForm.payment_method || "__none"} onValueChange={v => setEditForm(f => ({ ...f, payment_method: v === "__none" ? "" : v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">—</SelectItem>
                        {["cash","card","upi","bank_transfer","cheque"].map(m => <SelectItem key={m} value={m}>{m.replace("_"," ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Payment Status</Label>
                    <Select value={editForm.payment_status} onValueChange={v => setEditForm(f => ({ ...f, payment_status: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unpaid">Unpaid</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="refunded">Refunded</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Delivery Fee (₹)</Label>
                    <Input className="mt-1" type="number" min="0" step="0.01" value={editForm.delivery_fee} onChange={e => setEditForm(f => ({ ...f, delivery_fee: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Discount (₹)</Label>
                    <Input className="mt-1" type="number" min="0" step="0.01" value={editForm.discount} onChange={e => setEditForm(f => ({ ...f, discount: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <Label>Payment Terms</Label>
                    <Input className="mt-1" value={editForm.payment_terms} onChange={e => setEditForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder="Due on Receipt" />
                  </div>
                  <div>
                    <Label>Place of Supply</Label>
                    <Input className="mt-1" value={editForm.place_of_supply} onChange={e => setEditForm(f => ({ ...f, place_of_supply: e.target.value }))} placeholder="33-Tamil Nadu" />
                  </div>
                  <div className="col-span-2">
                    <Label>Subject</Label>
                    <Input className="mt-1" value={editForm.subject} onChange={e => setEditForm(f => ({ ...f, subject: e.target.value }))} placeholder="Auto from products if left blank" />
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <Label>Ship To <span className="font-normal text-muted-foreground">(blank = same as customer)</span></Label>
                    <Textarea className="mt-1" rows={3} value={editForm.ship_to} onChange={e => setEditForm(f => ({ ...f, ship_to: e.target.value }))} placeholder="Shipping name, address, GSTIN…" />
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <Label>Notes</Label>
                    <Textarea className="mt-1" rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <Label>Terms &amp; Conditions</Label>
                    <Textarea
                      className="mt-1 font-mono text-xs"
                      rows={6}
                      value={editForm.terms_and_conditions}
                      onChange={e => {
                        const v = e.target.value;
                        setEditForm(f => ({ ...f, terms_and_conditions: v }));
                        try { localStorage.setItem("eco_inv_terms", v); } catch { /* localStorage can be unavailable in private mode */ }
                      }}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Each line = one term. Saved as default for future invoices.</p>
                  </div>
                </div>
              </div>
              {/* Line Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Line Items <span className="text-destructive">*</span></p>
                  <Button size="sm" variant="outline" onClick={() => setEditForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))}><Plus className="h-4 w-4" /> Add line</Button>
                </div>
                <ScrollableX className="border rounded-lg">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-2 py-2 min-w-52">Product / Description</th>
                        <th className="text-left px-2 py-2 w-28">HSN/SAC</th>
                        <th className="text-right px-2 py-2 w-24">Qty</th>
                        <th className="text-left px-2 py-2 w-24">Unit</th>
                        <th className="text-right px-2 py-2 w-32">Rate (₹)</th>
                        <th className="text-right px-2 py-2 w-28">GST</th>
                        <th className="text-right px-2 py-2 w-28">Line Total</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editForm.lines.map((line, idx) => {
                        const lineTotal = line.quantity * line.unit_price;
                        return (
                          <tr key={idx} className="border-t">
                            <td className="px-2 py-1 min-w-[240px]">
                              <Popover open={editLinePopOpen === idx} onOpenChange={open => setEditLinePopOpen(open ? idx : null)}>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" role="combobox" className="w-full justify-between h-9 font-normal text-sm">
                                    <span className={cn("truncate", !line.description && "text-muted-foreground")}>{line.description || "Type or pick a product…"}</span>
                                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder="Search or type description…" value={line.description} onValueChange={v => setEditLine(idx, { description: v })} />
                                    <CommandList>
                                      <CommandEmpty><span className="text-xs text-muted-foreground">Will use typed text</span></CommandEmpty>
                                      {products.length > 0 && (
                                        <CommandGroup heading="Products">
                                          {products.map(p => (
                                            <CommandItem key={`ep-${p.id}`} value={p.name} onSelect={() => { setEditLine(idx, { description: p.name, unit_price: p.price, hsn_code: p.hsn_code || hsnMap[p.name] || "", gst_rate: p.gst_rate, unit: p.unit || "Nos" }); setEditLinePopOpen(null); }}>
                                              <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", line.description === p.name ? "opacity-100" : "opacity-0")} />
                                              <span className="flex-1">{p.name}</span>
                                              <span className="text-xs text-muted-foreground ml-2">₹{p.price.toLocaleString("en-IN")}</span>
                                            </CommandItem>
                                          ))}
                                        </CommandGroup>
                                      )}
                                      {customDescs.length > 0 && (
                                        <CommandGroup heading="Previously used">
                                          {customDescs.map(d => (
                                            <CommandItem key={`ec-${d}`} value={d} onSelect={() => { setEditLine(idx, { description: d, hsn_code: hsnMap[d] || "" }); setEditLinePopOpen(null); }}>
                                              <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", line.description === d ? "opacity-100" : "opacity-0")} />
                                              {d}
                                            </CommandItem>
                                          ))}
                                        </CommandGroup>
                                      )}
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </td>
                            <td className="px-2 py-1 w-28"><Input value={line.hsn_code} onChange={e => setEditLine(idx, { hsn_code: e.target.value })} placeholder="44013" className="w-full" /></td>
                            <td className="px-2 py-1 w-24"><Input type="number" min="0.01" step="0.01" value={String(line.quantity)} onChange={e => setEditLine(idx, { quantity: toNumber(e.target.value) })} className="text-right w-full" /></td>
                            <td className="px-2 py-1 w-24"><UnitSelect value={line.unit} onChange={v => setEditLine(idx, { unit: v })} /></td>
                            <td className="px-2 py-1 w-32"><Input type="number" min="0" step="0.01" value={String(line.unit_price)} onChange={e => setEditLine(idx, { unit_price: toNumber(e.target.value) })} className="text-right w-full" /></td>
                            <td className="px-2 py-1">
                              <Select value={String(line.gst_rate)} onValueChange={v => setEditLine(idx, { gst_rate: toNumber(v) })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
                              </Select>
                            </td>
                            <td className="px-2 py-2 text-right font-medium">{inr(lineTotal)}</td>
                            <td className="px-2 py-1 text-center">
                              <Button size="icon" variant="ghost" disabled={editForm.lines.length === 1} onClick={() => setEditForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollableX>
                {/* Live totals */}
                {(() => {
                  const subtotal   = editForm.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
                  const rawGst     = editForm.lines.reduce((s, l) => s + l.quantity * l.unit_price * l.gst_rate / 100, 0);
                  const delivery   = parseFloat(editForm.delivery_fee) || 0;
                  const discount   = parseFloat(editForm.discount) || 0;
                  const taxable    = Math.max(0, subtotal - discount);
                  const gstTotal   = subtotal > 0 ? rawGst * (taxable / subtotal) : 0;
                  const rawTotal   = taxable + gstTotal + delivery;
                  const total      = Math.round(rawTotal);
                  const roundOff   = total - rawTotal;
                  const interState = editForm.customer_state.trim().toLowerCase() !== editForm.seller_state.trim().toLowerCase();
                  return (
                    <div className="mt-3 flex justify-end">
                      <div className="text-sm space-y-1 text-right text-muted-foreground">
                        <div>Subtotal: <span className="text-foreground font-medium">{inr(subtotal)}</span></div>
                        <div>{interState ? "IGST" : "CGST+SGST"}: <span className="text-foreground font-medium">{inr(gstTotal)}</span></div>
                        {delivery > 0 && <div>Delivery: <span className="text-foreground font-medium">{inr(delivery)}</span></div>}
                        {discount > 0 && <div className="text-destructive">Discount: <span className="font-medium">− {inr(discount)}</span></div>}
                        {Math.abs(roundOff) >= 0.005 && <div>Round Off: <span className="text-foreground font-medium">{roundOff >= 0 ? "+" : "−"} ₹{Math.abs(roundOff).toFixed(2)}</span></div>}
                        <div className="font-semibold text-foreground border-t pt-1">Total: {inr(total)}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editSaving || editLoading} className="gap-2">
              {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice {selected?.id}</DialogTitle>
            <DialogDescription>Invoice details and GST breakdown.</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Order:</span><p className="font-medium text-card-foreground">{selected.orderId}</p></div>
                <div><span className="text-muted-foreground">Date:</span><p className="font-medium text-card-foreground">{selected.date}</p></div>
                <div><span className="text-muted-foreground">Customer:</span><p className="font-medium text-card-foreground">{selected.customer}</p></div>
                <div><span className="text-muted-foreground">GSTIN:</span><p className="font-medium text-card-foreground font-mono text-xs">{selected.gst}</p></div>
                <div><span className="text-muted-foreground">Order Status:</span><p className="font-medium text-card-foreground">{selected.orderStatus}</p></div>
                <div><span className="text-muted-foreground">Payment Status:</span><p className="font-medium text-card-foreground">{selected.paymentStatus}</p></div>
                <div><span className="text-muted-foreground">Payment Method:</span><p className="font-medium text-card-foreground">{selected.paymentMethod}</p></div>
                {selected.trackingNumber && (
                  <div><span className="text-muted-foreground">Tracking Number:</span><p className="font-medium text-card-foreground font-mono text-xs">{selected.trackingNumber}</p></div>
                )}
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-semibold">Balance Due</p>
                  <p className="text-xl font-bold text-card-foreground">{inr(selected.balanceDueValue)}</p>
                  <p className="text-xs text-muted-foreground">Paid {inr(selected.amountPaidValue)} of {selected.total}</p>
                </div>
                <Button size="sm" onClick={openRecordPayment} disabled={selected.balanceDueValue <= 0}>
                  <CreditCard className="h-4 w-4" /> Record Payment
                </Button>
              </div>

              <div className="border-t pt-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Payment Receipts</h4>
                <ScrollableX className="border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Receipt</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Date</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Mode</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Reference</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoicePayments.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No payments recorded yet.</td></tr>
                      )}
                      {invoicePayments.map((p) => (
                        <tr key={p.payment_id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium text-card-foreground">{p.payment_number || p.payment_id}</td>
                          <td className="px-3 py-2 text-muted-foreground">{p.paid_on || p.payment_date || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{p.payment_mode || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{p.reference_no || p.reference_number || "—"}</td>
                          <td className="px-3 py-2 text-right font-medium text-card-foreground">{inr(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableX>
              </div>

              <div className="border-t pt-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Line Items</h4>
                <ScrollableX className="border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Product</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Size</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">HSN</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Qty</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Unit Price</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">GST</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((item, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium text-card-foreground">{item.product}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.size}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.hsn || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.qty}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.unitPrice}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.gstRate}%</td>
                          <td className="px-3 py-2 text-right font-medium text-card-foreground">{item.lineTotal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableX>
              </div>

              <div className="border-t pt-3 space-y-2">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-medium text-card-foreground">{selected.subtotal}</span></div>
                {selected.igstAmountValue > 0 ? (
                  <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="font-medium text-card-foreground">{inr(selected.igstAmountValue)}</span></div>
                ) : selected.cgstAmountValue > 0 || selected.sgstAmountValue > 0 ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="font-medium text-card-foreground">{inr(selected.cgstAmountValue)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="font-medium text-card-foreground">{inr(selected.sgstAmountValue)}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span className="font-medium text-card-foreground">{selected.gstAmount}</span></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Delivery Fee</span><span className="font-medium text-card-foreground">{selected.deliveryFee}</span></div>
                <div className="flex justify-between border-t pt-2"><span className="font-semibold text-card-foreground">Total</span><span className="font-bold text-primary text-lg">{selected.total}</span></div>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className={`text-xs px-3 py-1 rounded-full font-medium ${paymentStatusColors[selected.paymentStatus] ?? "bg-muted text-muted-foreground"}`}>
                  {selected.paymentStatus}
                </span>
                <div className="flex gap-2">
                  {selected.paymentMethod === "Cash" && (
                    <Button size="sm" variant="outline" onClick={() => downloadCashBillForInvoice(selected)} disabled={downloadBusy} className="gap-1.5" title="Sri Vari Cash Bill (cash sale)">
                      <IndianRupee className="h-3.5 w-3.5" /> Cash Bill
                    </Button>
                  )}
                  <Button size="sm" onClick={() => downloadInvoice(selected)} disabled={downloadBusy} className="gap-1.5">
                    {downloadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download PDF
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Post a receipt against invoice {selected?.id}.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Amount</Label>
              <Input className="mt-1" type="number" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Paid on</Label>
              <Input className="mt-1" type="date" value={paymentForm.paid_on} onChange={e => setPaymentForm(f => ({ ...f, paid_on: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={paymentForm.payment_mode} onValueChange={v => setPaymentForm(f => ({ ...f, payment_mode: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{["Cash", "Bank Transfer", "UPI", "Cheque", "Card"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reference</Label>
              <Input className="mt-1" value={paymentForm.reference_no} onChange={e => setPaymentForm(f => ({ ...f, reference_no: e.target.value }))} placeholder="UTR / cheque no" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea className="mt-1" value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)} disabled={paymentSaving}>Cancel</Button>
            <Button onClick={recordPayment} disabled={paymentSaving}>
              {paymentSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Save Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Total sales summary — current, past, and combined (like the Expenses page) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Current Sales"
          value={inr(currentTotal)}
          subtitle={`${invoices.length} invoice(s)`}
          icon={IndianRupee}
        />
        <StatCard
          title="Past Sales"
          value={inr(pastTotal)}
          subtitle={`${historicalCount} invoice(s)`}
          icon={FileText}
        />
        <StatCard
          title="Total Sales"
          value={inr(currentTotal + pastTotal)}
          subtitle="current + past"
          icon={IndianRupee}
        />
      </div>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-4 border-b flex flex-wrap items-center gap-3">
          {/* Current vs Past (imported) invoices toggle */}
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setView("current")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                view === "current" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Current
            </button>
            <button
              type="button"
              onClick={() => setView("past")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                view === "past" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Past invoices
            </button>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={view === "past" ? "Search past invoices..." : "Search invoices..."}
              className="pl-10"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {view === "past" && (
            <p className="text-xs text-muted-foreground">
              Historical invoices imported via Data Upload (read-only).
            </p>
          )}
        </div>
        <ScrollableX>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Invoice</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Order</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Customer</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Items</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Total</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Payment</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-primary">{inv.id}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">{inv.invoiceDate || inv.date || "—"}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{inv.orderId}</td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-card-foreground">{inv.customer}</p>
                    <p className="text-xs text-muted-foreground font-mono">{inv.gst}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{inv.items.length} item(s)</td>
                  <td className="px-6 py-4 text-sm font-semibold text-card-foreground">{inv.total}</td>
                  <td className="px-6 py-4 text-sm">
                    <div className="space-y-1">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${paymentStatusColors[inv.paymentStatus] ?? "bg-muted text-muted-foreground"}`}>
                        {inv.paymentStatus}
                      </span>
                      <p className="text-xs text-muted-foreground">Due {inr(inv.balanceDueValue)}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-3 py-1 rounded-full font-medium ${orderStatusColors[inv.orderStatus] ?? "bg-muted text-muted-foreground"}`}>
                      {inv.orderStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right flex items-center justify-end gap-1">
                    {view === "past" ? (
                      <button onClick={() => downloadHistorical(inv)} disabled={downloadBusy} className="p-1.5 hover:bg-muted rounded-lg disabled:opacity-50" title="Download PDF"><Download className="h-4 w-4 text-muted-foreground" /></button>
                    ) : (
                      <>
                        <button onClick={() => viewInvoice(inv)} className="p-1.5 hover:bg-muted rounded-lg" title="View"><Eye className="h-4 w-4 text-muted-foreground" /></button>
                        <button onClick={() => openEditInvoice(inv)} className="p-1.5 hover:bg-muted rounded-lg" title="Edit"><Pencil className="h-4 w-4 text-muted-foreground" /></button>
                        <button onClick={() => downloadInvoice(inv)} disabled={downloadBusy} className="p-1.5 hover:bg-muted rounded-lg disabled:opacity-50" title="Download PDF"><Download className="h-4 w-4 text-muted-foreground" /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">{view === "past" ? "No past invoices found" : "No invoices found"}</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>

        {/* Load more — past view only, while more rows exist in the DB than are loaded */}
        {view === "past" && historical.length < historicalCount && (
          <div className="flex items-center justify-center gap-3 p-4 border-t">
            <span className="text-sm text-muted-foreground">
              Showing {historical.length} of {historicalCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadHistorical(historicalPage + 1)}
              disabled={historicalLoadingMore}
            >
              {historicalLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
