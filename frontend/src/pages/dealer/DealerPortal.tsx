/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard, Users, Tag, LogOut, Plus, RefreshCw, IndianRupee, ShoppingCart,
  AlertTriangle, Loader2, Leaf, Pencil, Link2, UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { dealerApi, type Row } from "@/lib/api/dealer";

const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const num = (n: unknown) => Number(n || 0);

const linkChip: Record<string, string> = {
  dealer_added: "bg-slate-100 text-slate-600",
  linked: "bg-emerald-100 text-emerald-700",
  conflict: "bg-amber-100 text-amber-700",
};
const linkLabel: Record<string, string> = {
  dealer_added: "Added by you",
  linked: "Linked account",
  conflict: "Needs review",
};

const emptyCustomer: Row = { name: "", phone: "", email: "", gstin: "", address: "", city: "", state: "", pincode: "" };

export default function DealerPortal() {
  const { userName, adminEmail, logout } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"dashboard" | "customers" | "prices">("dashboard");
  const [custOpen, setCustOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({ ...emptyCustomer });

  const dashboard = useQuery({ queryKey: ["dealer", "dashboard"], queryFn: () => dealerApi.dashboard() });
  const customers = useQuery({ queryKey: ["dealer", "customers"], queryFn: () => dealerApi.customers() });
  const prices = useQuery({ queryKey: ["dealer", "prices"], queryFn: () => dealerApi.priceList(), enabled: tab === "prices" });

  const saveCustomer = useMutation({
    mutationFn: async () => {
      if (!String(form.name).trim()) throw new Error("Customer name is required");
      const payload = { ...form };
      return editing
        ? dealerApi.updateCustomer(Number(editing.dealer_customer_id), payload)
        : dealerApi.createCustomer(payload);
    },
    onSuccess: (res: any) => {
      const status = res?.customer?.link_status ?? res?.link_status;
      if (status === "linked") toast.success("Saved — matched to an existing registered customer");
      else if (status === "conflict") toast.warning("Saved — flagged for review (possible duplicate)");
      else toast.success(editing ? "Customer updated" : "Customer added");
      setCustOpen(false); setEditing(null);
      qc.invalidateQueries({ queryKey: ["dealer", "customers"] });
      qc.invalidateQueries({ queryKey: ["dealer", "dashboard"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save customer"),
  });

  const openAdd = () => { setEditing(null); setForm({ ...emptyCustomer }); setCustOpen(true); };
  const openEdit = (c: Row) => {
    setEditing(c);
    setForm({ name: c.name ?? "", phone: c.phone ?? "", email: c.email ?? "", gstin: c.gstin ?? "", address: c.address ?? "", city: c.city ?? "", state: c.state ?? "", pincode: c.pincode ?? "" });
    setCustOpen(true);
  };

  const d = (dashboard.data ?? {}) as Row;
  const recent = (d.recent ?? []) as Row[];
  const custRows = (customers.data ?? []) as Row[];
  const priceItems = ((prices.data?.items ?? []) as Row[]);

  const navItems = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "customers", label: "My Customers", icon: Users },
    { key: "prices", label: "My Prices", icon: Tag },
  ] as const;

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"><Leaf className="h-4 w-4 text-primary" /></div>
            <div>
              <p className="text-sm font-bold leading-none text-foreground">Inventory Management System</p>
              <p className="text-[11px] text-muted-foreground">Dealer Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium leading-none">{userName || "Dealer"}</p>
              <p className="text-[11px] text-muted-foreground">{adminEmail}</p>
            </div>
            <Button variant="outline" size="sm" onClick={logout} className="gap-1.5"><LogOut className="h-4 w-4" /> Logout</Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl gap-1 px-2">
          {navItems.map((n) => (
            <button key={n.key} onClick={() => setTab(n.key)}
              className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
                tab === n.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <n.icon className="h-4 w-4" /> {n.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 p-4">
        {/* Dashboard */}
        {tab === "dashboard" && (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold">Welcome back{userName ? `, ${userName.split(" ")[0]}` : ""}</h1>
              <Button variant="outline" size="sm" onClick={() => dashboard.refetch()} className="gap-1.5"><RefreshCw className="h-4 w-4" /> Refresh</Button>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi icon={Users} label="My customers" value={String(num(d.customer_count))} />
              <Kpi icon={ShoppingCart} label="Orders" value={String(num(d.order_count))} />
              <Kpi icon={IndianRupee} label="This month" value={inr(d.month_order_value)} />
              <Kpi icon={AlertTriangle} label="Outstanding" value={inr(d.outstanding)} tone={num(d.outstanding) > 0 ? "amber" : undefined} />
            </div>
            {num(d.conflict_count) > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" /> {num(d.conflict_count)} of your customers need review (possible duplicate accounts). The Inventory Management System team will resolve these.
              </div>
            )}
            <div className="rounded-xl border bg-card shadow-sm">
              <div className="border-b px-4 py-3 font-semibold">Recent orders</div>
              {dashboard.isLoading ? <Loading /> : recent.length === 0 ? <Empty text="No orders yet." /> : (
                <div className="divide-y">
                  {recent.map((o) => (
                    <div key={o.order_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="font-mono">{o.order_number}</span>
                      <span className="truncate text-muted-foreground">{o.customer_name}</span>
                      <span className="ml-auto font-medium">{inr(o.total_amount)}</span>
                      <Badge variant="outline" className="capitalize">{String(o.order_status ?? "").replace("_", " ")}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* My Customers */}
        {tab === "customers" && (
          <>
            <div className="flex items-center justify-between">
              <div><h1 className="text-xl font-bold">My Customers</h1><p className="text-sm text-muted-foreground">Add and manage the customers you sell to.</p></div>
              <Button onClick={openAdd} className="gap-1.5"><UserPlus className="h-4 w-4" /> Add Customer</Button>
            </div>
            <div className="rounded-xl border bg-card shadow-sm">
              <ScrollableX>
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">GSTIN</th><th className="px-3 py-2">City</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
                  </thead>
                  <tbody>
                    {customers.isLoading ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                      : custRows.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No customers yet — add your first.</td></tr>
                      : custRows.map((c) => (
                        <tr key={c.dealer_customer_id} className="border-t">
                          <td className="px-3 py-2 font-medium">{c.name}{c.linked_customer_name && c.linked_customer_name !== c.name ? <span className="ml-1 text-xs text-muted-foreground">({c.linked_customer_name})</span> : ""}</td>
                          <td className="px-3 py-2">{c.phone || "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{c.gstin || "—"}</td>
                          <td className="px-3 py-2">{c.city || "—"}</td>
                          <td className="px-3 py-2"><Badge className={cn("gap-1", linkChip[c.link_status] ?? "")}>{c.link_status === "linked" && <Link2 className="h-3 w-3" />}{linkLabel[c.link_status] ?? c.link_status}</Badge></td>
                          <td className="px-3 py-2 text-right"><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </ScrollableX>
            </div>
          </>
        )}

        {/* My Prices */}
        {tab === "prices" && (
          <>
            <div className="flex items-center justify-between">
              <div><h1 className="text-xl font-bold">My Prices</h1><p className="text-sm text-muted-foreground">{prices.data?.price_list?.name ? `Price list: ${prices.data.price_list.name}` : "Your agreed product prices."}</p></div>
              <Button variant="outline" size="sm" onClick={() => prices.refetch()} className="gap-1.5"><RefreshCw className="h-4 w-4" /> Refresh</Button>
            </div>
            <div className="rounded-xl border bg-card shadow-sm">
              <ScrollableX>
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Your price</th><th className="px-3 py-2 text-right">Base price</th><th className="px-3 py-2">Source</th></tr>
                  </thead>
                  <tbody>
                    {prices.isLoading ? <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                      : priceItems.length === 0 ? <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No products available.</td></tr>
                      : priceItems.map((p) => (
                        <tr key={p.product_id} className="border-t">
                          <td className="px-3 py-2 font-medium">{p.product_name} {p.unit ? <span className="text-xs text-muted-foreground">/{p.unit}</span> : ""}{!p.is_available && <span className="ml-1 text-[11px] text-red-600">(unavailable)</span>}</td>
                          <td className="px-3 py-2 text-right font-semibold">{inr(p.unit_price)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{inr(p.base_price)}</td>
                          <td className="px-3 py-2">{p.source === "dealer_price_list" ? <Badge className="bg-primary/10 text-primary">Dealer rate</Badge> : <Badge variant="outline">Standard</Badge>}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </ScrollableX>
              <p className="px-4 py-2 text-[11px] text-muted-foreground">Prices are set by Inventory Management System. Contact your account manager for revisions.</p>
            </div>
          </>
        )}
      </main>

      {/* Add / edit customer */}
      <Dialog open={custOpen} onOpenChange={(v) => !saveCustomer.isPending && setCustOpen(v)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit customer" : "Add customer"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <F label="Name *" className="col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></F>
            <F label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></F>
            <F label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></F>
            <F label="GSTIN" className="col-span-2"><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} className="font-mono" /></F>
            <F label="Address" className="col-span-2"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></F>
            <F label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></F>
            <F label="State"><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></F>
            <F label="Pincode"><Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} maxLength={10} /></F>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustOpen(false)} disabled={saveCustomer.isPending}>Cancel</Button>
            <Button onClick={() => saveCustomer.mutate()} disabled={saveCustomer.isPending} className="gap-1.5">
              {saveCustomer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={cn("h-4 w-4", tone === "amber" ? "text-amber-500" : "text-primary")} /> {label}</div>
      <p className={cn("mt-1 text-2xl font-bold", tone === "amber" ? "text-amber-600" : "text-foreground")}>{value}</p>
    </div>
  );
}
function F({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="text-xs text-muted-foreground">{label}</Label><div className="mt-1">{children}</div></div>;
}
function Empty({ text }: { text: string }) { return <div className="py-8 text-center text-sm text-muted-foreground">{text}</div>; }
function Loading() { return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>; }
