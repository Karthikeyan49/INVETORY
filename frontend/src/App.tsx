import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useBrandTheme } from "@/hooks/useBrandTheme";
import { DashboardLayout } from "@/components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Machines from "./pages/Machines";
import MachineIssues from "./pages/MachineIssues";
import MachineMovementsLog from "./pages/MachineMovementsLog";
import InventoryItems from "./pages/InventoryItems";
import Purchases from "./pages/Purchases";
import Stamping from "./pages/Stamping";
import Followups from "./pages/Followups";
import Deliveries from "./pages/Deliveries";
import Orders from "./pages/Orders";
import Customers from "./pages/Customers";
import PendingApprovals from "./pages/PendingApprovals";
import Dealers from "./pages/Dealers";
import Invoices from "./pages/Invoices";
import Expenses from "./pages/Expenses";
import Finance from "./pages/Finance";
import FinancialStatements from "./pages/FinancialStatements";
import CapitalLoans from "./pages/CapitalLoans";
import GstInvoicing from "./pages/GstInvoicing";
import Reports from "./pages/Reports";
import Employees from "./pages/Employees";
import Attendance from "./pages/Attendance";
import Payroll from "./pages/Payroll";
import AdvanceRegister from "./pages/AdvanceRegister";
import Tasks from "./pages/Tasks";
import Meetings from "./pages/Meetings";
import Sops from "./pages/Sops";
import Workflows from "./pages/Workflows";
import SettingsPage from "./pages/Settings";
import Queries from "./pages/Queries";
import FAQPage from "./pages/FAQ";
import QuoteRequests from "./pages/QuoteRequests";
import Insights from "./pages/Insights";
import Procurement from "./pages/Procurement";
import SalesBilling from "./pages/SalesBilling";
import QuotationBuilder from "./pages/QuotationBuilder";
import DealerIntelligence from "./pages/DealerIntelligence";
import FinancePlanning from "./pages/FinancePlanning";
import HrCompliance from "./pages/HrCompliance";
import DataInterop from "./pages/DataInterop";
import InventoryDashboard from "./pages/inventory/InventoryDashboard";
import InventoryProducts from "./pages/inventory/InventoryProducts";
import InventoryZones from "./pages/inventory/InventoryZones";
import StockReceiving from "./pages/inventory/StockReceiving";
import InventoryMovements from "./pages/inventory/InventoryMovements";
import InventoryIntelligence from "./pages/inventory/InventoryIntelligence";
import InventoryApprovals from "./pages/inventory/InventoryApprovals";
import CycleCount from "./pages/inventory/CycleCount";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,          // treat data as fresh for 1 min → no refetch storm on navigation
      gcTime: 10 * 60_000,        // keep cached data for 10 min after a page unmounts
      refetchOnWindowFocus: false,// don't refetch every time the tab regains focus
      retry: 1,
    },
  },
});

function ProtectedRoutes() {
  const { isAuthenticated, loading, role, logout } = useAuth();

  // Apply the tenant's brand color to the runtime CSS theme once authenticated.
  useBrandTheme(isAuthenticated);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Dealers belong on their own site (dealer.inventory.com) — not the staff admin app.
  if (role === "dealer") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
        <p className="font-semibold text-foreground">This is the staff admin site.</p>
        <p className="text-sm text-muted-foreground">Dealers should sign in at <span className="font-medium">dealer.inventory.com</span>.</p>
        <button onClick={logout} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">Sign out</button>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/products" element={<Products />} />
        <Route path="/machines" element={<Machines />} />
        <Route path="/machine-issues" element={<MachineIssues />} />
        <Route path="/movements" element={<MachineMovementsLog />} />
        <Route path="/inventory-items" element={<InventoryItems />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/stamping" element={<Stamping />} />
        <Route path="/followups" element={<Followups />} />
        <Route path="/deliveries" element={<Deliveries />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/procurement" element={<Procurement />} />
        <Route path="/pending-approvals" element={<PendingApprovals />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/dealers" element={<Dealers />} />
        <Route path="/dealer-intelligence" element={<DealerIntelligence />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/sales-billing" element={<SalesBilling />} />
        <Route path="/quotation-builder" element={<QuotationBuilder />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/financial-statements" element={<FinancialStatements />} />
        <Route path="/capital-loans" element={<CapitalLoans />} />
        <Route path="/finance-planning" element={<FinancePlanning />} />
        <Route path="/gst-invoicing" element={<GstInvoicing />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/hr-compliance" element={<HrCompliance />} />
        <Route path="/payroll" element={<Payroll />} />
        <Route path="/advance-register" element={<AdvanceRegister />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/sops" element={<Sops />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/queries" element={<Queries />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/quote-requests" element={<QuoteRequests />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/data-interop" element={<DataInterop />} />
        <Route path="/inventory" element={<InventoryDashboard />} />
        <Route path="/inventory/products" element={<InventoryProducts />} />
        <Route path="/inventory/zones" element={<InventoryZones />} />
        <Route path="/inventory/receiving" element={<StockReceiving />} />
        <Route path="/inventory/movements" element={<InventoryMovements />} />
        <Route path="/inventory/intelligence" element={<InventoryIntelligence />} />
        <Route path="/inventory/approvals" element={<InventoryApprovals />} />
        <Route path="/inventory/cycle-count" element={<CycleCount />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </DashboardLayout>
  );
}

function LoginRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null; // wait for session check before deciding
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Login />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
