import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, CheckCircle2, FileUp, Hash, PackageCheck, Scan, Search, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { inr, num, qty } from "@/lib/inventoryFormat";
import { AllocationResult } from "@/components/inventory/AllocationResult";
import {
  getInventoryProducts, receiveStock, triggerAllocation, getAllocationHistory,
  type InvProduct, type AllocationResultData,
} from "@/lib/api/inventory";

const STEPS = ["Product", "Details", "Review"] as const;

/** Auto-generate a unique batch code: ECO-YYYYMMDD-XXXX */
function generateBatchNumber(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `ECO-${date}-${rand}`;
}

const REF_TYPES = [
  { value: "PURCHASE_ORDER", label: "Purchase Order" },
  { value: "MANUAL", label: "Manual" },
];

export default function StockReceiving() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InvProduct | null>(null);

  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [batchNumber, setBatchNumber] = useState(() => generateBatchNumber());
  const [expiryDate, setExpiryDate] = useState("");
  const [refType, setRefType] = useState("PURCHASE_ORDER");
  const [refId, setRefId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);

  const [allocation, setAllocation] = useState<AllocationResultData | null>(null);
  const [done, setDone] = useState(false);

  const products = useQuery({ queryKey: ["inv", "products"], queryFn: () => getInventoryProducts({ limit: 500 }) });

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (products.data ?? []).filter((p) => !p.is_deleted);
    if (!q) return rows.slice(0, 8);
    return rows.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 8);
  }, [products.data, search]);

  const reset = () => {
    setStep(0); setSelected(null); setSearch(""); setQuantity(""); setUnitCost("");
    setSupplier(""); setBatchNumber(generateBatchNumber()); setExpiryDate("");
    setRefType("PURCHASE_ORDER"); setRefId(""); setRemarks(""); setFile(null);
    setAllocation(null); setDone(false); setScanning(false);
  };

  /** Barcode scan using browser BarcodeDetector API (Chrome 83+, Edge 83+) */
  const startBarcodeScan = async () => {
    if (!("BarcodeDetector" in window)) {
      toast.error("Barcode scanning not supported in this browser. Use Chrome or Edge.");
      return;
    }
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.play();
      // @ts-expect-error BarcodeDetector not yet in TS lib
      const detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code", "ean_13", "code_39"] });
      const scanLoop = async () => {
        if (!video.videoWidth) { requestAnimationFrame(scanLoop); return; }
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            const code = barcodes[0].rawValue as string;
            stream.getTracks().forEach((t) => t.stop());
            setScanning(false);
            setSearch(code);
            toast.success(`Scanned: ${code}`);
          } else {
            requestAnimationFrame(scanLoop);
          }
        } catch { requestAnimationFrame(scanLoop); }
      };
      video.addEventListener("playing", () => requestAnimationFrame(scanLoop));
    } catch {
      setScanning(false);
      toast.error("Could not access camera. Allow camera permission and try again.");
    }
  };

  const confirm = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a product first");
      if (num(quantity) <= 0) throw new Error("Quantity must be greater than zero");
      await receiveStock({
        product_id: selected.inv_product_id,
        quantity: num(quantity),
        unit_cost: num(unitCost) || num(selected.standard_cost),
        reference_type: refType,
        reference_id: num(refId) > 0 ? num(refId) : null,
        remarks: [supplier.trim() ? `Supplier: ${supplier.trim()}` : null, remarks.trim() || null].filter(Boolean).join(" | ") || null,
        batch_number: batchNumber.trim() || null,
        expiry_date: expiryDate || null,
      });
      // Run smart allocation; tolerate backends that auto-allocate on receive.
      let alloc: AllocationResultData | null = null;
      try {
        alloc = await triggerAllocation({ product_id: selected.inv_product_id, quantity: num(quantity) });
      } catch {
        try { alloc = await getAllocationHistory(selected.inv_product_id); } catch { alloc = null; }
      }
      return alloc;
    },
    onSuccess: (alloc) => {
      toast.success("Stock received successfully");
      setAllocation(alloc);
      setDone(true);
      qc.invalidateQueries({ queryKey: ["inv", "products"] });
      qc.invalidateQueries({ queryKey: ["inv", "movements", { limit: 10 }] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not receive stock"),
  });

  const canNext = step === 0 ? !!selected : step === 1 ? num(quantity) > 0 : true;
  const reorderLevel = num(selected?.reorder_level);
  const available = num(selected?.available_quantity);
  const belowReorder = reorderLevel > 0 && available <= reorderLevel;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Stock Receiving</h1>
        <p className="text-muted-foreground">Receive stock against a PO or manually, then let the engine allocate it.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
              i < step ? "border-emerald-500 bg-emerald-500 text-white"
                : i === step ? "border-primary bg-primary text-primary-foreground"
                : "border-muted text-muted-foreground")}>
              {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className={cn("text-sm", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        {/* Step 1 — product selection */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search product by name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Button type="button" variant="outline" className="gap-2 shrink-0" onClick={startBarcodeScan} disabled={scanning}>
                <Scan className="h-4 w-4" />{scanning ? "Scanning…" : "Scan Barcode"}
              </Button>
            </div>
            <div className="divide-y rounded-lg border">
              {products.isLoading ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : matches.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No products match.</p>
              ) : matches.map((p) => (
                <button key={p.inv_product_id} onClick={() => setSelected(p)}
                  className={cn("flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40",
                    selected?.inv_product_id === p.inv_product_id && "bg-primary/5")}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-card-foreground">{p.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    on hand {qty(p.available_quantity ?? 0)} {p.uom}
                  </div>
                </button>
              ))}
            </div>

            {selected && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium text-card-foreground">{selected.name} <span className="font-mono text-xs text-muted-foreground">({selected.sku})</span></p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Current stock: <span className="font-semibold text-foreground">{qty(available)} {selected.uom}</span></span>
                  <span className="text-muted-foreground">Reorder level: {qty(reorderLevel)}</span>
                  <Badge className={cn("border-transparent", belowReorder ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>
                    {belowReorder ? "Below reorder" : "Healthy"}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — stock details */}
        {step === 1 && selected && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier Name" className="col-span-2"><Input placeholder="e.g. ABC Wood Suppliers Pvt Ltd" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
            <Field label="Batch Number">
              <div className="flex gap-2">
                <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} className="font-mono text-sm" />
                <Button type="button" variant="outline" size="icon" title="Re-generate batch number" onClick={() => setBatchNumber(generateBatchNumber())}><Hash className="h-4 w-4" /></Button>
              </div>
            </Field>
            <Field label="Expiry Date (optional)"><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Quantity *"><Input type="number" min="0" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
            <Field label="Unit Cost (₹)"><Input type="number" min="0" step="0.01" placeholder={String(num(selected.standard_cost))} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
            <Field label="Reference Type">
              <Select value={refType} onValueChange={setRefType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{REF_TYPES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Reference ID"><Input type="number" min="0" placeholder="e.g. PO id" value={refId} onChange={(e) => setRefId(e.target.value)} /></Field>
            <Field label="Remarks" className="col-span-2"><Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
            <Field label="Document attachment" className="col-span-2">
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]); }}
                className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed py-6 text-muted-foreground hover:bg-muted/30"
              >
                {file ? <><FileUp className="h-6 w-6 text-primary" /><span className="text-sm text-foreground">{file.name}</span></>
                  : <><Upload className="h-6 w-6 opacity-50" /><span className="text-sm">Drag & drop or click to attach (PDF/JPG/PNG)</span></>}
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            </Field>
          </div>
        )}

        {/* Step 3 — review & confirm */}
        {step === 2 && selected && (
          <div className="space-y-4">
            {!done ? (
              <>
                <div className="rounded-lg border">
                  <Row label="Product" value={`${selected.name} (${selected.sku})`} />
                  {supplier && <Row label="Supplier" value={supplier} />}
                  <Row label="Batch No." value={batchNumber} />
                  {expiryDate && <Row label="Expiry Date" value={new Date(expiryDate).toLocaleDateString("en-IN")} />}
                  <Row label="Quantity" value={`${qty(quantity)} ${selected.uom}`} />
                  <Row label="Unit cost" value={inr(num(unitCost) || num(selected.standard_cost))} />
                  <Row label="Total value" value={inr((num(unitCost) || num(selected.standard_cost)) * num(quantity))} />
                  <Row label="Reference" value={`${REF_TYPES.find((r) => r.value === refType)?.label ?? refType}${num(refId) > 0 ? ` · #${refId}` : ""}`} />
                  {remarks && <Row label="Remarks" value={remarks} />}
                  {file && <Row label="Attachment" value={file.name} />}
                </div>
                <p className="text-xs text-muted-foreground">The engine will allocate received stock across the appropriate zones after confirmation.</p>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
                  <CheckCircle2 className="h-5 w-5" /> Received {qty(quantity)} {selected.uom} of {selected.name}.
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-card-foreground">Predicted allocation</p>
                  <AllocationResult result={allocation} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        {!done ? (
          <>
            <Button variant="outline" className="gap-2" disabled={step === 0 || confirm.isPending} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {step < 2 ? (
              <Button className="gap-2" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Next <ArrowRight className="h-4 w-4" /></Button>
            ) : (
              <Button className="gap-2" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
                <PackageCheck className="h-4 w-4" /> {confirm.isPending ? "Receiving…" : "Confirm receipt"}
              </Button>
            )}
          </>
        ) : (
          <Button className="ml-auto gap-2" onClick={reset}><PackageCheck className="h-4 w-4" /> Receive another</Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="text-xs text-muted-foreground">{label}</Label><div className="mt-1">{children}</div></div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-card-foreground">{value}</span>
    </div>
  );
}
