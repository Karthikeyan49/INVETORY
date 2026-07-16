import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Trash2, FileDown, Pencil, FileText, ChevronLeft, GripVertical, Library, Package, Sparkles, Search, ReceiptText, ChevronUp, ChevronDown, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  listQuotations, getQuotation, createQuotation, updateQuotation, deleteQuotation,
  QUOTATION_KINDS,
  type QuotationListRow, type QuotationItem, type QuotationInput, type QuotationKind, type Quotation,
} from "@/lib/api/quotations";
import { downloadQuotation as downloadSrivariQuotation, type QuotationRow as SrivariRow } from "@/lib/srivariQuotationPdf";
import { createDelivery } from "@/lib/api/deliveries";
import { type LibraryComponent } from "@/lib/api/components";
import { type UIProduct, type ApiProduct } from "@/lib/api/products";
import { fetchMachines, type Machine } from "@/lib/api/machines";
import { fetchSpares, type Spare } from "@/lib/api/spares";
import { invoicesApi, GST_RATES } from "@/lib/api/invoices";
import { settingsApi } from "@/lib/api/settings";
import { stateFromGstin } from "@/lib/gstState";
import { parseQuotationPrompt } from "@/lib/quotationPrompt";
import { downloadQuotationPdf } from "@/lib/quotationPdf";
import { addOption, mergedOptions } from "@/lib/fieldOptions";
import { expandKit, loadKitRules } from "@/lib/quotationKit";
import { KitRulesDialog } from "@/components/KitRulesDialog";

// Sensible default units seeded into the unit dropdown.
const DEFAULT_UNITS = ["Nos", "Set", "Mtr", "Kg", "Ltr", "Hrs"];

const DEFAULT_TERMS = "1. 50% Advance payment\n2. 50% at Delivery\n3. Freight Charge Extra";
const GST_OPTIONS = [0, 5, 12, 18, 28];
const today = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const suggestRef = () => `VB_TN-${Date.now() % 10000}`;

// The quotation palette is sourced from real inventory: Machines become the
// draggable line items, Spares become the draggable components. Each is adapted
// into the builder's existing internal shapes so the rest of the page is unchanged.
function machineToPalette(m: Machine): UIProduct {
  const price = Number(m.sale_price ?? 0);
  const gst = Number(m.sale_gst_pct ?? 18);
  const name = [m.model, m.code].filter(Boolean).join(" — ") || m.code;
  return {
    id: m.id,
    product: name,
    sizes: [],
    purposes: [],
    subPurposes: {},
    description: [m.accuracy, m.platform_size, m.capacity].filter(Boolean).join(" · "),
    category: m.category || "Machines",
    gstRate: gst,
    minOrderQty: 1,
    imageUrl: "",
    _raw: { base_price: price, unit: "Nos", gst_rate: gst, product_name: name } as unknown as ApiProduct,
  };
}
function spareToLibrary(s: Spare): LibraryComponent {
  return {
    component_id: s.id,
    name: s.name,
    make: s.part_no ?? undefined,
    default_unit: s.unit ?? undefined,
    default_qty: 1,
    category: s.category ?? undefined,
  };
}

const blankComponent = () => ({ group: "", name: "", make: "", qty: 1 });
const blankItem = (): QuotationItem => ({
  name: "", make: "", qty: 1, unit: "Nos", rate: 0, amount: 0, specifications: "",
  capacity: "", accuracy: "", platform_size: "",
  gst_rate: 18, components: [],
});

// Which spec columns each Sri Vari format actually prints — drives which
// fields the item form shows (capacity/accuracy everywhere but Service;
// platform size only on Retail/Industrial, matching the four PDF layouts).
const kindSpecFields = (kind: QuotationKind) => ({
  capacity: kind !== "service",
  accuracy: kind !== "service",
  platformSize: kind === "retail" || kind === "industrial",
});

type Header = {
  customer_name: string; customer_address: string; customer_gstin: string;
  customer_contact: string; customer_contact_phone: string;
  particular: string; reference_no: string; system_title: string;
  quotation_kind: QuotationKind;
  prepared_by_name: string; prepared_by_designation: string; prepared_by_phone: string;
  quotation_date: string; gst_rate: number;
  advance_amount: number; advance_date: string;
  terms: string; notes: string;
};
const blankHeader = (): Header => ({
  customer_name: "", customer_address: "", customer_gstin: "",
  customer_contact: "", customer_contact_phone: "",
  particular: "", reference_no: suggestRef(), system_title: "",
  quotation_kind: "retail",
  prepared_by_name: "", prepared_by_designation: "", prepared_by_phone: "",
  quotation_date: today(), gst_rate: 18,
  advance_amount: 0, advance_date: "",
  terms: DEFAULT_TERMS, notes: "",
});

