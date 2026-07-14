import { Search, Eye, Home, Briefcase, MapPin, KeyRound, FileText, Truck, ShoppingCart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { fetchCustomers, fetchCustomerOrderStats, updateCustomerStatus, mapApiUserToUI } from "@/lib/api/customers";
import { fetchCustomerOrders, type CustomerOrderRow } from "@/lib/api/orders";
import { fetchDeliveries, type DeliveryNote } from "@/lib/api/deliveries";
import { apiFetch } from "@/lib/api/client";
import { ScrollableX } from "@/components/ui/scrollable-x";

interface CustomerInvoiceRow {
  invoice_id: number;
  invoice_number: string;
  total: number;
  status: string;
  created_at: string;
}
export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string;
  userType: "Customer" | "Dealer";
  deliveryAddress: string;
  city: string;
  pincode: string;
  orders: number;
  lastOrder: string;
  totalSpent: string;
  cancelledOrders: number;
  accountCreatedDate: string;
  activeOrders: number;
  deliveredOrders: number;
  isActive: boolean;
}

export default function Customers() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [custOrders, setCustOrders] = useState<CustomerOrderRow[]>([]);
  const [custInvoices, setCustInvoices] = useState<CustomerInvoiceRow[]>([]);
  const [custDeliveries, setCustDeliveries] = useState<DeliveryNote[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchCustomers(100, "customer")
      .then(apiData => {
        setCustomers(apiData.map(u => mapApiUserToUI(u)));
      })
      .catch(() => toast.error("Failed to load customers"))
      .finally(() => setLoading(false));
  }, []);

  // Deep-link from Orders (or anywhere else): /customers?customer=<id> auto-opens that profile.
  useEffect(() => {
    const id = Number(searchParams.get("customer"));
    if (!id || customers.length === 0) return;
    const match = customers.find(c => c.id === id);
    if (match) view(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, searchParams]);

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  );

  const view = (c: Customer) => {
    setSelected(c);
    setOpen(true);
    // Fetch real per-status order stats from the backend
    setStatsLoading(true);
    fetchCustomerOrderStats(c.id)
      .then((stats) => {
        setSelected((prev) =>
          prev && prev.id === c.id
            ? {
                ...prev,
                orders: stats.total_orders,
                activeOrders: stats.active_orders,
                deliveredOrders: stats.delivered_orders,
                cancelledOrders: stats.cancelled_orders,
                returnedOrders: stats.returned_orders,
                totalSpent: `₹${stats.total_spent.toLocaleString("en-IN")}`,
              }
            : prev
        );
      })
      .catch(() => toast.error("Could not load order stats"))
      .finally(() => setStatsLoading(false));

    // Full relationship history — orders, invoices, delivery challans.
    setHistoryLoading(true);
    Promise.all([
      fetchCustomerOrders(c.id).catch(() => []),
      apiFetch<{ data: CustomerInvoiceRow[] }>(`/admin/invoices?customer_name=${encodeURIComponent(c.name)}&limit=10`)
        .then(r => r.data ?? []).catch(() => []),
      fetchDeliveries({ search: c.name }).then(r => r.rows).catch(() => []),
    ])
      .then(([orders, invoices, deliveries]) => {
        setCustOrders(orders);
        setCustInvoices(invoices);
        setCustDeliveries(deliveries);
      })
      .finally(() => setHistoryLoading(false));
  };

  const handleResetPassword = () => {
    if (selected) {
      toast.success(`Password reset email sent to ${selected.email}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Customers</h1>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customer Details</DialogTitle>
            <DialogDescription>Profile filled by user in the mobile app</DialogDescription>
          </DialogHeader>
          {selected && (
            <Tabs defaultValue="profile" className="mt-2">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="stats">Order Stats</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="space-y-3 py-2">
                <div className="bg-muted/30 rounded-lg p-4 space-y-2.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">User Type & Status</span>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Customer</Badge>
                      {selected.isActive ? (
                         <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Active</Badge>
                      ) : (
                         <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Inactive</Badge>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Full Name</span><span className="text-card-foreground font-medium">{selected.name}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Email Address</span><span className="text-card-foreground">{selected.email}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Phone Number</span><span className="text-card-foreground">{selected.phone}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Delivery Address</span><span className="text-card-foreground text-right max-w-[200px]">{selected.deliveryAddress}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">City</span><span className="text-card-foreground">{selected.city}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Pincode</span><span className="text-card-foreground">{selected.pincode}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Account Created</span><span className="text-card-foreground">{selected.accountCreatedDate}</span></div>
                </div>
                <div className="pt-2 flex justify-between">
                  <Button 
                    variant={selected.isActive ? "destructive" : "default"} 
                    size="sm" 
                    onClick={async () => {
                      try {
                        const newStatus = !selected.isActive;
                        await updateCustomerStatus(selected.id, newStatus);
                        const updated = { ...selected, isActive: newStatus };
                        setCustomers(customers.map(c => c.id === selected.id ? updated : c));
                        setSelected(updated);
                        toast.success(`Customer ${newStatus ? 'activated' : 'deactivated'} successfully`);
                      } catch (err) {
                        toast.error("Failed to update status");
                      }
                    }}
                  >
                    {selected.isActive ? "Deactivate Account" : "Activate Account"}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2"><KeyRound className="h-4 w-4" /> Reset Password</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Reset Password?</AlertDialogTitle>
                        <AlertDialogDescription>A password reset email will be sent to {selected.email}.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleResetPassword}>Send Reset Email</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TabsContent>

              <TabsContent value="stats" className="py-2">
                {statsLoading ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className={`p-3 border rounded-lg text-center animate-pulse ${i === 4 ? 'col-span-2' : ''}`}>
                        <div className="h-8 bg-muted rounded mb-1 mx-auto w-16" />
                        <div className="h-3 bg-muted rounded mx-auto w-20" />
                      </div>
                    ))}
                  </div>
                ) : (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-card-foreground">{selected.orders}</p>
                    <p className="text-xs text-muted-foreground">Total Orders</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-primary">{selected.totalSpent}</p>
                    <p className="text-xs text-muted-foreground">Total Spent</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-status-shipped">{selected.activeOrders}</p>
                    <p className="text-xs text-muted-foreground">Active Orders</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-primary">{selected.deliveredOrders}</p>
                    <p className="text-xs text-muted-foreground">Delivered</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-destructive">{selected.cancelledOrders}</p>
                    <p className="text-xs text-muted-foreground">Cancelled Orders</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-muted-foreground">{(selected as any).returnedOrders ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Returned</p>
                  </div>
                </div>
                )}
              </TabsContent>

              <TabsContent value="history" className="space-y-4 py-2">
                {historyLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Loading history…</p>
                ) : (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><ShoppingCart className="h-4 w-4" /> Recent Orders</span>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate("/orders")}>View all</Button>
                      </div>
                      {custOrders.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No orders yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {custOrders.map(o => (
                            <div key={o.order_id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                              <div>
                                <span className="font-medium text-foreground">{o.order_number}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{o.created_at?.slice(0, 10)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px] capitalize">{o.order_status}</Badge>
                                <span className="font-medium text-primary">₹{o.total_amount.toLocaleString("en-IN")}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><FileText className="h-4 w-4" /> Invoices</span>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate("/invoices")}>View all</Button>
                      </div>
                      {custInvoices.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No invoices yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {custInvoices.map(inv => (
                            <div key={inv.invoice_id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                              <div>
                                <span className="font-medium text-foreground">{inv.invoice_number}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{inv.created_at?.slice(0, 10)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px] capitalize">{inv.status}</Badge>
                                <span className="font-medium text-primary">₹{Number(inv.total).toLocaleString("en-IN")}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Truck className="h-4 w-4" /> Delivery Challans</span>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate("/deliveries")}>View all</Button>
                      </div>
                      {custDeliveries.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No delivery challans yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {custDeliveries.map(d => (
                            <div key={d.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                              <div>
                                <span className="font-medium text-foreground">{d.challan_no}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{d.delivery_date?.slice(0, 10) ?? "—"}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px] capitalize">{d.status}</Badge>
                                <span className="font-medium text-primary">{d.amount != null ? `₹${Number(d.amount).toLocaleString("en-IN")}` : "—"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-4 border-b">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search customers..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollableX>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Full Name</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Phone</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Email</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">City</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Orders</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Total Spent</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-card-foreground">{c.name}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{c.phone}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{c.email}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{c.city}</td>
                  <td className="px-6 py-4 text-sm font-medium text-card-foreground">{c.orders}</td>
                  <td className="px-6 py-4 text-sm font-medium text-primary">{c.totalSpent}</td>
                  <td className="px-6 py-4 text-sm">
                    {c.isActive 
                      ? <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Active</Badge>
                      : <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Inactive</Badge>
                    }
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => view(c)} className="p-1.5 hover:bg-muted rounded-lg"><Eye className="h-4 w-4 text-muted-foreground" /></button>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Loading customers...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">No customers found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
      </div>
    </div>
  );
}
