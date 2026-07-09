import { Plus, Search, Edit, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  fetchProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  toProductType,
  deriveCategoryOptions,
  DEFAULT_CATEGORY,
  type UIProduct as Product,
  type SizePrice,
} from "@/lib/api/products";
import { ScrollableX } from "@/components/ui/scrollable-x";

interface SubPurposeMap {
  [purpose: string]: string[];
}

interface FormState {
  id: number;
  product: string;
  sizes: SizePrice[];
  purposes: string[];
  subPurposes: SubPurposeMap;
  newPurpose: string;
  newSubPurpose: string;
  activePurposeForSub: string;
  description: string;
  category: string;
  gstRate: number;
  minOrderQty: number;
  imageUrl: string;
}

const emptyForm: FormState = {
  id: 0, product: "", sizes: [{ size: "", price: "" }], purposes: [], subPurposes: {},
  newPurpose: "", newSubPurpose: "", activePurposeForSub: "",
  description: "", category: DEFAULT_CATEGORY, gstRate: 18, minOrderQty: 1, imageUrl: ""
};


export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ ...emptyForm });

  // ── Load products from API on mount ───────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetchProducts()
      .then(setProducts)
      .catch(() => toast.error("Failed to load products"))
      .finally(() => setLoading(false));
  }, []);

  // Category options are derived from existing products (generic fallback when
  // none exist). Always include the current form's category so an edited
  // product's category stays selectable even if it's not in the derived list.
  const productCategories = (() => {
    const set = new Set<string>(deriveCategoryOptions(products));
    if (form.category?.trim()) set.add(form.category.trim());
    set.add(DEFAULT_CATEGORY);
    return [...set].sort((a, b) => a.localeCompare(b));
  })();

  const filtered = products.filter(p =>
    p.product.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  );

  // ── Parse price string "₹12/kg" → number 12 ───────────────────────────
  const parsePrice = (priceStr: string): number => {
    const num = parseFloat(priceStr.replace(/[^0-9.]/g, ""));
    return isNaN(num) ? 0 : num;
  };

  const handleAdd = async () => {
    const validSizes = form.sizes.filter(s => s.size && s.price);
    if (!form.product || validSizes.length === 0) { toast.error("Product and at least one size with price required"); return; }
    try {
      // Build configurations: size × purpose × sub_purpose
      const configurations: { size: string; purpose: string; sub_purpose?: string; price: number }[] = [];
      for (const s of validSizes) {
        const priceNum = parsePrice(s.price);
        if (form.purposes.length === 0) {
          configurations.push({ size: s.size, purpose: "General", price: priceNum });
        } else {
          for (const pur of form.purposes) {
            const subs = form.subPurposes[pur] ?? [];
            if (subs.length === 0) {
              configurations.push({ size: s.size, purpose: pur, price: priceNum });
            } else {
              for (const sub of subs) {
                configurations.push({ size: s.size, purpose: pur, sub_purpose: sub, price: priceNum });
              }
            }
          }
        }
      }

      await createProduct({
        product_name: form.product,
        product_type: toProductType(form.category),
        description: form.description,
        base_price: parsePrice(validSizes[0].price),
        gst_rate: form.gstRate,
        category: form.category,
        image_url: form.imageUrl,
        is_available: true,
        configurations,
      });
      toast.success(`Product "${form.product}" added`);
      setForm({ ...emptyForm });
      setAddOpen(false);
      fetchProducts().then(setProducts);
    } catch (err) {
      toast.error("Failed to add product: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleEdit = async () => {
    const validSizes = form.sizes.filter(s => s.size && s.price);
    if (!form.product || validSizes.length === 0) { toast.error("Product and at least one size with price required"); return; }
    try {
      // Build configurations: size × purpose, with all sub-purposes as separate rows
      const configurations: { size: string; purpose: string; sub_purpose?: string; price: number }[] = [];
      for (const s of validSizes) {
        const priceNum = parsePrice(s.price);
        if (form.purposes.length === 0) {
          configurations.push({ size: s.size, purpose: "General", price: priceNum });
        } else {
          for (const pur of form.purposes) {
            const subs = form.subPurposes[pur] ?? [];
            if (subs.length === 0) {
              configurations.push({ size: s.size, purpose: pur, price: priceNum });
            } else {
              for (const sub of subs) {
                configurations.push({ size: s.size, purpose: pur, sub_purpose: sub, price: priceNum });
              }
            }
          }
        }
      }

      await updateProduct(form.id, {
        product_name: form.product,
        product_type: toProductType(form.category),
        description: form.description,
        base_price: parsePrice(validSizes[0].price),
        gst_rate: form.gstRate,
        category: form.category,
        image_url: form.imageUrl,
        configurations,
      });
      toast.success(`Product "${form.product}" updated`);
      setEditOpen(false);
      fetchProducts().then(setProducts);
    } catch (err) {
      toast.error("Failed to update product: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleDelete = async (p: Product) => {
    try {
      await deleteProduct(p.id);
      setProducts(products.filter(x => x.id !== p.id));
      toast.success(`Product "${p.product}" deleted`);
    } catch {
      toast.error("Failed to delete product");
    }
  };

  const openEdit = (p: Product) => {
    setForm({
      id: p.id, product: p.product, sizes: [...p.sizes], purposes: [...p.purposes],
      subPurposes: JSON.parse(JSON.stringify(p.subPurposes)),
      newPurpose: "", newSubPurpose: "", activePurposeForSub: p.purposes[0] || "",
      description: p.description, category: p.category,
      gstRate: p.gstRate ?? 18,
      minOrderQty: p.minOrderQty, imageUrl: p.imageUrl
    });
    setEditOpen(true);
  };

  const updateSize = (index: number, field: keyof SizePrice, value: string) => {
    setForm(f => {
      const sizes = [...f.sizes];
      sizes[index] = { ...sizes[index], [field]: value };
      return { ...f, sizes };
    });
  };

  const addSizeRow = () => setForm(f => ({ ...f, sizes: [...f.sizes, { size: "", price: "" }] }));
  const removeSizeRow = (index: number) => setForm(f => ({ ...f, sizes: f.sizes.filter((_, i) => i !== index) }));

  const addPurpose = () => {
    if (!form.newPurpose.trim()) return;
    const purpose = form.newPurpose.trim();
    setForm(f => ({
      ...f,
      purposes: [...f.purposes, purpose],
      subPurposes: { ...f.subPurposes, [purpose]: [] },
      newPurpose: "",
      activePurposeForSub: purpose,
    }));
  };
  const removePurpose = (index: number) => {
    setForm(f => {
      const removed = f.purposes[index];
      const newSubPurposes = { ...f.subPurposes };
      delete newSubPurposes[removed];
      const newPurposes = f.purposes.filter((_, i) => i !== index);
      return {
        ...f, purposes: newPurposes, subPurposes: newSubPurposes,
        activePurposeForSub: newPurposes[0] || "",
      };
    });
  };

  const addSubPurpose = () => {
    if (!form.newSubPurpose.trim() || !form.activePurposeForSub) return;
    setForm(f => ({
      ...f,
      subPurposes: {
        ...f.subPurposes,
        [f.activePurposeForSub]: [...(f.subPurposes[f.activePurposeForSub] || []), f.newSubPurpose.trim()],
      },
      newSubPurpose: "",
    }));
  };
  const removeSubPurpose = (purpose: string, index: number) => {
    setForm(f => ({
      ...f,
      subPurposes: {
        ...f.subPurposes,
        [purpose]: (f.subPurposes[purpose] || []).filter((_, i) => i !== index),
      },
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      if (img.width !== 300 || img.height !== 300) {
        toast.error(`Image must be 300×300 pixels. Uploaded image is ${img.width}×${img.height}.`);
        URL.revokeObjectURL(url);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm(f => ({ ...f, imageUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const renderForm = (onSubmit: () => void, submitLabel: string) => (
    <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto pr-1">

      {/* Product Name */}
      <div>
        <label className="text-sm font-medium text-card-foreground">Product Name *</label>
        <Input
          placeholder="e.g. Product name"
          value={form.product}
          onChange={e => setForm(f => ({ ...f, product: e.target.value }))}
          className="mt-1"
        />
      </div>

      {/* Category */}
      <div>
        <label className="text-sm font-medium text-card-foreground">Category *</label>
        <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {productCategories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* GST rate — auto-applied when this product is added to a quotation/invoice */}
      <div>
        <label className="text-sm font-medium text-card-foreground">GST %</label>
        <Select value={String(form.gstRate)} onValueChange={v => setForm(f => ({ ...f, gstRate: Number(v) }))}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Select GST rate" />
          </SelectTrigger>
          <SelectContent>
            {[0, 5, 12, 18, 28].map(r => (
              <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">Used to calculate tax when this product is added to a quotation or invoice.</p>
      </div>

      {/* Description */}
      <div>
        <label className="text-sm font-medium text-card-foreground">Description</label>
        <Textarea
          placeholder="Brief product description..."
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          className="mt-1 resize-none"
          rows={2}
        />
      </div>

      {/* Product Image */}
      <div>
        <label className="text-sm font-medium text-card-foreground">Product Image (300 × 300 px)</label>
        <div className="flex items-center gap-4 mt-1">
          {form.imageUrl ? (
            <div className="relative group">
              <img src={form.imageUrl} alt="Product" className="h-20 w-20 rounded-lg object-cover border border-border" />
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, imageUrl: "" }))}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center h-20 w-20 rounded-lg border-2 border-dashed border-muted-foreground/30 cursor-pointer hover:border-primary/50 transition-colors">
              <Plus className="h-5 w-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground mt-0.5">Upload</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
          )}
          <p className="text-xs text-muted-foreground">Upload a 300×300 pixel image.<br />JPG, PNG or WebP.</p>
        </div>
      </div>

      {/* Sizes & Prices */}
      <div>
        <label className="text-sm font-medium text-card-foreground">Sizes & Prices *</label>
        <div className="space-y-2 mt-1">
          {form.sizes.map((sp, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input placeholder="Size (e.g. 6mm)" value={sp.size} onChange={e => updateSize(i, "size", e.target.value)} className="flex-1" />
              <Input placeholder="Price (e.g. ₹8.50/kg)" value={sp.price} onChange={e => updateSize(i, "price", e.target.value)} className="flex-1" />
              {form.sizes.length > 1 && (
                <button type="button" onClick={() => removeSizeRow(i)} className="p-1.5 hover:bg-destructive/10 rounded-lg"><X className="h-4 w-4 text-destructive" /></button>
              )}
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addSizeRow}>+ Add Size</Button>
      </div>

      {/* Purposes */}
      <div>
        <label className="text-sm font-medium text-card-foreground">Purposes</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {form.purposes.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2.5 py-1 rounded-full">
              {p}
              <button type="button" onClick={() => removePurpose(i)}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <Input placeholder="e.g. Commercial Kitchen" value={form.newPurpose} onChange={e => setForm(f => ({ ...f, newPurpose: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPurpose(); } }} />
          <Button type="button" variant="outline" size="sm" onClick={addPurpose}>Add</Button>
        </div>
      </div>

      {/* Sub-Purposes */}
      {form.purposes.length > 0 && (
        <div>
          <label className="text-sm font-medium text-card-foreground">Sub-Purposes</label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">Define sub-purpose options shown in the app for each purpose</p>

          {/* Purpose tabs */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {form.purposes.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setForm(f => ({ ...f, activePurposeForSub: p }))}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  form.activePurposeForSub === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Sub-purpose list for active purpose */}
          {form.activePurposeForSub && (
            <div className="border rounded-lg p-3 bg-muted/20">
              <p className="text-xs font-medium text-card-foreground mb-2">
                Sub-purposes for "{form.activePurposeForSub}"
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(form.subPurposes[form.activePurposeForSub] || []).map((sp, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-accent/60 text-accent-foreground text-xs px-2.5 py-1 rounded-full">
                    {sp}
                    <button type="button" onClick={() => removeSubPurpose(form.activePurposeForSub, i)}><X className="h-3 w-3" /></button>
                  </span>
                ))}
                {(form.subPurposes[form.activePurposeForSub] || []).length === 0 && (
                  <span className="text-xs text-muted-foreground italic">No sub-purposes added yet</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Restaurant Kitchen"
                  value={form.newSubPurpose}
                  onChange={e => setForm(f => ({ ...f, newSubPurpose: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSubPurpose(); } }}
                  className="text-sm"
                />
                <Button type="button" variant="outline" size="sm" onClick={addSubPurpose}>Add</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        <Button onClick={onSubmit}>{submitLabel}</Button>
      </DialogFooter>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Manage products shown in mobile app</p>
        </div>
        <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (v) setForm({ ...emptyForm, sizes: [{ size: "", price: "" }] }); }}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" /> Add Product</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add New Product</DialogTitle>
              <DialogDescription>This product will be visible in the mobile app.</DialogDescription>
            </DialogHeader>
            {renderForm(handleAdd, "Add Product")}
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>Update the product details below.</DialogDescription>
          </DialogHeader>
          {renderForm(handleEdit, "Save Changes")}
        </DialogContent>
      </Dialog>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-4 border-b">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search products..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollableX>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Category</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Sizes & Prices</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Purposes</th>
                
                
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading products...</td></tr>
              ) : filtered.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {p.imageUrl && <img src={p.imageUrl} alt={p.product} className="h-8 w-8 rounded object-cover" />}
                      <span className="text-sm font-medium text-card-foreground">{p.product}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{p.category}</td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      {p.sizes.map((sp, i) => (
                        <div key={i} className="text-xs text-muted-foreground">
                          <span className="font-medium text-card-foreground">{sp.size}</span> — {sp.price}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      {p.purposes.map((pur, i) => (
                        <div key={i}>
                          <span className="text-xs font-medium text-card-foreground">{pur}</span>
                          {p.subPurposes[pur] && p.subPurposes[pur].length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {p.subPurposes[pur].map((sp, j) => (
                                <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{sp}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  
                  
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => openEdit(p)} className="p-1.5 hover:bg-muted rounded-lg mr-1"><Edit className="h-4 w-4 text-muted-foreground" /></button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button className="p-1.5 hover:bg-destructive/10 rounded-lg"><Trash2 className="h-4 w-4 text-destructive" /></button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{p.product}"?</AlertDialogTitle>
                          <AlertDialogDescription>This will remove the product from the mobile app.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(p)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No products found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
      </div>
    </div>
  );
}