export default function QuotationBuilder() {
  const navigate = useNavigate();
  const [view, setView] = useState<"list" | "form">("list");
  // Ask which Sri Vari letterhead format to use before opening a new quotation.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rows, setRows] = useState<QuotationListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [header, setHeader] = useState<Header>(blankHeader());
  // Start with no line items — the user adds them by drag-and-drop, the + on a
  // product chip, or the "Add Item" button. No empty placeholder row.
  const [items, setItems] = useState<QuotationItem[]>([]);

  // ── component library ─────────────────────────────────────────────────────
  const [library, setLibrary] = useState<LibraryComponent[]>([]);
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);

  // ── products palette ──────────────────────────────────────────────────────
  const [products, setProducts] = useState<UIProduct[]>([]);
  const [prodStatus, setProdStatus] = useState<"loading" | "ready" | "error">("loading");
  const [promptText, setPromptText] = useState("");
  const [dragOverItems, setDragOverItems] = useState(false);

  // ── palette search filters ────────────────────────────────────────────────
  const [libSearch, setLibSearch] = useState("");
  const [prodSearch, setProdSearch] = useState("");
  // Default T&C for new quotations, pulled from Settings.
  const [orgQuotationTerms, setOrgQuotationTerms] = useState("");
  // Collapse the floating palette to just its header (frees scroll space).
  const [paletteOpen, setPaletteOpen] = useState(true);

  // ── kit reasoning (auto-add required companions) ──────────────────────────
  const [autoKit, setAutoKit] = useState(true);
  const [kitOpen, setKitOpen] = useState(false);

  // ── persistent field-option dropdowns ─────────────────────────────────────
  // Bumped whenever a new value is persisted so the <datalist>s re-render.
  const [optTick, setOptTick] = useState(0);
  const remember = (field: string, value: string) => {
    const before = mergedOptions(field).length;
    addOption(field, value);
    if (mergedOptions(field).length !== before) setOptTick((t) => t + 1);
  };

  const loadLibrary = () =>
    fetchSpares({})
      .then(({ rows }) => setLibrary(rows.map(spareToLibrary)))
      .catch(() => { /* spares palette is best-effort; don't block the page */ });

  const load = () => {
    setLoading(true);
    listQuotations().then(setRows).catch((e) => toast.error(e?.message ?? "Failed to load quotations")).finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => { loadLibrary(); }, []);
  useEffect(() => {
    setProdStatus("loading");
    fetchMachines({ limit: 500 })
      .then(({ rows }) => { setProducts(rows.map(machineToPalette)); setProdStatus("ready"); })
      .catch(() => { setProdStatus("error"); });
  }, []);
  // Default quotation terms from Settings (pre-fills new quotations; editable).
  useEffect(() => {
    settingsApi.get().then((s) => setOrgQuotationTerms((s.quotation_terms || "").trim())).catch(() => { /* optional */ });
  }, []);

  const subtotal = useMemo(() => items.reduce((s, it) => s + (Number(it.amount) || 0), 0), [items]);
  // Group GST by per-item rate (missing → 18). Each group → { rate, base, gst }.
  const gstGroups = useMemo(() => {
    const map = new Map<number, { base: number; gst: number }>();
    for (const it of items) {
      const rate = Number(it.gst_rate ?? 18);
      const amount = Number(it.amount) || 0;
      const cur = map.get(rate) ?? { base: 0, gst: 0 };
      cur.base += amount;
      cur.gst += (amount * rate) / 100;
      map.set(rate, cur);
    }
    return Array.from(map.entries())
      .map(([rate, v]) => ({ rate, ...v }))
      .sort((a, b) => a.rate - b.rate);
  }, [items]);
  const gstTotal = useMemo(() => gstGroups.reduce((s, g) => s + g.gst, 0), [gstGroups]);
  const grandTotal = subtotal + gstTotal;
  const advance = Number(header.advance_amount) || 0;
  const balance = grandTotal - advance;

  // ── form helpers ──────────────────────────────────────────────────────────
  const setH = (k: keyof Header, v: any) => setHeader((h) => ({ ...h, [k]: v }));
  const updItem = (i: number, patch: Partial<QuotationItem>) =>
    setItems((arr) => arr.map((it, idx) => {
      if (idx !== i) return it;
      const next = { ...it, ...patch };
      if (("qty" in patch || "rate" in patch) && !("amount" in patch)) next.amount = (Number(next.qty) || 0) * (Number(next.rate) || 0);
      return next;
    }));
  const addItem = () => setItems((a) => [...a, blankItem()]);
  const delItem = (i: number) => setItems((a) => a.filter((_, idx) => idx !== i));
  const addComp = (i: number) => setItems((a) => a.map((it, idx) => idx === i ? { ...it, components: [...it.components, blankComponent()] } : it));
  const updComp = (i: number, ci: number, patch: any) =>
    setItems((a) => a.map((it, idx) => idx === i ? { ...it, components: it.components.map((c, cj) => cj === ci ? { ...c, ...patch } : c) } : it));
  const delComp = (i: number, ci: number) =>
    setItems((a) => a.map((it, idx) => idx === i ? { ...it, components: it.components.filter((_, cj) => cj !== ci) } : it));

  // ── library helpers ───────────────────────────────────────────────────────
  // Unique library names for the shared <datalist>.
  const libNames = useMemo(() => {
    const seen = new Set<string>();
    const out: LibraryComponent[] = [];
    for (const c of library) {
      const key = (c.name || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); out.push(c);
    }
    return out;
  }, [library]);

  // Library grouped by category for the palette, filtered by the search box.
  const libByCategory = useMemo(() => {
    const q = libSearch.trim().toLowerCase();
    const groups = new Map<string, LibraryComponent[]>();
    for (const c of library) {
      if (q && ![c.name, c.make, c.category].some((f) => (f || "").toLowerCase().includes(q))) continue;
      const cat = (c.category || "").trim() || "Uncategorised";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(c);
    }
    return Array.from(groups.entries());
  }, [library, libSearch]);

  // ── products palette helpers ──────────────────────────────────────────────
  // Products grouped by category for the palette, filtered by the search box.
  const productsByCategory = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    const groups = new Map<string, UIProduct[]>();
    for (const p of products) {
      if (q && ![p.product, p.description, p.category].some((f) => (f || "").toLowerCase().includes(q))) continue;
      const cat = (p.category || "").trim() || "Uncategorised";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(p);
    }
    return Array.from(groups.entries());
  }, [products, prodSearch]);

  // Product names for the per-item product picker datalist.
  const productNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of products) {
      const key = (p.product || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); out.push(p.product);
    }
    return out;
  }, [products]);

  // ── persistent field-option lists (persisted + present values + defaults) ──
  // optTick is read so these recompute when a new option is persisted.
  const unitOptions = useMemo(
    () => mergedOptions("unit", DEFAULT_UNITS, items.map((it) => it.unit), products.map((p) => p._raw?.unit ?? null)),
    [items, products, optTick],
  );
  const makeOptions = useMemo(
    () => mergedOptions(
      "make",
      items.map((it) => it.make),
      items.flatMap((it) => (it.components || []).map((c) => c.make)),
      library.map((c) => c.make ?? null),
    ),
    [items, library, optTick],
  );
  const customerOptions = useMemo(
    () => mergedOptions("customer", rows.map((r) => r.customer_name)),
    [rows, optTick],
  );
  const groupOptions = useMemo(
    () => mergedOptions(
      "group",
      items.flatMap((it) => (it.components || []).map((c) => c.group)),
      library.map((c) => c.category ?? null),
    ),
    [items, library, optTick],
  );

  // Display price for a product chip: prefer raw base_price, else first size price string.
  const productPriceLabel = (p: UIProduct) =>
    p._raw?.base_price != null ? inr(p._raw.base_price) : (p.sizes[0]?.price ?? "—");

  // Build a new line item prefilled from a product.
  const itemFromProduct = (p: UIProduct): QuotationItem => {
    const rate = Number(p._raw?.base_price ?? 0);
    const qty = 1;
    return {
      name: p.product,
      make: "",
      qty,
      unit: p._raw?.unit ?? "Nos",
      rate,
      amount: rate * qty,
      specifications: p.description || p.category || "",
      capacity: "", accuracy: "", platform_size: "",
      gst_rate: Number(p._raw?.gst_rate ?? p.gstRate ?? 18),
      components: [],
    };
  };

  // ── Prompt → quotation (frontend-only, no AI backend) ──────────────────────
  // Parse a free-text request against the loaded product catalog and turn the
  // matched products + quantities into line items, plus an extracted customer.
  const buildFromPrompt = () => {
    const text = promptText.trim();
    if (!text) { toast.error("Type what you need, e.g. \"70 solar panels, 1 inverter 60kw for VELS\""); return; }
    if (products.length === 0) {
      if (prodStatus === "loading") toast.error("Machines are still loading — try again in a moment");
      else if (prodStatus === "error") toast.error("Couldn't load machines. Check you're signed in and the API is reachable, then reload.");
      else toast.error("No machines yet. Add machines first (Machines page), then build from a prompt.");
      return;
    }
    const parsed = parseQuotationPrompt(text, products);
    if (parsed.matches.length === 0) {
      toast.error("Couldn't match any machines. Use names from your Machines list (e.g. the model or code).");
      return;
    }
    const extra = parsed.unmatched.length ? ` · ${parsed.unmatched.length} not matched` : "";

    if (autoKit) {
      const mains = parsed.matches.map((m) => ({ product: m.product, qty: m.qty > 0 ? m.qty : 1 }));
      const exp = expandKit(mains, products, library, loadKitRules());

      // Each main line item, with its companion components attached.
      const mainItems: QuotationItem[] = mains.map((m) => {
        const base = itemFromProduct(m.product);
        const components = exp.itemComponents
          .filter((c) => c.mainName === m.product.product)
          .map((c) => ({ group: c.group, name: c.name, make: c.make, qty: c.qty }));
        return {
          ...base,
          qty: m.qty,
          amount: Number((m.qty * base.rate).toFixed(2)),
          components: [...base.components, ...components],
        };
      });

      // Companion products appended as new line items.
      const extraItems: QuotationItem[] = exp.extraItems.map(({ product, qty }) => {
        const base = itemFromProduct(product);
        const q = qty > 0 ? qty : 1;
        return { ...base, qty: q, amount: Number((q * base.rate).toFixed(2)) };
      });

      const newItems = [...mainItems, ...extraItems];
      setItems(newItems);
      if (parsed.customerName && !header.customer_name.trim()) setH("customer_name", parsed.customerName);
      const companions = extraItems.length;
      const comp = companions ? ` (+${companions} companion${companions === 1 ? "" : "s"})` : "";
      toast.success(`Added ${mainItems.length} item${mainItems.length === 1 ? "" : "s"}${comp} from prompt${extra}`);
      return;
    }

    const newItems: QuotationItem[] = parsed.matches.map((m) => {
      const base = itemFromProduct(m.product);
      const qty = m.qty > 0 ? m.qty : 1;
      return { ...base, qty, amount: Number((qty * base.rate).toFixed(2)) };
    });
    setItems(newItems);
    if (parsed.customerName && !header.customer_name.trim()) setH("customer_name", parsed.customerName);
    toast.success(`Added ${newItems.length} item${newItems.length === 1 ? "" : "s"} from prompt${extra}`);
  };

  // When a line item's product picker matches a product, auto-fill that item
  // (name/rate/unit/specifications) from the product, reusing itemFromProduct.
  const applyProductToItem = (i: number, productName: string) => {
    const name = productName.trim();
    const match = products.find((p) => (p.product || "").trim().toLowerCase() === name.toLowerCase());
    if (!match) return;
    const filled = itemFromProduct(match);
    updItem(i, {
      name: filled.name,
      rate: filled.rate,
      unit: filled.unit,
      specifications: filled.specifications,
      gst_rate: filled.gst_rate,
    });
  };

  // Append a new product-derived line item.
  const addProductItem = (p: UIProduct) => {
    setItems((a) => [...a, itemFromProduct(p)]);
    toast.success(`Added "${p.product}"`);
  };

  const compFromLibrary = (c: LibraryComponent) => ({
    group: c.category || "", name: c.name, make: c.make || "", qty: c.default_qty || 1,
  });

  // Append a library component to a specific item's components list.
  const appendLibToItem = (i: number, c: LibraryComponent) =>
    setItems((a) => a.map((it, idx) => idx === i ? { ...it, components: [...it.components, compFromLibrary(c)] } : it));

  // "+" on a chip: append to the LAST item.
  const addLibToLastItem = (c: LibraryComponent) => {
    if (items.length === 0) return;
    appendLibToItem(items.length - 1, c);
    toast.success(`Added "${c.name}" to Item ${items.length}`);
  };

  const onDropOnItem = (i: number, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverItem(null);
    // A product dropped on a single item's component zone should still create a
    // new line item (products are line items, not components).
    const prodRaw = e.dataTransfer.getData("application/x-product");
    if (prodRaw) {
      try {
        const p = JSON.parse(prodRaw) as UIProduct;
        if (p?.product) addProductItem(p);
      } catch { /* ignore malformed product payloads */ }
      return;
    }
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const c = JSON.parse(raw) as LibraryComponent;
      if (!c?.name) return;
      appendLibToItem(i, c);
    } catch { /* ignore malformed drag payloads */ }
  };

  // Drop target on the items container: a product drop appends a new line item.
  const onDropProduct = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverItems(false);
    const prodRaw = e.dataTransfer.getData("application/x-product");
    if (!prodRaw) return;
    try {
      const p = JSON.parse(prodRaw) as UIProduct;
      if (p?.product) addProductItem(p);
    } catch { /* ignore malformed product payloads */ }
  };

  // Only react to product drags over the container (let component drags fall
  // through to the per-item zones unchanged).
  const onItemsDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-product")) return;
    e.preventDefault();
    if (!dragOverItems) setDragOverItems(true);
  };

  // When a component name matches a library entry, auto-fill its make.
  const autofillFromLibrary = (i: number, ci: number, name: string) => {
    const match = library.find((c) => (c.name || "").trim().toLowerCase() === name.trim().toLowerCase());
    if (match) updComp(i, ci, { name, make: match.make || "" });
  };

  // Spares are now the component palette; they're managed on the Spares page, so
  // the quotation no longer creates/deletes/syncs its own component records.
  const syncLibraryFromItems = async () => { /* no-op: spares live on the Spares page */ };

  const startNew = (kind: QuotationKind) => {
    setEditingId(null);
    setHeader({ ...blankHeader(), quotation_kind: kind, terms: orgQuotationTerms || DEFAULT_TERMS });
    setItems([]);
    setPickerOpen(false);
    setView("form");
  };
  const startEdit = async (id: number) => {
    try {
      const q = await getQuotation(id);
      setEditingId(id);
      setHeader({
        customer_name: q.customer_name || "", customer_address: q.customer_address || "",
        customer_gstin: q.customer_gstin || "", customer_contact: q.customer_contact || "",
        customer_contact_phone: q.customer_contact_phone || "",
        particular: q.particular || "", reference_no: q.reference_no || "", system_title: q.system_title || "",
        quotation_kind: q.quotation_kind || "retail",
        prepared_by_name: q.prepared_by_name || "", prepared_by_designation: q.prepared_by_designation || "",
        prepared_by_phone: q.prepared_by_phone || "",
        quotation_date: (q.quotation_date || today()).slice(0, 10),
        gst_rate: Number(q.gst_rate ?? 18),
        advance_amount: Number(q.advance_amount ?? 0),
        advance_date: q.advance_date ? q.advance_date.slice(0, 10) : "",
        terms: q.terms || DEFAULT_TERMS, notes: q.notes || "",
      });
      setItems(q.items?.length ? q.items.map((it) => ({ ...it, gst_rate: Number(it.gst_rate ?? 18), specifications: it.specifications || "", components: it.components || [] })) : []);
      setView("form");
    } catch (e: any) { toast.error(e?.message ?? "Failed to open quotation"); }
  };

  const payload = (): QuotationInput => ({
    ...header,
    gst_rate: Number(header.gst_rate) || 0,
    advance_amount: Number(header.advance_amount) || 0,
    items: items.filter((it) => it.name.trim()).map((it) => ({
      ...it, qty: Number(it.qty) || 0, rate: Number(it.rate) || 0, amount: Number(it.amount) || 0,
      gst_rate: Number(it.gst_rate ?? 18),
      specifications: it.specifications || "",
      components: (it.components || []).filter((c) => (c.name || "").trim() || (c.group || "").trim()),
    })),
  });

  // Map the builder's line items onto the Sri Vari quotation row shape for the
  // selected format (R2). Retail/industrial/stamping are machine-shaped rows;
  // service is a description row.
  const toSrivariRows = (kind: QuotationKind, its: QuotationItem[]): SrivariRow[] =>
    its.filter((it) => it.name.trim()).map((it, i) => {
      const base = Number(it.amount ?? (Number(it.qty || 0) * Number(it.rate || 0)));
      const common = { sno: String(i + 1), qty: it.qty != null ? String(it.qty) : undefined, basicPrice: base || undefined };
      return kind === "service"
        ? { ...common, description: [it.name, it.make, it.specifications].filter(Boolean).join(" — ") }
        : {
            ...common, model: it.name, unitPrice: Number(it.rate) || undefined,
            capacity: it.capacity || undefined, accuracy: it.accuracy || undefined, platformSize: it.platform_size || undefined,
          };
    });

  // Download the current quotation in the chosen Sri Vari letterhead format (R2).
  const downloadSrivari = (kind: QuotationKind = header.quotation_kind) => {
    const its = items.filter((it) => it.name.trim());
    if (!its.length) { toast.error("Add at least one line item first"); return; }
    const to = [header.customer_name, header.customer_address, header.customer_gstin ? `GSTIN: ${header.customer_gstin}` : "", header.customer_contact_phone ? `Phone: ${header.customer_contact_phone}` : ""]
      .filter((x) => x && String(x).trim()).join("\n");
    const subtotal = its.reduce((s, it) => s + Number(it.amount ?? Number(it.qty || 0) * Number(it.rate || 0)), 0);
    downloadSrivariQuotation({
      to,
      refNo: header.reference_no || "",
      date: header.quotation_date || "",
      rows: toSrivariRows(kind, its),
      total: subtotal,
    }, kind);
  };

  // Mark a quotation Accepted (best-effort) — the update endpoint expects the
  // whole record, so we resend it with status flipped. Shared by both convert
  // paths so a converted quotation is always flagged Accepted.
  const markQuotationAccepted = async (id: number, q: Quotation) => {
    if (q.status === "Accepted") return;
    try {
      await updateQuotation(id, {
        customer_name: q.customer_name,
        customer_address: q.customer_address || undefined,
        customer_gstin: q.customer_gstin || undefined,
        customer_contact: q.customer_contact || undefined,
        customer_contact_phone: q.customer_contact_phone || undefined,
        particular: q.particular || undefined,
        reference_no: q.reference_no || undefined,
        prepared_by_name: q.prepared_by_name || undefined,
        prepared_by_designation: q.prepared_by_designation || undefined,
        prepared_by_phone: q.prepared_by_phone || undefined,
        system_title: q.system_title || undefined,
        quotation_date: q.quotation_date ? q.quotation_date.slice(0, 10) : undefined,
        advance_amount: q.advance_amount || undefined,
        advance_date: q.advance_date ? q.advance_date.slice(0, 10) : undefined,
        terms: q.terms || undefined,
        notes: q.notes || undefined,
        status: "Accepted",
        items: q.items,
      });
      load();
    } catch { /* non-blocking */ }
  };

  // Convert an accepted quotation into a draft Delivery Challan (R3), prefilled
  // from the quotation. Off-books extra flows only when the extended login set it.
  const onConvertToChallan = async (id: number, no: string) => {
    let q: Quotation;
    try { q = await getQuotation(id); }
    catch (e: any) { toast.error(e?.message ?? "Failed to load quotation"); return; }
    if (!q.items?.length) { toast.error("This quotation has no line items."); return; }
    // Double-conversion guard: an already-Accepted quotation has been converted
    // at least once — require an explicit confirm before creating another challan.
    const msg = q.status === "Accepted"
      ? `Quotation ${no} is already marked Accepted (already converted once).\n\nCreate ANOTHER delivery challan from it anyway?`
      : `Convert quotation ${no} into a delivery challan?\n\nThis creates a DRAFT challan from the quotation's line items. Review it on the Delivery Challans page.`;
    if (!confirm(msg)) return;
    try {
      const itemsText = q.items.map((it) => `${it.name}${it.qty ? ` ×${it.qty}` : ""}`).join(", ");
      const amount = Number(q.subtotal ?? 0);
      const taxAmount = Number(q.gst_amount ?? 0);
      await createDelivery({
        customer_name: q.customer_name,
        items: itemsText,
        amount,
        tax_amount: taxAmount,
        notes: `Converted from Quotation ${q.quotation_no}.`,
        status: "draft",
      });
      // Flag the source quotation Accepted so it's visibly "used" in the list.
      await markQuotationAccepted(id, q);
      toast.success(`Delivery challan created from ${no}`);
      navigate("/deliveries");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to convert to delivery challan");
    }
  };

  // mode "update" saves the open quotation; "new" always creates a fresh copy
  // (so an edited quotation can be saved as a separate new one).
  const save = async (downloadAfter = false, mode: "update" | "new" = "update") => {
    if (!header.customer_name.trim()) { toast.error("Customer (M/S) name is required"); return; }
    if (!items.some((it) => it.name.trim())) { toast.error("Add at least one line item"); return; }
    setSaving(true);
    try {
      const saved = editingId && mode === "update"
        ? await updateQuotation(editingId, payload())
        : await createQuotation(payload());
      toast.success(`Quotation ${saved.quotation_no} saved`);
      // Best-effort: remember field values entered in this quotation for next time.
      remember("customer", header.customer_name);
      for (const it of items) { remember("make", it.make); remember("unit", it.unit); }
      // Best-effort: remember any new manual components for next time.
      await syncLibraryFromItems();
      if (downloadAfter) await downloadQuotationPdf(saved);
      setView("list"); load();
    } catch (e: any) { toast.error(e?.message ?? "Failed to save quotation"); }
    finally { setSaving(false); }
  };

  const onDownload = async (id: number) => {
    try { await downloadQuotationPdf(await getQuotation(id)); }
    catch (e: any) { toast.error(e?.message ?? "Failed to generate PDF"); }
  };
  const onDelete = async (id: number, no: string) => {
    if (!confirm(`Delete quotation ${no}?`)) return;
    try { await deleteQuotation(id); toast.success("Quotation deleted"); load(); }
    catch (e: any) { toast.error(e?.message ?? "Failed to delete"); }
  };

  // Convert an accepted quotation into a draft tax invoice, then open Invoices
  // so the user can review states / due date before sending.
  const onConvertToInvoice = async (id: number, no: string) => {
    let q: Quotation;
    try { q = await getQuotation(id); }
    catch (e: any) { toast.error(e?.message ?? "Failed to load quotation"); return; }
    if (!q.items?.length) { toast.error("This quotation has no line items to invoice."); return; }
    // Double-conversion guard: warn before invoicing a quotation that was already
    // converted (marked Accepted), so a stray second click can't duplicate it.
    const confirmMsg = q.status === "Accepted"
      ? `Quotation ${no} is already marked Accepted (already converted once).\n\nCreate ANOTHER tax invoice from it anyway?`
      : `Convert quotation ${no} into a tax invoice?\n\nThis creates a DRAFT invoice (from the quotation's line items) and marks the quotation Accepted. You can review it on the Invoices page.`;
    if (!confirm(confirmMsg)) return;
    try {

      // Derive seller/customer state from GSTINs so GST splits correctly.
      let sellerState = "";
      try { const st = await settingsApi.get(); sellerState = stateFromGstin(st.gstin || ""); } catch { /* settings optional */ }
      const customerState = stateFromGstin(q.customer_gstin || "");
      if (!sellerState) sellerState = customerState || "Tamil Nadu";

      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const today = new Date();
      const due = new Date(today.getTime() + 7 * 86400000);
      const allowed = new Set<number>(GST_RATES as unknown as number[]);

      const lines = q.items.map((it, i) => {
        let gst = Number(it.gst_rate ?? 18);
        if (!allowed.has(gst)) gst = 18;                       // invoice API only accepts 0/5/12/18/28
        const desc = [it.name, it.make, it.specifications].filter(Boolean).join(" — ");
        return { id: `q${i}`, description: desc || it.name, hsn: "", qty: Number(it.qty) || 0, unitPrice: Number(it.rate) || 0, gstRate: gst };
      });

      const inv = await invoicesApi.create({
        date: iso(today),
        dueDate: iso(due),
        customer: { name: q.customer_name, gstin: q.customer_gstin || "", state: customerState || sellerState, address: q.customer_address || "" },
        sellerState,
        lines,
        notes: `Converted from Quotation ${q.quotation_no}.${q.terms ? `\n\n${q.terms}` : ""}`,
        status: "Draft",
      });

      // Mark the source quotation Accepted (best-effort; conversion already succeeded).
      await markQuotationAccepted(id, q);

      toast.success(`Invoice ${inv.id} created from ${no}`);
      navigate("/invoices");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to convert to invoice");
    }
  };

  // ── LIST VIEW ───────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Quotation Builder</h1>
            <p className="text-muted-foreground">Assemble quotations and download branded PDFs.</p>
          </div>
          <Button onClick={() => setPickerOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> New Quotation</Button>
        </div>

        {/* Ask which Sri Vari format before opening the builder */}
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Which quotation format?</DialogTitle>
              <DialogDescription>Pick the Sri Vari letterhead this quotation should use — you can still change it later in the form.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {QUOTATION_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => startNew(k.value)}
                  className="rounded-lg border p-3 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <div className="font-semibold text-foreground">{k.label}</div>
                  <div className="text-xs text-muted-foreground">{k.description}</div>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        <div className="rounded-xl border bg-card">
          <div className="grid grid-cols-12 gap-2 border-b px-4 py-2.5 text-xs font-semibold text-muted-foreground">
            <div className="col-span-2">Quotation No.</div>
            <div className="col-span-3">Customer</div>
            <div className="col-span-3">Particular</div>
            <div className="col-span-1">Date</div>
            <div className="col-span-1 text-right">Total</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {loading ? (
            <div className="px-4 py-10 text-center text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center text-muted-foreground">
              <FileText className="mx-auto mb-3 h-8 w-8 opacity-40" />
              No quotations yet. Click <span className="font-medium text-foreground">New Quotation</span> to create one.
            </div>
          ) : rows.map((r) => (
            <div key={r.quotation_id} className="grid grid-cols-12 items-center gap-2 border-b px-4 py-3 text-sm last:border-0">
              <div className="col-span-2 font-medium text-foreground">
                {r.quotation_no}
                {r.status === "Accepted" && (
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary align-middle">Accepted</span>
                )}
              </div>
              <div className="col-span-3 truncate">{r.customer_name}</div>
              <div className="col-span-3 truncate text-muted-foreground">{r.particular || "—"}</div>
              <div className="col-span-1 text-xs text-muted-foreground">{r.quotation_date ? r.quotation_date.slice(0, 10) : "—"}</div>
              <div className="col-span-1 text-right font-medium">{inr(r.grand_total)}</div>
              <div className="col-span-2 flex justify-end gap-1">
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => onDownload(r.quotation_id)} title="Download PDF"><FileDown className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-primary" onClick={() => onConvertToInvoice(r.quotation_id, r.quotation_no)} title="Convert to Invoice (customer accepted)"><ReceiptText className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-primary" onClick={() => onConvertToChallan(r.quotation_id, r.quotation_no)} title="Convert to Delivery Challan"><Truck className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => startEdit(r.quotation_id)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => onDelete(r.quotation_id, r.quotation_no)} title="Delete"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── FORM VIEW ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => setView("list")}><ChevronLeft className="h-4 w-4" /> Back</Button>
          <h1 className="text-2xl font-bold text-foreground">{editingId ? "Edit Quotation" : "New Quotation"}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => save(false, "update")} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          {editingId && (
            <Button variant="outline" onClick={() => save(false, "new")} disabled={saving} title="Save the current edits as a brand-new quotation">Save as New</Button>
          )}
          <Button className="gap-2" onClick={() => save(true, "update")} disabled={saving}><FileDown className="h-4 w-4" /> Save &amp; Download PDF</Button>
          <Button variant="outline" className="gap-2" onClick={() => downloadSrivari()} title="Download in the selected Sri Vari format"><FileText className="h-4 w-4" /> Sri Vari PDF</Button>
        </div>
      </div>

      {/* Prompt → quotation (runs in the browser, no AI backend) */}
      <div className="rounded-xl border bg-card p-5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Build from prompt</span>
          <span className="text-xs text-muted-foreground">Type your requirement — it matches your products & quantities automatically.</span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={autoKit} onChange={(e) => setAutoKit(e.target.checked)} className="h-3.5 w-3.5" />
            Auto-add required components
          </label>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setKitOpen(true)}>Kit rules</Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={2}
            placeholder='e.g. "Quote for VELS Grand Square: 70 solar panels, 1 hybrid inverter 60kw, 100 m dc cable"'
            className="flex-1"
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") buildFromPrompt(); }}
          />
          <Button onClick={buildFromPrompt} className="gap-2 sm:self-stretch"><Sparkles className="h-4 w-4" /> Build</Button>
        </div>
      </div>

      {/* Header */}
      <div className="rounded-xl border bg-card p-5 grid gap-4 md:grid-cols-2">
        <div><label className="text-sm font-medium">Customer (M/S) *</label><Input list="opt-customer" value={header.customer_name} onChange={(e) => setH("customer_name", e.target.value)} onBlur={(e) => remember("customer", e.target.value)} placeholder="Customer / company name" className="mt-1" /></div>
        <div><label className="text-sm font-medium">Particular</label><Input value={header.particular} onChange={(e) => setH("particular", e.target.value)} placeholder="e.g. BURNER PANEL" className="mt-1" /></div>
        <div className="md:col-span-2"><label className="text-sm font-medium">Customer Address</label><Input value={header.customer_address} onChange={(e) => setH("customer_address", e.target.value)} className="mt-1" /></div>
        <div><label className="text-sm font-medium">Customer GSTIN</label><Input value={header.customer_gstin} onChange={(e) => setH("customer_gstin", e.target.value)} placeholder="e.g. 33ABCDE1234F1Z5" className="mt-1" /></div>
        <div><label className="text-sm font-medium">Kindly Attached</label><Input value={header.customer_contact} onChange={(e) => setH("customer_contact", e.target.value)} placeholder="Contact person" className="mt-1" /></div>
        <div><label className="text-sm font-medium">Contact Phone</label><Input value={header.customer_contact_phone} onChange={(e) => setH("customer_contact_phone", e.target.value)} className="mt-1" /></div>
        <div><label className="text-sm font-medium">Reference No</label><Input value={header.reference_no} onChange={(e) => setH("reference_no", e.target.value)} placeholder="e.g. VB_TN-1234" className="mt-1" /></div>
        <div className="md:col-span-2"><label className="text-sm font-medium">System / Title band</label><Input value={header.system_title} onChange={(e) => setH("system_title", e.target.value)} placeholder="e.g. HYBRID WITH 60KW BACKUP" className="mt-1" /></div>
        <div>
          <label className="text-sm font-medium">Sri Vari Format</label>
          <select
            value={header.quotation_kind}
            onChange={(e) => setH("quotation_kind", e.target.value as QuotationKind)}
            className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {QUOTATION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div><label className="text-sm font-medium">Prepared By</label><Input value={header.prepared_by_name} onChange={(e) => setH("prepared_by_name", e.target.value)} placeholder="Name" className="mt-1" /></div>
        <div><label className="text-sm font-medium">Designation</label><Input value={header.prepared_by_designation} onChange={(e) => setH("prepared_by_designation", e.target.value)} className="mt-1" /></div>
        <div><label className="text-sm font-medium">Prepared-By Phone</label><Input value={header.prepared_by_phone} onChange={(e) => setH("prepared_by_phone", e.target.value)} className="mt-1" /></div>
        <div><label className="text-sm font-medium">Quotation Date</label><Input type="date" value={header.quotation_date} onChange={(e) => setH("quotation_date", e.target.value)} className="mt-1" /></div>
        <div><label className="text-sm font-medium">GST %</label><Input type="number" value={header.gst_rate} onChange={(e) => setH("gst_rate", e.target.value)} className="mt-1" /></div>
        <div><label className="text-sm font-medium">Advance Amount (₹)</label><Input inputMode="decimal" placeholder="0" value={header.advance_amount ? String(header.advance_amount) : ""} onChange={(e) => setH("advance_amount", Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)} className="mt-1" /></div>
        <div><label className="text-sm font-medium">Advance Date</label><Input type="date" value={header.advance_date} onChange={(e) => setH("advance_date", e.target.value)} className="mt-1" /></div>
      </div>

      {/* Shared datalist for component-name dropdown (manual selection) */}
      <datalist id="component-options">
        {libNames.map((c) => <option key={c.component_id} value={c.name} />)}
      </datalist>

      {/* Persistent autocomplete datalists (grow as new values are entered) */}
      <datalist id="opt-customer">{customerOptions.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="opt-unit">{unitOptions.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="opt-make">{makeOptions.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="opt-group">{groupOptions.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="product-options">{productNames.map((v) => <option key={v} value={v} />)}</datalist>

      {/* Two-column workspace: line items on the left, a floating drag-bar of
          palettes on the right. Sidebar kicks in at md so it floats on most
          screens (not just very wide ones). */}
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_28rem]">

      {/* Floating palette drag-bar — stays pinned (sticky) while you scroll the
          line items, so the drag chips + quick-add buttons are always in reach.
          Collapsible so a tall palette never crowds the screen. */}
      <div className="order-first space-y-3 md:order-last md:sticky md:top-4 md:self-start md:z-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">

      {/* Collapse toggle — keeps the palette reachable but compact on demand */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 shadow-sm">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Package className="h-4 w-4" /> Item palette
        </span>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setPaletteOpen((o) => !o)}>
          {paletteOpen ? <><ChevronUp className="h-3.5 w-3.5" /> Hide</> : <><ChevronDown className="h-3.5 w-3.5" /> Show</>}
        </Button>
      </div>

      {paletteOpen && (<>
      {/* Spares palette (add-ons dragged onto a machine line) */}
      <div className="rounded-xl border bg-card p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Library className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Spares</span>
          <span className="text-xs text-muted-foreground">Drag a spare onto a machine line, or click + to add it to the last line.</span>
        </div>

        {library.length > 0 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={libSearch}
              onChange={(e) => setLibSearch(e.target.value)}
              placeholder="Search spares by name, part no or category…"
              className="h-9 pl-8 text-sm"
            />
          </div>
        )}

        {library.length === 0 ? (
          <p className="text-xs text-muted-foreground">No spares yet. Add them on the Spares page — they’ll appear here to drag onto machine lines.</p>
        ) : libByCategory.length === 0 ? (
          <p className="text-xs text-muted-foreground">No spares match “{libSearch}”.</p>
        ) : (
          <div className="space-y-3">
            {libByCategory.map(([cat, comps]) => (
              <div key={cat}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</div>
                <div className="flex flex-wrap gap-2">
                  {comps.map((c) => (
                    <div
                      key={c.component_id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/json", JSON.stringify(c));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className="group flex cursor-grab items-center gap-1 rounded-full border bg-muted/40 py-1 pl-2 pr-1 text-xs hover:bg-muted active:cursor-grabbing"
                      title={c.make ? `${c.name} · ${c.make}` : c.name}
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium text-foreground">{c.name}</span>
                      {c.make && <span className="text-muted-foreground">· {c.make}</span>}
                      <button
                        type="button"
                        onClick={() => addLibToLastItem(c)}
                        className="ml-0.5 grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                        title="Add to last line"
                      ><Plus className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="border-t pt-3 text-xs text-muted-foreground">Spares come from the Spares page. Add or edit them there and they’ll appear here.</p>
      </div>

      {/* Machines palette */}
      <div className="rounded-xl border bg-card p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Machines</span>
          <span className="text-xs text-muted-foreground">Drag a machine into the items list, or click + to add it as a new line item.</span>
        </div>

        {products.length > 0 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={prodSearch}
              onChange={(e) => setProdSearch(e.target.value)}
              placeholder="Search machines by name or category…"
              className="h-9 pl-8 text-sm"
            />
          </div>
        )}

        {products.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {prodStatus === "loading" ? "Loading machines…"
              : prodStatus === "error" ? "Couldn't load machines — check you're signed in and reload."
              : "No machines yet. Add them on the Machines page."}
          </p>
        ) : productsByCategory.length === 0 ? (
          <p className="text-xs text-muted-foreground">No machines match “{prodSearch}”.</p>
        ) : (
          <div className="space-y-3">
            {productsByCategory.map(([cat, prods]) => (
              <div key={cat}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</div>
                <div className="flex flex-wrap gap-2">
                  {prods.map((p) => (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-product", JSON.stringify(p));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className="group flex cursor-grab items-center gap-1 rounded-full border bg-muted/40 py-1 pl-2 pr-1 text-xs hover:bg-muted active:cursor-grabbing"
                      title={p.description || p.product}
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium text-foreground">{p.product}</span>
                      <span className="text-muted-foreground">· {productPriceLabel(p)}</span>
                      <button
                        type="button"
                        onClick={() => addProductItem(p)}
                        className="ml-0.5 grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                        title="Add as a new line item"
                      ><Plus className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </>)}

      </div>{/* /floating palette drag-bar */}

      {/* Items column — the WHOLE area is a product drop target, so dropping a
          product works even when there are zero line items. */}
      <div
        className={`min-w-0 space-y-4 rounded-xl p-2 transition-colors duration-150 ring-2 ring-inset ${dragOverItems ? "bg-primary/5 ring-primary/60" : "ring-transparent"}`}
        onDragOver={onItemsDragOver}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverItems(false); }}
        onDrop={onDropProduct}
      >
        {items.length === 0 && (
          <div className={`grid place-items-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${dragOverItems ? "border-primary/50" : "border-muted-foreground/30"}`}>
            <Package className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">Drag products here to add line items</p>
            <p className="text-xs text-muted-foreground">…or use the + on a product chip, or “Add Item” below.</p>
          </div>
        )}
        {items.map((it, i) => (
          <div key={i} className="rounded-xl border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-muted-foreground">Item {i + 1}</span>
              <Button size="sm" variant="ghost" className="h-8 gap-1 text-destructive" onClick={() => delItem(i)}><Trash2 className="h-4 w-4" /> Remove</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-12">
              <div className="md:col-span-12"><label className="text-xs text-muted-foreground">Link product (auto-fills name / rate / unit / specs)</label><Input list="product-options" placeholder="Type or pick a product…" onChange={(e) => applyProductToItem(i, e.target.value)} onBlur={(e) => applyProductToItem(i, e.target.value)} className="mt-1" /></div>
              <div className="md:col-span-4"><label className="text-xs text-muted-foreground">Product name *</label><Input value={it.name} onChange={(e) => updItem(i, { name: e.target.value })} className="mt-1" /></div>
              <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Make</label><Input list="opt-make" value={it.make} onChange={(e) => updItem(i, { make: e.target.value })} onBlur={(e) => remember("make", e.target.value)} className="mt-1" /></div>
              <div className="md:col-span-1"><label className="text-xs text-muted-foreground">Qty</label><Input type="number" value={it.qty} onChange={(e) => updItem(i, { qty: Number(e.target.value) })} className="mt-1" /></div>
              <div className="md:col-span-1"><label className="text-xs text-muted-foreground">Unit</label><Input list="opt-unit" value={it.unit} onChange={(e) => updItem(i, { unit: e.target.value })} onBlur={(e) => remember("unit", e.target.value)} className="mt-1" /></div>
              <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Rate (₹)</label><Input type="number" value={it.rate} onChange={(e) => updItem(i, { rate: Number(e.target.value) })} className="mt-1" /></div>
              <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Amount (₹)</label><Input type="number" value={it.amount} onChange={(e) => updItem(i, { amount: Number(e.target.value) })} className="mt-1" /></div>
              {kindSpecFields(header.quotation_kind).capacity && (
                <div className="md:col-span-3"><label className="text-xs text-muted-foreground">Capacity</label><Input value={it.capacity ?? ""} onChange={(e) => updItem(i, { capacity: e.target.value })} placeholder="e.g. 30kg" className="mt-1" /></div>
              )}
              {kindSpecFields(header.quotation_kind).accuracy && (
                <div className="md:col-span-3"><label className="text-xs text-muted-foreground">Accuracy</label><Input value={it.accuracy ?? ""} onChange={(e) => updItem(i, { accuracy: e.target.value })} placeholder="e.g. 1g" className="mt-1" /></div>
              )}
              {kindSpecFields(header.quotation_kind).platformSize && (
                <div className="md:col-span-3"><label className="text-xs text-muted-foreground">Platform Size</label><Input value={it.platform_size ?? ""} onChange={(e) => updItem(i, { platform_size: e.target.value })} placeholder="e.g. 400x400" className="mt-1" /></div>
              )}
              <div className="md:col-span-10"><label className="text-xs text-muted-foreground">Specifications</label><Input value={it.specifications ?? ""} onChange={(e) => updItem(i, { specifications: e.target.value })} placeholder="Technical specifications / details" className="mt-1" /></div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">GST %</label>
                <select
                  value={Number(it.gst_rate ?? 18)}
                  onChange={(e) => updItem(i, { gst_rate: Number(e.target.value) })}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {GST_OPTIONS.map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
            </div>

            {/* Components — drop target for library chips */}
            <div
              onDragOver={(e) => { e.preventDefault(); if (dragOverItem !== i) setDragOverItem(i); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverItem((cur) => (cur === i ? null : cur)); }}
              onDrop={(e) => onDropOnItem(i, e)}
              className={`rounded-lg p-3 transition-colors duration-150 ring-2 ring-inset ${dragOverItem === i ? "bg-primary/10 ring-primary/60" : "bg-muted/30 ring-transparent"}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Spares / add-ons</span>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => addComp(i)}><Plus className="h-3.5 w-3.5" /> Add spare</Button>
              </div>
              {it.components.length === 0 && <p className="text-xs text-muted-foreground">No spares added. Drag one from the Spares palette above.</p>}
              {it.components.map((c, ci) => (
                <div key={ci} className="mb-2 grid items-center gap-2 md:grid-cols-12">
                  <Input list="opt-group" placeholder="Group (optional)" value={c.group} onChange={(e) => updComp(i, ci, { group: e.target.value })} onBlur={(e) => remember("group", e.target.value)} className="md:col-span-3 h-8 text-sm" />
                  <Input list="component-options" placeholder="Spare name" value={c.name} onChange={(e) => updComp(i, ci, { name: e.target.value })} onBlur={(e) => autofillFromLibrary(i, ci, e.target.value)} className="md:col-span-4 h-8 text-sm" />
                  <Input list="opt-make" placeholder="Make" value={c.make} onChange={(e) => updComp(i, ci, { make: e.target.value })} onBlur={(e) => remember("make", e.target.value)} className="md:col-span-3 h-8 text-sm" />
                  <Input type="number" placeholder="Qty" value={c.qty} onChange={(e) => updComp(i, ci, { qty: Number(e.target.value) })} className="md:col-span-1 h-8 text-sm" />
                  <Button size="sm" variant="ghost" className="md:col-span-1 h-8 w-8 p-0 text-destructive" onClick={() => delComp(i, ci)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </div>
        ))}
        <Button variant="outline" onClick={addItem} className="gap-2"><Plus className="h-4 w-4" /> Add Item</Button>
      </div>{/* /items column */}

      </div>{/* /two-column workspace */}

      {/* Totals + terms */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <label className="text-sm font-medium">Terms &amp; Conditions</label>
          <Textarea value={header.terms} onChange={(e) => setH("terms", e.target.value)} rows={4} className="mt-1" />
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-medium">{inr(subtotal)}</span></div>
          {gstGroups.map((g) => (
            <div key={g.rate} className="flex justify-between"><span className="text-muted-foreground">{g.rate}% GST</span><span className="font-medium">{inr(g.gst)}</span></div>
          ))}
          <div className="flex justify-between border-t pt-2 text-base font-bold text-primary"><span>Grand Total</span><span>{inr(grandTotal)}</span></div>
          <div className="flex justify-between pt-1"><span className="text-muted-foreground">Advance</span><span className="font-medium">{inr(advance)}</span></div>
          <div className="flex justify-between text-base font-semibold"><span>Balance</span><span>{inr(balance)}</span></div>
        </div>
      </div>

      <KitRulesDialog open={kitOpen} onOpenChange={setKitOpen} />
    </div>
  );
}
